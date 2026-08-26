---
title: "TensorRT-LLM Inflight Batching、Overlap、并行、服务、性能与故障排查"
sidebar_label: "03. 调度、部署与性能排障"
sidebar_position: 3
description: "掌握 TensorRT-LLM KV Cache、Inflight Batching、并行策略、trtllm-serve、Triton 集成和性能诊断。"
tags: [TensorRT-LLM, Inflight Batching, Parallelism, Troubleshooting]
---

# TensorRT-LLM Inflight Batching、Overlap、并行、服务、性能与故障排查

## 1. 资源模型

```text
显存 = 权重 + KV Cache + 激活/Workspace + CUDA Graph + 通信Buffer + 余量
```

KV Cache 近似随“层数 × KV Head × Head Dim × 已缓存 Token × 精度 × 2(K/V)”增长。GQA/MQA、KV 量化、Page 大小和并行分片会改变实际结果。

Inflight Batch 的主要预算不是传统请求数，而是每轮处理 Token、KV Block、并发 Sequence 和可用 Workspace。将并发直接翻倍可能先触发 KV 抢占或尾延迟，而不是提升吞吐。

## 2. 并行

| 并行 | 切分对象 | 主要通信 |
| --- | --- | --- |
| TP | 层内矩阵 | 每层 AllReduce/AllGather，偏好 NVLink |
| PP | 层深度 | Stage 间激活 P2P |
| DP | 完整模型副本 | 请求独立，适合扩并发 |
| EP | MoE Experts | Token Dispatch/All-to-All，依赖高速网络 |

优先让单副本的高频通信留在 NVLink/NVSwitch 域，再跨节点使用 RDMA。扩大 TP 能让模型装下，但每 Token 通信增加；能用较小 TP 加 DP 时，可能有更好的吞吐和故障隔离。

## 3. 两种服务入口

```text
方案A：trtllm-serve → TensorRT-LLM LLM API/Executor
方案B：Triton Server → TensorRT-LLM Backend → Executor
```

`trtllm-serve` 可直接提供 OpenAI 兼容接口，链路较短；Triton 适合统一多框架模型仓库、协议和 Ensemble。版本较新的 TensorRT-LLM 部署方式变化较快，旧教程中的 Backend/Engine 路径不应默认适用于当前版本。

## 4. 性能实验

固定模型 Revision、精度、GPU、TP/PP、输入/输出长度分布和 SLO，逐步改变：并发、Max Batch/Token、KV 比例、CUDA Graph、Overlap、Quantization 和 Speculative Decoding。

记录：

- TTFT、TPOT、E2E P50/P95/P99；
- Input/Output Token/s 与每 GPU Token/s；
- Queue、Running、KV 使用/命中/抢占；
- GPU SM、Tensor Core、HBM 带宽与功耗；
- CPU、Tokenizer、NCCL 和网络时间。

Benchmark 客户端与 Server 分离，使用真实 Prompt/Output 长度分布。只报峰值 Token/s 无法说明生产容量。

## 5. 故障树

```text
服务启动失败
├─ 模型/Tokenizer/Checkpoint
├─ Engine/Plugin/CUDA/TensorRT兼容
├─ GPU显存与Compute Capability
└─ Rank/NCCL/拓扑

服务慢
├─ Queue与准入
├─ Prefill计算
├─ Decode HBM/KV
├─ TP/EP通信
├─ Graph命中与CPU调度
└─ 流式网络与客户端
```

## 6. 生产边界

模型加载后先执行 Warm-up 覆盖典型 Shape；Readiness 以真实推理为依据；升级以镜像 Digest 和 Engine 兼容矩阵为单位；旧版本回滚时保留原 Engine，不假设新 Engine 可被旧 Runtime 加载。

参考：[TensorRT-LLM Benchmarking](https://nvidia.github.io/TensorRT-LLM/performance/performance-tuning-guide/useful-build-time-flags.html)、[TensorRT-LLM Quick Start](https://nvidia.github.io/TensorRT-LLM/quick-start-guide.html)。
