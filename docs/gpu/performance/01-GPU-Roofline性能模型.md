---
title: "GPU Roofline 性能模型：算力、显存带宽与算术强度"
sidebar_position: 9
tags: [GPU, Roofline, Arithmetic Intensity, FLOPS, HBM, Nsight Compute]
description: "用 Roofline 的算术强度、内存带宽上限和计算峰值判断 Kernel 是访存受限还是计算受限，并指导优化实验。"
---

# GPU Roofline 性能模型：算力、显存带宽与算术强度

GPU 标称有很高 Tensor FLOPS 和 HBM 带宽，但任何 Kernel 的性能都同时受到“能多快计算”和“能多快供数”限制。Roofline 将两者放进一个模型：

```text
Attainable Performance ≤ min(Peak Compute,
                              Memory Bandwidth × Arithmetic Intensity)
```

它不是自动给出根因的仪表盘，而是帮助提出正确优化方向。

## 1. 三个核心量

### 1.1 Work/Performance

Kernel 完成的运算量，例如 FLOP；性能为 FLOP/s。计数必须明确：

- 哪种精度；
- FMA 算几个操作；
- Tensor Core 与普通 FP pipeline；
- 是否包含无效/稀疏/特殊运算；
- 理论、请求还是实际执行口径。

### 1.2 Memory Traffic

从所选内存层传输的字节。最简单 Roofline 使用 HBM/Device Memory traffic；层次化 Roofline 还可使用 L1/L2/Shared 等边界。

### 1.3 Arithmetic Intensity

```text
AI = Work / Memory Traffic
单位：FLOP/Byte
```

AI 高：每字节数据做很多计算；AI 低：读写大量数据但计算少。

## 2. 两条屋顶线

### 2.1 内存带宽斜线

```text
Performance = BW × AI
```

AI 较低时，提高计算峰值没有用，数据供给上限更低。

### 2.2 计算水平线

性能达到计算峰值后，继续提高 AI 也不会超过硬件计算上限。

### 2.3 Ridge Point

```text
AI_ridge = Peak Compute / Peak Memory Bandwidth
```

在 ridge 左侧通常属于内存带宽受限区域，右侧属于计算受限区域。不同精度/指令管线有不同 Peak，因而 ridge 不唯一。

## 3. 一个直观示例

假设某目标条件下：

```text
Peak compute = 100 TFLOP/s
Measured sustainable HBM BW = 2 TB/s
AI_ridge = 50 FLOP/Byte
```

Kernel AI=10：

```text
memory roof = 2 TB/s × 10 FLOP/B = 20 TFLOP/s
```

即使计算单元能到 100，简单模型上限约 20。

Kernel AI=100：内存屋顶给出 200，但计算屋顶只有 100，因此计算上限更低。

数字仅演示公式。真实 Peak、单位和可持续带宽需按目标 GPU、精度和实测。

## 4. 理论峰值与可持续峰值

产品标称值常假定理想指令、频率和占用。实际还受：

- GPU 架构与 SKU；
- 精度、Tensor Core、稀疏模式；
- Boost/功耗/温度；
- 指令混合；
- 数据布局和 shape；
- ECC、共享资源；
- MIG/虚拟化；
- 运行时/库版本。

工程 Roofline 更适合使用同机实测可持续基线：高效 GEMM 得计算屋顶，带宽微基准得 HBM 屋顶，并保留理论屋顶作为参考。

## 5. 算术强度如何估算

### 5.1 Vector Add

```text
c[i] = a[i] + b[i]
```

每元素约 1 FLOP，读 a/b、写 c。FP32 至少 12 bytes，不考虑缓存/写分配：

```text
AI ≈ 1 / 12 FLOP/B
```

非常低，典型带宽受限。

### 5.2 矩阵乘

矩阵乘有大量 FMA。若 tile 在 Shared/Register 中复用，每个从 HBM 读入的元素参与多次计算，AI 随矩阵规模和 tiling 提高，因此高效 GEMM 可接近计算屋顶。

### 5.3 注意“算法 AI”与“实际 AI”

算法按最理想只读一次估算；实际可能因：

- cache miss；
- 不合并访存；
- 中间 tensor materialization；
- 重复加载；
- spill；
- padding/无效 lane；
- 多次 Kernel。

