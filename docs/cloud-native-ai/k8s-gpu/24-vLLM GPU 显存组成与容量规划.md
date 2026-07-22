---
title: vLLM GPU 显存组成与容量规划
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["vLLM", "GPU", "显存", "KV Cache", "容量规划", "学习路线"]
---

# vLLM GPU 显存组成与容量规划

> **版本提示**：vLLM 参数与日志字段随版本变化。实践时固定 **vLLM 镜像、驱动、GPU Operator** 版本，不要使用 `latest`。示例基于 vLLM OpenAI 兼容服务。

部署时不能只算模型权重大小。显存通常还包括：KV Cache、激活、临时缓冲、CUDA Context / Graph、NCCL 缓冲、量化元数据、分配器预留与碎片。理论权重 16GB **不代表**一定能稳跑在 16GB 卡上。

前置：[部署 vLLM](./23-Kubernetes%20部署%20vLLM%20推理服务.md)；指标见 [第 28 篇](./28-大模型推理服务性能指标设计.md)。

---

## 1. 学习目标

理解显存组成；粗算权重；理解 KV Cache 与上下文/并发；使用 `gpu-memory-utilization` / `kv-cache-memory-bytes`；用日志与指标验证；制定上线前压测流程。

---

## 2. 显存总体结构

```text
GPU总显存
├── 驱动和 CUDA Context
├── 模型权重（启动后相对固定）
├── CUDA Graph / 编译缓存
├── 激活值及临时张量
├── 通信缓冲区
├── KV Cache（并发与长上下文的核心）
└── 安全余量
```

---

## 3. 模型权重

```text
权重显存 ≈ 参数量 × 单参数字节数
```

| 类型 | 理论大小 |
|------|----------|
| FP32 | 4 B |
| FP16 / BF16 | 2 B |
| INT8 | 1 B |
| INT4 | 0.5 B |

例：32B BF16 ≈ 64GB；TP=4 时主体约每卡 16GB，但仍有 Scale、未切分参数、词表、CUDA、通信、对齐等——只作第一轮筛选。

量化模型还有 Scale / Zero Point / Group 元数据、未量化层、反量化缓冲等，**不能**简单用 `P × 0.5` 当最终需求。最可靠：固定模型 / vLLM / GPU → 启动记真实显存 → 并发与长上下文压测。

---

## 4. KV Cache

自回归生成要复用历史 Key/Value，存在 KV Cache。大致受：层数、KV Head 数、Head Dim、KV 数据类型、已缓存 Token、并发、TP 方式影响。

```text
单 Token KV ≈ 2 × 层数 × KV_Head × Head_Dim × 元素字节数
总 KV ≈ 单 Token × 所有请求当前 Token 总数
```

请求越多、上下文越长、输出越长 → KV 越大。假设池能存 100k Token，可支持「100×1k」或「10×10k」或「2×50k」等组合，还受 PagedAttention Block 与调度影响。

启动日志常有：

```text
GPU KV cache size: ... tokens
Maximum concurrency for ... tokens per request: ...x
```

前者为可存 KV Token 总量，后者为指定最大请求长度下的并发估算。

---

## 5. 核心参数

### 5.1 `--gpu-memory-utilization`

例：`0.90` 表示本实例可用该卡显存的一部分（权重、KV、运行时等）。**不感知**同卡其他 vLLM 实例，多实例同卡仍可能超配。生产明确配置（如 `0.88`），勿盲信默认。过高易启动 OOM / 碎片 / NCCL 失败；过低则 KV 小、并发差。建议首次从 **0.85～0.90** 验证，勿直接 `0.99`。

### 5.2 `--kv-cache-memory-bytes`

例：`20G`。一旦设置，用显式 KV 大小，不再靠 utilization 自动推 KV。适合稳定复现、统一容量、预留通信缓冲；勿一上来盲设——先让自动计算，再据日志与压测固定。

### 5.3 `--max-model-len`

单请求 Prompt+Output 总上限。勿因模型声明 128K 就配 `131072`——会抬高单请求资源、压低并发、影响 Graph 与 KV 规划。按业务 P95/P99 输入与最大输出定。

### 5.4 `--kv-cache-dtype` / `--cpu-offload-gb`

KV 默认 `auto`；FP8/INT8 等可省显存但影响精度与后端。CPU Offload 可略超显存加载，依赖 PCIe/NUMA，适合验证与低吞吐，**不宜**当默认高性能方案。

---

## 6. 其他占用

CUDA Context、CUDA Graph、Prefill 激活、NCCL 缓冲、显存碎片（`nvidia-smi` 有空闲仍可能因无足够连续块而失败）。

推荐起步：

```bash
exec vllm serve /models/Qwen \
  --host 0.0.0.0 --port 8000 \
  --served-model-name qwen \
  --tensor-parallel-size 4 \
  --gpu-memory-utilization 0.88 \
  --max-model-len 32768
```

先固定模型/精度/TP/上下文/利用率，再逐步试量化 KV、Prefix Cache、Offload、更大上下文与更高并发。

---

## 7. 验证

```bash
kubectl logs -f <vllm-pod>
kubectl logs <vllm-pod> | grep -Ei 'memory|cache|concurrency|oom|nccl'

watch -n 1 nvidia-smi   # 启动前 / 加载中 / Ready / 单请求 / 高并发
```

Prometheus（`/metrics`）关注：`vllm:kv_cache_usage_perc`、`num_requests_running` / `waiting`、延迟与排队直方图。`kv_cache_usage_perc=1` 表示 KV 已满。

---

## 8. 容量规划流程

1. 权重能否加载：`参数量 × 精度 ÷ TP + 运行时开销`  
2. 业务上下文：平均 / P95 / 最大输入与输出  
3. 启动读 `GPU KV cache size` 与 `Maximum concurrency`  
4. 压测并发 1→16，上下文 1K→32K  
5. 安全区间：极限若 16 并发，生产先 10～12，留长度波动与碎片  

**误区**：显存未满还能加并发；TP=4 每卡严格四分之一；模型支持 128K 就该部署 128K；显存 90% 等于业务繁忙。

---

## 9. 本篇总结

规划同时看：权重、KV、激活、Graph、通信、碎片、余量。可靠路径：理论估算 → 实际启动 → 日志 → 并发/长上下文压测 → Prometheus。

下一篇：[Tensor Parallel 多卡部署](./25-vLLM%20Tensor%20Parallel%20多卡部署.md)。

---

## 参考与致谢

- [vLLM Engine Arguments](https://docs.vllm.ai/en/latest/configuration/engine_args.html)
- [vLLM Production Metrics](https://docs.vllm.ai/en/latest/usage/metrics.html)
- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/)

本文按 vLLM 文档整理，并按本系列做了交叉链接。
