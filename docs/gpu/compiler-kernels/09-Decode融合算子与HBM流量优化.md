---
title: "Decode 融合算子与 HBM 流量优化"
sidebar_label: "09. Decode 融合与 HBM 流量"
sidebar_position: 9
description: "从单 Token Decode 的小矩阵、Kernel Launch 和 HBM 往返解释融合算子的收益、边界与性能分析方法。"
tags: [LLM Decode, Kernel Fusion, HBM, GEMV, Attention]
---

# Decode 融合算子与 HBM 流量优化

Prefill 一次处理很多 Prompt Token，矩阵较大；Decode 每轮通常只为每条活动序列生成一个新 Token。二者执行同一模型，却有不同的 Shape 和瓶颈。

```text
Decode Step
→ 读取当前Hidden State
→ Norm / QKV / RoPE
→ 读取历史KV并执行Attention
→ O Projection / Residual
→ MLP或MoE
→ LM Head / Sampling
→ 下一Token
```

Decode 优化不能只问“FLOPS 提高了多少”，还要问一次 Token 在 HBM 和 Kernel 边界之间往返了多少次。

## 1. Decode 为什么容易受内存和 Launch 限制

线性层 `X[M,K] × W[K,N]` 中，Decode 的 `M` 接近活动序列数。`M` 较小时：

- 同一批权重的计算复用低；
- 每轮都要读取大量权重；
- 小 Kernel 数量多，CPU Launch 占比上升；
- 中间 Tensor 很小，但反复写回/读回 HBM；
- Attention 还要读取不断增长的 KV Cache。

GPU Util 高低都不能直接回答这些问题。要看 Kernel 时间线、HBM 带宽、Tensor Core 使用率、Launch 间隙和实际 Shape。

## 2. 融合的本质

假设原始路径：

```text
Kernel A读取X → 写Y到HBM
Kernel B读取Y → 写Z到HBM
Kernel C读取Z → 写O到HBM
```

融合后：

```text
一个Kernel读取X
→ Y/Z保留在寄存器或Shared Memory
→ 直接写最终O
```

可能减少：

- 两次或更多 Kernel Launch；
- 中间 Tensor 的 HBM 写入和读取；
- Stream/Event 调度与框架开销；
- 临时显存分配。

融合通常不减少模型定义中的核心数学量，而是改变数据驻留位置和执行边界。

## 3. Decode 中常见的融合边界

### 3.1 Norm 与线性层周边

- RMSNorm + Residual；
- Bias + Activation；
- GEMM Epilogue 中的 Bias、Gate 或量化；
- 输入量化 + 低比特 GEMM；
- GEMM 输出的反量化/再量化。

### 3.2 Attention 周边

- QKV Projection 的布局变换；
- RoPE 与 KV Cache 写入；
- KV 读取、Score、Online Softmax 与 Value 聚合；
- GQA 的 KV Head 映射；
- Attention 输出布局与 O Projection 前处理。

### 3.3 MLP/MoE 周边

- Gate 与 Up Projection；
- SiLU/GELU 与逐元素乘；
- Router Softmax/Top-k 的部分预处理；
- Expert Dispatch、Grouped GEMM 和 Combine 的相邻阶段。

### 3.4 Sampling 周边

- Logits 后处理；
- Temperature、Top-k/Top-p；
- 概率归一化与抽样。

并非越多越好。跨越动态调度、通信或大规模全局同步的融合，复杂度和风险会快速增加。

## 4. 用字节账本判断值不值得融合

对候选算子链列出：

| 项目 | 融合前 | 融合后 |
| --- | ---: | ---: |
| 输入读取 |  |  |
| 中间 Tensor 写入 |  |  |
| 中间 Tensor 读取 |  |  |
| 最终输出写入 |  |  |
| Kernel Launch 数 |  |  |
| Workspace |  |  |

例如 BF16 中间 Tensor 有 `T` 个元素，一次完整“写回再读出”至少产生近似 `4T` 字节的显存流量，尚未包含 Cache Line、对齐和元数据。若 Tensor 本来能稳定驻留 L2，实际 HBM 节省会低于这个上界，因此仍需 Profiler 验证。

## 5. 为什么融合后反而可能更慢

- 单个 Kernel 使用更多寄存器，Occupancy 下降；
- Shared Memory 增加，限制并发 Block；
- 指令和分支变多，Warp Divergence 加重；
- 动态 Shape 需要 Mask，浪费计算；
- 组合变体太多，引发编译和缓存膨胀；
- 原本可并发的 Kernel 被串在一起；
- 通用融合破坏了高度优化的库 Kernel；
- 为少见路径加入大量条件判断；
- CUDA Graph Bucket 命中率下降或回退 Eager。

所以融合收益是“减少的流量与 Launch”减去“更高的单 Kernel 资源和复杂度成本”。

## 6. 融合发生在哪个层次

| 层次 | 例子 | 特征 |
| --- | --- | --- |
| 模型代码 | 手写 fused module | 容易理解，需维护多 Backend |
| 编译器 | Inductor/Triton Pattern Fusion | 可自动生成，但受 Graph Break 和动态 Shape 影响 |
| 库/自定义算子 | FlashAttention、Fused MLP | 高度优化，支持矩阵有边界 |
| GEMM Epilogue | Bias、Activation、Quantize | 避免一次输出往返，耦合 GEMM 配置 |
| 推理框架 | Attention Backend、Sampler、Custom Op | 与 Batch、KV、Graph 和调度紧密关联 |

