---
title: GPU 基础知识：从计算核心到显存
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "CUDA", "显存", "Tensor Core", "nvidia-smi", "学习路线"]
---

# GPU 基础知识：从计算核心到显存

在学习 Kubernetes GPU 集群之前，首先需要理解 GPU 本身是如何工作的。很多运维问题最终都会回到几个基础概念：

- GPU 为什么适合大模型训练和推理？
- CUDA Core 和 Tensor Core 有什么区别？
- SM、Thread、Warp 分别是什么？
- GPU 利用率高代表什么？
- 显存使用率和显存带宽利用率是不是一回事？
- 为什么显存还有空闲，程序却不一定跑得快？
- 为什么 GPU 利用率很低，但显存却已经占满？

本文以 **NVIDIA GPU** 和 **CUDA** 体系为主，介绍计算结构、线程执行模型和存储层次，为后续 [nvidia-smi](./03-nvidia-smi%20常用命令与指标说明.md)、[驱动与 CUDA](./04-NVIDIA%20驱动、CUDA%20与容器运行时的关系.md)、Device Plugin、GPU Operator 和大模型部署打下基础。

---

## 1. 学习目标

完成本文后，应能：

1. 解释 CPU 与 GPU 的主要区别；
2. 理解 SM、CUDA Core、Tensor Core 的关系；
3. 理解 Thread、Block、Grid 和 Warp；
4. 掌握 GPU 的存储层次；
5. 区分显存容量、显存带宽和显存利用率；
6. 看懂 `nvidia-smi` 中的基础指标；
7. 初步判断工作负载是计算瓶颈还是内存瓶颈。

---

## 2. CPU 与 GPU 的区别

CPU 和 GPU 不是互相替代，而是面向不同类型的工作负载。

CPU 通常核心少、功能复杂，擅长：复杂控制逻辑、分支判断、串行任务、操作系统调度、数据库事务、延迟敏感型任务。

GPU 由大量并行计算单元组成，更适合：矩阵/向量运算、图像处理、深度学习、科学计算，以及可拆成大量相似小任务的计算。

CUDA 将 CPU 称为 **Host**，将 GPU 称为 **Device**。程序通常由 CPU 发起：Host 准备数据并启动任务，Device 并行执行 Kernel；二者分别连接主机内存与设备内存（显存）。

```text
CPU：少量强大的工人，擅长处理复杂任务
GPU：大量并行工人，擅长同时处理相似任务
```

对一百万个数字做相同乘法，可以把不同数据分给大量 GPU 线程并行计算。但强依赖、复杂分支的逻辑不一定适合 GPU——前后依赖会降低并行效率。

---

## 3. GPU 的基本硬件结构

从 CUDA 编程模型角度，可把 NVIDIA GPU 简化为：

```text
GPU
├── 多个 Graphics Processing Cluster（GPC）
│   ├── 多个 Streaming Multiprocessor（SM）
│   │   ├── CUDA Core
│   │   ├── Tensor Core
│   │   ├── 寄存器
│   │   ├── Shared Memory
│   │   ├── L1 Cache
│   │   └── Warp Scheduler
│   └── ...
├── L2 Cache
└── GPU 显存
```

CUDA 官方把 GPU 看成多个 **SM** 的集合。每个 SM 内有寄存器、统一数据缓存以及计算功能单元；不同架构下，每 SM 的单元数量和缓存大小可能不同。

### 3.1 SM 是什么

```text
Streaming Multiprocessor（流式多处理器）
```

SM 是 GPU 执行和调度线程的核心单元。Kernel 启动后，大量线程划成多个 Thread Block，再分配到不同 SM。**一个 Block 内的所有线程调度到同一 SM**，从而能用同一块 Shared Memory 通信和同步。

注意：**SM 数量 ≠ GPU「核心数」**。一个 SM 还包含多个 CUDA Core、Tensor Core、寄存器、调度器和缓存。

---

## 4. CUDA Core 是什么

