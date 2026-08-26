---
title: "Triton config.pbtxt、Dynamic/Sequence Batcher、Ensemble 与实例组"
sidebar_label: "02. 模型配置、Batch 与实例组"
sidebar_position: 2
description: "理解 Triton 模型输入输出、版本、实例放置和三类调度器，建立吞吐与延迟模型。"
tags: [Triton Inference Server, config.pbtxt, Dynamic Batching, Ensemble]
---

# Triton config.pbtxt、Dynamic/Sequence Batcher、Ensemble 与实例组

## 1. `config.pbtxt` 描述什么

```protobuf
name: "encoder"
platform: "onnxruntime_onnx"
max_batch_size: 32
input [{ name: "input_ids" data_type: TYPE_INT64 dims: [ -1 ] }]
output [{ name: "embedding" data_type: TYPE_FP32 dims: [ 768 ] }]
instance_group [{ kind: KIND_GPU count: 1 gpus: [0] }]
dynamic_batching { max_queue_delay_microseconds: 200 }
```

它定义模型协议契约、Batch 维、版本策略、实例组、调度器、预热、优化和事务策略。自动生成配置适合快速实验，生产应保存显式配置，避免升级后默认行为变化。

`dims` 通常不包含 Batch 维；`max_batch_size=0` 表示模型不支持 Triton Batch 维。模型导出的动态维度、TensorRT Optimization Profile 和客户端形状必须一致。

## 2. 默认与 Dynamic Batcher

默认调度器把请求直接交给可用 Instance。Dynamic Batcher 在一个很小等待窗口内合并无状态请求，提高 GPU 批处理效率。

```text
多个单请求到达
→ 模型Queue
→ 等待不超过max_queue_delay
→ 合并到≤max_batch_size
→ 交给空闲Instance
```

调整顺序：先确定模型允许的最大 Batch；用无延迟 Dynamic Batch 测基线；若延迟预算还有空间，再增加 Queue Delay。官方建议多数模型不要盲设 `preferred_batch_size`，除非 TensorRT Profile 等确实使特定 Batch 明显更快。

Queue Policy 可限制队列长度、优先级和超时。过载时有界拒绝比无限排队更可预测。

## 3. Sequence Batcher

有状态模型的一组请求必须进入同一 Model Instance。客户端使用 Correlation ID 和 Start/End 标志，Sequence Batcher 管理槽位和超时。它解决的是跨请求状态亲和，不是普通无状态 Batch。

LLM 的 Inflight/Continuous Batch 可借助 Iterative Sequence 实现：一次请求每个迭代只执行一部分，未完成请求重新进入下一轮，与新请求重新组 Batch。

## 4. Ensemble

Ensemble 把预处理、模型和后处理连接成 Tensor DAG：

```text
Raw Input → Tokenizer/Python → Encoder → Classifier → Postprocess
```

Ensemble Scheduler 负责张量依赖，不执行计算；每一步仍由对应模型 Scheduler 和 Backend 执行。端到端 Trace 要保留每一步 Queue 和 Compute，否则只看到 Ensemble 总延迟。

## 5. Instance Group

`count × GPU数量` 决定 Model Instance 数。增加实例前计算权重、Workspace、激活和输入输出 Buffer 显存。CPU 密集 Backend 还要考虑 NUMA 和线程池。

对单模型逐步测 `instance_count × batch × concurrency` 矩阵，记录吞吐、P99、GPU SM/显存和 Queue。实例越多并不必然越快。

参考：[Triton Model Configuration](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_configuration.html)、[Triton Batchers](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html)。
