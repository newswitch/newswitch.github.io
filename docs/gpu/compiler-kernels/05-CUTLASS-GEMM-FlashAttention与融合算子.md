---
title: "CUTLASS、GEMM、FlashAttention 与融合算子"
sidebar_label: "05. GEMM、Attention 与融合"
sidebar_position: 5
description: "理解矩阵乘、Tile、Tensor Core、Epilogue 与 IO-Aware Attention，判断专用融合 Kernel 的收益和边界。"
tags: [CUTLASS, GEMM, FlashAttention, Tensor Core, Kernel Fusion]
---

# CUTLASS、GEMM、FlashAttention 与融合算子

本文先从 GEMM 的复用推导 Tile，再解释 Attention 为什么不能直接逐块 Softmax，最后推导前向合并与后向重计算。以下数字都是注明假设的教学模型，不是任何 GPU 的实测性能；通用性能上界见 [Roofline](../performance/01-GPU-Roofline性能模型.md)。

## 1. GEMM 是大模型核心工作负载

线性层可表示为：

```text
D = α × A × B + β × C
```

高性能实现把矩阵切成 Thread Block/Warp/Instruction Tile，在 HBM、L2、Shared Memory 和 Register 间分层搬运，并用 Tensor Core 执行 MMA。

### 1.1 为什么矩阵乘值得分块

设 `A[M,K] × B[K,N]`，FMA 按 2 FLOP 计，令 α=1、β=0。若理想地各读一次 A/B、写一次 D，每元素 b 字节：

```text
FLOPs = 2MKN
理想逻辑字节 = b(MK + KN + MN)
AI_ideal = 2MKN / [b(MK + KN + MN)]
```

这不是每个实现的实际 HBM 流量。不同输出 Tile 会重复请求输入，能否由 L2 满足取决于缓存和访问顺序；β 非零还要读 C。

每个 Block 计算 `BM×BN` 的输出，对 K 维按 BK 分块。一个 K 阶段加载 `BM×BK` 的 A 和 `BK×BN` 的 B，执行 `2BM×BN×BK` FLOP：

```text
AI_stage = 2BM×BN / [b(BM+BN)]
```

取 BF16、BM=BN=64、BK=32：输入为 8 KiB，计算为 262144 FLOP，阶段复用约 32 FLOP/Byte。把 BM、BN 同时升到 128，阶段复用升到 64 FLOP/Byte，但 FP32 输出累加器从 `64²×4=16 KiB` 升到 `128²×4=64 KiB`。省流量与累加器容量必须一起算；寄存器分配由参与线程及 Layout 决定，不能把这些字节全算到一个线程。

### 1.2 边缘 Tile 的利用率

若 M=N=130、BM=BN=128，需要 2×2 个输出 Tile。有效输出只有 16900 个，而按满 Tile 安排有 65536 个槽位，比例约 25.79%。Mask 保证不越界，却不必然让 Tensor Core 跳过所有补齐槽位的计算。若简单采用更大 Tile，小矩阵可能因尾块、并行任务不足或资源占用变慢。

## 2. CUTLASS 的层次

CUTLASS 提供 CUDA C++ 模板构建 GEMM 和相关 Kernel。理解重点：

- 数据类型与累加类型；
- Layout 和 Alignment；
- Thread Block/Warp/Instruction Shape；
- Pipeline Stage；
- Epilogue 融合 Bias、Activation、Quantization；
- 目标 GPU 架构和 Tensor Core 指令。

错误 Alignment 或不合适 Shape 可能回退或使用低效 Kernel。

### 2.1 Mainloop 与 Epilogue 分别解决什么

Mainloop 沿 K 维加载片段并累加矩阵乘；Epilogue 把分散在计算线程中的累加器整理为输出，应用 α/β、Bias、激活或类型转换。把 Bias+Activation 放在 Epilogue，可以避免一次“写 GEMM 输出，再读它做激活”的往返，但不能把 ReLU 随意插进 K 的部分和：

```text
relu((-2)+3) = 1
relu(-2)+relu(3) = 3
```

