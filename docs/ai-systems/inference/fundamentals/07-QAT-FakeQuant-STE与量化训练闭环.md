---
title: "QAT、Fake Quant、STE 与量化训练闭环"
sidebar_label: "07. QAT、Fake Quant 与 STE"
sidebar_position: 7
description: "解释量化感知训练如何在浮点训练中模拟低比特误差，STE 如何传递梯度，以及训练制品如何转换并在推理 Backend 中验收。"
tags: [QAT, Fake Quant, STE, PTQ, Quantization]
---

# QAT、Fake Quant、STE 与量化训练闭环

QAT（Quantization-Aware Training）不是“直接用 INT4 完成普通训练”，而是在训练 Forward 中模拟目标量化网格，让参数提前适应推理时将遇到的舍入、截断和饱和误差。

```text
浮点参数
→ Forward插入Fake Quant
→ 模型看到近似量化值
→ 计算任务Loss
→ Backward用近似梯度更新浮点主参数
→ Convert生成目标低比特制品
→ 目标Backend执行并验收
```

## 1. 为什么 PTQ 不够时才考虑 QAT

PTQ 在训练结束后转换参数，成本低，通常应先尝试。以下情况可能需要 QAT：

- 4 bit 或更激进精度下任务质量明显下降；
- 激活存在异常值，简单校准难以覆盖；
- 小模型或特定敏感层对量化噪声更脆弱；
- 工具调用、数学、代码等任务出现集中退化；
- 目标硬件要求权重与激活同时低比特，而 PTQ 难以满足精度门槛。

QAT 不是自动修复所有精度问题。训练数据、量化方案和最终推理 Kernel 必须匹配，否则模型适应的是一种误差，部署时执行的却是另一种误差。

## 2. Fake Quant 到底“假”在哪里

真实量化会把浮点值存为低比特整数：

```text
q = clamp(round(x / s) + z, qmin, qmax)
```

Fake Quant 在 Forward 中做量化再反量化：

```text
x_fq = (clamp(round(x / s) + z, qmin, qmax) - z) × s
```

`x_fq` 仍是浮点 Tensor，但只能落在目标量化网格上。后续层因此能感知舍入和饱和造成的误差，同时训练仍可保留浮点主权重和常规优化器状态。

## 3. Round 不可导，为什么还能训练

`round()` 在绝大多数位置的真实导数为零，直接使用会让梯度无法有效穿过量化节点。QAT 常使用 STE（Straight-Through Estimator）近似处理：

```text
Forward：执行round/clamp，模拟量化
Backward：在允许区间内近似把梯度直接传回
```

直观上，STE 不是声称 `round` 的数学导数为 1，而是工程上选用一个可训练的代理梯度。

Clipping 区域、Scale 是否可学习、Zero Point 如何处理，会影响具体梯度。讨论 QAT 时不能只说“有 STE”，还要说明使用的 Fake Quant 和 Observer 实现。

## 4. Observer、Scale 与训练阶段

Observer 统计 Tensor 分布，用于确定 Scale 和 Zero Point。典型生命周期：

```text
初始浮点稳定阶段
→ 开启Observer收集范围
→ 开启Fake Quant注入量化噪声
→ 适时冻结Observer，避免网格持续漂移
→ 继续微调收敛
→ 转换制品
```

并非所有配方都采用相同顺序。重要的是记录：

- 从第几步开始 Fake Quant；
- 何时冻结 Observer；
- Scale 固定还是可学习；
- 哪些层排除；
- 权重和激活分别使用何种粒度；
- 训练时模拟的舍入、Clipping 与推理 Kernel 是否一致。

## 5. 权重 QAT 与激活 QAT

| 方案 | Forward 中模拟什么 | 主要挑战 |
| --- | --- | --- |
| Weight Only QAT | 权重低比特，激活高精度 | 权重误差、Packing 与低比特 Linear Kernel |
| Weight + Activation QAT | 权重和激活都低比特 | 激活动态范围、异常值和更严格 Backend 支持 |
| KV Cache Quantization | KV 写入/读取采用低比特 | 长上下文误差累积、Attention Backend 兼容 |

三者是不同对象。训练了 W4A16 QAT 模型，不代表 KV Cache 自动变成 INT8。

## 6. Prepare、Train、Convert、Serve

完整闭环应明确四个阶段：

### 6.1 Prepare

- 匹配目标推理方案插入 Fake Quant；
- 定义需要量化的模块和排除层；
- 初始化 Observer/Scale；
- 固定模型、Tokenizer、数据和代码版本。

### 6.2 Train

- Forward 看到量化近似值；
- Backward 更新浮点参数；
- 监控任务 Loss、Scale、Clipping 比例和梯度；
- 定期同时评估 Fake-Quant 模型和浮点参考。

### 6.3 Convert

- 移除训练专用 Observer；
- 固化 Scale/Zero Point；
- 量化并 Packing 权重；
- 写出推理框架需要的配置和元数据。

### 6.4 Serve

