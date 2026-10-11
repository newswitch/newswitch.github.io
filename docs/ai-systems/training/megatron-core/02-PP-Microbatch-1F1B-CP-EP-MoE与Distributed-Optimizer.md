---
title: "Megatron Core PP、Microbatch、1F1B、CP、EP、MoE 与 Distributed Optimizer"
sidebar_label: "02. 流水线、长上下文与 MoE"
sidebar_position: 2
description: "推导 Microbatch 与流水线气泡、1F1B 激活驻留、CP Softmax 合并、MoE 路由容量与优化器显存。"
tags: [Megatron Core, Pipeline Parallel, Context Parallel, Expert Parallel, MoE]
---

# Megatron Core PP、Microbatch、1F1B、CP、EP、MoE 与 Distributed Optimizer

TP 切层内矩阵，PP 切模型深度，CP 切上下文，EP 切专家所有权。它们共同决定同一个训练 Step 的依赖图；不能把每一种策略单独省下的显存、时间或 GPU 数直接相乘。

下面沿用上一章的[矩阵分块与 Rank 坐标](./01-Process-Group-TP-Sequence-Parallel与一次Transformer层.md)，以同步更新、非交错流水线为基础，再讨论长上下文和 MoE。所有时间与容量例子都显式给出假设。

## 1. Pipeline Parallel

### 1.1 Global Batch 不等于 GPU 数乘 Microbatch

PP 把模型切成 p 个 Stage，每个 Stage 只持有部分层。一个 Microbatch 必须依次完成所有 Stage 的 Forward，再逆序完成 Backward，才算处理完这些样本。

设每个独立数据副本的 Microbatch 含 b 个样本，一次 Optimizer Step 累积 m 个 Microbatch，有 d 个数据副本：

```text
Global Batch = b × m × d
```

TP、PP、CP Rank 协同处理这些样本，不提供额外独立样本，不能再乘进 Global Batch。固定 Global Batch 和 d 时，减小 b 会增大 m，有利于填满流水线，但每个 Microbatch 的 GEMM 更小、通信与调度次数更多。

同一步的所有 Microbatch 使用相同参数版本，梯度累积后统一更新。不能每做完一个 Microbatch 的 Backward 就独立更新某个 Stage，否则后续 Microbatch 可能混用新旧权重，不再是这里的同步训练语义。

### 1.2 GPipe 与 1F1B 的区别首先是激活驻留

GPipe 先排完 m 个 Forward，再执行 Backward；前向结束时，一个 Stage 可能保存 m 份 Microbatch 激活。

非交错 1F1B 包含 Warm-up、稳定交替和 Drain。Warm-up 用足够多的 Forward 填充后续 Stage；稳定阶段在本地交替完成一个 Forward 和一个 Backward，及时释放已经反向完成的激活；最后排空尚未完成的 Backward。

