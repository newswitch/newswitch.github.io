---
title: "SGLang ModelRunner、CUDA Graph 与 Kernel Backend"
sidebar_label: "05. ModelRunner、Graph 与 Kernel"
sidebar_position: 5
description: "沿ScheduleBatch到ForwardBatch、Attention、Sampling与输出，解释SGLang设备热路径和Backend选择。"
tags: [SGLang, ModelRunner, CUDA Graph, Attention Backend, Kernel]
---

# SGLang ModelRunner、CUDA Graph 与 Kernel Backend

Scheduler决定“本轮做什么”，ModelRunner负责把这个决定变成设备Tensor和模型前向。它位于SGLang性能热路径：

```text
ScheduleBatch
→ ForwardBatch/Attention Metadata
→ ModelRunner
→ Model Forward
→ Attention/GEMM/MoE Kernel
→ Logits/Sampling
→ BatchTokenIDOutput
```

## 1. ModelRunner的职责

- 加载和分片模型权重；
- 初始化TP/DP/PP/EP通信；
- 建立KV Memory Pool和运行Buffer；
- 将请求Batch转换成设备输入；
- 构造Attention Metadata与KV Slot映射；
- 选择Eager或CUDA Graph；
- 调用Attention、GEMM、MoE和Sampling Backend；
- 返回采样Token与执行状态。

它不是一个Kernel，而是组织多个Kernel和通信的运行框架。

## 2. ForwardBatch中有什么

概念上包括：

```text
input_ids
positions
sequence lengths
prefix lengths
KV pool indices
request-to-token mapping
attention metadata
sampling info
forward mode（Prefill/Decode/Mixed）
```

这些对象由动态请求状态生成。Host准备过慢会让GPU等待，即使Kernel本身很快。

## 3. Attention Backend

Attention Backend选择必须匹配：

- GPU架构；
- 模型Attention类型：MHA/GQA/MLA等；
- Prefill还是Decode；
- dtype与KV dtype；
- Head Dim与Page Size；
- CUDA Graph；
- Sliding Window、多模态和量化；
- 目标SGLang版本。

不同Backend可能分别优化Prefill和Decode。启动成功不代表它在目标Shape上最快，也不代表所有模型特性都正确。

## 4. GEMM、MoE与Sampling Backend

| Backend族 | 主要工作 | 验收重点 |
| --- | --- | --- |
| GEMM | 线性层矩阵乘 | Shape、dtype、量化、GPU架构 |
| MoE Runner | Router、Expert计算与通信 | EP、负载均衡、All-to-All |
| Sampling | Logits处理与Token选择 | Logprobs、Grammar、确定性、性能 |
| Grammar | JSON/Regex/EBNF约束 | 编译冷延迟、缓存和语义 |

切换Backend必须同时做输出正确性和性能A/B，不能只看单个Microbenchmark。

## 5. CUDA Graph

Decode包含大量短小Kernel，Host Launch可能造成空洞。CUDA Graph捕获固定执行后Replay：

```text
Batch Size/Shape
→ 选择Capture Bucket
→ 填充固定Buffer
→ Replay Graph
```

收益：减少Launch与Python开销。代价：

- 启动Capture时间；
- 额外显存；
- Shape Bucket和Padding；
- 动态功能回退；
- 调试复杂度。

## 6. Capture Size怎样选择

Capture范围过小会频繁Eager；范围过大或Bucket过多会增加显存与启动时间。依据生产运行Batch分布选择：

```text
P(batch_size=1,2,4,8,...)
→ 选择覆盖主要流量的Bucket
→ 测Replay覆盖率
→ 计算Padding浪费
```

“已成功Capture”与“生产请求实际Replay”是两件事。

## 7. Kernel空洞怎么定位

若设备Timeline显示：

```text
Kernel → 长空洞 → Kernel → 长空洞
```

从以下层检查：

1. 请求到达率是否不足；
2. Tokenizer/Scheduler CPU；
3. ZMQ/IPC；
4. ForwardBatch输入准备；
5. Graph是否回退；
6. Sampling/Detokenizer；
7. NCCL同步与慢Rank；
8. Debug日志或Profiler自身开销。

## 8. TP慢Rank

各Rank执行相同Step并在Collective汇合。一个Rank因CPU、GPU、Shape或拓扑变慢，会让其他Rank等待。Profile时保存：

- Rank→GPU UUID映射；
- 每RankKernel和NCCL时长；
- CPU线程与NUMA；
- Graph Replay状态；
- 同一Batch的开始/结束时间。

## 9. 四层性能实验

| 层 | 工具/模式 | 回答问题 |
| --- | --- | --- |
| HTTP服务 | `bench_serving` | 真实TTFT/TPOT/吞吐 |
| Engine离线 | offline throughput | 去掉HTTP后的调度能力 |
| ModelRunner | one batch | 固定Batch的设备执行 |
| Kernel | Nsight/Profiler/Microbenchmark | 具体算子与通信 |

从上向下定位。不要用Kernel峰值代替在线容量。

## 10. 发布验证

```text
[ ] 模型和目标Backend组合受支持
[ ] Eager正确性基线通过
[ ] Graph输出与Eager回归一致
[ ] Capture Size来自真实Batch分布
[ ] Replay覆盖率和额外显存已记录
[ ] Prefill/Decode Backend分别压测
[ ] TP各Rank无长期偏差
[ ] Logprobs、Grammar、工具调用等功能回归
[ ] 版本升级后重新执行Backend A/B
```

## 11. 官方资料

- [SGLang Server Arguments](https://docs.sglang.io/advanced_features/server_arguments.html)
- [SGLang Benchmark and Profiling](https://github.com/sgl-project/sglang/blob/main/docs/developer_guide/benchmark_and_profiling.md)
- [SGLang源码](https://github.com/sgl-project/sglang/tree/main/python/sglang/srt)
