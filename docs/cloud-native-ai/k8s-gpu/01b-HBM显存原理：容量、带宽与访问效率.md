---
title: HBM 显存原理：容量、带宽与访问效率
date: 2026-08-06 18:00:00
categories: 云原生
tags: [GPU, HBM, 显存, CUDA, 性能]
description: 从 GPU 内存层次出发，理解 HBM 容量、带宽、访问合并、缓存和 AI 工作负载显存组成，并通过实验区分容量不足、带宽瓶颈与计算瓶颈。
---

# HBM 显存原理：容量、带宽与访问效率

上一篇介绍了 SM、CUDA Core、Tensor Core、Warp 和 GPU 存储层次。本篇只聚焦一个经常被混淆的问题：

> 显存容量很大、显存占用很高、显存带宽利用率很高，分别代表什么？

这三件事完全不同：

- **显存容量**决定数据能不能放进去
- **显存带宽**决定单位时间能搬多少数据
- **访问效率**决定应用能用到多少理论带宽

← [GPU 基础知识：从计算核心到显存](./01-GPU%20基础知识：从计算核心到显存.md)

## 1. 学习目标

完成本文后，你应该能够：

- 画出 Register、Shared Memory、L1/L2 和 HBM 的层次
- 区分显存容量、带宽、延迟和利用率
- 解释为什么显存占满不等于 GPU 正在计算
- 理解连续访问、合并访问和缓存命中
- 计算模型权重、激活、梯度、优化器状态和 KV Cache 的主要显存开销
- 使用一个简单实验区分计算型和带宽型负载
- 知道 HBM 与 PCIe、NVLink、网卡和存储的边界

## 2. HBM 在完整系统中的位置

```mermaid
flowchart LR
    S["存储"] --> R["CPU 系统内存"]
    R --> P["PCIe"]
    P --> H["GPU HBM / Global Memory"]
    H --> L2["L2 Cache"]
    L2 --> L1["L1 / Shared Memory"]
    L1 --> REG["Register"]
    REG --> SM["SM / CUDA Core / Tensor Core"]
```

从 GPU Kernel 视角看，HBM 通常就是 Global Memory 背后的物理内存。不同厂商和产品会使用不同显存技术，但学习时先记住：

```text
Global Memory：CUDA 编程模型中的地址空间
HBM：很多数据中心 GPU 使用的高带宽物理显存
VRAM：对 GPU 显存的泛称
```

三者不能在所有语境中完全画等号，但在数据中心 GPU 性能讨论中，经常会被近似地放在一起。

## 3. 为什么 GPU 需要独立显存

GPU 有大量并行执行单元。数千个线程同时运行时，需要持续读取：

- 模型权重
- 输入 Tensor
- 中间激活
- 梯度
- 优化器状态
- KV Cache

如果这些数据全部通过 CPU 内存和 PCIe按需读取，PCIe 很容易成为瓶颈。因此 GPU 配置自己的高带宽显存，并通过更宽的接口为大量 SM 提供数据。

这并不意味着所有显存访问都很快。HBM 相对片上 Register、Shared Memory 和 Cache 仍然属于高延迟存储。

## 4. GPU 内存层次

### 4.1 Register

Register 位于 SM 内部，由单个线程使用。

特点：

- 延迟最低
- 带宽极高
- 容量有限
- 数量不足时可能发生 Register Spill

Register Spill 会把本应保存在 Register 的数据放到 Local Memory。Local Memory 名称里虽然有 Local，但通常仍位于 Global Memory 背后，访问代价显著增加。

### 4.2 Shared Memory

Shared Memory 位于 SM 上，由同一个 Thread Block 内的线程共享。

适合：

- 重复使用的数据块
- 矩阵乘法 Tile
- 线程之间交换中间结果
- 减少重复访问 Global Memory

需要关注：

- 容量
- Bank Conflict
- Block 使用量对 Occupancy 的影响

### 4.3 L1 Cache

L1 Cache 靠近 SM。具体组织、容量以及和 Shared Memory 的关系会随 GPU 架构变化。

它主要减少同一 SM 对 Global Memory 的重复访问。

### 4.4 L2 Cache

L2 Cache 通常由多个 SM 共享，是访问 HBM 前的重要缓存层。

当工作集能较好命中 L2 时，监控到的 HBM 流量可能下降，应用性能却提高。这就是为什么不能只用“显存带宽越高越好”评价程序。

### 4.5 HBM / Global Memory

HBM 容量最大，所有 SM 可以访问，但相对片上存储延迟更高。

优化目标不是拒绝使用 HBM，而是：

- 让访问尽量连续
- 让一次传输服务更多线程
- 提高缓存复用
- 减少无意义的数据搬运
- 尽可能把计算和传输重叠

## 5. 容量、带宽和延迟

### 5.1 容量

容量回答：

> GPU 同时能保存多少数据？

例如模型权重、KV Cache 和运行时工作区总量超过可用显存时，可能出现：

- CUDA OOM
- 模型无法加载
- Batch 或上下文长度被迫降低
- Tensor Parallel 或 Offload
- 频繁在 CPU 与 GPU 间换入换出

