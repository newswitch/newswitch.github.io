---
title: "vLLM 与大模型推理学习路线"
sidebar_position: 0
tags: [vLLM, LLM, 推理, KV Cache, PagedAttention, 学习路线]
description: "从 Transformer 推理、Prefill/Decode、KV Cache 和调度开始，系统学习 vLLM 架构、并行部署、性能分析与生产运维。"
---

# vLLM 与大模型推理学习路线

vLLM 不只是一个“启动大模型的命令行工具”。要真正部署、调优和排障，需要同时理解：

```text
HTTP / SSE 协议
→ Chat Template 与 Tokenization
→ Scheduler 与 Continuous Batching
→ Prefill / Decode
→ KV Cache / PagedAttention / Prefix Cache
→ CUDA Kernel
→ TP / PP / DP / EP
→ NCCL / NVLink / RDMA
→ Gateway / 路由 / 限流 / 扩缩容
→ 指标 / SLO / 发布 / 故障恢复
```

本模块分成两条学习线：

1. **源码线**：理解 vLLM 内部对象和算法如何实现。
2. **生产线**：理解请求路径、资源模型、部署架构、性能和可靠性。

---

## 1. 版本说明

原有六篇源码笔记基于 **vLLM 0.6.3**，主要描述 V0 架构：

- `LLMEngine`
- 旧 Scheduler 队列。
- `BlockSpaceManager`
- GPU/CPU KV Cache Swap。
- `PrefixCachingBlockAllocator`

这些文章适合学习设计思想和历史实现，但不能把所有类名、默认值和执行流程直接套到
当前 V1。

新补充文章以当前 vLLM V1 官方文档为基线，重点描述稳定的工程概念。执行实验前仍要：

```bash
vllm --version
vllm serve --help
```

并固定镜像 Digest、模型 Revision、驱动和 CUDA 版本。

---

## 2. 学习前置

### 必须具备

- Python 和 PyTorch 基础。
- Transformer 自回归生成流程。
- GPU、HBM、PCIe、NVLink 基础。
- Kubernetes Deployment、Service、Probe 和 GPU 调度。
- Prometheus Counter、Gauge、Histogram。

### 推荐先读

- [GPU 基础知识](../../../foundations/compute/gpu/01-GPU%20基础知识：从计算核心到显存.md)
- [HBM 显存原理](../../../foundations/compute/gpu/02-HBM显存原理：容量、带宽与访问效率.md)
- [CPU 与 GPU 之间的数据搬运](../../../foundations/compute/gpu/04-CPU与GPU之间的数据搬运.md)
- [NVLink 与 NVSwitch](../../../foundations/compute/gpu/05-NVLink与NVSwitch原理.md)
- [Kubernetes 部署 vLLM](../serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)

---

## 3. 第一阶段：一次推理到底发生了什么

目标：能从 HTTP 请求一直讲到首 token 和流式结束。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 01 | [推理请求从 HTTP 到首个 Token 的完整生命周期](./07-推理请求从HTTP到首个Token的完整生命周期.md) | 能画出 Gateway、API Server、EngineCore、Worker、GPU 和 SSE 路径 |
| 02 | [Prefill、Decode 与 KV Cache 资源模型](./08-Prefill-Decode与KV-Cache资源模型.md) | 能解释 TTFT、TPOT、显存和吞吐的来源 |
| 03 | [Continuous Batching 与 Chunked Prefill](./09-Continuous-Batching与Chunked-Prefill.md) | 能解释调度预算、长短请求干扰和尾延迟 |

完成后应能回答：

- 为什么长 Prompt 主要影响 TTFT？
- 为什么 Decode 常常受显存带宽限制？
- 为什么 HTTP 200 不代表流式请求完成？
- 为什么 KV Cache 满不等于 CUDA OOM？
- 为什么大 Prefill 会影响正在 Decode 的请求？

---

## 4. 第二阶段：阅读 vLLM 源码

原有源码笔记：

| 顺序 | 文章 | 版本定位 |
| --- | --- | --- |
| 01 | [整体代码架构](./vLLM学习笔记（一）整体代码架构.md) | V0 `LLMEngine` 与 Worker |
| 02 | [调度前的预处理工作](./vLLM学习笔记（二）vLLM调度前的预处理工作.md) | V0 输入处理与请求对象 |
| 03 | [调度器策略](./vLLM学习笔记（三）vLLM调度器策略.md) | V0 Scheduler |
| 04 | [BlockSpaceManager](./vLLM学习笔记（四）BlockSpaceManager.md) | V0 KV Block 管理 |
| 05 | [PrefixCachingBlockAllocator](./vLLM学习笔记（五）PrefixCachingBlockAllocator.md) | V0 Prefix Cache 实现 |
| 06 | [参数使用](./vLLM学习笔记（六）参数使用.md) | 旧版本参数，需要与当前 CLI 核对 |

### V1 源码建议入口

```text
OpenAI API Server
→ AsyncLLM / EngineClient
→ EngineCore
→ Scheduler
→ KVCacheManager
→ ModelExecutor
→ Worker / ModelRunner
→ Attention Backend / CUDA Kernel
→ OutputProcessor
```

源码阅读不要从整个仓库第一行开始。先用一次请求建立调用链，再对照指标和日志定位对象。

