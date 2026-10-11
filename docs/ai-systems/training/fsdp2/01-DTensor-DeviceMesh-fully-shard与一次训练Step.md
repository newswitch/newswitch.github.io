---
title: "FSDP2 DTensor、DeviceMesh、fullyshard 与一次训练 Step"
sidebar_label: "01. FSDP2 架构与训练路径"
sidebar_position: 1
description: "从数据并行等价性推导 DeviceMesh、DTensor 分片、参数生命周期、梯度归约与累积的正确性。"
tags: [FSDP2, DTensor, DeviceMesh, AllGather, ReduceScatter]
---

# FSDP2 DTensor、DeviceMesh、fullyshard 与一次训练 Step

FSDP2 切分的是模型状态的长期存储，不是把一个线性层的矩阵乘法拆给多个 Rank。理解它要同时回答两个问题：某个参数由谁保存和更新，以及计算这一层时谁持有完整参数。

下面以同步数据并行、普通 Adam、无 CPU Offload 为基线。API 行为采用 [PyTorch 2.8 的 FSDP2 定义](https://docs.pytorch.org/docs/2.8/distributed.fsdp.fully_shard.html)；特殊算子、共享参数和组合并行需要另外检查约束。

## 1. 分片为什么不改变数据并行的目标

设有 N 个 Rank，每个 Rank 用同一版本的参数 θ 处理自己的样本，得到局部平均损失 L_r。若各 Rank 有相同数量、相同权重的有效样本，全局目标及梯度为：

```text
L(θ) = (L_0(θ) + ... + L_(N-1)(θ)) / N
g    = (g_0 + ... + g_(N-1)) / N
θ'   = Optimizer(θ, g, optimizer_state)
```

DDP 在每个 Rank 保存完整 θ 和完整优化器状态；FSDP 把它们划分成互不重叠的所有权区间。各 Rank 计算局部损失前临时取回完整参数，之后只接收自己负责区间的全局梯度。因此，拼接各 Rank 更新后的参数分片，仍得到同一个逻辑 θ'。

成立条件包括：参数版本一致、梯度归约和损失缩放正确、更新规则一致。浮点加法顺序不同可能造成数值差异，数学等价不意味着逐位相同。若每个 Rank 的有效 Token 数不同，简单平均局部平均损失会给小样本 Rank 过大权重，应按有效 Token 数归一化。

这也说明 FSDP 与 TP 的根本差异：FSDP Rank 处理不同样本，计算当前单元时取回该单元完整权重；[TP Rank 协同完成同一样本的部分矩阵乘法](../megatron-core/01-Process-Group-TP-Sequence-Parallel与一次Transformer层.md)。两者都“切权重”，但切的是不同阶段的职责。

## 2. DeviceMesh 的坐标与通信组 {/* #1-devicemesh */}

Rank 是一个通信参与者；DeviceMesh 把 Rank 编号放进逻辑坐标系。考虑两个节点、每个节点四张卡，明确采用下面的教学布局：

```text
mesh[replicate, shard] =
[[0, 1, 2, 3],
 [4, 5, 6, 7]]

shard 组：    {0,1,2,3} 和 {4,5,6,7}
replicate 组：{0,4}、{1,5}、{2,6}、{3,7}
```

沿 shard 维变化、固定 replicate 坐标，得到参数 AllGather 和梯度 ReduceScatter 的组。沿 replicate 维变化、固定 shard 坐标，得到保存同一参数区间的副本组。

例如 Rank 1 与 Rank 5 持有同一区间的参数，但处理不同数据。HSDP 先在每一行归约并切分梯度，再在对应列之间同步梯度分片，才能让两份参数副本保持一致。

Mesh 是逻辑拓扑，不会自动创造 NVLink，也不会把错误的 Rank 映射搬到正确网卡。只有当同一行实际位于高速互联域时，这个布局才实现“节点内分片、节点间复制”。名称相同、Rank 矩阵不同，通信经过的链路也可能不同。

## 3. DTensor 的全局形状与局部分片 {/* #2-dtensor */}

DTensor 表示一个逻辑上的全局 Tensor，包括全局形状、Mesh、Placement 和本地 Tensor。`Shard(0)` 中的 0 是 Tensor 的轴，不是 Mesh 的轴；Placement 列表的位置才对应 Mesh 维度。[DTensor 的 Placement 定义](https://docs.pytorch.org/docs/2.8/distributed.tensor.html)区分分片、复制和待归约的部分结果。

设参数 W 的全局形状是 `[8, 4]`，在四个 Rank 上均匀按第 0 轴切分：

| Rank | 本地形状 | 对应全局范围 |
| --- | --- | --- |
| 0 | `[2, 4]` | `W[0:2, :]` |
| 1 | `[2, 4]` | `W[2:4, :]` |
| 2 | `[2, 4]` | `W[4:6, :]` |
| 3 | `[2, 4]` | `W[6:8, :]` |

全局仍是一个 `[8, 4]` 参数，不是四个独立的小模型。在上述二维 HSDP Mesh 中，Placement 为 `(Replicate(), Shard(0))`：第一维复制这些分片，第二维切参数的第 0 轴。

`Replicate()` 表示各 Rank 已经持有同一个逻辑值；`Partial()` 则表示各 Rank 的局部值还要归约才能得到逻辑结果，二者不能互换。例如四个 Rank 各算一份局部梯度时，尚未求和的四份梯度不是四个全局梯度副本。

这里假设切分轴可整除。非均匀切分、填充和自定义切分轴会影响局部尺寸与临时 Buffer，不能在容量规划时一律当作恰好除以 Rank 数。

## 4. fully_shard 建立的是通信与生命周期单元 {/* #3-应用顺序 */}

FSDP2 对每个参数分别表达分片，但把一组参数打包通信，避免每个小 Tensor 都启动一次 Collective。自底向上调用时，子模块已经管理的参数不再归入父模块的新组：

```python
from torch.distributed.fsdp import fully_shard

for block in model.layers:
    fully_shard(block)
fully_shard(model)
```

这个例子表达所有权结构，不是完整启动脚本。每个 Block 有自己的参数通信单元；Root 管理尚未被子单元接管的参数，例如未单独分组的 Embedding 或输出层。Root 调用不会再把所有子层参数重复打包。这里的“参数分组”不是为每个 Block 新建不同的 Rank Process Group，它们通常复用同一个 Mesh 的通信组。

粒度决定三个边界：何时取回完整参数、何时可以释放它们、哪些参数一起通信。只给整个模型建立一个大组时，虽然空闲时仍是分片，计算前却要物化整个模型，可能在第一次 Forward 就 OOM。

共享权重需要所有引用遵守同一生命周期。若两个模块复用同一个参数，却在不同时间假定它已被释放或物化，不能把“按 Module 切”直接理解为“参数所有权天然互不重叠”。

## 5. Forward 的参数状态转换 {/* #4-forward */}

以 `reshard_after_forward=True` 的普通 Block 为例：

| 阶段 | 参数状态 | 当前 Rank 在做什么 |
| --- | --- | --- |
| 计算前 | 本地 DTensor 分片 | 保存自己负责的参数区间 |
| AllGather 后 | 临时完整参数 | 拼接其他 Rank 的区间；按计算 dtype 物化 |
| Forward | 完整参数仍在 | 用自己的样本计算输出，保存必要激活 |
| Forward 后 | 回到分片 | 释放完整参数，激活可能仍保留到 Backward |

参数释放与激活释放是两回事。权重恢复分片后，Autograd 仍可能保存输入、非线性结果等激活；FSDP 不会自动把这些激活也按 DP Rank 切分。

Prefetch 的含义是提前物化后续单元。例如计算 Block 0 时取回 Block 1，而不是等 Block 0 计算结束才开始取回。它能隐藏等待，却会让两个完整单元同时驻留。[FSDP2 教程](https://docs.pytorch.org/tutorials/intermediate/FSDP_tutorial.html)展示了分组与预取的配合。

`reshard_after_forward=False` 保留完整参数，省掉 Backward 前的再次 AllGather。PyTorch 2.8 在该参数为 `None` 时，对非 Root 单元采用 True、Root 采用 False；因此“每层每步一定两次 AllGather”只适用于明确重分片的基线，不是所有默认行为。

## 6. Backward 为什么需要 ReduceScatter {/* #5-backward */}

### 6.1 完整参数与局部梯度

线性层 `Y = XW` 的反向有两类计算：

```text
dW = X^T dY      权重梯度，wgrad
dX = dY W^T      输入梯度，dgrad
```

即使 Forward 已释放完整 W，计算 dX 时通常仍需要它，所以 Backward 前要重新 AllGather。特殊层不一定需要全部权重，但不能把这种例外当作通用规则。

每个 DP Rank 用自己的 X 算出一份完整形状的局部 dW。ReduceScatter 一次完成两件事：在 Rank 间归约相同位置的梯度，再把归约结果按参数所有权切给各 Rank。

### 6.2 四个 Rank 的纸面归约

把一个八元素参数切成四份，每份两个元素。以下是四个 Rank 的局部梯度，省略 Tensor 包装：

```text
g0 = [1,1 | 1,1 | 1,1 | 1,1]
g1 = [2,2 | 2,2 | 2,2 | 2,2]
g2 = [3,3 | 3,3 | 3,3 | 3,3]
g3 = [4,4 | 4,4 | 4,4 | 4,4]

SUM ReduceScatter：
Rank0 得 [10,10]，Rank1 得 [10,10]
Rank2 得 [10,10]，Rank3 得 [10,10]

若目标是四份等权损失的平均，每份应再归一化为 [2.5,2.5]。
```

这里先展示 SUM 的数学语义，不表示要在 FSDP 外额外除以四。框架可在归约前后应用缩放；损失归一化与框架梯度归一化必须合在一起检查，重复除法同样会把训练改错。

ReduceScatter 不同于 Scatter。仅把 Rank 0 的梯度切开，会丢掉其他 Rank 的样本贡献；只 Reduce 到 Rank 0，则会集中存储和更新完整优化器状态。

### 6.3 本地 Adam 更新为什么成立

Adam 的逐元素更新只依赖该元素的梯度和历史一、二阶矩：

```text
m_j' = β1 m_j + (1-β1) g_j
v_j' = β2 v_j + (1-β2) g_j²
m_hat_j = m_j' / (1-β1^t)
v_hat_j = v_j' / (1-β2^t)
θ_j' = θ_j - η × m_hat_j / (sqrt(v_hat_j) + ε)
```

其中 t 是所有 Rank 一致的更新次数，η 是学习率，ε 防止分母为零，两个 hat 项修正初始状态为零带来的偏差。若只恢复权重而丢失 m、v 或更新次数，下一步也不会是原训练轨迹的延续。

因此 Rank 负责 θ 的某一区间时，也能负责该区间的 m、v。下一次 AllGather 拼接更新后的区间，所有 Rank 就能使用新的完整权重。

但全局梯度裁剪需要先合成全局范数。若各 Rank 保存互不重复的全局梯度区间，先求本地平方和，再求全局和，最后使用同一个裁剪系数：

```text
s_r = sum_(j owned by r) g_j²
norm = sqrt(sum_r s_r)
scale = min(1, threshold / (norm + ε))
```

HSDP 中复制区间不能重复计入范数。各 Rank 按自己的分片范数分别裁剪，会让不同区间使用不同缩放系数，改变梯度方向。具有跨参数统计量的优化器也需要相应的额外同步，不能机械套用“所有更新都完全本地”。

## 7. 梯度累积改变的是同步时机

设每个 Rank 连续处理 K 个等大小 Microbatch，最后只更新一次。全局平均梯度为：

```text
g = sum_r sum_k g_(r,k) / (N × K)
```

一种方式是每个 Microbatch 都归约，再累加本地分片；另一种方式是先保存未同步梯度，最后统一归约。后者减少同步次数，但未同步梯度可能是完整形状，并以累积 dtype 驻留，显存不再服从简单的“梯度除以 N”。

对 HSDP，还可以先在 shard 组做 ReduceScatter、延迟 replicate 组的 AllReduce。理解累积时必须分别问：参数是否重分片、梯度是否归约、归约覆盖哪个组、何时做 Optimizer Step。关闭梯度同步不等于关闭参数 AllGather。

## 8. 初始化峰值与训练峰值是不同问题 {/* #6-初始化 */}

即使分片后的模型状态能够装下，若初始化先在每张 GPU 上创建完整模型，仍可能在训练开始前 OOM。Meta Tensor 只描述形状和类型，不分配参数数据；后续要把本地分片真正分配并初始化，或从分片 Checkpoint 填入。

Meta 初始化本身不是有效权重，也不会自动保证各 Rank 一致。需要区分“分配存储”“赋予初始数值”和“恢复训练状态”。先创建 Optimizer 再改变参数表示，还可能让 Optimizer 持有错误引用，应在分片参数建立后绑定它。

## 9. 从生命周期解释观察结果 {/* #7-观察方法 */}

把 Timeline 与本章的状态表对齐：AllGather 前等待表示参数尚未可用；计算期间出现下一组 AllGather 是预取；Backward 后出现 ReduceScatter 是梯度所有权收敛。显存峰值应能解释为某几个完整单元、激活和通信 Buffer 同时存活。

GPU 利用率高不能证明通信被隐藏。计算和通信可能同时占用 GPU，却互相争用带宽；需要看关键路径是否缩短，而不仅是两个 Kernel 是否重叠。

## 10. 纸面自检

1. 四个 Rank 分片 W，但每个 Rank 在 Forward 都算完整 W 的 GEMM，这是 TP 吗？不是，这是以临时物化换长期状态分片的 FSDP。
2. Forward 后权重已重分片，为什么显存还高？激活、下一组预取参数、未完成归约的梯度或 Buffer 仍可能存活。
3. HSDP 的两个副本组分别算出了不同梯度，能只做行内 ReduceScatter 吗？不能，同一区间的副本还要同步，否则参数副本会逐步分叉。
4. 把数据并行平均梯度切成分片后，还能逐元素做 Adam 吗？能；但全局范数裁剪等跨分片统计量仍需同步。

下一章把这里的状态转换量化成[显存、通信量和重叠边界](./02-分片策略-Wrap-混合精度-Activation-Checkpoint与Offload.md)。