“1F1B”描述稳定阶段，不表示第一个 Forward 后立刻就能 Backward。前面 Stage 必须等待最后 Stage 生成并传回梯度。[Megatron 流水线论文](https://arxiv.org/abs/2104.04473)区分这些调度与交错方案。

### 1.3 三 Stage、四 Microbatch 的完整时序

令每个 Stage 的一次 Forward 或 Backward 都耗时一个槽，忽略 P2P 时间和资源争用，每个 Stage 每槽最多执行一个操作。`Fi`、`Bi` 分别表示 Microbatch i 的前向和反向，`—` 表示等待或空闲；槽内输出只能在下一槽使用。

| 时间槽 | Stage 0 | Stage 1 | Stage 2 |
| --- | --- | --- | --- |
| 0 | F0 | — | — |
| 1 | F1 | F0 | — |
| 2 | F2 | F1 | F0 |
| 3 | — | — | B0 |
| 4 | — | B0 | F1 |
| 5 | B0 | F2 | B1 |
| 6 | F3 | B1 | F2 |
| 7 | B1 | F3 | B2 |
| 8 | — | B2 | F3 |
| 9 | B2 | — | B3 |
| 10 | — | B3 | — |
| 11 | B3 | — | — |

例如 Stage 0 的 B0 最早在槽 5：Stage 2 在槽 3 完成 B0，Stage 1 在槽 4 才能计算 B0。Stage 0 槽 2 的 F2 是稳定交替前的 Forward，使它一度持有 F0、F1、F2 三份待反向激活。

在这个普通非交错调度中，Stage i 的激活份数峰值约为 `min(m, p-i)`，这里 i 从 0 开始。因此三 Stage 的峰值分别为 3、2、1 份，而 GPipe 在本例可能达到各 4 份。具体 Buffer、重算和异步释放会影响字节峰值。

### 1.4 气泡公式的口径

继续假设均衡 Stage、等长 F/B、无通信代价。每个 Stage 有 2m 个有效计算槽，完整调度需要：

```text
总槽数                 = 2m + 2(p-1)
气泡占墙钟时间的比例   = (p-1)/(m+p-1)
气泡时间 / 理想计算时间 = (p-1)/m
```

这两个比例分母不同，不能都叫“气泡率”而混用。p=3、m=4 时，总槽数 12，有效槽数 8，墙钟气泡比例是三分之一，不是二分之一；二分之一是气泡相对理想计算的额外开销。

普通 1F1B 相比 GPipe 的主要优势是激活更早释放，不会仅凭交替 F/B 就消除同步流水线气泡。增大 m 降低气泡占比，却可能改变 Global Batch 或 Microbatch 大小。

### 1.5 Virtual Pipeline 与阶段不均衡

Virtual Pipeline 把一个物理 Stage 的层分成多个 Chunk，以更细粒度交错执行，改变填充与排空时序。它不增加独立数据副本，也不会把一次更新拆成多个 Optimizer Step。

在理想均衡模型中，更细的 Chunk 可缩短气泡时间；代价是更多阶段边界消息、更复杂的依赖与额外驻留。原来的非交错公式不能直接照搬。Embedding、输出投影、MoE 和不同序列长度还会让每层成本不等：每 Stage 相同层数不等于相同耗时，流水线稳态会受慢 Stage 限制。

### 1.6 两物理 Stage、四逻辑 Chunk 的合法交错时序

设 L0、L2 在物理 Rank 0，L1、L3 在物理 Rank 1，前向依赖是 `L0→L1→L2→L3`，反向相反。每个 chunk 的 F/B 各占一个槽，通信忽略，每 Rank 每槽一个操作，槽内结果下一槽可用。用四个 Microbatch，按“就绪反向优先，同方向尽早处理较早 Microbatch”的规则，可得到下面的完整合法示例；这是解释 VPP ownership 的教学调度，不冒充任意版本 Megatron 的标准 1F1B trace。

| 槽 | Rank 0：L0/L2 | Rank 1：L1/L3 |
| --- | --- | --- |
| 0 | F(L0,m0) | — |
| 1 | F(L0,m1) | F(L1,m0) |
| 2 | F(L2,m0) | F(L1,m1) |
| 3 | F(L2,m1) | F(L3,m0) |
| 4 | F(L0,m2) | B(L3,m0) |
| 5 | B(L2,m0) | F(L3,m1) |
| 6 | F(L0,m3) | B(L1,m0) |
| 7 | B(L0,m0) | B(L3,m1) |
| 8 | B(L2,m1) | F(L1,m2) |
| 9 | F(L2,m2) | B(L1,m1) |
| 10 | B(L0,m1) | F(L3,m2) |
| 11 | — | B(L3,m2) |
| 12 | B(L2,m2) | F(L1,m3) |
| 13 | F(L2,m3) | B(L1,m2) |
| 14 | B(L0,m2) | F(L3,m3) |
| 15 | — | B(L3,m3) |
| 16 | B(L2,m3) | — |
| 17 | — | B(L1,m3) |
| 18 | B(L0,m3) | — |

可逐格验证：每个 `(方向,chunk,microbatch)` 恰好出现一次，共 32 次操作；每 Rank 16 个有效槽；所有前驱都在更早槽完成。墙钟为 19 槽，每 Rank 平均有效比例 16/19。作为同成本基线，不交错的两 Stage 各持有连续两个 chunk，每次整 Stage F/B 各耗 2 槽，用前述均衡公式得到 20 槽。这个小例子只证明细粒度交错可改变气泡，不证明所有 VPP 配置都更快或该表最优。

L1→L2 的边从 Rank 1 返回 Rank 0，是跨卡边，不是本地调用。每个 Microbatch 前向从原来一个跨卡阶段边界变成三个，反向同样增加；实际 P2P 延迟可抵消节约的槽。每个逻辑 chunk 还要独立跟踪待反向激活，不能按物理 Rank 只存一份。

### 1.7 实现里的 virtual microbatch 不是新增样本

Megatron 的调度表将一次本地调用映射到 `(microbatch_id, model_chunk_id)`。例如 5 个 Microbatch、2 个 chunk、每组 3 个 Microbatch 时，前向本地查表顺序为：

```text
microbatch_id:  0 1 2 0 1 2 3 4 3 4
chunk_id:      0 0 0 1 1 1 0 0 1 1
```

反向 chunk 次序和 warm-up 数还需按物理位置与目标调度决定；不能把这个局部序列直接当全局墙钟表。十次本地前向仍对应五份输入，不是 Global Batch 翻倍。目标版本还可能约束 Microbatch group 的大小、尾组和通信组合。[Megatron 调度表与交错实现](https://github.com/NVIDIA/Megatron-LM/blob/main/megatron/core/pipeline_parallel/schedules.py)

## 2. Context Parallel

### 2.1 切 Query 不等于只看本地 Key

CP 将长度 s 的序列切给 C 个 Rank，各持有大约 s/C 个 Token 的输入和激活。逐 Token 的 Linear、LayerNorm 可以本地执行；Attention 不行，因为一个本地 Query 仍可能关注远端 Key。

对一次 Attention，可把计算写成：

```text
本地 Query Q_r × 所有合法 Key 的集合
→ 按全局合法 Key 范围归一化
→ 对对应 Value 加权求和
```

只计算本地 `softmax(Q_r K_r^T)V_r` 会把注意力范围截断成局部块，改变模型。CP 可通过 Ring/P2P 逐块交换 KV、聚集 KV 或其他布局转换获得所需数据；算法选择影响通信和驻留，不改变全局 Attention 的目标。[Megatron CP 定义](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/features/context_parallel.html)区分了 CP 与常规 SP。

### 2.2 局部 Softmax 为什么不能直接平均

对一个 Query，设块 i 的合法 Key 得分为 z_j，Value 为 v_j。为每块保存以下统计量：

```text
m_i = max_j z_j
l_i = sum_j exp(z_j-m_i)
n_i = sum_j exp(z_j-m_i) v_j

局部输出 o_i = n_i/l_i
```

合并两个非空块 a、b 时，先统一指数的基准：

```text
m = max(m_a, m_b)
l = exp(m_a-m) l_a + exp(m_b-m) l_b
n = exp(m_a-m) n_a + exp(m_b-m) n_b
全局输出 o = n/l
```

代入可见，每一项都变成 `exp(z_j-m)`，所以结果与一次性全局 Softmax 相同。它允许逐块处理 KV，而不必同时保留全部分数；这只是合并恒等式，具体通信实现不一定直接交换这些统计量。全被 Mask 的空块应作为零贡献跳过，不能计算不定的最大值差。

反例：两个块各含一个 Key，得分分别为 0 与 ln(3)，Value 分别为 10 与 20。局部 Softmax 各自输出 10、20，直接平均得到 15；正确全局输出为 `(10+3×20)/4=17.5`。每块的归一化权重不同，平均局部输出就丢掉了它。

此处只保留 CP 的合并契约；循环不变量、片上 Tile、流量模型与 Attention 后向的完整推导统一放在 [FlashAttention：Online Softmax](../../../gpu/compiler-kernels/05-CUTLASS-GEMM-FlashAttention与融合算子.md#online-softmax)，避免把通信与 Kernel 两篇都扩成重复的算法教材。

### 2.3 反向同步与负载边界

远端 KV 参与多个 Query 区间的计算，其梯度要合并这些区间的贡献并回到 KV 所有者。CP 权重本身也复制在对应 Rank 上，各 Rank 只处理部分 Token，因此相同权重的梯度需要同步；不能把所有权重状态都按 C 除掉。

全局普通 Attention 计算量仍约为 `s²h` 的量级，CP 主要把它分摊；理想局部计算约为全局的 1/C，但网络传输和启动代价不会消失。显式保存注意力分数时有平方级激活项；使用分块 Attention 避免完整分数驻留后，也不能因此认为计算量变成线性。

因果 Attention 的早期 Query 可见 Key 少、后期多。若简单按连续序列块平均分配，Token 数相同也可能工作量不等；需要考虑块布局和有效计算，而不只看 s/C。短序列则可能因通信占比过高而得不偿失。

### 2.4 反向的两种归属：Query 留本地，KV 归所有者

将 Query 行块按 r 分片，Key/Value 行块按 j 分片。每个 Query owner 用前向的全局行 LSE 重建 `P_rj`，不能用只对 j 归一化的局部概率。令 G_r 为对应输出梯度，`D_r=rowsum(G_r⊙O_r)`，无 Dropout 时：

```text
dZ_rj = P_rj⊙(G_r V_jᵀ-D_r)
dQ_r  = sum_j dZ_rj K_j/√d
dK_j  = sum_r dZ_rjᵀ Q_r/√d
dV_j  = sum_r P_rjᵀ G_r
```

dQ_r 汇总所有 KV 块后仍属于 Query owner；dK_j/dV_j 汇总所有 Query owner 的贡献后必须回到 KV owner。前向传 KV 的 ring，后向不仅重传所需 KV，还要按协议累积或传回梯度；不能因为前向输出本地完成就省掉后向归约。[Megatron CP 的 KV gather 与梯度 reduce-scatter](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/features/context_parallel.html)

手算两 Rank：各持一个 Query 和一个 KV，d=1，两个 Q 都为 1，K 为 `[0,ln3]`，V 为 `[10,20]`，故每行 P=`[1/4,3/4]`、O=17.5。上游 G0=1、G1=2，则两行 dZ 分别为 `[-1.875,1.875]`、`[-3.75,3.75]`。KV owner 0 最终 dK=-5.625、dV=0.75；owner 1 为 dK=5.625、dV=2.25。只用本地 Query 的贡献会丢掉另一行；取平均也会少一倍。

Q owner 0 的 dQ=`1.875·ln3`，owner 1 为 `3.75·ln3`，它们是不同 Token 的梯度，不能做 AllReduce 把二者相加当成同一个激活。GQA 还需在每个 KV owner 内合并共享该 KV 头的 Query 头贡献；因果 mask 和 dropout mask 必须使用全局 Token 坐标与前向相同的契约。通用导数与 GQA 公式见[Attention 后向](../../../gpu/compiler-kernels/05-CUTLASS-GEMM-FlashAttention与融合算子.md#attention-backward)。

## 3. Expert Parallel 与 MoE

### 3.1 Token 是按路由分配，而不是固定切分

设路由域中有 N 个有效 Token、E 个 Expert，每个 Token 选择 k 个 Expert。忽略 Shared Expert，逻辑输出为：

```text
y_t = sum_(e in TopK(t)) gate_(t,e) × Expert_e(x_t)
```

是否对选中的 Gate 再归一化取决于 Router 定义，不能默认所有实现的权重和都是 1。未丢弃时，Expert 输入分配总数为 Nk，不是 N：一个 Token 被选给多个 Expert 就形成多个分配。

EP 将不同 Expert 放在不同 Rank；它不是让每个 Expert 都看到相同 Token。典型 All-to-All Dispatcher 路径是：

```text
Router 产生 Token → Expert 与 Gate 映射
→ 按 Expert 和目标 Rank 重排
→ Dispatch，发送远端分配
→ 本地 Expert / Grouped GEMM
→ 返回 Expert 输出
→ 逆重排并按原 Token 的 Gate 加权合并
```

逆重排与 Gate 权重是正确性的一部分。只把返回结果顺序拼起来，可能维度正确却把别的 Token 输出当成当前 Token 的输出。不同 Dispatcher 可以采用 AllGather 或优化的通信机制，并非所有 EP 实现都固定两次普通 All-to-All。

### 3.2 六 Token 的路由与慢 Rank

考虑 N=6、E=4、k=2，路由如下：

| Token | 选中的 Expert |
| --- | --- |
| t0 | e0、e1 |
| t1 | e0、e1 |
| t2 | e0、e1 |
| t3 | e0、e2 |
| t4 | e0、e3 |
| t5 | e2、e3 |

四个 Expert 的分配数为 `[5,3,2,2]`，总计 12，平均 3。最忙 Expert 是平均的 5/3 倍；若 Rank 0 放 e0、e1，Rank 1 放 e2、e3，两 Rank 总分配数为 8 与 4。

相同 Expert 成本且计算时间近似与分配数成正比时，Rank 0 的计算约为 Rank 1 的两倍，慢 Rank 限制这个阶段。真实小 GEMM 不一定线性缩放，但这个例子已说明“总 Token 数均匀”和“平均负载正常”都不足以保证 EP 均衡。

### 3.3 Capacity、丢弃与 Padding 的交换

定义一个教学模型：容量在上述完整路由域统一计算，容量系数为 c，每个 Expert 最多接收：

```text
capacity = ceil(c × Nk/E)
```

取 c=1，则容量为 3，e0 超过容量的两个分配需要按策略处理。丢弃会改变实际模型输出，不只是性能优化；无丢弃策略保留所有分配，则要承担最大负载对应的动态存储与计算。

若 c=2，容量为 6，再将所有 Expert 填充到固定容量，总槽数是 24，但只有 12 个有效分配，填充利用率为二分之一。更规则的矩阵形状可能提高 Kernel 效率，但也增加无效计算，不能只看 GEMM 速度。

真实容量可能在本地 Token 域定义，并受对齐、路由算法与版本影响，应先明确 N 的范围；不能把整个 Global Batch 的 Token 数无条件代入实现。不同 Capacity、Padding 与 Dispatcher 选项见 [Megatron MoE 文档](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/features/moe.html)。

### 3.4 通信量与专家显存不是同一个稀疏度

若每个分配发送 h 维激活、每元素 b 字节，远端分配比例为 f，忽略元数据、填充与复制优化，则整个路由域 Dispatch 加返回的数据量约为：

```text
V ≈ 2 × f × N × k × h × b
```

这是整个域的发送量总和，不是每 Rank 固定流量。热点、目标分布和物理拓扑决定链路峰值；不同原始 Rank 的 Token 可能集中到一个 Expert Rank。

Top-k 减少每 Token 激活的 Expert 数，却不代表未选中 Expert 的参数与优化器状态可以不存在。计算稀疏、通信路由稀疏与模型状态所有权是三个不同概念。

### 3.5 EP 与数据副本的重新划分

在 CP=1、Expert TP 等于 Dense TP 的传统简化布局中，可把既有 DP 域拆成 EP 与 Expert DP（EDP）：`DP = EP × EDP`。Dense 参数在 DP 组同步，某个 Expert 的相同权重只在它自己的 EDP 副本组同步，不能把不同 Expert 的梯度相加。

例如 TP=2、PP=2、DP=4 已使用 16 卡。采用 EP=2、EDP=2 是重组这 16 卡中的专家职责，不会自动变成 32 卡。采用不同 Expert TP 或并行折叠时，上面的简化关系可能不适用，但 Dense 与 Expert 网格仍须映射到同一个物理 Rank 集合。

TP、EP、SP 的兼容条件还取决于 Expert 层与 Dispatcher 实现。不能把某个版本的 SP 要求升级为所有 MoE 算法的数学定理。

## 4. Distributed Optimizer

### 4.1 为什么不等于完整参数分片

经典 Distributed Optimizer 在数据副本间切分优化器更新职责。Backward 产生梯度后 ReduceScatter，每个 Rank 更新自己负责的 FP32 主参数与 Adam 状态，再 AllGather 更新后的计算参数供后续层使用。

但这个路径仍保留完整计算参数 Buffer，以及完整大小的主梯度 Buffer；ReduceScatter 后只有本地负责区间的归约值有效，不意味着其余 Buffer 容量都已释放。[官方显存模型](https://docs.nvidia.com/megatron-core/developer-guide/latest/user-guide/features/dist_optimizer.html)给出 BF16 参数、FP32 主梯度时的每参数成本 `6 + 12/d`，而不是 `18/d`。

### 4.2 BF16 与 FP32 主梯度的账本

设当前 TP/PP Rank 所负责模型分块含 P_local 个参数，d 为该类参数的优化器分片组大小。使用普通 FP32 Adam 状态：

| 对象 | 每 Rank 字节数 |
| --- | --- |
| 完整 BF16 计算参数 Buffer | `2P_local` |
| 完整 FP32 主梯度 Buffer | `4P_local` |
| FP32 主参数分片 | `4P_local/d` |
| FP32 Adam 两个状态分片 | `8P_local/d` |
| 合计 | `(6 + 12/d)P_local` |

例如 d=4，为每参数 9 字节；d=8，为 7.5 字节；d 趋于很大时仍趋近 6 字节，而不是零。相比非分布式的 18 字节，下降来自主参数与优化器状态分片，不是所有对象都分片。

这里只计算指定实现的模型状态，不含 Autograd 临时梯度、激活、通信和算子工作区。其他 dtype、优化器、分布式实例或额外参数分片策略需要重新列项；Expert 参数还要使用对应的 EDP/更新组，不能把 Dense DP 大小照搬进去。

这与 FSDP 的区别在于参数何时完整驻留：FSDP 通常按计算单元取回完整参数，经典 Distributed Optimizer 在当前模型分块上保留完整计算权重。参数物化时序不同，峰值与通信模式也不同。

## 5. 从约束选择组合，而不是固定顺序 {/* #5-组合顺序 */}

| 约束或主导成本 | 可考虑的维度 | 同时引入的代价 |
| --- | --- | --- |
| 单层权重或计算过大 | TP | 每层激活通信、小 GEMM 效率 |
| 模型深度与总权重过大 | PP | 阶段通信、气泡、阶段均衡 |
| 长上下文激活与 Attention 工作 | CP | KV 与梯度通信、因果负载均衡 |
| Expert 参数与路由工作 | EP | Dispatch 热点、容量、重排 |
| 优化器状态过大 | Distributed Optimizer | 梯度与参数同步、Buffer 驻留 |
| 增加独立数据吞吐 | DP | Global Batch 语义和梯度同步 |

先让各类持久对象与临时对象满足容量，再比较关键路径。全局固定卡数时增大一个独立维度，就会挤占其他维度：例如固定 Global Batch 下增大 TP，DP 变小，每数据副本需承担更多 Microbatch，PP 气泡可能降低，但 TP 通信又会增加。

优化目标不只是最低显存或最少通信，而是在保持目标损失、参数版本和样本权重不变的前提下，找容量与时间都可接受的布局。

## 6. 纸面自检

1. b=2、m=8、DP=4、TP=2、PP=4、CP=2，Global Batch 是多少？64 个样本，TP/PP/CP 不再相乘。
2. p=3、m=4 的理想流水线为何有三分之一气泡？每 Stage 有 8 个有效槽，整个迭代用 12 槽；不同于气泡相对计算的二分之一开销。
3. 普通 1F1B 比 GPipe 省什么？主要是待反向激活的驻留份数，不能据此断言气泡消失。
4. CP 两个局部 Attention 输出为 10、20，能取平均吗？不能，必须保留各块的归一化权重；例子里的正确值是 17.5。
5. 六 Token、Top-2 路由要处理几个分配？无丢弃时为 12；Expert 参数状态仍包括未被该 Token 选中的专家。
6. BF16/FP32 主梯度的经典 Distributed Optimizer，d=4 能按 `18/4` 算吗？不能，其完整 Buffer 仍占每参数 6 字节，总计 9 字节。

读 [数据与性能排障](./03-数据-Checkpoint-通信重叠-容量-性能与故障排查.md)时，可用这些依赖与账本判断一个等待来自气泡、梯度同步、KV 交换还是专家热点。
