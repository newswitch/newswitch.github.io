---
title: "torch.compile、Dynamo、Graph Break 与 Dynamic Shape"
sidebar_label: "02. torch.compile 与 Graph Break"
sidebar_position: 2
description: "理解 Python Frame 捕获、Guard、重编译、Graph Break 和动态形状如何影响启动、内存和稳态性能。"
tags: [torch.compile, TorchDynamo, Graph Break, Dynamic Shape]
---

# torch.compile、Dynamo、Graph Break 与 Dynamic Shape

本文以 PyTorch 2.8 文档的 Guard 与符号形状模型为基准，讨论原理；具体捕获能力、重编译上限和配置项要按所用版本核对。先区分三个事件：Graph Break 切断捕获，Guard 决定缓存代码能否复用，重编译为新的假设生成代码。它们不是同一个错误的三种叫法。

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

### 3.1 一次调用的状态转移

可以把每个缓存项理解为“假设成立时才可调用的程序”，而不是不加条件的模型副本：

```text
查找当前函数的缓存项
→ 是否有一组 Guard 全部通过？
  → 有：执行对应代码（内部仍可能包含 Graph Break 后的 Python）
  → 无：若允许编译，重新追踪并生成带新 Guard 的缓存项
        若达到配置限制或处于回退策略，走相应回退/报错路径
```

假设第一次输入为连续 BF16 Tensor，形状 `[8,4096]`，生成代码依赖 `M=8`、最后一维 Stride 为 1。第二次仍是 `[8,4096]` 但换了数据，通常不因数据数值本身重编译；换为 `[16,4096]`，静态 M 的假设可能失败；换为同形状的转置 View，Stride 假设也可能失败。因此“Shape 一样”不是复用的充分条件。

Graph Break 则是一次捕获过程中的边界：即使输入完全相同、缓存始终命中，每次调用仍可能跨这个边界执行 Python。反过来，没有 Break 的整图也可能因 Guard 不匹配反复重编译。[Dynamo 的 Guard 模型](https://docs.pytorch.org/docs/2.8/torch.compiler_dynamo_overview.html#what-is-a-guard)解释了这种条件化复用。

## 4. Dynamic Shape

动态 Shape 允许同一 Graph 处理一定范围输入，但动态性会增加符号推理和 Kernel 设计复杂度。完全静态可能产生过多变体，过度动态又可能失去专用优化。

对 LLM 常见策略是把 Batch/Sequence 长度归入有限 Bucket，兼顾缓存复用和 Padding 浪费。

### 4.1 符号维度不等于同时捕获所有分支

把 `M=8` 换成符号 M，并不意味着每个与 M 有关的 Python 分支都被保留。考虑：

```python
def f(x):
    if x.shape[0] <= 16:
        return x + 1
    return x * 2
```

追踪短 Batch 路径时，可生成 `x+1`，并要求 M 满足相应范围；M=12 可以复用这个范围内的变体，M=32 不能执行同一条短 Batch 程序。换路径与换精确尺寸是两个不同的特化原因。这是解释性例子，不保证某版本实际只生成这一条 Guard。[PyTorch 2.8 Dynamic Shapes](https://docs.pytorch.org/docs/2.8/torch.compiler_dynamic_shapes.html#the-guard-model)说明了路径特化与符号推理的关系。

`if x.sum() > 0` 又是另一类问题：条件依赖 Tensor 数据而非元数据，可能需要同步、Graph Break 或受支持的显式控制流表示。把尺寸标为动态不能自动解决数据依赖的控制流，也不等于支持动态 Rank。

### 4.2 Bucket 的 Padding 账不能只按 Token 算

假设真实序列长 s=100，补到 b=128，且实现确实执行整个补齐区域：

```text
逐 Token 线性层工作比例 = b/s = 1.28
密集 Attention 配对比例 = b²/s² = 1.6384
```

所以 Token 数只多 28%，Attention 配对工作可能多约 63.84%。若 Kernel 能跳过 Mask 块，实际额外工作会更少；仅把分数设为负无穷却仍执行矩阵乘，不等于跳过这部分计算。因果块的有效工作要另按三角区域计算。

Bucket 的选择是在变体数量、编译成本、Padding 工作和静态 Buffer 容量之间取舍。编译动态 Shape 与 CUDA Graph 静态地址是两层不同约束：前者能处理多个 M，不代表一次 Graph Capture 就能不加处理地重放所有 M。

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

### 7.1 编译成本什么时候能摊平

只比较热执行会漏掉首次编译。假设 Eager 每次耗时 10 ms，编译后每次 7 ms，总编译成本 600 ms，忽略其他开销：

```text
Eager 总时间 = 10N ms
Compile 总时间 = 600 + 7N ms
收支平衡：N = 600/(10-7) = 200 次
```

若每个变体只调用 20 次，很多变体再快也可能无法回本；若一个变体复用十万次，摊销结论完全不同。这只是总工作量模型，不能证明首次请求或 P99 达标。思考题：没有 Graph Break 却持续编译，优先检查什么？答案是 Guard 假设、路径、输入元数据与缓存复用，而不是继续“消除 Break”。

参考：[Dynamo Overview（PyTorch 2.8）](https://docs.pytorch.org/docs/2.8/torch.compiler_dynamo_overview.html)、[Dynamic Shapes（PyTorch 2.8）](https://docs.pytorch.org/docs/2.8/torch.compiler_dynamic_shapes.html)。
