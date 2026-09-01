---
title: "W4A16、AWQ、GPTQ 与量化 Kernel 执行链路"
sidebar_label: "06. W4A16、AWQ、GPTQ 与执行链路"
sidebar_position: 6
description: "从量化公式、分组与权重打包开始，理解 AWQ 和 GPTQ 如何生成制品，以及 W4A16 权重如何经过融合反量化 Kernel 完成推理。"
tags: [W4A16, AWQ, GPTQ, Weight Only, Quantization Kernel]
---

# W4A16、AWQ、GPTQ 与量化 Kernel 执行链路

`W4A16` 只说明“权重通常以 4 bit 保存、激活仍以 16 bit 参与计算”，没有说明制品如何生成，也没有保证目标硬件一定有高效 Kernel。

理解量化需要同时追踪三条线：

```text
数值线：浮点权重 → Scale/Zero Point → 低比特整数 → 近似权重
制品线：校准 → 量化 → Packing → 配置与权重文件
执行线：读取压缩权重 → 解包/反量化 → GEMM/GEMV → 输出激活
```

## 1. 先读懂最基本的量化公式

把一组浮点数映射到整数网格，可简化为：

```text
q = clamp(round(x / s) + z, qmin, qmax)
x_hat = (q - z) × s
```

- `s` 是 Scale，决定相邻量化格点的间距；
- `z` 是 Zero Point，使整数零点能够对应某个浮点值；
- `q` 是实际保存的低比特整数；
- `x_hat` 是反量化后的近似值；
- `x - x_hat` 是量化误差。

对称量化通常令 `z=0`，实现简单；非对称量化能更好覆盖偏斜分布，但元数据和 Kernel 处理更复杂。

### 1.1 Scale 的粒度

| 粒度 | Scale 数量 | 精度与成本 |
| --- | ---: | --- |
| Per-Tensor | 整个 Tensor 一个 | 元数据少，但容易被异常值拉大范围 |
| Per-Channel | 每个输出或输入 Channel 一个 | 通常更准，需要 Kernel 支持对应广播 |
| Per-Group | 每若干权重一个 | W4A16 常见折中，Group 越小通常越准、元数据越多 |

`group_size=128` 不是“每 128 个参数随便放一起”，而是沿制品规定的维度分组。维度、布局和权重转置方式不同，生成的 Scale 不能互换。

## 2. W4A16 到底省了什么

假设线性层权重为 `W[K,N]`，输入激活为 BF16：

```text
X[M,K] (BF16) × W[K,N] (INT4 Packed)
→ Kernel 内解包和反量化
→ BF16/FP16 或更高精度累加路径
→ Y[M,N]
```

它主要减少：

- 权重在磁盘和显存中的容量；
- Decode 阶段反复从 HBM 读取权重的字节数；
- TP 场景中每个 Rank 的固定权重占用。

它通常没有自动减少：

- BF16 激活；
- BF16 KV Cache；
- Attention 临时 Workspace；
- CUDA Graph 静态 Buffer；
- TP 的激活集合通信量。

因此，W4A16 可能让模型从“装不下”变成“装得下”，也可能让同一副本容纳更多 KV Cache；这两种收益都不等于单请求延迟必然降低四倍。

## 3. 为什么 4 bit 权重需要 Packing

通用内存通常不能把每个 4 bit 值当作独立地址访问。制品会把多个低比特值压入 8/16/32 bit 容器，并按 Kernel 需要重排。

```text
逻辑权重 q0 q1 q2 q3 q4 q5 q6 q7
→ 位打包到一个 32-bit 容器
→ 按 Tile、Channel、Group 和硬件指令要求重排
```

运行时不是简单执行 `INT4 × BF16`：

1. 从 HBM 读取 Packed INT4 和 Scale；
2. 在寄存器或片上存储中解包；
3. 用 Scale 恢复到 Kernel 需要的计算表示，或直接走硬件支持的低比特 MMA；
4. 完成矩阵乘与累加；
5. 可在 Epilogue 中融合 Bias、激活或再量化。