- 在真实目标硬件加载；
- 确认模块替换和 Kernel 命中；
- 重新做质量、协议、性能与容量验收。

训练中的 Fake Quant 模型能运行，不等于 Convert 后的低比特制品能被生产 Runtime 正确执行。

## 7. QAT、量化训练、QLoRA 不要混为一谈

| 名称 | 训练时主要状态 | 目标 |
| --- | --- | --- |
| QAT | 浮点主参数 + Fake Quant | 让最终量化模型适应量化误差 |
| 真正低精度训练 | 参数/激活/梯度中的部分真实使用低精度 | 降低训练计算或内存成本 |
| QLoRA | 冻结的低比特基座 + 高精度 LoRA Adapter | 低成本参数高效微调 |

QLoRA 的基座量化主要服务于训练内存节省；QAT 的核心是模拟最终推理量化数值。二者可以组合，但不能因为名称里都有“量化”就视为同一流程。

## 8. 分布式 QAT 的额外问题

- 所有 Rank 必须使用一致的量化配置和 Observer 状态；
- Scale/Observer 是否需要同步取决于粒度和实现；
- FSDP/TP 分片前后插入 Fake Quant 的位置要明确；
- Checkpoint 必须保存浮点主参数、量化状态和训练进度；
- 恢复后不能意外重新进入 Observer 热身阶段；
- 混合精度 Loss Scale 与量化 Scale 是两种不同概念。

若恢复后 Loss 突然变化，除数据游标和优化器外，还要检查 Fake Quant 开关、Observer 冻结状态和 Scale。

## 9. 如何判断精度损失发生在哪一层

按以下顺序缩小范围：

1. 浮点基线是否稳定；
2. 插入 Fake Quant 但未训练时，哪类样本先退化；
3. 训练后 Fake-Quant 模型是否恢复；
4. Convert 后离线推理是否与 Fake-Quant 接近；
5. 生产 Backend 输出是否与离线转换结果一致；
6. 是否只有特定 Shape、长上下文或特定层触发回退/误差。

可对敏感层临时保持高精度做消融，但最终方案需要记录精度收益、显存和性能代价。

## 10. 生产验收矩阵

| 层次 | 验收内容 |
| --- | --- |
| 数值 | Logits、层输出、误差分位数、NaN/Inf |
| 任务 | 准确率、Pass@k、偏好胜率、领域任务 |
| 协议 | JSON、工具调用、停止条件、流式输出 |
| 性能 | TTFT、TPOT、吞吐、HBM、Kernel 命中 |
| 容量 | 固定显存、KV 余量、最大安全并发 |
| 稳定性 | 长上下文、异常输入、多轮、压力与回滚 |

不要只用训练 Loss 判定 QAT 成功。Loss 可以收敛，但转换、Packing 或 Backend Kernel 仍可能引入新的差异。

## 11. 常见故障

| 现象 | 优先检查 |
| --- | --- |
| Loss 从开启 Fake Quant 起发散 | 学习率、Clipping、Scale、Observer、敏感层 |
| 恢复训练后指标跳变 | QAT 开关、Observer 状态、Checkpoint 完整性 |
| Fake-Quant 评测正常，Convert 后下降 | 转换公式、Packing、Scale/Zero Point 布局 |
| 离线正常，生产框架下降 | Kernel、模板、Tokenizer、Backend 回退和版本 |
| 显存下降但速度变慢 | Dequant 未融合、Shape 不合适、Launch 或通信瓶颈 |

## 12. 自测题与答案

### 12.1 Fake Quant 为什么不直接保存 INT4 Tensor？

训练需要可微的浮点计算和浮点主参数。Fake Quant 在 Forward 中把值限制到目标量化网格，再恢复为浮点表示，使模型感知量化误差，同时允许常规 Backward 更新。

### 12.2 STE 是否等于 `round` 的真实导数？

不是。STE 是人为选定的代理梯度，用来绕过不可导或几乎处处梯度为零的离散操作。它使训练可行，但其行为取决于具体 Fake Quant 和 Clipping 实现。

### 12.3 QAT 模型为什么仍要在目标硬件重新验收？

训练模拟的是数值方案，生产执行还包含权重 Packing、Kernel、累加精度、图优化和框架回退。模拟与真实实现不一致时，精度和性能都可能变化。

### 12.4 何时不应该直接上 QAT？

当 PTQ 已满足质量和性能目标，或目标 Backend 尚无对应低比特 Kernel 时，QAT 会增加训练、制品和验证复杂度，却不一定带来生产收益。应先确认目标格式、Kernel 和验收门槛。

## 13. 参考资料

- [PyTorch Quantization-Aware Training for LLMs](https://pytorch.org/blog/quantization-aware-training/)
- [TorchAO QAT Workflow](https://docs.pytorch.org/ao/stable/workflows/qat.html)
- [AWQ](https://arxiv.org/abs/2306.00978)
- [GPTQ](https://arxiv.org/abs/2210.17323)
