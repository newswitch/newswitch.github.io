---
title: "GPUModelRunner、CUDA Graph 与 Kernel 空洞分析"
sidebar_label: "19. GPUModelRunner、CUDA Graph 与 Kernel 空洞分析"
sidebar_position: 19
tags: [vLLM, GPUModelRunner, CUDA Graph, Nsight Systems, 性能分析]
description: "用 CPU-GPU 时间线定位 vLLM 执行间空洞、Graph Replay、Eager 路径、同步和 Kernel 瓶颈。"
---

# GPUModelRunner、CUDA Graph 与 Kernel 空洞分析

当指标指向 GPU 执行层，下一步不是马上使用最重的 Kernel Profiler，而是先用时间线回答：

```text
GPU 是一直在忙但每步太慢，
还是每次只忙一下，随后长时间等 CPU？
```

这两种问题需要完全不同的工具和修复。

---

## 1. 三种典型时间线

### A：GPU 被上游饿住

```text
CPU: [prepare/schedule────────] [prepare/schedule────────]
GPU:                         [K]                         [K]
```

Kernel 短、空洞长。优先查 EngineCore、ModelRunner 输入准备、IPC 和同步。

### B：GPU 持续计算

```text
CPU: [submit][submit][submit]
GPU:     [Kernel████][Kernel████][Kernel████]
```

空洞少，若延迟仍高，再用 Kernel 指标分析计算/带宽。

### C：多卡同步等待

```text
rank0 GPU: [compute][NCCL wait────][compute]
rank1 GPU: [compute──────][NCCL][compute────]
```

慢 rank 或拓扑决定整体速度。

第一步只需把每次 Scheduler/Execute 与 CUDA/NCCL 对齐。

---

## 2. ModelRunner 在 Kernel 前做什么

每 Step 的 CPU 热路径通常包含：

- 合并 SchedulerOutput 增量；
- 更新 request → index 映射；
- 准备 input IDs、positions；
- 构造 Block Table/Slot Mapping；
- 生成 Attention/Sampling Metadata；
- 把 CPU Buffer 拷到 GPU；
- 选择实际/Pad 后的执行 Shape；
- 发起 Graph Replay 或 Eager Forward。

这些工作会随请求数、token 数、功能和 Shape 变化。只看平均 Batch Size 不够，应记录每 Step：

```text
num_requests
num_scheduled_tokens
num_prefill_tokens
num_decode_tokens
shape/padded_shape
graph_or_eager
prepare_time
execute_time
```

---

## 3. CUDA Graph 解决什么

普通 Eager 执行每轮需要 CPU 发起大量 CUDA API/Kernel Launch。Decode 工作较小、Step 频繁时，Launch 开销占比可能很高。

CUDA Graph 先捕获一组固定执行操作，后续 Replay：

```text
首次/预热：构建固定地址 Buffer → 捕获 Graph
稳态：写入新数据 → Replay 已捕获 Graph
```

收益：

- 减少 Python/CUDA Launch 开销；
- 降低 Step 间空洞；
- 改善 Decode 尾延迟稳定性。

限制：

- Shape、地址和控制流需要满足捕获条件；
- 某些模型/功能/动态路径不兼容；
- 需要额外预热时间和显存；
- 捕获集合不能无限覆盖所有 Shape。

---

## 4. Graph 未命中的表现

Graph 未命中不一定有错误日志。可能表现为：

- 某些 Batch Size 的 TPOT 突然变高；
- CPU CUDA API 时间增加；
- 大量小 Kernel Launch；
- GPU Busy 降低；
- 请求长度/并发变化时出现阶梯式延迟。

验证：

1. 记录真实 Shape 分布；
2. 区分 Graph Replay 与 Eager；
3. 把 TPOT 按 Shape/请求数分桶；
4. 固定 Shape 重放，确认空洞是否消失；
5. 检查捕获配置是否覆盖生产最常见而非合成 Shape。

不要为了命中 Graph 把输入 Pad 得过大：减少 Launch 的收益可能被多算 token/无效计算抵消。

---

## 5. 隐式同步怎样制造空洞

常见同步点：

- CPU 读取 GPU Tensor 值；
- `.item()` 或等价操作；
- GPU→CPU 输出拷贝后立即等待；
- CUDA Event/Stream 错误依赖；
- Python 需要采样结果才能推进结构化状态；
- allocator 或异常路径触发同步；
- Profile/调试开关改变执行。

时间线中表现为 CPU 卡在 CUDA API，同时 GPU 没有后续工作。

分析时查看调用栈与 CUDA API duration，不要只看 Kernel 名。一次很慢的同步 API 可能只是“替前面所有异步 Kernel 买单”，需沿 Stream 依赖回溯。

