---
title: "TensorRT-LLM 从零到生产学习路线"
sidebar_label: "00. TensorRT-LLM 学习路线"
sidebar_position: 0
description: "从模型加载和 Engine 到 PyExecutor、KV Cache、Inflight Batching、并行、量化、服务与性能排障。"
tags: [TensorRT-LLM, TensorRT, LLM, NVIDIA]
---

# TensorRT-LLM 从零到生产学习路线

TensorRT-LLM 是 NVIDIA GPU 上的大模型优化与执行栈。它把模型结构、精度、并行方式和硬件能力映射到高性能执行路径，并在 Runtime 中提供 KV Cache、Paged Attention、Inflight Batching、Overlap Scheduler 和采样。

```text
Hugging Face/量化Checkpoint
→ 模型解析、转换或Engine构建
→ TensorRT-LLM LLM API / Executor
→ Scheduler + KVCacheManager
→ ModelEngine执行GPU Kernel
→ Sampler与流式输出
```

## 1. 学习顺序

1. [LLM API、PyExecutor、Scheduler、KVCacheManager 与一次生成路径](./01-LLM-API-PyExecutor-Scheduler-KVCacheManager与一次生成路径.md)；
2. [Checkpoint、Engine、Plugin、精度、量化与兼容边界](./02-Checkpoint-Engine-Plugin-精度-量化与兼容边界.md)；
3. [Inflight Batching、Overlap、并行、服务、性能与故障排查](./03-Inflight-Batching-Overlap-并行-服务-性能与故障排查.md)。

## 2. 与相邻技术的关系

| 技术 | 负责什么 |
| --- | --- |
| CUDA/cuBLAS/cuDNN | GPU 运行时和基础 Kernel |
| TensorRT | 通用深度学习图优化与 Engine Runtime |
| TensorRT-LLM | LLM 网络、插件、KV、调度、并行和服务 API |
| Triton Inference Server | 通用模型服务器，可承载 TensorRT-LLM Backend |
| `trtllm-serve` | TensorRT-LLM 自带的在线服务入口 |
| vLLM/SGLang | 另一类 LLM Runtime 与调度栈 |

## 3. 选型边界

TensorRT-LLM 适合 NVIDIA 硬件、追求模型特定极致性能并能维护版本/Engine/量化矩阵的环境。vLLM 通常模型接入更快、社区兼容面更广；性能差异必须用目标 GPU、模型、精度、上下文和 SLO 实测。

## 4. 完成标准

- 能解释从 Prompt 到每个 Decode Step 的 Executor 路径；
- 能区分 Checkpoint、TensorRT Engine 和运行时 KV Cache；
- 能计算量化对权重、KV、激活和输出质量的影响；
- 能根据 NVLink/IB 拆分 TP、PP、DP、EP；
- 能定位问题在模型转换、Engine、Plugin、Scheduler、KV、通信还是 Server。

参考：[TensorRT-LLM Architecture](https://nvidia.github.io/TensorRT-LLM/architecture/overview.html)、[Quick Start](https://nvidia.github.io/TensorRT-LLM/quick-start-guide.html)。
