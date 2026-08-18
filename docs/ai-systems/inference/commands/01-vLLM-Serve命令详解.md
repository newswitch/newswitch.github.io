---
title: "vLLM serve 命令详解"
sidebar_label: "01. vLLM serve 命令详解"
sidebar_position: 1
description: "掌握 vLLM serve 的模型身份、服务协议、显存、KV Cache、并行策略、调度、可观测性与安全参数。"
tags: [vLLM, LLM, Serve, KV Cache, Tensor Parallel, 推理]
---

# vLLM serve 命令详解

vLLM的CLI迭代很快。启动前固定镜像摘要和版本，以目标环境中的帮助作为参数事实：

```bash
vllm --version
vllm serve --help
vllm collect-env
```

## 1. 最小启动 `[A]`

```bash
vllm serve /models/Qwen \
  --served-model-name qwen-prod \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16
```

生产必须固定模型revision或只读物化路径、Tokenizer、chat template和镜像。`--served-model-name` 是API暴露名称，不证明底层权重身份。

## 2. 参数分层

### 2.1 模型与Tokenizer {/* #模型与tokenizer */}

| 参数族 | 作用与边界 |
|---|---|
| 位置参数 `model` | Hub ID或本地路径，生产使用不可变制品 |
| `--revision`、`--code-revision`、`--tokenizer-revision` | 固定权重、代码与Tokenizer版本 |
| `--tokenizer`、`--tokenizer-mode` | 指定Tokenizer和加载模式 |
| `--trust-remote-code` | 允许执行仓库代码，高风险，只对审计制品开启 |
| `--dtype`、`--kv-cache-dtype` | 权重/计算与KV Cache精度 |
| `--quantization`、`--load-format` | 量化与加载器，必须匹配制品格式 |
| `--max-model-len` | 最大上下文，直接影响KV容量和启动分析 |
| `--generation-config` | 是否应用模型仓库generation配置，避免隐式改变默认采样 |

### 2.2 服务与协议 {/* #服务与协议 */}

| 参数族 | 作用 |
|---|---|
| `--host`、`--port`、`--uds` | 监听地址、端口或Unix socket |
| `--api-key` | 简单API Key；生产通常还需网关、TLS和身份鉴权 |
| `--served-model-name` | OpenAI API中的model名称，可提供别名 |
| `--root-path` | 反向代理子路径 |
| `--ssl-keyfile`、`--ssl-certfile`、`--ssl-ca-certs` | TLS/mTLS参数，证书权限必须受控 |
| `--allowed-origins`、`--allowed-methods`、`--allowed-headers` | CORS边界，不要默认全放开 |
| `--disable-frontend-multiprocessing`、`--api-server-count` | API Server进程模型，版本支持与行为需实测 |
| `--config` | 从YAML加载CLI配置；配置与CLI覆盖优先级以当前版本为准 |

### 2.3 显存与调度 {/* #显存与调度 */}

| 参数族 | 作用与风险 |
|---|---|
| `--gpu-memory-utilization` | 目标实例可使用显存比例，不是硬隔离 |
| `--kv-cache-memory-bytes` | 显式KV预算，支持版本中会覆盖比例推算 |
| `--swap-space`、`--cpu-offload-gb` | 使用CPU内存换GPU容量，受NUMA/PCIe影响 |
| `--max-num-seqs` | 同时调度序列上限 |
| `--max-num-batched-tokens` | 每轮调度Token预算 |
| `--enable-chunked-prefill` | 对长Prefill分块，需测TTFT/ITL权衡 |
| `--enable-prefix-caching` | 启用前缀缓存；命中、租户隔离和缓存盐需评估 |
| `--block-size` | KV块粒度，后端支持范围不同 |
| `--max-seq-len-to-capture` | CUDA Graph捕获范围相关参数，版本可能变化 |

### 2.4 并行与分布式 {/* #并行与分布式 */}

| 参数族 | 作用 |
|---|---|
| `--tensor-parallel-size` / `-tp` | 层内张量并行，受GPU拓扑和NCCL影响 |
| `--pipeline-parallel-size` / `-pp` | 层间流水并行 |
| `--data-parallel-size` / `-dp` | 模型副本并行，路由和全局负载需单独设计 |
| `--enable-expert-parallel` | MoE Expert并行 |
| `--distributed-executor-backend` | multiprocessing、Ray等执行后端 |
| `--headless` | 多节点DP等架构中的无前端实例，按官方部署模式使用 |

参数短名和组合约束随版本变化，脚本不要依赖未锁定版本的缩写。

## 3. 启动证据

保存启动日志中的：模型配置、权重加载耗时、GPU内存分析、KV块数量、最大并发估计、attention backend、并行rank、NCCL拓扑、编译/CUDA Graph阶段、监听地址与metrics路径。

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/v1/models | jq .
curl -fsS http://127.0.0.1:8000/metrics | head
```

进程健康与模型可推理是不同条件；必须发送一个固定小请求并验证完整流式结束标记。

## 4. 可观测性

常见参数族包括日志级别、访问日志、请求ID头、OpenTelemetry Trace端点与模块、Prometheus指标。Prompt日志可能泄露数据，生产默认不记录原始输入；Trace采用采样并限制下游容量。

重点指标：running/waiting请求、KV使用率、prompt/generation token、TTFT、queue time、prefill/decode time、E2E、preemption、错误和流式完成。

## 5. 安全与稳定边界

- 不对未知仓库开启 `--trust-remote-code`。
- 不把HF Token/API Key写入命令行，避免出现在进程列表。
- `--enforce-eager` 等诊断参数会改变性能路径，不能与基线混比。
- 修改上下文、KV精度、并行度或调度预算都需要重新做容量曲线。
- 多副本滚动时先预热新实例，确认模型revision和指标，再导流。

## 6. 故障矩阵

| 阶段 | 现象 | 首要证据 |
|---|---|---|
| 下载 | 401/超时/重复下载 | revision、Token、缓存、代理、磁盘 |
| 权重加载 | OOM/格式错误 | dtype、量化、分片索引、TP、实际空闲显存 |
| 编译/捕获 | 启动慢或失败 | Triton/Inductor缓存、CUDA Graph、算子和架构 |
| 服务就绪 | health正常但请求失败 | `/v1/models`、chat template、请求格式、模型名 |
| 高并发 | waiting和TTFT突增 | KV、调度预算、请求长度、网关限流 |
| 多卡 | NCCL timeout/利用率不均 | rank日志、NVLink/PCIe、拓扑、进程绑定 |

## 7. 掌握标准 {/* #掌握标准 */}

能把参数分为模型、服务、显存、调度和并行；能从启动日志复算KV与并发；能设计不泄露Prompt的可观测性；能通过固定revision和完整启动清单复现实例。

## 8. 官方资料 {/* #官方资料 */}

- [vLLM serve CLI](https://docs.vllm.ai/en/latest/cli/serve/)
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html)