CUDA Core 是执行普通算术指令的硬件计算单元，主要处理浮点/整数运算、逻辑运算、地址计算等。

不能把它简单当成 CPU Core：

```text
一个 CUDA Core ≠ 一个 CPU Core
一个 CUDA Core ≠ 一个 CUDA Thread
一个 CUDA Thread ≠ 始终独占一个 CUDA Core
```

Thread 是软件执行上下文，CUDA Core 是硬件执行单元；GPU 在大量线程之间调度硬件资源。因此只比 CUDA Core 数量不够，还要看架构、频率、Tensor Core、显存带宽、数据类型、功耗限制和实际负载。

---

## 5. Tensor Core 是什么

Tensor Core 专为矩阵运算加速，深度学习里的全连接、Attention、卷积、训练与推理等，很多都能落到矩阵乘加。它支持混合精度，具体格式取决于架构，常见包括 FP32、TF32、FP16、BF16、FP8、INT8、INT4 等。

| 计算单元 | 主要用途 |
|----------|----------|
| CUDA Core | 通用浮点、整数和逻辑运算 |
| Tensor Core | 矩阵乘法、混合精度和 AI 计算 |
| RT Core | 光线追踪（图形渲染） |

大模型性能不能只看 CUDA Core，还要看目标精度下 Tensor Core 是否可用。同一模型用 FP32 / FP16 / BF16 / INT8 / INT4，吞吐、显存和精度可能完全不同。

---

## 6. Thread、Block、Grid 和 Warp

```text
Grid
└── Thread Block
    └── Thread
```

### 6.1 Thread

最小的软件执行单位。例如处理一百万个数据，可建一百万个线程，每线程负责一个元素。

### 6.2 Thread Block

同一 Block 中的线程：在同一 SM 上运行；可共享 Shared Memory；可同步；可协作完成局部任务。

### 6.3 Grid

多个 Block 组成 Grid。一次 Kernel 启动通常对应一个 Grid。CUDA 可启动极大规模的线程与 Block，GPU 按可用 SM 逐批调度。

### 6.4 Warp

GPU 通常不以单个 Thread 为单位执行，而是按 Warp 组织。NVIDIA CUDA 中：

```text
1 Warp = 32 个 Thread
```

Warp 内线程通常执行相同指令，称为 **SIMT**（Single Instruction, Multiple Threads）。Block 内线程按每 32 个划成一个 Warp。例如 256 线程的 Block → `256 ÷ 32 = 8` 个 Warp。

### 6.5 Warp Divergence

同一 Warp 内线程走不同分支时发生 Warp Divergence：

```cpp
if (thread_id % 2 == 0) {
    do_a();
} else {
    do_b();
}
```

GPU 需分别执行两分支，并暂时屏蔽不属于当前分支的线程，并行效率下降。Warp 内控制路径一致时利用率更高。

---

## 7. GPU 的存储层次

性能既取决于算力，也取决于数据能否及时送到计算单元：

```text
速度快、容量小
        ↑
寄存器 Register
Shared Memory / L1 Cache
L2 Cache
Global Memory（显存）
Host Memory（主机内存）
        ↓
速度慢、容量大
```

CUDA 主要内存空间包括 Global、Constant、Shared、Local、Register。Global 对所有线程可见；Shared 在 Block 内共享；Register / Local 在逻辑上属于单线程。

### 7.1 Register

位于 SM 内，保存临时变量、索引、中间结果等。极快但容量有限；每线程占用过多会降低 SM 能同时容纳的线程数（影响 Occupancy）。

### 7.2 Shared Memory

Block 内共享，用于线程间交换、缓存复用数据、矩阵分块、减少对显存的重复访问。比全局显存更近计算单元，但容量有限，且由当前 SM 上多个 Block 竞争。

### 7.3 L1 与 L2 Cache

每 SM 通常有 L1；L2 由 GPU 内各 SM 共享。命中率取决于访问模式、复用程度、连续性与工作集大小。

