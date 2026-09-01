---
title: "并行归约、Split-K 与确定性 Router GEMM"
sidebar_label: "08. 确定性 Router GEMM"
sidebar_position: 8
description: "从浮点加法顺序、原子操作和 Split-K 解释 MoE Router/GEMM 的非确定性，并建立正确性、性能和端到端归因方法。"
tags: [MoE, Router, GEMM, Split-K, Determinism, Persistent Kernel]
---

# 并行归约、Split-K 与确定性 Router GEMM

“同一输入、同一权重、同一随机种子，结果为什么仍有差异？”这类问题不能只归因于随机数。并行归约顺序、原子操作、通信到达顺序、Top-k 并列值和不同 Kernel 配置都可能改变最后几位，并进一步改变 MoE 路由。

```text
Router Logits
→ Top-k Expert选择
→ Token按Expert重排
→ Expert GEMM或Grouped GEMM
→ 聚合Top-k Expert输出
→ 恢复Token顺序
```

确定性优化必须先说明要固定哪一段，而不是笼统地说“让模型可复现”。

## 1. 先定义三种“相同”

| 目标 | 含义 | 典型验证 |
| --- | --- | --- |
| Bitwise Determinism | 每个输出 bit 完全相同 | 哈希或逐元素相等 |
| Numerical Reproducibility | 差异在指定绝对/相对误差内 | `atol/rtol`、ULP、误差分位数 |
| Semantic/Route Stability | Token 路由或最终任务结果稳定 | Top-k 一致率、任务指标、KL |

Bitwise 相同最严格，也往往代价最高。上线前要由业务和验证目标决定需要哪一级，不能用宽松 `allclose` 声称“完全确定”，也不能因最后一位变化就认定业务错误。

## 2. 浮点加法为什么与顺序有关

实数加法满足结合律，有限精度浮点通常不满足：

```text
(a + b) + c  !=  a + (b + c)
```

大数和小数相加时会发生舍入。并行归约把部分和分配给不同 Warp、Block 或 Rank；只要合并树不同，最后几位就可能不同。

对普通 Dense 层，这种微小差异可能只体现在 Logits 尾数；对 MoE Router，如果两个 Expert 分数非常接近，尾数变化就可能改变 Top-k 排名，继而让 Token 进入完全不同的 Expert 路径。

## 3. Split-K 为什么可能不确定

GEMM `C[M,N] = A[M,K] × B[K,N]` 的每个输出元素都要沿 `K` 维归约。Split-K 把 `K` 分成多个片段并行计算：

```text
K0 → Partial C0
K1 → Partial C1
K2 → Partial C2
K3 → Partial C3
       ↓ reduce
       C
```

它能增加小 `M/N` Shape 的并行度，但需要合并 Partial C。常见合并方式：

- 原子加到同一输出；
- 写入 Workspace 后由第二个 Kernel 归约；
- 固定树形归约；
- Cooperative/Cluster 方式协作。

若使用原子加，Block 完成顺序可能随调度变化，累加顺序不固定；若使用 Workspace 但第二阶段按固定索引顺序归约，则更容易实现可复现，但增加一次写入、读取和 Launch。

因此“关闭 Split-K”可能恢复确定性，却不是唯一方案；真正边界是是否有固定的部分和生成与归约顺序。

## 4. 原子操作、Scatter 与 Expert 聚合

MoE 中还存在两类常见归约：

1. 多个 Token 按 Expert Scatter/计数，构建 Offset；
2. Top-k Expert 输出按 Router Weight 聚合回 Token。

如果多个线程使用 Atomic 为同一 Expert 计数，Token 在 Expert Buffer 中的物理顺序可能变化。数学上只要能通过反向索引恢复，输出可以等价；但下游 Grouped GEMM 的 Tile 分配、归约顺序或调试结果可能变化。

如果多个 Expert 输出原子累加到同一 Token，则累加到达顺序也可能变化。确定性实现常采用稳定排序、前缀和、固定 Offset 和固定顺序合并，但会增加排序、Workspace 或同步成本。

## 5. Top-k 自身也有边界

需要确认：

- 分数相同或极接近时如何 Tie-break；
- Top-k 返回是否保证稳定顺序；
- Softmax 在 Top-k 前还是后；
- Router Dtype 和累加精度；
- 是否加入噪声或负载均衡扰动；
- Capacity 溢出时 Token 如何丢弃或重路由。

即使 GEMM 完全确定，未定义 Tie-break 的 Top-k 也可能让路由不稳定。可复现协议应规定并验证并列值处理，例如按 Expert ID 二级排序，而不是只固定随机种子。

## 6. Persistent Kernel 是什么

普通 Kernel 通常把大量 Tile 作为 Block 调度；Persistent Kernel 倾向于启动与设备并行资源数量相关的一组常驻工作 Block，再从任务队列循环领取 Tile。

优势：

- 减少重复 Launch 或调度开销；
- 可复用权重、元数据或片上状态；
- 对大量相似小任务可能更高效。

风险：

- 固定 Block 数对小 `M` 可能远大于实际工作量；
- 很多常驻 Block 只处理少量任务，Occupancy 看似高但有效计算低；
- 寄存器和 Shared Memory 占用限制并发；
- 不同 Expert Token 数极不均衡，静态任务分配造成长尾；
- 固定配置只适合少数 Shape。

“Persistent”不是天然更快。它把 Launch 成本换成了常驻资源和任务分配复杂度。

## 7. 为什么固定配置在小 M 下浪费资源

Router/Expert GEMM 的 `M` 常等于某个 Expert 收到的 Token 数，可能从 0 到数百剧烈变化。

假设固定为大 Shape 选择：

```text
128个Persistent CTA
每个CTA处理若干Tile
```