产生更多 bytes。Profiler 测得的实际 AI 更接近实现。

## 6. 点在图上的位置如何解释

### 接近斜线

HBM 带宽利用较好且 AI 低，优化应提高数据复用/AI，或减少字节，而不是只增计算并发。

### 低于斜线很远

虽位于 memory-bound 区，但没有接近带宽屋顶，可能是：

- 访问不合并；
- 延迟受限/并发不足；
- cache/partition imbalance；
- 小 Kernel；
- 分支/依赖；
- 实际带宽屋顶估计不对。

### 接近水平线

计算管线利用较高，进一步优化需更高效指令/精度/算法或更多硬件。

### 低于水平线很远

可能 compute-bound 区但未用目标 pipeline：shape 不适合 Tensor Core、occupancy、依赖、发散、指令混合或调度空洞。

Roofline 只给“距离哪个上限”，仍需细化指标解释距离。

## 7. 优化内存受限 Kernel

按优先级形成假设：

1. **减少总字节：**低精度、压缩、去除中间 tensor；
2. **提高复用：**tiling、Shared Memory、cache；
3. **融合 Kernel：**中间结果留在寄存器/Shared；
4. **合并访问：**连续、对齐、布局变换；
5. **提高并发隐藏延迟：**更多 warp/异步 copy；
6. **避免 spill：**寄存器与 occupancy 权衡；
7. **减少无效工作：**padding、mask、重复读取。

融合可能增加寄存器和降低 occupancy；低精度可能影响模型质量。每项都需端到端验证。

## 8. 优化计算受限 Kernel

- 使用适合架构的 Tensor Core 数据类型；
- shape/对齐满足库快速路径；
- 使用高效 cuBLAS/cuDNN/Triton Kernel；
- 减少慢指令和数据类型转换；
- 提高 instruction-level parallelism；
- 减少 warp divergence；
- 提高有效 lane；
- 调整 tile/block；
- 算法级减少 FLOP；
- 避免功耗/温度降频。

“减少 FLOP”有时会降低 AI，转为带宽受限，但总时间仍可能改善；最终看端到端性能。

## 9. 层次化 Roofline

单一 HBM Roofline 无法解释命中 L2/L1 的 Kernel。层次化模型有不同带宽屋顶：

```text
L1/Shared roof
L2 roof
HBM roof
```

同一 Kernel 相对不同层的 AI 不同：

```text
AI_HBM = FLOP / HBM bytes
AI_L2  = FLOP / L2 bytes
```

如果 HBM 流量很少但 L2 流量高，Kernel 可能受 L2 上限。Nsight Compute 提供不同 section/metric 定义，需查看报告公式。

## 10. Nsight Compute Roofline 流程

1. 用 Nsight Systems 找到热点 Kernel；
2. 固定输入和目标 Kernel；
3. 使用 Nsight Compute roofline section set/profile；
4. 查看 FLOP、memory traffic、achieved performance、roof；
5. 检查报告中 metric 公式和精度；
6. 结合 Memory Workload、Occupancy、Warp State；
7. 修改一个变量；
8. 使用 baseline 对比点移动；
9. 回到端到端请求/训练验证。

不同 Nsight Compute 版本的 section 名和 metric 会变化，以当前文档/`--list-sets` 为准。

## 11. Roofline 与 Occupancy 的关系

Occupancy 是实现接近屋顶的一种条件，不是屋顶本身：

- memory latency-bound Kernel 可能需要更多 warp；
- bandwidth-bound Kernel 在较低 occupancy 已把 HBM 打满；
- compute-bound Kernel 可能因寄存器高导致 occupancy 低但计算吞吐高；
- 为提高 occupancy 导致 spill，会向右/左和向下改变实际点。

先看点相对屋顶，再用 occupancy 解释为何没到屋顶。

## 12. Roofline 与模型推理

### Prefill

大矩阵乘、较高 batch/token，通常 AI 较高，更容易接近 Tensor Core compute roof；Attention 其他阶段仍可能带宽受限。

### Decode

每步少量 token，权重被反复读取，有效矩阵维度小，常更偏 HBM/launch/latency。增大 continuous batch 可提高权重复用和 AI。

### KV Cache

读写大量 KV、计算相对有限，容易内存带宽受限；GQA/MQA、KV 精度和分页布局会改变 bytes。