高效实现会把解包、反量化和矩阵乘融合在同一 Kernel 内。若框架先生成完整 BF16 权重临时 Tensor，再调用普通 GEMM，HBM 流量和临时显存可能抵消压缩收益。

## 4. AWQ 做了什么

AWQ 是 Activation-aware Weight Quantization。核心问题不是寻找“绝对值最大的权重”，而是利用校准激活识别哪些输入 Channel 对输出更敏感。

对线性层 `Y=XW`，可以做保持函数等价的缩放：

```text
Y = (X × S^-1) × (S × W)
```

AWQ 搜索合适的 Channel Scale，使重要 Channel 对量化网格更友好，再对变换后的权重做分组低比特量化。理想状态下，浮点等价变换不改变原函数，但会改变量化误差分布。

完整流程是：

```text
固定基座模型和Tokenizer
→ 用代表性校准集执行Forward
→ 收集激活统计并识别敏感Channel
→ 搜索平滑/缩放参数
→ 对各层权重分组量化
→ 按目标Runtime要求Packing
→ 生成量化配置、Scale和权重
→ 任务质量、协议和性能验收
```

AWQ 的“Activation-aware”发生在离线生成制品时。在线推理一般不需要为每个请求重新执行 AWQ 搜索。

### 4.1 AWQ 不等于混合精度保留 1% 权重

论文观察到少量显著 Channel 很重要，但硬件友好的实现并不一定把这些权重单独保存成 FP16 稀疏旁路。常见做法是通过等价缩放保护它们，再保持规则的低比特矩阵布局。是否存在高精度保留层，要看具体制品配置和实现。

## 5. GPTQ 与 AWQ 的差异

GPTQ 是基于近似二阶信息的训练后权重量化方法。它按块或按列量化权重，并在后续未量化权重中补偿当前量化引入的误差。

| 维度 | AWQ | GPTQ |
| --- | --- | --- |
| 主要信息 | 校准激活与 Channel 重要性 | 校准输入形成的近似二阶信息 |
| 核心动作 | 等价缩放后量化 | 逐步量化并做误差补偿 |
| 是否反向训练 | 否 | 否 |
| 在线执行 | 依赖目标 AWQ Kernel/布局 | 依赖目标 GPTQ Kernel/布局 |
| 共同风险 | 校准偏差、制品格式不兼容、Kernel 回退、质量退化 | 同左 |

算法名字只描述“如何得到近似权重”。真正部署还需要回答：保存格式是什么、Kernel 读取什么布局、目标 GPU/NPU 是否支持、哪些层会回退。

## 6. 一次 W4A16 线性层如何运行

以 Decode 的小 `M` 矩阵为例：

```text
Hidden State(BF16)
→ 选择量化Linear实现
→ 读取Packed INT4 Tile与Scale
→ 解包并反量化到寄存器/片上Buffer
→ Tensor Core或专用指令完成乘加
→ Epilogue写回BF16输出
```

检查性能时要确认四件事：

1. Profiler 中实际 Kernel 名称是否为目标量化实现；
2. 是否存在单独的大型 Dequant Kernel 和 BF16 权重临时写回；
3. 目标 Shape 是否命中高效 Tile，而不是通用回退；
4. HBM 读取下降后，瓶颈是否转移到 Launch、Attention 或 TP 通信。

## 7. 为什么小 Batch 更可能受益，也更容易踩坑

Decode 常见 `M≈正在运行的序列数`。小 `M` 时，单步需要读取大量权重，却只完成较少乘加，因而更容易受权重带宽限制；W4A16 能显著减少权重字节。

但小 `M` 也可能造成：

- Tile 填不满；
- Tensor Core 利用率低；
- 解包和 Scale 开销占比上升；
- Kernel Launch 成为主要成本；
- 特定 Group Size 没有优化实现。

所以要按生产中的 Batch/Token Shape 测量，不能只引用大矩阵吞吐。

## 8. 从模型目录判断制品是否完整

至少确认：

```text
基座模型Revision
量化算法和版本
bits / group_size / zero_point / scale dtype
哪些模块被量化或排除
权重Packing布局
Tokenizer与Chat Template
目标Runtime、硬件架构和Kernel
校准集摘要
质量与性能报告
```

