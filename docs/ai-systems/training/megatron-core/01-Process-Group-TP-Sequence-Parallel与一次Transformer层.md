---
title: "Megatron Core Process Group、TP、Sequence Parallel 与一次 Transformer 层"
sidebar_label: "01. 进程组与张量并行"
sidebar_position: 1
description: "从 Rank 坐标和矩阵分块推导 TP 前反向通信、Attention Head 切分及 Sequence Parallel 的正确性。"
tags: [Megatron Core, Process Group, Tensor Parallel, Sequence Parallel]
---

# Megatron Core Process Group、TP、Sequence Parallel 与一次 Transformer 层

Tensor Parallel（TP）让多个 Rank 协同计算同一个逻辑层。理解它不能只记“列切、行切”，还要证明：切分后的局部结果怎样组成原结果，非线性在哪里能独立执行，反向梯度在哪里必须归约。

本章采用传统 Dense Transformer 的 TP、PP、DP、CP 网格，不引入额外的权重重物化维度。矩阵统一写成 `Y = XW`；PyTorch Linear 的实际权重存储通常是其转置，数学上的列切不等于存储 Tensor 的第 1 轴切分。

## 1. 正交进程组

### 1.1 并行维度表达不同职责

| 维度 | 多个 Rank 协作的对象 | 典型交换 |
| --- | --- | --- |
| TP | 同一层的不同权重与算子分块 | 激活或输入梯度的归约与聚集 |
| PP | 同一模型的不同深度阶段 | 相邻阶段的激活与梯度 |
| CP | 同一样本的不同序列区间 | Attention 的 KV 与相应梯度 |
| DP | 同一模型的不同数据样本 | 相同权重分片的梯度同步 |

上述独立维度下，`world_size = TP × PP × CP × DP`。例如 64 卡、TP=4、PP=4、CP=2，则 DP=2，不是每张 GPU 都处理一份独立样本。

EP 描述 Expert 的分配，它通常在既有 Rank 集合上重新组织 Expert Parallel 与 Expert Data Parallel。不能把 EP 大小直接额外乘入 Dense 网格公式。专家层采用不同 TP 大小时，还要分别检查 Dense 与 Expert 网格的映射；具体组定义见 [Parallel State](https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.parallel_state.html)。

### 1.2 八 Rank 的纸面坐标

取 TP=2、PP=2、DP=2、CP=1。为方便推演，显式定义教学编号 `rank = t + 2d + 4p`，其中 t、d、p 分别是三个坐标；这不是要求所有版本使用同一默认编号顺序。

```text
Stage p=0：数据副本 d=0 → Rank {0,1}
           数据副本 d=1 → Rank {2,3}
Stage p=1：数据副本 d=0 → Rank {4,5}
           数据副本 d=1 → Rank {6,7}

TP 组：{0,1}、{2,3}、{4,5}、{6,7}
PP 组：{0,4}、{1,5}、{2,6}、{3,7}
DP 组：{0,2}、{1,3}、{4,6}、{5,7}
```

Rank 3 与 Rank 2 共同计算同一阶段的一个 Microbatch，与 Rank 7 传递这个 Microbatch 的阶段边界，与 Rank 1 同步相同权重分片在不同样本上的梯度。

把 TP 的激活归约错误地放进 DP 组，不一定只是 Hang：形状刚好相同时，也可能把不同样本的激活加在一起而得到错误结果。组内 Collective 的类型、次序、元素数量和 dtype 必须一致。

逻辑坐标与物理互联是两层问题。把高频 TP 通信映射到高速互联域通常有利，但仅将组命名为 TP 不会改变它实际经过的网络。

## 2. MLP 的 TP

### 2.1 从矩阵乘法推导列切与行切

设批量 Token 数 M 为 batch 与 sequence 的乘积，隐藏宽度 h，MLP 中间宽度为 4h。忽略 Bias，普通 MLP 为：

```text
X:  [M, h]
W1: [h, 4h]
W2: [4h, h]
H = φ(XW1)
Y = HW2
```

在 T 个 TP Rank 上，按 W1 的输出维切列，得到 `W1_r: [h, 4h/T]`。每个 Rank 都有 X，计算 `H_r = φ(XW1_r)`。因为 φ 是逐元素激活，先分块再激活与先激活再分块等价，不需要先聚集完整 H。

W2 按对应输入维切行，得到 `W2_r: [4h/T, h]`。每个 Rank 的输出形状都是 `[M,h]`，但只是部分和：

```text
H = concat(H_0, ..., H_(T-1))
W2 = stack_rows(W2_0, ..., W2_(T-1))

Y = HW2 = sum_r H_r W2_r
```