### 7.4 Global Memory

即常见所说的 GPU 显存（如 16 / 24 / 48 / 80 GiB），存放模型权重、KV Cache、输入输出张量、激活、梯度、优化器状态、CUDA Context、临时缓冲等。独立 GPU 通常有自己的 Device Memory。

### 7.5 Local Memory

名字易误解：逻辑上属单线程，物理上常落在设备内存。寄存器不足时可能「溢出」到 Local Memory，性能可能明显下降。

---

## 8. 显存容量、带宽和利用率

### 8.1 显存容量

表示最多能存多少数据，主要决定：模型能否加载、最大 Batch / 上下文、KV Cache、并发量、能否训练等。

```text
GPU 总显存：24 GiB
模型权重：14 GiB
KV Cache：6 GiB
CUDA 与临时缓冲：2 GiB
剩余：约 2 GiB
```

### 8.2 显存带宽

单位时间 GPU 与显存之间能传输多少数据（GB/s、TB/s）。容量大 ≠ 带宽高：

```text
显存容量 = 仓库有多大
显存带宽 = 大门每秒能运多少货
计算能力 = 工厂每秒能加工多少货
```

两类典型瓶颈：

- **Compute Bound**：计算单元长期忙碌  
- **Memory Bound**：计算单元经常等数据  

### 8.3 显存占用与 Memory Utilization

`nvidia-smi` 里两个指标易混：

| 指标 | 含义 |
|------|------|
| Memory-Usage | 已用多少显存容量，如 `18000 MiB / 24576 MiB` |
| Memory Utilization | 采样周期内显存总线在读/写的时间比例（不是容量占用百分比） |
| GPU-Util | 采样周期内至少有一个 Kernel 在执行的时间比例 |

因此可能出现：显存占用 90%、Memory Util 10%、GPU Util 5%——权重已加载，但当前请求少，算力和显存总线并不忙。

更细的命令与指标见：[nvidia-smi 常用命令与指标说明](./03-nvidia-smi%20常用命令与指标说明.md)。

---

## 9. 常见数据精度

| 数据类型 | 大致位宽 | 常见场景 |
|----------|----------|----------|
| FP32 | 32 bit | 通用计算、部分训练 |
| TF32 | 19 bit 有效格式体系 | Ampere 及之后部分训练 |
| FP16 | 16 bit | 训练、推理 |
| BF16 | 16 bit | 大模型训练和推理 |
| FP8 | 8 bit | 新架构训练和推理 |
| INT8 | 8 bit | 量化推理 |
| INT4 | 4 bit | 低显存量化推理 |

低精度通常减少权重占用、传输量、KV Cache 和部分计算开销，但可能掉精度，且需 GPU / 框架 / 算子支持。粗算参数量 `P` 的权重：

```text
FP32：P × 4 Bytes
FP16/BF16：P × 2 Bytes
INT8：P × 1 Byte
INT4：P × 0.5 Byte
```

7B 模型仅原始权重约：FP32 ~28 GB、FP16 ~14 GB、INT8 ~7 GB、INT4 ~3.5 GB。实际还有 Context、KV Cache、激活和临时缓冲，不能只按权重大小选卡。

---

## 10. 使用 nvidia-smi 查看 GPU

### 10.1 基础信息

```bash
nvidia-smi
```

关注：型号、驱动版本、CUDA 兼容版本、温度、功耗、显存、GPU Util、进程。

### 10.2 查询指定指标

```bash
nvidia-smi \
  --query-gpu=name,uuid,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw \
  --format=csv
```

### 10.3 详细查询

```bash
nvidia-smi -q
nvidia-smi -q -d MEMORY,UTILIZATION,TEMPERATURE,POWER
```

### 10.4 持续观察

```bash
watch -n 1 nvidia-smi
nvidia-smi dmon
nvidia-smi dmon -s pucm
```

### 10.5 拓扑

```bash
nvidia-smi topo -m
```