### Quantization

减少权重字节可提高有效 AI/降低 HBM 流量，但反量化与特殊 Kernel 增加计算。是否更快取决于 GPU、shape、Kernel 和 batch。

## 13. Roofline 与训练

- GEMM/卷积可能 compute-bound；
- optimizer update、elementwise、norm 可能 bandwidth-bound；
- activation checkpointing 以额外计算换显存容量，不只改变单 Kernel；
- 算子融合减少中间 HBM 流量；
- DDP/NCCL 不在单 GPU compute/HBM Roofline 中，需要通信模型；
- DataLoader/CPU 空洞也不在 Kernel Roofline 中。

端到端 step time 不能只用一个 Kernel 点解释。

## 14. 把 NVLink/NIC 纳入扩展模型

多 GPU 场景还有通信屋顶：

```text
Collective time ≈ latency term + message bytes / effective link bandwidth
```

计算加速后，NCCL 占比上升；单 Kernel Roofline 点变好而 step time 不变，可能是通信/同步成为 Amdahl 瓶颈。

需要同时看：

- GPU Kernel Roofline；
- NVLink/NCCL 带宽；
- overlap；
- 最慢 rank；
- CPU/数据输入。

## 15. 常见错误结论

### “点在左边，所以 HBM 已跑满”

左边表示模型上 memory roof 更低，不代表实际达到屋顶。看点到斜线距离和实际带宽。

### “计算受限，只能换更快 GPU”

可能没使用 Tensor Core、shape 不合适、分支/指令低效，离计算屋顶很远。

### “AI 是算法常数”

实际流量受实现、cache、融合和 shape 影响，同一算法不同 Kernel AI 不同。

### “标称 HBM/Tensor 峰值就是屋顶”

可持续屋顶受频率、精度、设备和测试影响。

## 16. 实验路线

### 实验 A：Vector Add

低 AI。测有效带宽、实际 HBM 流量，调整 coalescing。预期靠近 memory roof。

### 实验 B：GEMM

扫描 M/N/K、精度和 Tensor Core，观察小 shape 到大 shape 从低效到接近 compute roof。

### 实验 C：Kernel Fusion

对两个 elementwise Kernel 与融合版比较：FLOP 相近，HBM bytes 减少，AI 和时间改善。

### 实验 D：Decode batch

固定模型/序列长度，改变 active sequences，记录 TPOT、HBM、Tensor utilization 和 Roofline，说明 batch 如何改变硬件效率。

### 实验 E：量化

固定请求与输出质量标准，比较权重 bytes、反量化计算、TTFT/TPOT 和单位成本。

## 17. 结果记录

```markdown
- GPU/SKU/clock/power/MIG:
- driver/CUDA/framework/kernel:
- precision/shape/batch:
- measured work and bytes definitions:
- arithmetic intensity:
- achieved FLOP/s and BW:
- roof values and source:
- occupancy/register/shared:
- kernel time and E2E time:
- baseline delta:
- quality/correctness:
```

## 18. 常见误区

1. **Roofline 能精确预测所有时间。**它是上界与方向模型。
2. **内存受限就只升级 HBM。**先减少/复用 bytes。
3. **计算受限表示计算单元满载。**点可能离水平线很远。
4. **只有一个 Roofline。**精度和内存层次有不同屋顶。
5. **单 Kernel 优化等于模型加速。**CPU、NCCL、队列可能主导。
6. **FLOP 口径天然统一。**Profiler、理论和 Tensor operation 口径需核对。
7. **点越右越好。**最终目标是向上减少时间，不是追求 AI 数字。

## 19. 掌握标准

应能计算/解释 AI 与 ridge point，区分内存/计算区和“未到屋顶”，使用实测可持续屋顶和 Nsight 报告，选择减少 bytes、提高复用或提高计算效率的实验，并把 Kernel 结论放回 Prefill/Decode/KV/NCCL 端到端路径。

下一篇：[NUMA、PCIe 与中断亲和性实验](../labs/01-NUMA-PCIe与中断亲和性实验.md)。

## 参考资料

- [Nsight Compute Roofline Charts](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html#roofline-charts)
- [Nsight Compute documentation](https://docs.nvidia.com/nsight-compute/)
- [CUDA C++ Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)
- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)