说明“做了 Decode 融合”时，应明确是哪个层次、覆盖哪些 Shape、未命中时如何回退。

## 7. Prefill 与 Decode 必须分别选择 Kernel

同一融合算子可能需要多套策略：

```text
Prefill：大M，优先Tensor Core吞吐和大Tile
Decode：小M，优先权重/KV读取、Launch和小Shape效率
Mixed Batch：同时有Prefill与Decode，需要独立调度或折中Kernel
```

只用 Prefill 大矩阵 Benchmark 证明融合有效，不能说明 TPOT 会下降。只用单序列 Decode，也不能说明高并发下仍然有效。

## 8. 与量化的关系

W4A16 常把以下步骤融合：

```text
读取Packed INT4
→ 解包
→ 乘Scale反量化
→ GEMM/GEMV
→ Epilogue写BF16输出
```

如果反量化单独落地完整 BF16 权重，压缩带来的 HBM 优势会被削弱。反过来，融合反量化会增加指令和寄存器压力，必须针对目标 Shape 调优。

量化与融合一起上线时，应做四组实验：

```text
BF16 + 非融合
BF16 + 融合
量化 + 非融合/通用路径
量化 + 融合量化Kernel
```

这样才能区分容量收益、量化收益和融合收益。

## 9. 与 TP 通信的关系

TP 线性层之间常伴随 AllReduce/ReduceScatter/AllGather。候选优化包括：

- 计算与通信重叠；
- 将相邻逐元素操作放进通信前后；
- ReduceScatter 后只处理本地 Shard；
- 用 Custom AllReduce 减少小消息开销。

但 Collective 要求所有 Rank 在相同顺序参与。把通信纳入 CUDA Graph 或自定义融合后，Rank 间 Shape、Graph 模式和 Buffer 地址必须一致；否则可能出现卡死，而不只是数值回归。

## 10. 一套分析流程

### 10.1 确认服务阶段

- TTFT 问题先区分排队、Tokenize、Prefill；
- TPOT 问题重点看 Decode Step；
- 吞吐问题同时看活动序列数、调度预算和 GPU 时间线。

### 10.2 找出候选算子链

用框架 Profiler 和 Nsight Systems 找：

- 高频小 Kernel；
- Kernel 之间的 CPU 空洞；
- 重复的中间 Tensor Memcpy/读写；
- 每层稳定出现的同步；
- Decode 中占比最高的权重和 KV 读取。

### 10.3 用 Nsight Compute 验证

- DRAM/L2 吞吐；
- Tensor Core/SM 利用；
- Registers per Thread；
- Achieved Occupancy；
- Warp Stall 原因；
- 实际执行指令和内存访问。

### 10.4 回到端到端

在真实 Token 分布下比较 TTFT、TPOT、吞吐、P99、显存和功耗。确认没有因 Graph Pool、编译缓存或变体数量增加而降低容量。

## 11. 正确性边界

融合改变运算顺序，可能改变：

- 浮点舍入；
- Softmax 数值稳定性；
- Top-k Tie-break；
- RNG 消耗顺序；
- Mask、Padding 和尾块处理；
- 多请求交错时使用的 Buffer。

测试应覆盖不同 Batch、序列长度、Head Dim、GQA、Dtype、量化、Graph/Eager、多流和请求取消。不能只比较一次固定短句。

## 12. 自测题与答案

### 12.1 为什么 Decode 比 Prefill 更容易 Memory/Launch Bound？

Decode 每条活动序列每轮只增加一个 Token，矩阵 `M` 小，权重计算复用低，同时每轮仍要读取大量权重和历史 KV；大量小 Kernel 还放大 CPU Launch 开销。Prefill 的大矩阵通常更容易提高计算复用。

### 12.2 融合算子是否减少模型 FLOPs？

多数融合不改变核心数学量，主要减少 Kernel Launch 和中间 Tensor 的 HBM 往返。某些算法级融合会重排或避免中间结果物化，但仍需分别说明数学量和 I/O 量。

### 12.3 为什么融合 Kernel 的时间下降，TPOT 可能不变？

该 Kernel 可能只占 Decode Step 的很小比例，或节省时间被 Attention、TP Collective、调度和同步抵消。必须测算子链与端到端，并应用 Amdahl 定律理解上限。

### 12.4 如何判断一次融合值得保留？

它应在目标 Shape 上减少可证明的 Launch/HBM 成本，通过数值和协议回归，并在真实负载下降低 TPOT 或提高安全吞吐；同时不能显著增加显存、编译冷启动和维护风险。

## 13. 参考资料

- [FlashAttention](https://arxiv.org/abs/2205.14135)
- [NVIDIA CUTLASS](https://docs.nvidia.com/cutlass/)
- [NVIDIA Nsight Systems](https://docs.nvidia.com/nsight-systems/UserGuide/)
- [NVIDIA Nsight Compute](https://docs.nvidia.com/nsight-compute/)