可看 GPU–GPU（含 NVLink）、与 CPU NUMA、与网卡的距离。后续见：[GPU 服务器硬件拓扑与 NUMA](./02-GPU%20服务器硬件拓扑与%20NUMA.md)。

---

## 11. 实验记录

在 GPU 服务器上执行：

```bash
nvidia-smi \
  --query-gpu=index,name,uuid,memory.total,memory.used,utilization.gpu,utilization.memory,temperature.gpu,power.draw \
  --format=csv
```

记录：型号、数量、单卡显存、当前占用、GPU Util、Memory Util、温度、功耗。再执行 `nvidia-smi topo -m`，记录 NVLink、NUMA、与网卡关系。

若有大模型服务，用 `watch -n 1 nvidia-smi` 分别记录：加载前 / 加载后 / 无请求 / 单请求 / 高并发，对比显存占用、GPU Util、Memory Util、功耗、温度。

---

## 12. 常见误区

1. **GPU Util 100% ≠ 性能最优**：只表示采样期内在跑 Kernel，不代表 Tensor Core 用满、访存高效、延迟最优或未降频。  
2. **显存未满 ≠ 还能加并发**：还受 KV Cache、碎片、临时空间、上下文长度、CUDA Graph、框架预留等限制。  
3. **显存占用高 ≠ GPU 忙**：权重可长期驻留，可能出现「显存 95%、GPU Util 0%」。  
4. **不能跨架构只比 CUDA Core**：还要看架构、Tensor Core、频率、带宽、精度、功耗、软件与模型。  
5. **Memory Util ≠ 显存容量使用率**：前者是总线忙闲，后者是占了多少容量。

---

## 13. 本篇总结

```text
GPU → 多个 SM → SM 内有计算单元 / 寄存器 / Shared Memory / 调度器
线程按 Block 组织 → 每 32 线程一个 Warp
CUDA Core：通用算术；Tensor Core：矩阵与混合精度
存储：Register → Shared/L1 → L2 → Global → Host
```

分析性能时同时看：GPU Util、显存占用、Memory Util、功耗、温度、频率，以及业务吞吐与延迟。

下一篇：[GPU 服务器硬件拓扑与 NUMA](./02-GPU%20服务器硬件拓扑与%20NUMA.md)；动手命令优先：[nvidia-smi 常用命令与指标说明](./03-nvidia-smi%20常用命令与指标说明.md)；组件链路：[NVIDIA 驱动、CUDA 与容器运行时的关系](./04-NVIDIA%20驱动、CUDA%20与容器运行时的关系.md)。

---

## 14. 课后练习

1. CUDA Core、Tensor Core 和 CUDA Thread 有什么区别？  
2. 为什么一个 Thread Block 必须运行在同一个 SM 上？  
3. 一个含 256 线程的 Block 会分成多少个 Warp？  
4. Warp Divergence 为什么会降低执行效率？  
5. Shared Memory 和 Global Memory 有什么区别？  
6. `Memory-Usage` 与 `Memory Util` 有什么区别？  
7. 为什么模型没有请求时，显存仍可能占用 90%？  
8. 为什么不能只根据 CUDA Core 数量比较两张 GPU？  
9. 显存容量和显存带宽分别决定什么？  
10. 用 `nvidia-smi` 记录一张实际 GPU 的型号、显存、利用率、温度和功耗。

---

## 参考与致谢

- [CUDA Programming Guide — Programming Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html)（异构系统、SM、Thread Block、Warp、内存模型）
- [CUDA Programming Guide — Writing SIMT Kernels](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html)（Global / Shared / Local / Register 等内存空间）
- [NVIDIA Tensor Cores](https://www.nvidia.com/en-us/data-center/tensor-cores/)
- [NVIDIA System Management Interface（nvidia-smi）](https://developer.nvidia.com/system-management-interface)

本文按上述官方材料整理，并按本系列学习路线做了结构与交叉链接调整。