当某 Expert 只有几个 Token 时：

- 可用 Tile 很少；
- 大量 CTA 取不到任务或只完成很小工作；
- 初始化、Barrier 和队列管理成本保持不变；
- 资源被占住，其他 Kernel 更难并发。

所以动态策略应按 `M/N/K`、Expert 数、Top-k、Dtype、GPU 架构和当前路由分布选配置。

## 8. 动态配置与回退路径

可维护的实现通常不是一个“万能 Kernel”，而是一个决策表：

| Shape/条件 | 候选路径 |
| --- | --- |
| 极小 M | GEMV/小 Tile 专用 Kernel，避免过多 CTA |
| 中等 M | Persistent 或 Grouped GEMM |
| 大 M | 常规高吞吐 GEMM |
| 需要 Bitwise | 固定归约树或 Workspace 两阶段归约 |
| Workspace 不足 | 无 Split-K 或确定性较低的显式回退 |
| 对齐/架构不支持 | 受控的通用实现 |

选择逻辑必须可观测：日志或指标记录实际 Kernel、Tile、Split-K、Workspace 和回退原因。否则端到端回归时无法知道执行路径是否变化。

## 9. 一套确定性验证矩阵

### 9.1 单算子

- 固定输入和权重，重复运行至少数十次；
- 覆盖极小/中等/大 `M`；
- 覆盖均衡和倾斜 Expert 分布；
- 比较 Bitwise、最大误差、P99 误差和 NaN/Inf；
- 记录 Kernel 配置和硬件架构。

### 9.2 算子链

```text
Router → Top-k → Dispatch → Expert GEMM → Combine
```

记录每层：Router Logits、Top-k IDs/Weights、Expert Token Count、Dispatch Offset、输出误差。这样才能判断差异最早出现在哪里。

### 9.3 端到端

- 固定 Tokenizer、Prompt、Sampling 与 Seed；
- Greedy 与 Sampling 分开；
- 比较 Route Agreement、Logits KL、生成 Token 和任务指标；
- 多卡时覆盖不同 Rank 启动顺序和负载；
- 重新启动进程后重复验证。

只在同一进程中连续调用两次，无法覆盖 Autotune Cache、进程布局和通信初始化差异。

## 10. 性能验证不要和正确性混在一起

| 层级 | 指标 |
| --- | --- |
| 单 Kernel | 时间、GB/s、TFLOPS、Occupancy、寄存器、Workspace |
| 算子链 | Router+Dispatch+GEMM+Combine 总时间、同步与中间流量 |
| 模型 | 每层时间、Decode Step、Prefill、通信等待 |
| 服务 | TTFT、TPOT、吞吐、P99、最大安全并发 |

确定性 Kernel 慢 8% 不等于端到端慢 8%；如果该 Kernel 只占 Step 的 10%，理论影响可能不到 1%。反过来，单 Kernel 提速也可能被同步、All-to-All 或调度完全抵消。

## 11. 如何正确描述“收益归因”

如果同时上线了动态 Kernel、通信融合和 Batch 调整，端到端收益不能全部归于个人编写的 GEMM。应拆成：

```text
基线
→ 仅替换确定性GEMM
→ 再启用动态配置
→ 再启用通信/算子融合
→ 最终端到端系统
```

每一步都保留相同工作负载和置信区间，并报告：

- 当前改动直接改变的单算子指标；
- 对算子链的净影响；
- 对端到端 SLO 的可测影响；
- 无法由当前实验支持的结论。

## 12. 故障定位顺序

当“关闭某优化后结果稳定”时，不应立即认定优化名称就是根因：

1. 确认关闭开关实际改变了哪些 Kernel、Shape 和通信路径；
2. 用最小输入复现第一个产生差异的中间 Tensor；
3. 分别固定 Top-k、Dispatch 和 GEMM，做二分隔离；
4. 切换 Split-K/Atomic/Workspace 路径；
5. 固定 Kernel 配置，排除 Autotune 变化；
6. 多 Rank 比较 Collective 序号和输入；
7. 用单变量修复重新做正确性与性能回归。

## 13. 自测题与答案

### 13.1 Split-K 为什么可能导致同一输入得到不同尾数？

不同 K 分片生成 Partial C 后需要合并。如果使用 Atomic 或完成顺序不固定的归约，浮点加法顺序会变化；浮点加法不满足严格结合律，因此最后几位可能不同。

### 13.2 关闭 Split-K 是否一定能实现完整确定性？

不一定。Top-k Tie-break、Atomic Dispatch/Combine、通信归约、随机采样和其他 Kernel 仍可能不确定。它只能消除一个候选来源。

### 13.3 为什么 Persistent Kernel 在小 M 下可能变慢？

为大任务准备的常驻 CTA、队列和同步开销在小 M 时不会同比缩小，大量 CTA 无有效 Tile 可做，还可能占用寄存器和 Shared Memory，阻碍其他工作。

### 13.4 如何证明确定性 GEMM 改动提升了端到端性能？

先做仅替换 GEMM 的 A/B，固定其他配置；报告单 Kernel、Router 算子链和端到端三个层级，并用时间占比和多次测量说明收益。若多个优化同时变化，只能报告组合收益，不能全部归因于 GEMM。

## 14. 参考资料

- [PyTorch Reproducibility](https://docs.pytorch.org/docs/stable/notes/randomness.html)
- [NVIDIA cuBLAS Results Reproducibility](https://docs.nvidia.com/cuda/cublas/index.html#results-reproducibility)
- [NVIDIA CUTLASS GEMM API](https://docs.nvidia.com/cutlass/latest/media/docs/cpp/gemm_api.html)
- [Megatron Core MoE](https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/moe.html)