---

## 6. H2D/D2H 与 Pinned Memory

每 Step 会有少量控制数据和输出在 CPU/GPU 间移动。理想情况：

- 使用预分配 Buffer；
- 可用时使用 Pinned Memory；
- 异步拷贝与其他工作重叠；
- 只复制有效范围；
- 减少大量微小传输。

若时间线显示大量串行 `cudaMemcpy`：

1. 看拷贝大小和方向；
2. 看是否 Pinned；
3. 看 Stream 是否错误同步；
4. 查是否复制了 Pad 后全部 Buffer；
5. 查 NUMA 与 PCIe 拓扑。

小拷贝的主要问题常是固定开销和同步，不一定是 PCIe 带宽跑满。

---

## 7. 什么时候再用 Kernel Profiler

只有满足以下条件，再进入 Nsight Compute 或 Kernel 级分析：

```text
GPU 执行已经连续
且目标延迟/吞吐仍不达标
且单个/某类 Kernel 占主要 GPU 时间
```

随后判断：

- GEMM 的 Tensor Core/Occupancy；
- Decode Attention 的 DRAM 吞吐；
- Kernel 是否因 Shape 过小效率低；
- dtype/量化是否走预期 Kernel；
- 融合算子是否生效；
- GPU 是否降频。

Kernel Profile 开销很大，应在可控复现环境采样，不直接长时间挂生产。

---

## 8. NVTX 与请求关联

理想 Trace 应标出：

```text
schedule
prepare_inputs
model_forward
attention
logits
sample
output_copy
```

同时记录 Step ID、scheduled tokens、Prefill/Decode 组成。不要把 request ID 全部塞入 NVTX 导致 Trace 巨大，可抽样一条请求并用 Step ID 关联。

若源码已有 NVTX/Profiler 钩子，优先使用；新增标记时避免在热路径构造大字符串。

---

## 9. 实验顺序

1. 取 30～60 秒可复现异常窗口；
2. 对齐 Engine Step、CPU Thread、CUDA、NCCL；
3. 量化 GPU Busy 与 Gap 的比例；
4. 给最大 Gap 找 CPU 调用栈/等待原因；
5. 统计 Graph/Eager 与 Shape；
6. 只有 GPU 连续时才选 Top Kernel；
7. 改一个变量复验 TTFT/TPOT/吞吐和成本。

### Gap 指标

可以定义：

```text
gpu_gap_ratio
= GPU 无 Kernel 且存在 waiting 请求的时间
  / 观测总时间
```

“存在 waiting 请求”很重要。无流量时 GPU 空闲不是性能故障。

---

## 10. 常见误区

| 误区 | 正确做法 |
| --- | --- |
| GPU Util 低就做 Nsight Compute | 先用 Systems 看空洞在哪 |
| Graph 越多越好 | 覆盖高频 Shape，并核算 Padding/显存/预热成本 |
| 一个慢 CUDA API 就是根因 | 异步模型下要回溯它等待的前序工作 |
| 小 Memcpy 说明 PCIe 带宽不够 | 先看固定开销、同步和 NUMA |
| 合成固定 Batch 很快就代表生产快 | 真实 Shape 波动可能频繁走 Eager |
| Profile 结果可直接代表生产 | Profiler 会改变时序，需要低侵入复验 |

---

## 11. 证据结论模板

```text
等待请求存在的 60 秒窗口内，GPU Kernel Busy 仅 34%，Gap 66%。
其中 72% Gap 位于 execute_end 到下一次 execute_submit 之间。
CPU Profile 显示 Sampling Metadata 重建占 ModelRunner on-CPU 的 41%；
真实 Shape 中 63% 未命中已捕获 CUDA Graph。
扩大常见 Shape 覆盖并复用 Metadata Buffer 后，Gap 降至 24%，
TTFT P99 下降 38%，TPOT P99 下降 21%，Padding 计算增加 3%，显存余量仍满足基线。
```

---

## 12. 延伸阅读与验收

- [Nsight Systems 端到端时间线分析](../../../sre/performance/03-Nsight-Systems端到端时间线分析.md)
- [Nsight Compute CUDA Kernel 分析](../../../sre/performance/04-Nsight-Compute-CUDA-Kernel分析.md)

验收题：

1. 为什么先用 Systems、后用 Compute？
2. CUDA Graph 主要减少什么开销？
3. 怎样证明 Graph 未命中伤害了生产 TPOT？
4. 什么条件下 GPU 空闲才应计为 gap 故障？
5. 为什么慢 CUDA API 不一定是根因？
6. Padding 与 Graph 覆盖之间有什么权衡？

下一篇进入多 GPU：TP 慢 rank、NVLink 与 NCCL 如何系统排查。