### 5.2 带宽

带宽回答：

> 每秒最多能从 HBM 读取或写入多少字节？

理论带宽可以粗略理解为：

```text
理论带宽 = 单次传输位宽 × 有效数据速率
```

但应用通常达不到理论峰值，原因包括：

- 访问不连续
- 请求粒度不合适
- 读写混合
- 缓存行为
- 指令和同步开销
- SM 无法生成足够多的并发内存请求
- 其他任务共享 GPU

### 5.3 延迟

延迟回答：

> 一次访问需要等待多久？

大量并发线程可以用“一个 Warp 等待时切换另一个 Warp”隐藏部分内存延迟，但前提是：

- 有足够可运行的 Warp
- 没有严重数据依赖
- Register 和 Shared Memory 使用没有把 Occupancy 压得过低

高带宽不代表单次访问延迟低。

## 6. 显存占用为什么不等于显存忙

加载一个大模型后，权重可能长期占据大部分显存，即使当前没有请求：

```text
显存占用：高
GPU Core 利用率：低
HBM 带宽利用率：低
业务吞吐：低
```

这是一种正常的“数据驻留但没有计算”状态。

相反，一个流式数据处理程序可能只占少量显存，却持续搬运数据：

```text
显存占用：低或中
HBM 带宽利用率：高
GPU Core 利用率：中
```

因此至少要同时观察：

- 显存已用容量
- GPU Core 利用率
- 显存带宽或 DRAM Active
- Tensor Core 活跃度
- SM Active
- 业务吞吐和延迟

## 7. 连续访问与合并访问

GPU 以内存事务服务一组线程，而不是每个线程都独立高效访问任意地址。

假设一个 Warp 中的线程依次访问连续元素：

```text
thread 0 → a[0]
thread 1 → a[1]
thread 2 → a[2]
...
```

硬件可以把多个请求合并成较少的内存事务。

如果线程跨很大步长访问：

```text
thread 0 → a[0]
thread 1 → a[1024]
thread 2 → a[2048]
...
```

可能产生更多内存事务，实际有效带宽下降。

这就是 Coalesced Access 的核心：让同一个 Warp 的线程尽量访问连续、对齐的数据。

## 8. 有效带宽

应用实际搬运的数据量可以用来估算有效带宽：

```text
有效带宽 = 应用有效读写字节数 ÷ 执行时间
```

如果一个 Kernel 读取两个数组、写入一个数组，每个数组有 `N` 个 FP32 元素：

```text
有效数据量约为 3 × N × 4 字节
```

这个计算不能替代性能分析器，因为：

- Cache 可能减少 HBM 访问
- 写入可能经过合并和缓冲
- 编译器可能优化掉部分操作
- 实际内存事务可能大于有效数据量

但它非常适合建立第一层判断。

## 9. Compute-bound 与 Memory-bound

### Compute-bound

特征：

- 计算单元接近饱和
- Tensor Core 或 CUDA Core 活跃
- HBM 带宽尚有余量
- 增加计算能力可能提高性能

典型例子：

- 计算密度较高的矩阵乘法
- 大 Batch GEMM

### Memory-bound

特征：

- HBM 带宽接近平台可达到的上限
- 计算单元没有完全饱和
- 增加更多 FLOPS 帮助有限
- 减少数据搬运或提高复用更有效

典型例子：

- 向量加法
- Embedding 查找
- 某些归一化和逐元素算子
- 小 Batch 推理中的部分操作

### Roofline 的直觉

Arithmetic Intensity 表示：

```text
每搬运 1 字节数据，完成多少计算操作
```

计算密度低，更容易受内存带宽限制；计算密度高，才有机会接近计算峰值。

学习阶段不需要先背公式，先问：

1. 这个算子搬了多少字节？
2. 做了多少次计算？
3. 同一份数据能否复用？
4. 当前瓶颈是 HBM 还是计算单元？

## 10. AI 工作负载的显存组成

### 10.1 推理

主要包括：

- 模型权重
- KV Cache
- 激活和临时 Tensor
- CUDA Graph
- NCCL Buffer
- 框架和 CUDA Context
- 内存分配器预留空间

权重粗略估算：

```text
权重容量 ≈ 参数量 × 每个参数字节数
```

例如只做数量级估算：

| 精度 | 每参数理论字节数 |
| --- | ---: |
| FP32 | 4 |
| FP16/BF16 | 2 |
| INT8 | 1 |
| 4-bit | 约 0.5，另有量化元数据 |

真实占用还会包含量化 Scale、Zero Point、对齐和运行时工作区。

### 10.2 训练

训练通常还需要：

- 梯度
- 优化器状态
- Master Weight
- 保存用于反向传播的激活
- 通信 Buffer

所以同样参数量的模型，训练显存需求通常显著高于推理。

### 10.3 KV Cache

KV Cache 与以下因素相关：

- 层数
- KV Head 数
- Head Dimension
- Token 数
- 并发请求数
- KV 数据类型

因此“模型能加载”不代表“能承载目标上下文和并发”。

详细规划见：

→ [vLLM GPU 显存组成与容量规划](./24-vLLM%20GPU%20显存组成与容量规划.md)

