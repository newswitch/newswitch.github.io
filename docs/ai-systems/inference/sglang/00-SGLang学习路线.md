---
title: "SGLang 学习路线"
sidebar_label: "00. SGLang 学习路线"
sidebar_position: 0
description: "从请求生命周期、Radix Cache、调度与 ModelRunner 到生产参数、容量和故障排查的 SGLang 系统学习路线。"
tags: [SGLang, RadixAttention, 推理框架, CUDA, LLM]
---

# SGLang 学习路线

SGLang 是面向大语言模型与多模态模型的高性能推理服务框架。理解 SGLang 不能只停留在“它也提供 OpenAI API”，而要看清它的进程管线、RadixAttention、调度器、KV 内存池、CUDA Graph、Kernel Backend 与并行策略如何协作。

## 1. 阅读顺序 {/* #阅读顺序 */}

| 阶段 | 文章 | 学完应能回答 |
|---|---|---|
| 1 | [SGLang 整体架构与请求生命周期](./01-SGLang整体架构与请求生命周期.md) | 一句话如何经过 TokenizerManager、Scheduler、TP Worker 和 DetokenizerManager 输出 |
| 2 | [SGLang 生产参数参考](./02-SGLang生产参数参考.md) | 模型、内存、Radix Cache、调度、Graph、Kernel 和分布式参数怎样影响性能 |
| 3 | [RadixAttention 与 Radix Cache 源码原理](./03-RadixAttention与Radix-Cache源码原理.md) | Token前缀怎样进入Radix Tree，KV如何锁定、复用与淘汰 |
| 4 | [Scheduler 与 Overlap Scheduler](./04-SGLang-Scheduler与Overlap-Scheduler.md) | Waiting/Running、Chunked Prefill、Retract和CPU-GPU流水怎样协作 |
| 5 | [ModelRunner、CUDA Graph 与 Kernel Backend](./05-SGLang-ModelRunner-CUDA-Graph与Kernel-Backend.md) | ScheduleBatch怎样变成设备执行，Backend与Graph怎样影响热路径 |
| 6 | [单机与 Kubernetes 生产部署](./06-SGLang单机与Kubernetes生产部署.md) | 如何配置GPU、共享内存、探针、网关、优雅退出和灰度 |
| 7 | [性能分析与容量规划](./07-SGLang性能分析与容量规划.md) | 如何分层Benchmark并把Radix冷/热状态纳入SLO容量 |
| 8 | [生产故障排查 Runbook](./08-SGLang生产故障排查Runbook.md) | 如何定位多进程、KV、Graph、NCCL、Kubernetes与返回链路事故 |
| 9 | [四大推理框架对比与选型](/docs/ai-systems/inference/vLLM-vLLM-Ascend-SGLang-MindIE框架对比与选型) | RadixAttention 与 vLLM Prefix Cache 的差异，什么时候选择 SGLang |

## 2. 学习主线 {/* #学习主线 */}

```text
OpenAI / Native API
        ↓
HTTP Server + TokenizerManager
        ↓ ZMQ
Scheduler + ScheduleBatch
        ↓
TP Worker + ModelRunner
        ↓
Attention Backend / CUDA Graph / Sampling
        ↓
BatchTokenIDOutput
        ↓ ZMQ
DetokenizerManager
        ↓
TokenizerManager → SSE / JSON
```

学习时要同时跟踪三条线：

- **请求线**：文本、Token ID、Req、ScheduleBatch、ForwardBatch、输出 Token 和流式文本；
- **资源线**：权重、KV 内存池、Radix Tree、CUDA Graph Workspace 和通信 Buffer；
- **时间线**：Queue、Prefill、Decode、Detokenize、TTFT 和 Inter-Token Latency。

## 3. 与 vLLM 的知识复用 {/* #与-vllm-的知识复用 */}

以下概念可以直接复用：Prefill/Decode、Continuous Batching、Paged KV Cache、TP/DP/EP、量化、Speculative Decoding 和 OpenAI API。以下部分必须重新学习：

- TokenizerManager → Scheduler → DetokenizerManager 的 ZMQ 进程管线；
- Radix Tree 表达共享前缀和缓存淘汰；
- `mem_fraction_static`、`max_total_tokens` 与 KV Pool 的预算方式；
- `schedule_policy=lpm` 等策略怎样利用前缀局部性；
- SGLang 的 Attention、Sampling、Grammar、GEMM Backend 选择；
- Overlap Scheduler、PD Disaggregation、HiCache 等高级路径。

## 4. 建议实验 {/* #建议实验 */}

1. 用一个短 Prompt 观察进程、ZMQ 通道和流式输出。
2. 构造 100 条相同系统提示词请求，对比 Radix Cache 开关和命中率。
3. 比较 `fcfs` 与 `lpm`，记录 TTFT、吞吐、公平性与缓存命中。
4. 调整 `mem_fraction_static`、`max_running_requests` 与 `chunked_prefill_size`，找到 OOM/SLO 边界。
5. 比较 CUDA Graph 开关、不同 Capture Batch Size 和 Attention Backend。
6. 在 TP 场景检查 NCCL、GPU 拓扑、共享内存和 Rank 时间线。

## 5. 掌握标准 {/* #掌握标准 */}

- 能从日志判断瓶颈在 Tokenizer、Scheduler、ModelRunner、Kernel、NCCL 还是 Detokenizer。
- 能解释 Radix Cache 命中为什么可能降低 Prefill 成本，也可能带来缓存占用和租户隔离问题。
- 能根据真实 Token 分布和 SLO 配置静态内存、并发、Prefill Token Budget 与调度策略。
- 能用同一请求集公平比较 SGLang 和 vLLM，而不是只看框架宣传吞吐。
- 能从单机正确性基线走到Kubernetes部署、容量报告、故障演练与回滚。

## 6. 官方入口 {/* #官方入口 */}

- [SGLang 官方文档](https://docs.sglang.io/)
- [Server Arguments](https://docs.sglang.io/docs/advanced_features/server_arguments)
- [Hyperparameter Tuning](https://docs.sglang.io/docs/advanced_features/hyperparameter_tuning)
- [SGLang GitHub](https://github.com/sgl-project/sglang)