所以第二层结束要 SUM 归约，而不是拼接这些 Y_r。列切输出是不同特征，行切输出是同一特征的不同贡献；二者形状和合并操作不同。[Megatron 的并行 Linear 定义](https://docs.nvidia.com/megatron-core/developer-guide/latest/apidocs/core/core.tensor_parallel.layers.html)使用这一配对。

如果把 W1 先按输入维切开，则 `XW1` 变成多个部分和，必须先归约才能激活。反例是 `ReLU(-1 + 2)=1`，而 `ReLU(-1)+ReLU(2)=2`。非线性通常不能跨求和随意移动，这是配对选择的正确性原因，不只是性能经验。

对 SwiGLU 等门控 MLP，也要把两条投影的对应中间特征分给同一 Rank，才能本地完成逐元素相乘。中间宽度不一定为 4h，公式应替换成模型实际宽度。

### 2.2 两 Rank 的数值例子

把中间宽度缩小为 2，令：

```text
X  = [1, 2]
W1 = [[1, 3],
      [2, 4]]
W2 = [[1, 2],
      [3, 4]]
φ  = ReLU

完整计算：H = [5,11]，Y = [38,54]

Rank0：W1 第一列 → H0=5  → W2 第一行 → Y0=[5,10]
Rank1：W1 第二列 → H1=11 → W2 第二行 → Y1=[33,44]
归约：Y0+Y1=[38,54]
```

在普通 TP 中归约后各 Rank 都获得完整 Y；启用 SP 时则可直接保留归约后的不同序列区间，下一节解释其边界。

Row Parallel 的输出 Bias 只能加一次。若每个 Rank 在部分和中都加相同 Bias，再求和，就会得到 T 倍 Bias。Bias、Residual 和 Dropout 的位置都必须符合逻辑上的单次运算。

### 2.3 反向在哪里通信

令 D 为完整输出梯度。每个 Rank 可以本地计算：

```text
dW2_r = H_r^T D
dH_r  = D W2_r^T
dZ_r  = dH_r ⊙ φ'(XW1_r)
dW1_r = X^T dZ_r
dX_r  = dZ_r W1_r^T

完整输入梯度 dX = sum_r dX_r
```

因此一个普通 TP MLP 的主要激活通信是 Forward 末端归约 Y，以及 Backward 到达输入边界时归约 dX。局部权重梯度不用在 TP 组中拼成完整权重梯度；它们属于不同参数区间，但仍需在相应 DP 组同步不同样本的贡献。

接着上面的数值例子，取 D 为 `[1,1]`：Rank 0 得到 dH0=3、dX0=`[3,6]`；Rank 1 得到 dH1=7、dX1=`[21,28]`。两者相加才是完整 dX=`[24,34]`。若漏掉输入梯度归约，当前层的权重梯度可能看似正常，前一层却收到错误梯度。

## 3. Attention 的 TP

对标准多头 Attention，Head 之间在 Attention 核心计算阶段独立。将 Q、K、V 投影的输出按 Head 分配，每个 Rank 为自己负责的 Head 计算：

```text
O_r = softmax(Q_r K_r^T / sqrt(d_head) + mask) V_r
```

每个 Head 仍需要完整的相关 Key 序列；“Head 被 TP 切分”不等于“上下文已被切分”。随后输出投影按输入 Head 特征切分，各 Rank 算部分输出，再像 MLP 的 W2 一样归约。

GQA/MQA 中多个 Query Head 共享较少的 KV Head。若 KV Head 少于 TP 大小，就不能直接给每个 Rank 分配互不重叠的一个 KV Head。实现可能限制布局或复制部分 KV；这会改变 KV 显存和通信，不能继续假设所有对象都恰好除以 T。

同样需要分清 Bias、Residual 和随机状态：处于复制区域的逻辑输出必须一致，处于不同分片区域的随机流则要匹配它们各自负责的逻辑元素。随意给所有 Rank 同一个或完全独立的 Seed，都不足以证明与非并行模型等价。

## 4. Sequence Parallel

### 4.1 为什么切序列适合 LayerNorm

LayerNorm 对每个 Token 的隐藏特征计算均值与方差。若切隐藏维，各 Rank 缺少完整特征，需要额外归约统计量；若切序列维，每个 Rank 持有部分 Token 的完整隐藏向量，就能独立做 LayerNorm、Dropout 和残差等逐 Token 操作。

普通 TP 在这些区域复制 `[s,b,h]` 激活，SP 将其变成每 Rank 的 `[s/T,b,h]`。它减少的是特定区域的激活冗余，不意味着整个 Transformer 的所有激活都按同一方式缩小。[Sequence Parallel 的原始分析](https://arxiv.org/abs/2205.05198)将这些区域与 TP 的特征切分区域区别对待。

### 4.2 两种分片在边界转换

在常规 TP+SP MLP 路径中：

```text
每 Rank：部分序列 × 完整隐藏维
→ 本地 LayerNorm
→ AllGather 序列，得到完整序列输入
→ Column Parallel，变为完整序列 × 部分中间特征
→ 本地激活与 Row Parallel，得到完整序列的部分输出和
→ SUM ReduceScatter，变回部分序列 × 完整隐藏维
→ 本地 Dropout/Residual
```

Backward 逆向转换：输出边界的序列梯度先 AllGather；输入侧的部分梯度贡献则 ReduceScatter，交回各 Rank 负责的 Token 区间。不能把输出处的 ReduceScatter 当成普通 Scatter，因为归约要先合成不同 TP 分块的贡献。

LayerNorm 的参数在 TP Rank 间通常复制。SP Rank 处理不同序列位置，因此这类复制参数的局部梯度来自不同 Token，还需要同步；而不同 TP 权重分片不应互相求和。是否同步取决于参数的逻辑所有权，不是看 Tensor 形状相同就做 AllReduce。

### 4.3 SP 并不天然增加一倍通信

理想 Ring 下，AllReduce 可以拆成 ReduceScatter 与 AllGather。普通 MLP 前向和反向各一次 AllReduce；SP 把边界改为前向一对 AG/RS、反向一对 AG/RS。在对应张量大小相同的模型中，带宽项相近，但同步点、驻留时间和可重叠窗口改变了。

SP 通常在 TP 组上运行，不再额外乘一个 SP 维度增加 GPU 数。它也不等于 CP：SP 的常规路径在 Attention 前重新聚集相关序列区域；CP 让序列分片跨越 Attention 核心，并专门交换远端 KV。

## 5. 通信重叠与 TP 的扩展边界 {/* #5-通信重叠 */}

令 M 为 Token 数、h 为隐藏宽度，按一次乘加计两 FLOPs，忽略激活与 Bias，一个中间宽度为 4h 的 MLP Forward 约需：

```text
两次 GEMM 总计算量 ≈ 16 M h²
理想每 TP Rank 计算量 ≈ 16 M h² / T
一次输出归约的完整张量字节数 = M h × 每元素字节数
```

权重和大部分计算随 T 分摊，但归约对象仍是 `[M,h]`。扩大 T 会让 GEMM 更短、更窄，通信启动开销却不按 T 消失。因此 TP 的收益会受通信比例和小矩阵计算效率限制，不存在“TP 翻倍吞吐必然翻倍”。

可将理想单层时间写成计算项、暴露的通信项与依赖尾部之和，而不是把所有通信时间直接相加。输入梯度一旦产生，可以尝试在其通信期间计算本层权重梯度；但依赖该输入梯度的前一层仍要等归约完成。

通信与 GEMM 同时出现只是重叠的必要证据之一，不是收益证明。它们可能争用 SM、HBM 或互联资源；端到端关键路径缩短才是有效隐藏。

## 6. 切分边界与反例 {/* #6-常见错误 */}

| 看似可行的做法 | 为什么不成立或不充分 |
| --- | --- |
| 把 EP 直接乘进 GPU 总数 | EP 可能重新划分既有 Rank 域，不是额外独立维度 |
| W1 按输入切，各 Rank 直接做激活 | 非线性不保持部分和的可加性 |
| Row Parallel 输出直接拼接 | 输出是同一特征的贡献，应归约 |
| SP 按隐藏维切 LayerNorm | 各 Rank 缺少完整统计量，不能独立计算 |
| 所有同形参数梯度在 TP 组求和 | 不同权重分片不是副本；需要按所有权确定同步组 |
| 所有 Head 或层数都必须平均分配 | 简单均分有整除约束，复制与不均匀布局也可能存在，但成本不同 |

配置约束要对应具体算法。层数不均匀的 PP 布局、KV 复制和 Expert Tensor Parallel 都不能仅靠一个“整除所有维度”的判断覆盖。

## 7. 纸面自检

1. 数值例子里的两份 Y_r 能否拼接成 `[5,10,33,44]`？不能，完整输出只有两维，应相加成 `[38,54]`。
2. 为什么 W1 列切后能独立 ReLU？因为它们是输出坐标的不同区间，而不是同一坐标的部分和。
3. W2 的反向产生 dH_r 后，是否立刻需要 TP AllReduce？不需要，dH_r 属于不同中间特征；到 dX 的部分贡献才需要归约。
4. 八 Rank 例子中 Rank 3 的 TP、PP、DP 伙伴分别是谁？分别是 Rank 2、Rank 7、Rank 1。
5. SP Rank 的 LayerNorm 梯度为什么需要同步？参数是副本，但 Token 区间不同，各自只算了部分样本贡献。

下一章继续推导[流水线时序、长上下文 Attention 与专家路由](./02-PP-Microbatch-1F1B-CP-EP-MoE与Distributed-Optimizer.md)。