因此必须先完成需要的归约，再执行不与求和交换的非线性。软件流水则用多个输入缓冲，使下一 K 块的搬运与当前块计算重叠，代价是额外 Shared Memory/寄存器。[CUTLASS Efficient GEMM](https://docs.nvidia.com/cutlass/latest/media/docs/cpp/efficient_gemm.html)描述了分层 Tile、流水与 Epilogue；这些机制不等于所有架构采用完全相同的线程映射。

## 3. 算术强度

GEMM 在大 Shape 下通常有较高 Arithmetic Intensity，容易发挥 Tensor Core；小 Batch、窄矩阵或 Decode 场景可能受 Launch、内存和矩阵形状限制。TFLOPS 低不能直接说明 Kernel 差，还需与该 Shape 的可达上限比较。

## 4. FlashAttention 的核心思想

标准 Attention 若物化完整 `S×S` 分数矩阵，会产生大量 HBM 读写。FlashAttention 按 Tile 在片上存储计算，通过 Online Softmax 避免完整中间矩阵写回，减少 I/O。

```text
不是减少Attention数学量
而是重排计算，减少HBM流量和中间存储
```

实际 Backend 还受 Head Dim、Dtype、Mask、因果模式、GQA、GPU 架构和版本限制。

### 4.1 先写清楚目标与符号

先讨论单头、无 Dropout、无 Mask、自然指数的 Attention，序列长 s，Head Dim 为 d：

```text
Q,K,V: [s,d]
Z = QKᵀ/√d: [s,s]
P = softmax(Z)，沿每个 Query 行归一化
O = PV: [s,d]
```

两次矩阵乘约 `4s²d` FLOP，未计 Softmax 等操作。避免物化 Z/P 不会消除所有 Query-Key 配对，普通密集 Attention 的核心计算仍是平方量级。这里的 Exact 指不引入稀疏/低秩近似，不保证与另一种浮点归约顺序逐 Bit 相同。

### 4.2 Online Softmax：保留的是可合并统计量 {/* #online-softmax */}

对一行 Query，已经处理的合法 Key 集合为 A。保存三个状态：

```text
m_A = max_(j∈A) z_j
l_A = sum_(j∈A) exp(z_j-m_A)
u_A = sum_(j∈A) exp(z_j-m_A) v_j    # d 维向量
当前输出 o_A = u_A/l_A
```

新的非空块 B 也有 m_B、l_B、u_B。合并时用共同最大值 m：

```text
m = max(m_A,m_B)
α = exp(m_A-m)，β = exp(m_B-m)
l = αl_A + βl_B
u = αu_A + βu_B
o = u/l
```

正确性来自每项指数的基准统一：

```text
exp(m_A-m) × exp(z_j-m_A) = exp(z_j-m)
```

所以 l 与 u 恰好是所有已处理 Key 在同一基准下的分母和加权分子。这是循环不变量：初始非空块成立，每次合并保持成立，扫完合法 Key 后就是全局结果。可直接以第一个非空块初始化；全 Mask 块是零贡献，应跳过，避免 `-inf-(-inf)`。若整行无合法 Key，输出按接口约定处理。

另一种实现保存归一化的旧输出 o_A，此时旧分子必须恢复为 `l_A×o_A`，不能漏掉 l_A。最大值上升时也不能只更新 l 而忘记缩放旧 u。[Online Normalizer 论文](https://arxiv.org/abs/1805.02867)给出了在线最大值/分母思路；这里把加权 Value 分子放入同一不变量来推导 Attention。

### 4.3 三个 Key 的手算与错误合并

取得分 `[0,ln(2),ln(4)]`，标量 Value 为 `[1,3,5]`。第一块含前两个 Key，第二块含第三个：

```text
块 A：m_A=ln(2)，l_A=1/2+1=3/2，u_A=1/2+3=7/2
块 B：m_B=ln(4)，l_B=1，u_B=5
合并：m=ln(4)，α=1/2，β=1
      l=3/4+1=7/4，u=7/4+5=27/4
      o=27/7 ≈ 3.857143
一次性计算：(1×1+2×3+4×5)/(1+2+4)=27/7
```

局部输出分别是 `7/3` 和 5，平均得到 `11/3`，并不等于 `27/7`。分块 Softmax 各自在不同 Key 集合归一化，只有把分母权重和指数基准带回来才能合并。分布式 [Context Parallel](../../ai-systems/training/megatron-core/02-PP-Microbatch-1F1B-CP-EP-MoE与Distributed-Optimizer.md#22-局部-softmax-为什么不能直接平均)使用同一原理，但还要解决跨 Rank 的 KV 与梯度传输。

### 4.4 逻辑流量账：消掉中间矩阵，不等于只读一次 KV

设 s=4096、d=64，Z/P 都按 BF16 物化。取理想三阶段基线 `QKᵀ → Softmax → PV`：Z 写读各一次，P 写读各一次，仅两个中间矩阵就需要：

```text
4 × s² × 2 bytes = 128 MiB
```

再理想地各读一次 Q/K/V、写一次 O，另需 2 MiB；基线合计约 130 MiB，未计额外 Softmax Pass、统计量和重复输入请求。若 Z/P 用 FP32，中间项翻倍。这里计算的是逻辑读写量，不是宣称这些请求都实际穿过 HBM。

再构造一个 Query-outer 的分块前向：每个 Program 保留 Br 行 Q 和输出状态，循环扫完整 K/V。取 Br=64，一共有 64 个 Query Tile；假设各 Tile 请求的 K/V 没有由缓存复用：

```text
K/V 请求 = 2 × 64 × s × d × 2 bytes = 64 MiB
Q 读一次、O 写一次 = 1 MiB
合计约 65 MiB，另加行统计量
```

Z/P 的全矩阵消失了，K/V 却被不同 Query Tile 多次请求。若 Br=128，同一模型请求量降到约 33 MiB；若重复请求命中 L2，实际 HBM 流量会更低。此例固定遍历顺序，不等同于原论文所有版本的实际实现。

但 Br 翻倍也增加片上活跃状态。假设 Bc=64、输入 BF16、分数和输出累加 FP32，并暂存整个分数 Tile，Br=64 时 Q、K/V、分数、累加器约占 8+16+16+16=56 KiB；Br=128 时约占 16+16+32+32=96 KiB，还未计统计量、流水、地址和编译器暂存。它们分别落在寄存器/Shared 等资源中，不是一个可随意混用的容量池。真实实现可复用部分存储，但必须以活跃区间为依据，不能假设所有状态免费驻留。

### 4.5 IO 复杂度的适用条件

原论文用 C 表示片上快存储可容纳的标量数，在 `d ≤ C ≤ sd` 的两层存储模型中，取 Key Tile 宽度为 `Θ(C/d)`。其 Key-outer 算法需要约 `Θ(sd/C)` 轮，每轮访问约 Θ(sd) 个 Query/输出状态元素，因此总访问为 `Θ(s²d²/C)`；标准物化路径为 `Θ(sd+s²)`。[FlashAttention 原论文定理 2 与附录 C](https://arxiv.org/pdf/2205.14135)给出这一模型的推导。

注意 C 的单位不是“字节”，不能把 64 KiB 直接代入标量数；混合精度还需分别换算。固定 d、固定硬件容量 C 时，该访问式仍随 s 平方增长，不能写成“FlashAttention 总 HBM 流量线性”。线性的是不保存完整注意力矩阵的额外驻留空间量级，不是普通密集 Attention 的全部运算量或全部请求流量。

### 4.6 后向为什么可以重算 P {/* #attention-backward */}

令 G 为上游输出梯度，且仍假设无 Dropout。逐行 Softmax 的导数为 `∂p_j/∂z_k=p_j(δ_jk-p_k)`，链式法则得到：

```text
dV = PᵀG
dP = GVᵀ
D_i = sum_j P_ij × dP_ij
dZ_ij = P_ij × (dP_ij-D_i)
dQ = dZ K / √d
dK = dZᵀ Q / √d
```

关键是 D 无需再读一行 P：

```text
D_i = sum_j P_ij × dot(G_i,V_j)
    = dot(G_i, sum_j P_ij V_j)
    = dot(G_i,O_i)
```

前向保存行统计量 `LSE_i=m_i+ln(l_i)`，后向逐 Tile 重算 `Z_ij`，再由 `P_ij=exp(Z_ij-LSE_i)` 恢复概率，便可计算局部梯度贡献，不必把完整 P 存在 HBM。dK/dV 要合并来自多个 Query Tile 的贡献，调度、归约及是否使用 Atomic 另有性能和确定性约束。[Triton Fused Attention](https://triton-lang.org/main/getting-started/tutorials/06-fused-attention.html)中的后向预处理与分块梯度可对应到这些式子；其代码使用的 exp2/log2 缩放要换算，不能和这里的自然指数直接混用。

手算一行：`P=[1/4,3/4]`、`V=[10,20]`、`G=1`，则 O=17.5、D=17.5、`dZ=[-1.875,1.875]`、`dV=[1/4,3/4]`。dZ 的行和为零，符合“所有得分同加常数，Softmax 不变”的性质。若漏减 D，行和就不是零。

Causal/任意 Mask 必须在前后向使用同一合法 Key 集合；Dropout 还要复现相应掩码/RNG 语义，上述无 Dropout 公式不能未经扩展直接套用。重算增加计算却节省全矩阵保存/读回，是否更快取决于片上调度和内存层，而非“重算一定更慢”。

### 4.7 FlashAttention-2：把相同算法分给更多独立工作者

Online Softmax 可以保存未归一化 u，最后才除 l，避免每块都把整个输出向量归一化。FA2 同时减少非矩阵乘操作，并在 Batch/Head 之外按 Query 行块增加 CTA 并行度。若 B=1、H=8、s=4096、Br=128，只有每头一个 CTA 时是 8 个任务；按 Query tile 切开可以形成 `1·8·32=256` 个任务。更多任务增加填满 SM 的机会，不代表每个任务都没有额外 KV 请求。[FlashAttention-2 原论文](https://arxiv.org/abs/2307.08691)

Warp 内划分也要看结果的所有权。若多个 warp 切同一 Query 的 K/V 范围，最后必须合并它们的输出状态；若各 warp 持有不同 Query 行并共享所需 K/V，则各自输出独立，能减少这类跨 warp 归约。代价是 Q、分数和输出寄存器分配改变，不能只把 warp 数变大就获得同样效果。FA2 的 sliced-Q 思路与 Split-K 的“切归约维增加任务”应明确区分。

### 4.8 FlashAttention-3：异步硬件需要显式生命周期

在 Hopper 路径中，FA3 利用 TMA 搬运和异步 WGMMA，将 producer 与 consumer 的工作分给不同 warp/warpgroup，并把下一块矩阵乘与当前块 Softmax 等操作重叠。WGMMA 完成之前，累加器不能当成已经就绪的分数；P 完成之前，PV 不能使用它。异步意味着允许重叠独立阶段，不意味着删除数据依赖。[FlashAttention-3 原论文](https://arxiv.org/abs/2407.08608)

把每个 K/V 缓冲 slot 的生命周期抽象为：

```text
EMPTY(g) → FILLING(g) → READY(g) → READING(g) → EMPTY(g+1)
             TMA完成       消费者完成所有相关MMA/读取
```

这里 g 是复用代次。Producer 等待旧消费者释放 slot 后再发起新搬运，consumer 等待对应代次的数据就绪，完成所有异步读取后才通知可复用。若只判断“barrier 曾完成过”，而不区分代次，下一圈可能误读旧完成信号；若发出 MMA 就立刻释放 K/V，下一次 TMA 可能覆盖尚在使用的操作数。实际 barrier 的 phase、预期字节数和参与者数量必须与指令协议一致。

两级缓冲允许装载块 j+1 时处理 j；更深流水还可在 Softmax(j) 时执行 QK(j+1)。在线输出 u 的缩放和加法仍需遵守块间递推，不能在旧 u 尚未 rescale 时乱序累加新 PV。增加 slot 会占用更多 shared/register，可能减少驻留。FP8 路径还引入分块量化和误差控制，改变有限精度行为，应独立验证，不能只当作相同数学的无成本换 dtype。

### 4.9 Dropout 后向：随机 mask 也属于前向状态

设 P 是归一化后的概率，dropout 概率 p，R 为 Bernoulli mask 除以 `1-p`，输出 `O=(P⊙R)V`。从同一链式法则得到：

```text
dV = (P⊙R)ᵀG
dP = (GVᵀ)⊙R
D_i = sum_j P_ij·dP_ij = dot(G_i,O_i)
dZ = P⊙(dP-D)
dQ = dZ K/√d，dK = dZᵀQ/√d
```

归一化用的是 dropout 前的 P，不能对保留下来的 Key 再做一次 Softmax。后向必须重现前向同一个 R，可保存 mask 或保存能重建它的 RNG 状态。Counter-based 方案要定义 `(batch,head,query,key)` 到随机计数的映射；若计数仅依赖 tile 遍历顺序，改 tile 或并行划分可能改变 mask。保证某个实现重算一致与跨配置 bitwise 一致是不同要求。

### 4.10 GQA 的共享 KV 梯度必须求和

设 Hq 是 Query 头数，Hkv 是 KV 头数，分组大小 r=Hq/Hkv，Query 头 h 使用 KV 头 `g(h)=floor(h/r)`。前向每个 Query 头有独立 Softmax，但共享 K/V 参数输入，因此：

```text
dK_g = sum_(h: g(h)=g) dZ_hᵀQ_h/√d
dV_g = sum_(h: g(h)=g) (P_h⊙R_h)ᵀG_h
```

两个共享头贡献 1、3 时，应得到 4，不是平均值 2，也不是最后一次写入的 3。每个 dQ 只归属自己的 Query 头；dK/dV 则要跨 Query 行 tile 与共享头聚合。可以分配唯一 writer 做完整归约、写 workspace 再固定树归约，或使用 atomic；最后一种影响浮点到达顺序。详细成本和误差界见[并行归约](./08-并行归约-SplitK与确定性Router-GEMM.md)。

## 5. 融合算子

融合可以减少 Launch 和中间 Tensor HBM 往返，例如 Bias+Activation、RMSNorm、RoPE。边界包括：

- Kernel 太大导致寄存器压力；
- 动态 Shape 产生多个变体；
- 调试和数值验证更复杂；
- 特殊输入回退到非融合路径；
- 编译时间和 Cache 增长。

## 6. 推理与训练差异

Prefill 的大矩阵更接近 Compute Bound；Decode 的小 Batch GEMM/GEMV 更容易受内存和 Launch 限制。训练 Forward/Backward 还包含梯度和更多激活。不能用 Prefill Benchmark 代表 Decode，也不能用 Forward 代表完整训练 Step。

## 7. 验证

比较相同 Shape、Dtype、Layout、Warmup 和同步方式；同时报告数值误差、Kernel 时间、端到端时间、HBM、功耗和编译成本。确认调用的实际 Kernel 名称和 Backend。

### 7.1 理论掌握检查与适用边界

不看公式，应能完成四件事：算出 GEMM Tile 的复用与累加器容量；用新最大值正确缩放旧 Softmax 状态；分别计算中间矩阵容量和分块请求字节；从 Softmax 导数推出 dQ/dK/dV 并解释 LSE 的用途。

还应解释 FA2 的 Query ownership、FA3 缓冲代次与异步完成条件，并推导 Dropout/GQA 的梯度归属。本文补齐算法与调度依赖模型，但不是每条架构指令的完整实现手册；具体 barrier 编码、寄存器布局和最优 Tile 仍要对照目标实现与设备验证，不能由一个资源模型推断所有架构的最优配置。

参考：[NVIDIA CUTLASS](https://docs.nvidia.com/cutlass/)、[FlashAttention](https://github.com/Dao-AILab/flash-attention)。