---

## 5. 第三阶段：显存与缓存

需要掌握：

- 模型权重。
- CUDA Context。
- 激活值和临时 Workspace。
- KV Cache。
- CUDA Graph。
- NCCL Buffer。
- Prefix Cache。
- KV Cache quantization。

已有文章：

- [vLLM GPU 显存组成与容量规划](../serving/02-vLLM%20GPU%20显存组成与容量规划.md)
- [CUDA OOM 排查与优化](../../../platform/gpu-cluster/troubleshooting/05-CUDA%20OOM%20排查与优化.md)

计划继续补充：

- Automatic Prefix Caching 的哈希、Block、引用计数和 LRU。
- 多租户 Prefix Cache 隔离与 `cache_salt`。
- KV Cache Offload 与外部 KV Connector。
- Prefill/Decode 分离及 KV Cache 传输。

---

## 6. 第四阶段：并行推理

| 策略 | 解决问题 |
| --- | --- |
| TP | 单卡放不下模型，按层内张量切分 |
| PP | 按层切成多个流水线 Stage |
| DP | 复制模型，独立处理不同请求批次 |
| EP | MoE Expert 分布到不同设备 |
| DP Attention | Attention 复制/分组，Expert 使用 EP |

学习文章：

- [TP、PP、DP、EP 与 MoE 推理并行策略](./10-TP-PP-DP-EP与MoE推理并行策略.md)
- [vLLM Tensor Parallel 多卡部署](../serving/03-vLLM%20Tensor%20Parallel%20多卡部署.md)
- [NCCL 通信原理](../../training/distributed/05-NCCL%20通信原理与常见问题.md)
- [多机训练的完整路径](../../../projects/end-to-end/04-多机训练的完整路径.md)

---

## 7. 第五阶段：生产服务

| 文章 | 技术重点 |
| --- | --- |
| [推理网关、准入控制与过载保护](./11-推理网关准入控制与过载保护.md) | 队列、并发、Token 预算、超时、限流、负载感知路由 |
| [大模型推理服务性能指标](../serving/06-大模型推理服务性能指标设计.md) | TTFT、TPOT、E2E、waiting、KV Cache |
| [探针设计](../serving/04-大模型服务%20Kubernetes%20探针设计.md) | startup/readiness/liveness |
| [滚动升级与优雅退出](../serving/05-大模型推理服务滚动升级与优雅退出.md) | 摘流、Drain、SSE、回滚 |
| [LLM 服务 SLI/SLO](../../../engineering/reliability/01-LLM服务SLI-SLO-SLA工程化.md) | 可用性、流式完成、延迟 SLO |

---

## 8. 第六阶段：性能分析

一次调优必须固定：

```text
模型与 Revision
量化和 dtype
GPU 型号与数量
TP/PP/DP/EP
输入 Token 分布
输出 Token 分布
并发和到达模型
Prefix Cache 命中率
max_num_seqs
max_num_batched_tokens
网络与存储环境
```

核心结果：

- QPS。
- Prompt tokens/s。
- Generation tokens/s。
- TTFT P50/P95/P99。
- TPOT/ITL P50/P95/P99。
- E2E P50/P95/P99。
- 排队时间。
- 错误率和流式完成率。
- 单请求 GPU 秒、token 成本和功耗。

不能只比较“每秒生成多少 token”，也不能只用一次 curl 的延迟代表生产性能。

---

## 9. 建议实验

### 实验 A：请求生命周期

1. 启动单卡小模型。
2. 分别发送流式和非流式请求。
3. 为 Gateway、API Server 和 Engine 加 Trace。
4. 标注排队、Prefill、首 token、Decode 和完成时间。

### 实验 B：长短请求干扰

1. 固定短请求流量。
2. 注入一个长 Prompt。
3. 对比启用和调整 Chunked Prefill 前后的 TTFT/ITL。

### 实验 C：KV Cache

1. 逐步增加并发和上下文。
2. 观察 KV Cache、waiting、preemption 和错误。
3. 重复相同 System Prompt，验证 Prefix Cache 命中。

### 实验 D：并行策略

在相同 8 GPU 节点对比：

```text
TP=8
TP=4, PP=2
TP=2, DP=4
```

记录显存、通信、吞吐和尾延迟，而不是只判断“能否启动”。

---

## 10. 模块验收

- [ ] 能画出一次流式请求的端到端路径。
- [ ] 能解释 TTFT、TPOT、E2E 分别由哪些阶段组成。
- [ ] 能估算权重和 KV Cache 显存。
- [ ] 能解释 PagedAttention 和 Prefix Cache 的作用。
- [ ] 能说明 Continuous Batching 如何提高吞吐。
- [ ] 能判断何时选择 TP、PP、DP 或 EP。
- [ ] 能设计有界队列、准入控制、超时和过载降级。
- [ ] 能建立以 waiting、TTFT、KV Cache 为核心的看板。
- [ ] 能完成压测、发布、回滚和故障注入。

## 11. 官方资料

- [vLLM V1 User Guide](https://docs.vllm.ai/en/latest/getting_started/v1_user_guide.html)
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)
- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)

官方文档和 CLI 是版本事实来源；本系列负责把零散参数和组件串成可理解、可验证的
工程路径。
