---
title: "torch.compile、Dynamo、Graph Break 与 Dynamic Shape"
sidebar_label: "02. torch.compile 与 Graph Break"
sidebar_position: 2
description: "理解 Python Frame 捕获、Guard、重编译、Graph Break 和动态形状如何影响启动、内存和稳态性能。"
tags: [torch.compile, TorchDynamo, Graph Break, Dynamic Shape]
---

# torch.compile、Dynamo、Graph Break 与 Dynamic Shape

## 1. `torch.compile` 做什么

TorchDynamo 在 Python Frame 层观察字节码，把可表示的 Tensor 计算捕获成 FX Graph，并为捕获时的假设生成 Guard。Guard 命中时复用已编译结果；不命中时可能重编译或回退。

```text
输入
→ Guard检查
→ 命中Compiled Graph
或 Guard失败 → 新Graph/重编译
→ Graph Break之间继续Python执行
```

## 2. Graph Break

无法安全捕获的 Python 行为会结束当前 Graph，例如依赖 Tensor 值的 Python 控制流、不支持操作、部分副作用或显式禁用区域。Graph Break 的影响：

- Graph 变小，融合机会减少；
- Python 与 Kernel Launch 增多；
- 多段分别编译；
- 首次请求延迟增加；
- 输入路径变化时出现新的编译。

Graph Break 不一定错误，但数量和位置必须可解释。

## 3. Guard 与重编译

Guard 可能约束 Tensor Shape、Stride、Dtype、Device、Python 对象和全局状态。请求长度、Batch、KV Block 或配置频繁变化时，可能不断产生新变体。

“服务启动成功后偶尔卡顿”可能是新 Shape 触发编译，而不是 GPU 突然变慢。监控编译次数、原因、Cache Hit 和请求 Shape 分布。

## 4. Dynamic Shape

动态 Shape 允许同一 Graph 处理一定范围输入，但动态性会增加符号推理和 Kernel 设计复杂度。完全静态可能产生过多变体，过度动态又可能失去专用优化。

对 LLM 常见策略是把 Batch/Sequence 长度归入有限 Bucket，兼顾缓存复用和 Padding 浪费。

## 5. Fullgraph 与错误暴露

`fullgraph=True` 要求单个可捕获 Graph，遇到 Break 时直接暴露，有助于开发期发现问题，但不保证业务语义适合整图。生产启用前比较 Eager 与 Compile 的数值、显存、冷启动和不同 Shape。

## 6. 排查步骤

```text
确认Eager基线正确
→ 记录Compile配置和Backend
→ 导出Graph Break/Guard/Recompile原因
→ 按输入Shape和请求时间关联
→ 检查生成Graph数量
→ 对比冷/热缓存性能
→ 验证回退与错误路径
```

不要在生产直接打开最大日志级别，编译日志可能巨大且包含模型结构；先在可复现环境采集。

## 7. 何时不值得编译

模型很小、CPU 前后处理占主导、输入形态几乎每次都不同、已有高度融合 Kernel 或冷启动 SLO 极严时，编译收益可能低于成本。结论必须由端到端 Goodput 证明。

参考：[torch.compile Programming Model](https://docs.pytorch.org/docs/stable/torch.compiler_programming_model.html)、[Graph Breaks](https://docs.pytorch.org/docs/stable/compile/programming_model.common_graph_breaks.html)。
