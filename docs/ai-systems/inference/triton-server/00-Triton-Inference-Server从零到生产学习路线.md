---
title: "Triton Inference Server 从零到生产学习路线"
sidebar_label: "00. Triton Server 学习路线"
sidebar_position: 0
description: "从 Model Repository 到 Scheduler、Backend、动态批处理、模型控制、性能分析和 Kubernetes 生产排障。"
tags: [Triton Inference Server, NVIDIA, Model Repository, Dynamic Batching]
---

# Triton Inference Server 从零到生产学习路线

NVIDIA Triton Inference Server 是通用模型服务器，不是 Triton GPU 编程语言。前者负责 HTTP/gRPC、模型仓库、调度、Batch、Backend、指标和模型生命周期；后者常被 TorchInductor 用于生成 GPU Kernel。

```text
HTTP/gRPC/C API
→ 每模型Scheduler与Queue
→ Dynamic/Sequence/Ensemble调度
→ Model Instance
→ TensorRT/ONNX Runtime/Python/PyTorch等Backend
→ CPU/GPU执行
```

## 1. 学习顺序

1. [Model Repository、Scheduler、Backend 与一次请求路径](./01-Model-Repository-Scheduler-Backend与一次请求路径.md)；
2. [`config.pbtxt`、Dynamic/Sequence Batcher、Ensemble 与实例组](./02-config-pbtxt-Dynamic-Sequence-Batcher-Ensemble与实例组.md)；
3. [Docker、Kubernetes、模型控制、指标、性能分析与故障 Runbook](./03-Docker-Kubernetes-模型控制-指标-性能分析与故障Runbook.md)。

## 2. 适用边界

Triton 适合一个平台统一托管 TensorRT、ONNX、Python、PyTorch 等多种模型，尤其是 CV、语音、Embedding、Rerank 和由多个模型组成的 Pipeline。LLM 可以通过 TensorRT-LLM Backend 等运行，但 vLLM/SGLang 自带的 OpenAI 服务和 KV 调度可能更直接。

## 3. 与 TensorRT-LLM 的关系

TensorRT-LLM 是 LLM 优化与执行栈；Triton 是模型服务器。常见组合是：

```text
Triton HTTP/gRPC
→ Triton Scheduler
→ TensorRT-LLM Backend
→ TensorRT-LLM Executor/KV Cache/GPU
```

新版本 TensorRT-LLM 也提供独立 `trtllm-serve`，因此使用 Triton Backend 是架构选择，不是必经路径。

## 4. 完成标准

- 能从请求追到具体 Model Instance 和 Backend；
- 能正确设计模型仓库目录和 `config.pbtxt`；
- 能区分 Dynamic、Sequence、Ensemble 与 LLM Inflight Batch；
- 能解释增加 Instance 为何可能吞吐上升也可能显存溢出；
- 能用 Metrics、Trace、Perf Analyzer 定位 Queue、Compute Input、Infer 和 Compute Output。

参考：[Triton Architecture](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/architecture.html)、[Triton User Guide](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/)。
