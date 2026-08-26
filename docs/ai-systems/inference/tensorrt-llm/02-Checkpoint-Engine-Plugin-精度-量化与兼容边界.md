---
title: "TensorRT-LLM Checkpoint、Engine、Plugin、精度、量化与兼容边界"
sidebar_label: "02. 模型构建、量化与兼容"
sidebar_position: 2
description: "理解 Hugging Face Checkpoint 到 TensorRT-LLM 执行制品的转换、Plugin 选择、量化和版本兼容。"
tags: [TensorRT-LLM, Engine, Quantization, Plugin]
---

# TensorRT-LLM Checkpoint、Engine、Plugin、精度、量化与兼容边界

## 1. 三类制品

| 制品 | 包含什么 | 是否硬件/版本相关 |
| --- | --- | --- |
| 原始 Checkpoint | 权重、Config、Tokenizer | 相对通用 |
| TensorRT-LLM Checkpoint | 转换、分片或量化后的权重 | 与模型实现和并行相关 |
| TensorRT Engine | 优化后的图、Kernel/Profile/Tactic | 对 TensorRT、GPU 架构和配置更敏感 |

新版本 LLM API 可直接从模型路径完成部分构建和加载，但 Engine 路径仍用于显式控制和优化。生产 Manifest 应记录原模型 Revision、转换参数、量化校准集、TensorRT-LLM/TensorRT/CUDA、目标 Compute Capability 和 Engine Hash。

## 2. 构建路径

```text
HF Config/Weights/Tokenizer
→ 模型类映射与权重转换
→ 选择dtype、量化、TP/PP/EP和最大Shape
→ 构建Network与TensorRT-LLM Plugins
→ TensorRT Builder搜索Tactic并生成Engine
→ 序列化Engine与Config
```

`trtllm-build` 的精确参数会随版本变化，应以安装版本 `--help` 为准。最大 Batch、输入长度、输出长度和 Beam Width 会影响 Optimization Profile、Workspace、构建时间和运行上限。

## 3. Plugin

Attention、GEMM、MoE、NCCL、Quantization 等 Plugin 将 LLM 特定模式映射到优化 Kernel。Plugin 选择错误可能表现为构建失败、运行时不支持、数值漂移或性能退化。

Engine 不能仅凭文件存在就发布。必须在目标 GPU 上完成反序列化、最短/最长 Shape、并行通信和输出质量验证。

## 4. 精度和量化

| 类型 | 主要影响 |
| --- | --- |
| BF16/FP16 | 通用基线，权重约 2 Byte/参数 |
| FP8 | Hopper/Blackwell 等硬件加速，需校准和兼容检查 |
| INT8 SmoothQuant | 权重与激活量化，需校准 |
| INT4 AWQ/GPTQ | 权重显著压缩，质量与 Kernel 支持需实测 |
| FP8/INT8 KV Cache | 降低长上下文 KV 占用，可能影响质量 |

权重量化不等于整个服务显存按同比例下降。Runtime Workspace、激活、Logits、CUDA Graph 和 KV Cache 仍占显存。

## 5. 质量门禁

量化和 Engine 优化必须同时验证：模型任务指标、困惑度/准确率、固定 Golden Prompt、Tokenizer 一致性、长上下文、工具调用/结构化输出，以及 TTFT/TPOT/吞吐。只比较几句话“看起来差不多”不能证明可上线。

## 6. 常见故障

- 构建时 OOM：Builder Workspace、并行构建、最大 Shape；
- Engine 反序列化失败：TensorRT/CUDA/GPU 架构不匹配；
- Unsupported Plugin：镜像没有相同 Plugin 库或版本；
- 输出异常：Tokenizer/Chat Template、量化 Scale、模型实现；
- 性能低于预期：Shape 未命中 Profile、Graph 回退、Plugin/Tactic 不理想。

参考：[TensorRT-LLM Build Command](https://nvidia.github.io/TensorRT-LLM/commands/trtllm-build.html)、[Quantization](https://nvidia.github.io/TensorRT-LLM/features/quantization.html)。