## 11. 查看显存与带宽相关信息

### 11.1 基础状态

```bash
nvidia-smi
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory --format=csv
```

`utilization.memory` 不等于“显存占用百分比”。它描述的是一个采样窗口内显存读写活动的繁忙程度，具体定义应以当前驱动/NVML 文档为准。

### 11.2 持续观察

```bash
nvidia-smi dmon -s pucm
```

观察：

- Power
- GPU Utilization
- Memory Utilization
- Clock

### 11.3 DCGM

生产集群应通过 DCGM Exporter 观察：

- GPU Core 活跃
- DRAM 活跃
- PCIe/NVLink 流量
- 温度和功耗
- ECC 和 Xid

不同 GPU 和 DCGM 版本支持的 Profiling 指标不同，先查询当前平台实际暴露的指标。

### 11.4 Nsight Compute

需要深入分析 Kernel 时，使用 Nsight Compute 查看：

- Memory Workload Analysis
- L1/L2 命中
- DRAM 吞吐
- Warp Stall Reason
- Occupancy
- Roofline

不要在未经评估的生产任务上直接开启高开销 Profiling。

## 12. PyTorch 带宽实验

下面实验比较逐元素加法的有效带宽。只在空闲测试 GPU 上运行。

```python
import torch

device = "cuda"
n = 256 * 1024 * 1024

a = torch.ones(n, dtype=torch.float32, device=device)
b = torch.ones(n, dtype=torch.float32, device=device)

for _ in range(10):
    c = a + b

torch.cuda.synchronize()

start = torch.cuda.Event(enable_timing=True)
end = torch.cuda.Event(enable_timing=True)

start.record()
for _ in range(20):
    c = a + b
end.record()

torch.cuda.synchronize()
seconds = start.elapsed_time(end) / 1000

bytes_per_iteration = n * 4 * 3
effective_gbps = bytes_per_iteration * 20 / seconds / 1e9

print(f"time={seconds:.3f}s")
print(f"effective_bandwidth={effective_gbps:.2f} GB/s")
```

注意：

- 这个实验会分配超过 2 GiB 的 Tensor，并产生额外输出
- 显存不足时应降低 `n`
- 不要在共享 GPU 上用大数组干扰其他任务
- PyTorch 分配器和 Kernel 实现会影响结果
- 有效带宽不是硬件理论带宽

### 实验记录

| 项目 | 结果 |
| --- | --- |
| GPU 型号 |  |
| 驱动/CUDA/PyTorch |  |
| Tensor 大小 |  |
| GPU Utilization |  |
| Memory Utilization |  |
| 有效带宽 |  |
| 是否接近基线 |  |

## 13. 常见误区

### 显存利用率 100% 等于显存满了

错误。显存占用和显存读写活动是两类指标。

### 显存越大，模型一定越快

容量解决“能否放下”；速度还取决于带宽、计算能力、互联和软件实现。

### 理论 HBM 带宽就是应用带宽

应用受访问模式、缓存、同步和 Kernel 实现影响。

### GPU 利用率高就没有内存瓶颈

采样利用率无法替代 Kernel 级分析。GPU 可以在等待内存时仍显示较高活跃度。

### 只要减少显存占用就会提升速度

量化、Offload 和重计算可能降低容量压力，却增加计算或数据传输。

## 14. 它与其他模块的关系

### 上游

- 存储提供模型和数据集
- CPU 系统内存负责普通加载和预处理
- PCIe 把数据传入 GPU

### 本层

- HBM 保存 GPU 当前工作集
- Cache、Shared Memory 和 Register 提高复用
- SM 从内存层次中取得数据执行计算

### 下游

- 多 GPU 间通过 PCIe P2P、NVLink 或 NVSwitch交换显存数据
- 跨节点通过 NIC 和 GPUDirect RDMA
- Kubernetes 根据显存容量、GPU 型号和拓扑选择节点

## 15. 本篇总结

```text
显存容量：决定能放多少
显存带宽：决定每秒能搬多少
访问效率：决定能用到多少带宽
计算密度：决定更可能受计算还是内存限制
```

理解 HBM 后，下一步应先看服务器的 CPU、PCIe 和 NUMA 拓扑，再研究数据如何从 Host 进入 GPU。

→ [GPU 服务器硬件拓扑与 NUMA](./02-GPU%20服务器硬件拓扑与%20NUMA.md)

## 16. 课后练习

1. 显存占用和显存带宽利用率有什么区别？
2. 为什么 HBM 带宽很高，仍需要 L2、Shared Memory 和 Register？
3. 什么是 Coalesced Access？
4. 训练为什么比推理需要更多显存？
5. 一个显存占用 90%、GPU Utilization 5% 的进程可能处于什么状态？
6. 选择一个逐元素算子和一个矩阵乘法，比较其 GPU Core 与 DRAM 指标。
7. 用自己的 GPU 运行带宽实验，记录有效带宽并解释它为什么不等于理论值。

## 参考与致谢

- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)
- [CUDA Programming Model：GPU Memory](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html)
- [CUDA C++ Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)
- [DCGM Exporter GPU Telemetry](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)