配置文件写着 `quant_method: awq` 只能说明入口声明，不能证明所有层成功使用量化 Kernel。最终要结合加载日志、模型层替换结果和 Profiler。

## 9. CUDA 与 NPU 为什么不能只复制同一制品

逻辑上的 W4A16 可以跨平台讨论，物理制品和执行实现却与 Backend 绑定：

- Packing 顺序和对齐要求不同；
- Scale/Zero Point 的组织不同；
- CUDA、CANN/ATB 等算子支持矩阵不同；
- 支持的 Group Size、Dtype 和模型架构不同；
- Graph Capture 与动态 Shape 的回退路径不同；
- 转换工具可能需要生成目标硬件专用权重。

因此迁移时应从“目标框架当前支持的量化格式”反向选择转换链，不能只看文件名中包含 `AWQ`。

## 10. 精度与性能必须分开验收

### 10.1 精度

- 与 BF16 基线使用同一模型 Revision、Tokenizer、模板和 Sampling；
- 覆盖真实领域、长上下文、代码、数学、工具调用和结构化输出；
- 比较困惑度或任务指标，也比较协议正确性；
- 分层抽样分析哪类请求退化，不只看总体平均值。

### 10.2 性能

- 冷启动和稳态分开；
- Prefill 与 Decode 分开；
- 固定输入/输出 Token 联合分布；
- 同时记录 TTFT、TPOT、吞吐、显存、功耗和最大安全并发；
- 用 Profiler 证明使用了目标 Kernel。

## 11. 常见误判

| 说法 | 问题 |
| --- | --- |
| W4A16 就是用 INT4 做全部计算 | 激活和累加路径仍可能是 BF16/FP16，权重还需解包与反量化 |
| AWQ 不需要数据 | 不反向训练不等于不需要代表性校准激活 |
| 权重缩小四倍，延迟也缩小四倍 | 端到端还受 Attention、Launch、通信和排队影响 |
| 同为 AWQ 的模型文件都能加载 | Packing、Group Size、Kernel 和框架版本可能不兼容 |
| 成功启动就表示量化生效 | 可能有层回退高精度实现，必须核对日志和 Kernel |

## 12. 自测题与答案

### 12.1 为什么 W4A16 通常对 Decode 比 Prefill 更有吸引力？

Decode 的小 Batch 线性层常需要为较少计算反复读取大量权重，更容易受 HBM 权重带宽限制。W4A16 减少权重读取字节，因此可能降低每 Token 时间；Prefill 的大矩阵复用权重更充分，更容易进入计算受限区间，收益模式不同。

### 12.2 AWQ 的激活信息在哪里使用？

在离线校准和权重变换阶段，用于识别敏感 Channel 并搜索缩放参数。生成制品后，在线请求通常直接读取已经量化和打包的权重，不会重新执行搜索。

### 12.3 为什么量化模型启动成功，吞吐却没有提高？

可能目标 Shape 回退到通用 Kernel、反量化未融合、服务受 CPU/Launch/Attention/TP 通信限制，或测试 Batch 太小/太大而未命中量化 Kernel 的优势区间。需要用实际 Kernel、时间线和 HBM 指标证明。

### 12.4 AWQ、GPTQ 和 QAT 的根本区别是什么？

AWQ 利用校准激活寻找权重缩放，GPTQ 使用近似二阶信息逐步量化并补偿误差；二者通常属于 PTQ。QAT 则在训练或微调期间用 Fake Quant 模拟目标量化误差，通过梯度让参数适应该误差。

## 13. 参考资料

- [AWQ: Activation-aware Weight Quantization](https://arxiv.org/abs/2306.00978)
- [GPTQ: Accurate Post-Training Quantization](https://arxiv.org/abs/2210.17323)
- [vLLM Quantization](https://docs.vllm.ai/en/latest/features/quantization/)
- [vLLM-Ascend Quantization Adaptation](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/Design_Documents/quantization_adaptation.html)
