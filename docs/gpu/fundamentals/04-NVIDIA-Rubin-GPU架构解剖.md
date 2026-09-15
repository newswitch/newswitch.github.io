---
title: "NVIDIA Rubin GPU 架构解剖：从双 Die、HBM4、TMA 到 NVLink 6"
sidebar_label: "04. NVIDIA Rubin GPU 架构解剖"
sidebar_position: 4
description: "从 Rubin GPU 的双计算 Die、224 个 SM、HBM4、增强 TMA 与 Tensor Core，讲到 NV-HBI、NVLink-C2C、NVLink 6、Vera Rubin NVL72，以及一个大模型请求在整套系统中的执行路径。"
tags: [GPU, NVIDIA, Rubin, Vera Rubin, HBM4, NVLink 6, NV-HBI, TMA, Tensor Core, CUDA]
---

# NVIDIA Rubin GPU 架构解剖：从双 Die、HBM4、TMA 到 NVLink 6

Rubin 是 Blackwell 之后面向数据中心 AI 训练与推理的 NVIDIA GPU 架构。理解它不能只看“50 PFLOPS”或“288 GB HBM4”两个数字，因为一条模型执行链同时经过计算、片内数据搬运、显存、GPU 间互联和 CPU-GPU 协同。任何一段跟不上，其他资源都可能等待。

本文从 GPU 本体出发，依次解释：

```text
双计算 Die 与 NV-HBI
→ GPC、SM、Tensor Core 与 Transformer Engine
→ L2、HBM4 与增强 TMA
→ NVLink 6、NVLink-C2C 与 PCIe 6.0
→ Vera Rubin NVL72 机架级系统
→ 一个大模型请求的完整数据流
```

文中的规格以 NVIDIA 截至 2026 年 9 月公布的 Rubin GPU 与 Vera Rubin 平台资料为边界。不同 SKU、系统形态及后续正式软件版本可能发生变化，部署时仍应重新核对产品手册、驱动、CUDA、框架和容器支持矩阵。

## 1. 学习目标

读完本文，应当能够回答：

- Rubin、Vera、Vera Rubin 和 Vera Rubin NVL72 分别是什么；
- 为什么 Rubin 有两个计算 Die，但不能简单理解为两张 GPU；
- NV-HBI、NVLink-C2C、NVLink 6 和 PCIe 6.0 分别连接哪里；
- 224 个 SM、896 个 Tensor Core 与 50 PFLOPS NVFP4 是什么关系；
- HBM4 的 288 GB 容量和 22 TB/s 带宽分别解决什么问题；
- 为什么 Decode 更容易受显存子系统限制，而 Prefill 更容易压满矩阵计算；
- 增强 TMA 的 Inline Descriptor Update 为什么适合 MoE；
- Rubin 为什么专门增强指数运算、细粒度 Kernel 协同和 NVLink 同步；
- NVL72 的 3.6 TB/s、260 TB/s 和 20.7 TB 分别是什么统计口径；
- CUDA Compute Capability 10.7、`sm_107` 与框架兼容性是什么关系；
- 如何判断问题处在计算、显存、互联、CPU 调度还是软件适配层。

## 2. 先把五个名字分清楚

| 名称 | 所处层级 | 核心含义 |
| --- | --- | --- |
| Rubin | GPU 架构与 GPU | 执行 CUDA Kernel、Tensor 计算和显存访问的加速器 |
| Vera | CPU | 面向 AI 基础设施的 Arm CPU，与 Rubin 协同处理主机侧工作 |
| Vera Rubin | 平台组合 | Vera CPU、Rubin GPU、NVLink、网络、软件等共同组成的平台 |
| Vera Rubin NVL72 | 机架级系统 | 36 颗 Vera CPU、72 颗 Rubin GPU 和 NVLink 6 Switch 组成的 Scale-Up 域 |
| Vera Rubin POD | 多机架系统 | 通过 Scale-Out 网络把多个机架级系统继续扩展 |

这五个名字不能互换：

```text
Rubin GPU                 一颗加速器
Vera CPU + Rubin GPU      CPU-GPU 协同计算节点
NVLink 6 Switch Fabric    机架内 GPU Scale-Up 网络
Vera Rubin NVL72          72 GPU 机架级执行域
Vera Rubin POD            多机架 AI 系统
```

### 2.1 Blackwell、Blackwell Ultra 与 Rubin

Blackwell 和 Blackwell Ultra 都属于 Blackwell 家族。Blackwell Ultra 不是 Rubin 的别名，而是 Blackwell 平台的增强阶段；Rubin 才是下一代 GPU 架构。

| 维度 | Blackwell | Blackwell Ultra | Rubin |
| --- | --- | --- | --- |
| 数据中心代表 | B200/GB200 | B300/GB300 | Rubin/Vera Rubin |
| Compute Capability | 10.0 | 10.3 | 10.7 |
| 显存代际 | HBM3e | HBM3e | HBM4 |
| GPU Scale-Up | 第五代 NVLink | 第五代 NVLink | NVLink 6 |
| 典型机架域 | GB200 NVL72 | GB300 NVL72 | Vera Rubin NVL72 |
| 重点变化 | NVFP4、双 Die、第五代 NVLink | 更大显存容量与平台增强 | 更高带宽 HBM4、增强 TMA、Tensor 与通信路径 |

代际名称只说明设计家族，不能代替具体 SKU 参数。比较时还需要统一精度、稀疏口径、功耗、显存容量、带宽方向和系统规模。

## 3. Rubin GPU 的整体结构

[![Rubin GPU 双 Die、HBM4、L2、TMA 与外部互联关系](/images/gpu/rubin/rubin-gpu-architecture.svg)](/images/gpu/rubin/rubin-gpu-architecture.svg)

*图：Rubin GPU 教学逻辑图，用于解释组件和数据路径，不表示真实 Die Floorplan、连线数量或物理尺寸。*

NVIDIA 已公布的 Rubin GPU 核心规格包括：

| 项目 | 公开规格 | 应该怎样理解 |
| --- | ---: | --- |
| 计算 Die | 2 个 | 同一封装内通过 NV-HBI 连接 |
| 晶体管数量 | 3360 亿 | 整颗 GPU 的芯片规模指标 |
| SM | 224 个 | CUDA Thread Block 的主要执行场所 |
| Tensor Core | 896 个 | 每个 SM 4 个，负责矩阵乘加等 Tensor 运算 |
| Transformer Engine | 第三代 | 协调低精度格式、缩放和 Tensor Core 路径 |
| NVFP4 推理峰值 | 最高 50 PFLOPS | 特定低精度和计数口径下的理论峰值 |
| HBM4 容量 | 最高 288 GB | 保存权重、激活、KV Cache 和工作区 |
| HBM4 带宽 | 最高 22 TB/s | HBM 与 GPU 芯片之间的理论峰值吞吐 |
| NVLink 6 | 3.6 TB/s/GPU | GPU 到 NVLink Switch Fabric 的双向聚合 Scale-Up 带宽 |
| NVLink-C2C | 1.8 TB/s | Vera CPU 与 Rubin GPU 的一致性互联带宽 |
| PCIe | Gen 6 x16，最高 256 GB/s | 双向聚合口径；单方向理论值约为其一半 |

这里至少要识别四条不同的数据路径：

```text
Die 0 ←── NV-HBI ──→ Die 1              封装内部
SM ←── L2 / Memory Controller ──→ HBM4  GPU 本地存储
Rubin GPU ←── NVLink-C2C ──→ Vera CPU   CPU-GPU 一致性互联
Rubin GPU ←── NVLink 6 ──→ 其他 GPU     机架内 Scale-Up
```

它们的作用、距离、协议和带宽口径都不同。

## 4. 两个计算 Die 为什么仍是一颗 GPU

单个 Die 的面积受光刻 Reticle Limit、制造良率、供电和布线约束。Rubin 使用两个接近光刻极限的计算 Die，并通过 NVIDIA High-Bandwidth Interface（NV-HBI，高带宽 Die 间接口）在同一封装内连接。

可以把它理解为：

```text
一颗逻辑 GPU
├── Compute Die 0：GPC、SM、Tensor Core 等
├── Compute Die 1：GPC、SM、Tensor Core 等
├── NV-HBI：两颗 Die 的封装内高速互联
├── 统一的 GPU 设备语义与调度
└── 共同连接 L2、HBM4 和外部 I/O
```

### 4.1 它不等于两张显卡

两张独立 GPU 通常各有设备 ID、各自显存地址空间和跨设备通信语义，应用需要显式选择设备并使用 P2P、NCCL 或其他通信方式。Rubin 的两个 Die 是同一 GPU 封装内部的实现，CUDA 软件面对的是统一的 GPU 设备。

因此：

- 不需要为了两个 Die 把普通单 GPU Kernel 改写成两进程 Tensor Parallel；
- 但硬件和编译器仍要处理跨 Die 的数据局部性、负载均衡和访问代价；
- “软件看到一颗 GPU”不表示芯片内部所有访问延迟完全一致。

### 4.2 NV-HBI 不是 NVLink 6

| 接口 | 连接范围 | 主要用途 |
| --- | --- | --- |
| NV-HBI | 同一 Rubin 封装内的两个计算 Die | 组成统一 GPU |
| NVLink-C2C | Vera CPU 与 Rubin GPU | CPU-GPU 一致性高速互联 |
| NVLink 6 | Rubin GPU 与 NVLink Switch/其他 GPU | 机架内 GPU Scale-Up |
| PCIe 6.0 | GPU 与 PCIe Host/设备 | 通用主机与外设互联 |

看到 “NV” 前缀不能把这些接口当成同一条总线。

## 5. GPC、SM、Warp 与 Tensor Core

Rubin 仍延续 CUDA GPU 的基本执行层次：

```text
CUDA Kernel
→ Grid
→ Thread Block
→ 分派到某个 SM
→ Warp（NVIDIA 中 32 个 Thread）
→ Warp Scheduler 发射指令
→ CUDA/Tensor/Load-Store/特殊函数等管线执行
```

### 5.1 224 个 SM 是什么

SM（Streaming Multiprocessor，流式多处理器）是运行 Thread Block、调度 Warp 和承载片上执行资源的基本单元。它不是一颗“CPU 核”，也不表示一个 SM 同时只执行一条线程。

一个 SM 会让多个 Warp 同时保持可运行状态：某个 Warp 等待数据时，调度器可以切换到另一个已就绪 Warp，以并发隐藏延迟。真正的并发能力还会受到以下资源约束：

- 每个 Block 的线程数；
- 每个线程使用的 Register 数量；
- 每个 Block 使用的 Shared Memory；
- 活跃 Warp 和 Block 上限；
- 指令依赖与访存延迟。

因此，224 个 SM 不等于“224 个任务并行”，也不能直接换算成模型 QPS。

Compute Capability 10.7 的 CUDA 规格还给出每个 SM 336 KB Unified Data Cache，并允许 Shared Memory 配置到最高 328 KB。使用 328 KB 超大 Shared Memory 配置时，Kernel 需要通过 Function Attribute 或 Launch Attribute 显式启用 `cudaSharedMemoryModeAllowOversizedSharedMemory`。这说明“硬件有 328 KB”不等于普通 Kernel 默认就能全部占用；分配过大还可能减少同一 SM 上可同时驻留的 Block 数量。

### 5.2 896 个 Tensor Core 怎样分布

公开规格给出 224 个 SM 和 896 个 Tensor Core：

```text
896 Tensor Core ÷ 224 SM = 4 Tensor Core/SM
```

Tensor Core 面向矩阵乘加与相关 Tensor 运算。普通 CUDA Core、Load/Store 管线、特殊函数单元和 Tensor Core 不是互相替代关系：一个 Transformer Layer 既有 GEMM，也有归一化、位置编码、采样、访存和通信。

### 5.3 为什么峰值高不代表 GPU 一直很忙

Tensor Core 只有在算子进入适合的矩阵指令路径时才能贡献峰值。以下情况都可能让实际吞吐远低于理论值：

- 矩阵维度太小或形状不适合硬件 Tile；
- Batch 太小，Decode 每步只有少量 Token；
- 算子仍使用 BF16/FP16，没有进入 NVFP4 路径；
- 量化格式、Scale、Layout 或 Kernel 不匹配；
- HBM 搬运权重的时间高于矩阵计算时间；
- Tensor Parallel 的 Collective 让计算等待通信；
- CPU 调度、Tokenize 或 Kernel Launch 产生空洞。

## 6. 第三代 Transformer Engine 与 NVFP4

Transformer Engine 不是一组独立于 Tensor Core 的“额外算力核心”。它更接近一套硬件与软件协同机制，根据层、Tensor 和数值范围选择低精度计算路径，并管理缩放、格式转换与精度策略，让 Tensor Core 更安全地使用低精度。

可以分成三层：

```text
模型/框架层：哪些层允许低精度，怎样校准或训练
Transformer Engine：格式选择、缩放、统计与执行策略
Tensor Core：真正执行矩阵乘加
```

### 6.1 NVFP4 解决什么问题

FP4 用更少 Bit 表示权重或激活，可以减少：

- HBM 中模型占用；
- HBM 到计算单元的数据搬运量；
- 多 GPU 之间的部分通信量；
- Tensor Core 完成同等元素数量所需的资源。

代价是数值范围和精度下降，因此不能把一个 BF16 模型文件直接改成 FP4 类型就认为量化完成。实际链路通常需要：

```text
模型选择
→ 量化或量化感知训练
→ Scale/Block 规则
→ 精度校验
→ 对应 Rubin Kernel
→ 端到端吞吐与延迟验证
```

### 6.2 怎样正确理解 50 PFLOPS

50 PFLOPS 表示最高每秒约 5×10^16 次特定 NVFP4 运算的理论能力，但它不是任何模型、任何精度都能得到的性能。

比较数字前必须问：

1. 是 FP64、FP32、TF32、BF16、FP8 还是 NVFP4；
2. 是否使用稀疏或特殊计数口径；
3. 是单 GPU 还是 72 GPU 机架聚合值；
4. 是理论峰值、Kernel 实测还是端到端 Token 吞吐；
5. 工作负载是 Prefill、Decode、训练还是 MoE 通信。

不同精度的 FLOPS 不能直接放在一起判断“快多少”。

### 6.3 K 维吞吐为什么重要

矩阵乘法可以写成：

```text
C[M,N] = A[M,K] × B[K,N]
```

`K` 是归约维。Tensor Core 需要分段处理 K 并累加部分和。Rubin 在每个时钟处理更大的 K 范围，使相同 GEMM 所需的 K 循环次数减少。其价值不仅是峰值更高，还包括：

- 降低 K 循环和指令调度开销；
- 在 Tensor Parallel 增大、单卡 M/N 切片变小时继续利用较大的 K；
- 改善部分小 M Decode GEMM 的执行效率；
- 减少中间状态管理和依赖等待。

这并不表示所有矩阵都能获得两倍端到端加速。若瓶颈是 HBM、通信或非矩阵算子，Tensor Core 更快后，瓶颈只会转移到下一层。

### 6.4 三 Bit LUT 权重格式是什么

Rubin Transformer Engine 还公布了面向矩阵 B 的 3-bit Lookup Table（查找表）格式。它不是用 3 Bit 直接编码一个完整浮点值，而是让每个 3-bit Index 指向一张小表中的代表值：

```text
3-bit Index：000 001 010 ... 111
                 ↓
Lookup Table：8 个可选择的代表值
                 ↓
Tensor Core 在矩阵运算路径中解析
```

它的目标是进一步减少权重容量和搬运量，同时通过查找表选择比固定均匀量化更适合当前权重分布的值。实际能否保持精度仍取决于表值生成、Block/Group 划分、模型层敏感度和校准方法，不能仅根据“3 Bit”判断质量或吞吐。

## 7. HBM4：容量和带宽是两件事

Rubin 每颗 GPU 最高配置 288 GB HBM4，理论峰值带宽最高 22 TB/s。公开架构图使用 12-Hi HBM Stack，即单个堆栈垂直叠放多层 DRAM Die，再通过先进封装与 GPU 相连。

### 7.1 288 GB 容量决定能放下多少

GPU 显存主要保存：

```text
模型权重
+ KV Cache
+ 当前激活
+ CUDA Graph/框架工作区
+ 通信 Buffer
+ 内存碎片与运行时保留
```

因此，不能用 `288 GB ÷ 每参数字节数` 直接得出最大可服务模型。以 BF16 权重为例，参数理论上约占 2 Byte，但推理仍需要 KV Cache、激活和工作区。

### 7.2 显存带宽 22 TB/s 决定每秒能搬多少

显存带宽描述 HBM 与 GPU 芯片之间单位时间可传输的数据量。它不等于显存占用率，也不等于 GPU Util。

一个近似的 Decode 下界可以写成：

```text
单 Token 需要读取的数据量
--------------------------------  ≈ 单 Token 最短访存时间
可实现的 HBM 有效带宽
```

如果每生成一个 Token 都需要大量读取权重，而 Batch 又不足以复用权重，那么 Decode 容易成为 Memory-Bound（受显存带宽限制）。

### 7.3 容量大不能替代带宽高

| 现象 | 容量是否足够 | 带宽是否足够 | 结果 |
| --- | --- | --- | --- |
| 模型装不下 | 否 | 无从谈起 | OOM、切分或 Offload |
| 模型能装下但 Decode 慢 | 是 | 可能不足 | GPU 计算单元等待权重/KV 数据 |
| 带宽很高但 KV Cache 装不下 | 否 | 是 | 并发或上下文仍受限 |
| 容量和带宽都够 | 是 | 是 | 还要检查计算、通信与调度 |

### 7.4 理论 22 TB/s 不等于程序必达值

理论带宽与可实现带宽之间还隔着：

- 访问是否连续、合并；
- Cache 命中率与数据复用；
- 请求并发是否足够；
- Tensor Layout 是否合适；
- Bank/Partition 使用是否均衡；
- Kernel 中计算与访存能否重叠。

判断时应使用 Profiler 的实际 DRAM 吞吐、时间占比和 Stall 原因，而不是只看产品规格。

## 8. 增强 TMA：把复杂搬运从线程手中拿走

TMA（Tensor Memory Accelerator，张量内存加速器）用于在 Global Memory 与 Shared Memory 等层次之间异步搬运多维 Tensor Tile，并由硬件处理地址生成、边界和布局信息。

[![Rubin 中 HBM4、TMA、Shared Memory、Tensor Core 与 MoE 描述符的数据流](/images/gpu/rubin/rubin-tma-dataflow.svg)](/images/gpu/rubin/rubin-tma-dataflow.svg)

*图：增强 TMA 的教学数据流。Descriptor 是搬运元数据，不是 Tensor 数据本身。*

### 8.1 没有 TMA 时线程要做什么

简化地看，传统搬运可能让许多线程参与：

```text
计算每个元素的 Global Address
→ 执行 Load
→ 处理边界
→ 写入 Shared Memory
→ 同步
→ Tensor Core 消费 Tile
```

这会占用指令、Register 和地址计算资源。

TMA 把搬运描述为一个 Tensor 操作：

```text
软件准备 Descriptor
→ 发起异步 Tensor Copy
→ TMA 生成地址并搬运 Tile
→ 计算 Warp 执行其他工作
→ 数据到达后同步并消费
```

它的价值不是“HBM 突然变快”，而是减少搬运管理开销，并更容易形成加载下一块、计算当前块的流水线。

### 8.2 Inline Descriptor Update 为什么适合 MoE

MoE 模型拥有许多 Expert。它们的 Tensor 形状和 Layout 可能相同，但数据地址不同。若每个 Expert 都维护一个完整 TMA Descriptor，动态路由会带来元数据准备、读取和切换开销。

Rubin 支持在 TMA 指令中直接覆盖 Pointer、Stride 等字段：

```text
共享的 Layout Descriptor
├── Expert 0：运行时替换 Pointer/Stride
├── Expert 1：运行时替换 Pointer/Stride
└── Expert N：运行时替换 Pointer/Stride
```

也就是说，“如何解释这种 Tensor 布局”的公共部分可以复用，“这次去哪里取数据”的动态部分由指令更新。它特别适合 Token 每轮会路由到不同 Expert 的场景。

### 8.3 TMA 不会自动优化所有程序

框架或 Kernel 必须显式生成适合的 TMA 路径，并正确安排：

- Tile 形状；
- Shared Memory Buffer；
- Producer/Consumer 同步；
- Layout 与对齐；
- 计算和搬运重叠。

只把程序编译到 `sm_107` 不代表所有 Global Load 都会自动变成最优 TMA 流水线。

## 9. Attention 为什么还要增强指数运算

Transformer Attention 的简化形式是：

```text
Scores = Q × Kᵀ
Prob   = Softmax(Scores)
Output = Prob × V
```

Tensor Core 可以快速执行前后两个矩阵乘法，但 Softmax 包含最大值归约、减法、指数、求和和归一化。如果 GEMM 变得很快，Softmax 可能在总时间中的占比反而升高。

Rubin 相对 Blackwell 提高了每个 SM 的指数吞吐：

| 数据类型 | Rubin 相对 Blackwell 的公开提升 |
| --- | ---: |
| FP32 Exponential | 约 2 倍 |
| BF16/FP16 Exponential | 约 4 倍 |

这说明架构优化不能只盯 Tensor Core。一个 Transformer Block 的端到端速度由最慢的一组算子、同步或数据路径决定。

### 9.1 Activation Sparsity 的位置

Rubin 可以把 Attention 中间结果转换为结构化稀疏表示，保留非零值和元数据，再让后续 Softmax 与稀疏矩阵乘法处理更少数据。

这与“模型权重量化成 FP4”不是一回事：

| 技术 | 作用对象 | 主要目的 |
| --- | --- | --- |
| 权重量化 | 模型 Weight | 减少容量、带宽和 Tensor 计算成本 |
| Activation Sparsity | 运行时中间结果 | 跳过部分无效计算与搬运 |
| KV Cache 量化 | K/V 历史状态 | 降低长上下文和并发的显存压力 |

稀疏路径仍需要模型、Kernel、精度验证和实际稀疏度共同支持，不能仅凭硬件能力推断业务收益。

## 10. 更细粒度的 Producer-Consumer 协同

推理中常见如下依赖：

```text
Kernel A 产生 Activation Tile
→ 写入内存
→ Kernel B 读取 Tile 并继续计算
```

如果 B 必须等待 A 的大范围工作完成，GPU 时间线上会出现 Bubble（空洞）。Rubin 强化细粒度的数据驱动协同，使 Consumer 更早在所需 Tile 就绪后开始工作，而不是等待更粗粒度的完成条件。

这类能力优化的是：

- Kernel 之间的等待；
- Activation 经过关键路径的延迟；
- Producer 与 Consumer 的重叠；
- Token 逐步生成时的小间隙累计。

它不能消除真正的数据依赖。Consumer 仍不能读取尚未完成的数据，硬件只是让“已经就绪的局部工作”不必等待无关部分。

## 11. 四种互联逐层拆开

### 11.1 NV-HBI：封装内 Die-to-Die

NV-HBI 把两颗计算 Die 组成统一 Rubin GPU，解决的是芯片扩展和封装内部通信。它不直接表示两颗机架内 GPU 之间的带宽。

### 11.2 NVLink-C2C：Vera CPU 与 Rubin GPU

NVLink-C2C 提供最高 1.8 TB/s 的一致性 CPU-GPU 互联。Coherent（缓存一致性）意味着 CPU 与 GPU 可以在受支持的软件模型下更自然地共享和同步内存视图，减少传统离散 PCIe 设备的数据管理负担。

一致性也不等于“CPU 内存与 HBM 延迟相同”。物理位置、带宽、NUMA、页放置和访问方向仍会影响性能。

### 11.3 NVLink 6：GPU Scale-Up

每颗 Rubin GPU 通过 NVLink 6 接入 NVLink Switch Fabric，公开规格为每 GPU 3.6 TB/s 双向聚合带宽。它主要承载：

- Tensor Parallel 的 All-Reduce/Reduce-Scatter/All-Gather；
- Expert Parallel 的 All-to-All；
- Pipeline Parallel 的 Activation 传输；
- GPU P2P Load/Store 与通信融合；
- 机架内 GPU 之间的低延迟 Collective。

### 11.4 PCIe 6.0：通用 Host 与外设路径

Rubin 提供 PCIe Gen 6 x16，官方给出的最高 256 GB/s 是双向聚合值。单方向理论有效数据率约为 128 GB/s，实际还会受协议、平台拓扑、Payload 和软件影响。

PCIe 仍适合通用兼容路径、外设和管理场景；它没有因为 NVLink 出现而消失。

### 11.5 Scale-Up 与 Scale-Out 不相互替代

```text
Scale-Up：NVLink 6 / NVLink Switch
  范围：紧耦合 GPU 域
  特点：低延迟、高带宽、频繁 Collective

Scale-Out：InfiniBand / Spectrum-X Ethernet 等
  范围：服务器、机架和数据中心之间
  特点：更大规模路由与集群扩展
```

NVLink 6 不替代 InfiniBand 或 Ethernet，后者也不等价于 GPU 封装内 NV-HBI。

## 12. Counted Writes：为什么通信还要优化同步

GPU 直接通过 NVLink 向远端 GPU 写入数据时，不只有 Payload 搬运，还要告诉接收方“哪一块数据已经完成”。传统方案可能需要额外 Memory Barrier、Acknowledgement 或 Atomic Flag，频繁小通信会让同步成本变得明显。

Rubin 引入 Counted Writes（计数写入）机制：接收端可以用硬件维护的完成计数，更高效地判断对应数据是否已到达。

```text
发送 GPU
├── 写入远端 Payload
└── 更新与传输关联的完成计数
        ↓
接收 GPU 检查计数
→ 目标数据完成
→ 后续 Kernel/Tile 可以消费
```

它主要减少同步协议和等待，不意味着数据不再经过 NVLink，也不等于所有 NCCL 操作都自动获得固定比例加速。收益取决于通信粒度、频率、Kernel 融合和软件是否使用对应能力。

## 13. 从一颗 GPU 扩展到 Vera Rubin NVL72

[![Rubin GPU、Vera CPU、Compute Tray、NVLink Switch Tray、NVL72 与 Scale-Out 的层次](/images/gpu/rubin/vera-rubin-nvl72.svg)](/images/gpu/rubin/vera-rubin-nvl72.svg)

*图：Vera Rubin NVL72 教学层次图。机架内真实背板、线缆、供电和液冷布局以产品资料为准。*

Vera Rubin NVL72 的公开组成包括：

```text
18 个 Compute Tray
├── 合计 36 颗 Vera CPU
└── 合计 72 颗 Rubin GPU

9 个 NVLink Switch Tray
└── 组成 NVLink 6 全互联 Scale-Up Fabric

ConnectX-9 / BlueField-4 / Spectrum-X
└── 网络、DPU 与 Scale-Out 相关能力
```

### 13.1 3.6 TB/s 与 260 TB/s 为什么都对

| 数字 | 统计范围 | 含义 |
| ---: | --- | --- |
| 3.6 TB/s | 单颗 GPU | 每 GPU 接入 NVLink 6 Fabric 的双向聚合带宽 |
| 260 TB/s | 72 GPU 机架 | `72 × 3.6 TB/s ≈ 259.2 TB/s` 的机架聚合口径 |

260 TB/s 不能解释成“任意两张 GPU 之间单次复制达到 260 TB/s”。它是把整个 72 GPU Scale-Up 域的接口带宽汇总。

### 13.2 20.7 TB HBM4 也不是一块平坦显存

```text
72 × 288 GB = 20,736 GB ≈ 20.7 TB
```

这是机架内所有 GPU 本地 HBM 容量的总和。每块权重、KV Cache 和 Activation 仍有物理归属，框架必须通过 Tensor、Pipeline、Expert、Data Parallel 或 KV Cache 分片决定放置和通信。

“所有 GPU 可以高速互联”与“所有显存自动变成一块无差别内存”是两个概念。

### 13.3 NVL72 为什么称为一个计算域

全互联 NVLink Switch Fabric 让任意 GPU 不必依赖固定的点对点直连拓扑，可以通过交换网络访问其他 GPU。其意义是：

- 调度和并行策略不必完全受某一对 GPU 物理 Link 数限制；
- MoE All-to-All 和大规模 Tensor Parallel 获得更一致的通信路径；
- Collective 可以使用机架级互联与 In-Network Compute；
- 故障、路由和链路管理上升为机架级问题。

它仍不是一颗“拥有 72×SM 的巨型单 GPU”。CUDA 设备、进程、内存放置和 Collective 语义依然存在。

## 14. 一个大模型请求进入 Rubin 后经历什么

下面用在线推理请求串起所有组件：

```text
用户 Prompt
→ 网关与推理服务接收请求
→ Vera CPU：协议处理、Tokenize、请求调度和 Batch 组织
→ Scheduler 选择执行时机与 KV Cache Block
→ 输入与控制信息经 NVLink-C2C/运行时进入 Rubin
→ HBM4 提供权重、输入和 KV Cache
→ TMA 把 Tensor Tile 异步搬入片上存储
→ SM 调度 Warp
→ Tensor Core 执行 GEMM/Attention 主要矩阵计算
→ 其他管线执行 Softmax、归一化、索引和采样相关算子
→ 多 GPU 分片通过 NVLink 6 执行 Collective
→ 结果写回并进入下一层
→ 生成 Logits，选择下一个 Token
→ 循环 Decode，直到停止条件
→ 服务返回结果
```

### 14.1 Prefill 阶段

Prefill 一次处理 Prompt 中较多 Token，矩阵 M 维较大，通常更容易充分利用 Tensor Core。主要关注：

- GEMM/Attention Kernel 是否使用正确精度；
- HBM 与片上 Tile 搬运是否高效；
- 长上下文 Attention 的中间数据量；
- Tensor Parallel Collective 是否与计算重叠；
- TTFT 是否被队列和 Prefill 调度放大。

### 14.2 Decode 阶段

Decode 通常每个 Sequence 每步生成一个 Token，矩阵较“瘦”，且每步仍要读取大量权重和 KV Cache，因此常见限制是：

- HBM 有效带宽；
- Batch/并发不足导致权重复用差；
- KV Cache 容量、布局和访问效率；
- 小 Kernel 与 Kernel 间空洞；
- 每层 Tensor Parallel 通信；
- CPU/Runtime 每 Token 的调度成本。

Rubin 的 HBM4、K 维处理、指数吞吐、细粒度 Kernel 协同与 Counted Writes，分别瞄准了这条链上的不同等待点。

### 14.3 MoE 阶段

MoE 还会多出：

```text
Router 计算 Top-K Expert
→ Token 按 Expert 重排
→ All-to-All Dispatch
→ 各 GPU 读取对应 Expert Weight
→ Expert GEMM
→ All-to-All Combine
→ 恢复 Token 顺序
```

增强 TMA 降低 Expert Tensor 描述和搬运开销；NVLink 6 承载机架内 Token Dispatch/Combine；更大的 HBM4 容量可驻留更多 Expert 权重。三者是协同关系，不是同一种优化。

## 15. Compute Capability 10.7 与 `sm_107`

Rubin 的 CUDA Compute Capability 为 10.7。Compute Capability 是 GPU 硬件 ISA 和能力版本，不是 CUDA Toolkit 版本。

```text
Compute Capability 10.7  → Rubin 硬件能力
sm_107                   → 为 Rubin 生成的 GPU 机器代码目标
CUDA 13.4                → 提供 Rubin Developer Preview 的 Toolkit 版本
Driver                    → 宿主机内核态驱动和兼容边界
Framework/Wheel           → PyTorch、算子库等是否包含目标代码
```

截至本文写作时，CUDA 13.4 对 Vera Rubin 的支持属于 **Developer Preview**。NVIDIA 的发布说明明确指出，这一预览支持不用于 Benchmark、Performance Analysis 或 Production Deployment。因此下面的命令用于理解兼容链和准备验证方法，不应把预览结果当作正式生产基线。

### 15.1 三类编译目标

CUDA 编译文档会区分基础、家族和架构专属目标。以 Rubin 相关目标为例：

| 目标 | 含义 | 兼容性思路 |
| --- | --- | --- |
| `sm_107` | Rubin 的普通机器代码目标 | 为 10.7 设备生成 Cubin |
| `sm_107f` | Family-Specific | 面向同一架构家族的特性边界 |
| `sm_107a` | Architecture-Specific | 使用 10.7 独有能力，只保证目标架构 |

`a` 目标可能使用 Rubin 独有指令，性能潜力更高，但不能假设它向其他 10.x GPU 通用。`f` 与 `a` 的实际选择应按 CUDA 编译器文档和所用库的发布说明决定。

### 15.2 为什么“驱动能识别”还不够

Rubin 上运行一个框架至少要同时满足：

```text
GPU 固件与宿主机驱动支持
∩ CUDA Runtime/Toolkit 支持
∩ PyTorch 或其他框架支持
∩ cuBLAS/cuDNN/NCCL/TensorRT 等库支持
∩ 自定义 Kernel 含 sm_107 Cubin 或可 JIT 的 PTX
∩ 容器与宿主机驱动 ABI 兼容
```

缺少任意一层都可能出现“设备可见但算子运行失败”“回退到较慢 Kernel”或“启动时 No Kernel Image”。

### 15.3 上机后怎样检查

查看硬件名称和 Compute Capability：

```bash
nvidia-smi --query-gpu=index,name,compute_cap,memory.total --format=csv
```

查看当前 CUDA 编译器认识的 GPU 目标：

```bash
nvcc --list-gpu-arch
nvcc --list-gpu-code
```

检查二进制中携带哪些 GPU 代码：

```bash
cuobjdump --list-elf ./your_binary
cuobjdump --dump-ptx ./your_binary
```

在 PyTorch 中检查：

```python
import torch

print(torch.__version__)
print(torch.version.cuda)
print(torch.cuda.get_device_name(0))
print(torch.cuda.get_device_capability(0))
print(torch.cuda.get_arch_list())
```

期望看到的核心关系是：设备能力包含 `(10, 7)`，框架的架构列表或可 JIT PTX 能覆盖 Rubin。命令具体输出随硬件和软件版本变化，不应照抄示例作为兼容性证明。

## 16. 从指标判断瓶颈在哪一层

| 观察现象 | 更可能的方向 | 下一步证据 |
| --- | --- | --- |
| HBM 已占用很多，GPU Util 很低 | 权重已加载但请求少、排队或 CPU 侧有空洞 | 请求率、Batch、GPU Timeline、CPU Profile |
| GPU Util 高，Tensor 吞吐低，HBM 吞吐高 | Decode/访存限制 | DRAM Throughput、Arithmetic Intensity、Batch |
| Tensor Core 高但端到端延迟仍高 | 通信、排队或非矩阵算子 | NCCL 时间、Queue Time、Softmax/Norm 占比 |
| NVLink 吞吐长期接近上限 | TP/EP 通信限制 | Collective 分解、消息尺寸、Overlap |
| GPU Kernel 之间有周期性空洞 | Host Launch、同步或依赖粒度 | CPU-GPU Timeline、Graph、Producer/Consumer |
| 单卡快，多卡扩展效率差 | 并行切分或 Collective 限制 | TP=1 对照、每层通信量、NVLink 拓扑 |
| 长上下文 TTFT 突增 | Prefill Attention、KV 分配或排队 | Prompt 长度分桶、Prefill Profile、Cache 命中 |
| 并发增加后 TPOT 急剧恶化 | HBM、KV Cache 或调度竞争 | HBM 吞吐、KV 使用、Batch/Sequence 变化 |

### 16.1 不要只看 `nvidia-smi` 的 GPU Util

GPU Util 往往表示采样窗口中是否有 Kernel 活跃，不等于 Tensor Core 占用，也不能说明 HBM、NVLink 或每个 SM 的效率。完整证据至少需要：

```text
服务层：QPS、TTFT、TPOT、排队、Batch、Prompt/Output 长度
框架层：KV Cache、Scheduler、Prefill/Decode 时间、并行策略
Kernel 层：算子时间、占用率、Stall、Tensor/FP/Load-Store 路径
显存层：容量、实际 HBM 吞吐、Cache 命中与访问效率
互联层：NVLink/NCCL 吞吐、Collective 时间与错误
主机层：CPU、内存、NUMA、Tokenize 和 Runtime Launch
```

### 16.2 一个实用对照实验顺序

```text
单请求、单 GPU
→ 固定输入长度，增加并发
→ 固定并发，增加上下文
→ TP=1 与 TP>1 对照
→ BF16 与目标低精度对照
→ 逐层拆出 Queue、Prefill、Decode、Collective
```

每次只改变一个主要变量，才能把收益或回退归因到对应组件。

## 17. 部署 Rubin 时真正要检查什么

### 17.1 软件兼容矩阵

建立并固定以下版本：

| 层级 | 必须记录的内容 |
| --- | --- |
| 固件/BMC | GPU、NVLink Switch、NIC/DPU、主板固件 |
| Driver | 精确版本与支持分支 |
| CUDA | Runtime、Toolkit、Compatibility Package |
| 通信库 | NCCL、网络插件及其拓扑配置 |
| 框架 | PyTorch、TensorRT-LLM、vLLM 等版本 |
| Kernel | FlashAttention、Triton、自定义扩展的 `sm_107` 支持 |
| 容器 | Base Image、用户态库、挂载的 Host Driver |

不要用“CUDA 大版本一样”替代完整矩阵。

### 17.2 供电和液冷

NVL72 是机架级设备，GPU 性能与数据中心供电、液冷、进出水温、流量、压差和机架功率管理直接相关。功耗或温度约束会改变频率，最终表现为：

```text
理论规格没有变化
但实际 Clock 降低
→ Kernel 时间变长
→ Collective 等待最慢 Rank
→ 整个分布式任务变慢
```

因此基础设施指标必须和 GPU/应用指标使用同一时间轴。

### 17.3 NVLink Fabric 健康

需要确认：

- 所有 GPU 和 NVLink Switch 是否被 Fabric Manager/系统软件正确纳管；
- Link 是否处于期望速率与宽度；
- 是否存在 Link Replay、CRC、降级或路由重构；
- Collective 性能是否符合基线；
- 单 Tray 维护或故障是否触发预期的隔离和重路由。

不要因为 72 张卡都能被 `nvidia-smi` 枚举，就认为 Scale-Up Fabric 一定健康。

### 17.4 容量规划必须同时算四本账

```text
HBM 容量：权重 + KV Cache + Activation + Workspace
HBM 带宽：每 Token 权重/KV 搬运量 ÷ 目标 TPOT
互联带宽：每层 Collective 数据量 × 层数 × 并发
功率与散热：稳定频率所需的机架电力和冷却余量
```

只算“模型能不能装下”只能完成容量规划的一小部分。

## 18. 常见误区

### 18.1 Rubin 有两个 Die，所以是两张 GPU

错误。两个计算 Die 通过 NV-HBI 在同一封装中组成一颗逻辑 GPU，不是需要应用按双设备管理的两张卡。

### 18.2 288 GB × 72 就得到一块 20.7 TB 统一显存

错误。这是所有 GPU 本地 HBM 的容量总和。数据仍有归属，跨 GPU 访问仍消耗 NVLink 带宽和协议开销。

### 18.3 把 22 TB/s 理解为模型存储读取速度

错误。这是 GPU 芯片与本地 HBM4 之间的带宽，不是 NVMe、NFS 或对象存储带宽。

### 18.4 3.6 TB/s 和 260 TB/s 矛盾

不矛盾。前者是单 GPU 的 NVLink 6 双向聚合带宽，后者是 72 GPU 机架的聚合带宽。

### 18.5 NVLink 6 可以替代集群 Ethernet/InfiniBand

错误。NVLink 6 解决紧耦合 Scale-Up，跨服务器和跨机架 Scale-Out 仍需要数据中心网络。

### 18.6 把 50 PFLOPS 当作 BF16 模型的固定性能

错误。这个数字对应 NVFP4 的特定峰值口径。BF16、FP8 和端到端模型都有不同上限。

### 18.7 TMA 会自动优化所有 CUDA 程序

错误。Kernel、编译器或算子库必须生成对应的数据搬运与流水线，Tile、同步和 Layout 仍需设计。

### 18.8 CUDA 13.4 能识别 Rubin，所有框架就都能运行

错误。Toolkit 只是兼容链的一层。Driver、框架 Wheel、算子库、自定义扩展和容器必须共同支持 `sm_107` 或可兼容 PTX。

### 18.9 GPU Util 低表示 Rubin 算力不够

错误。GPU 可能在等待请求、CPU、HBM、Collective 或同步；也可能 Kernel 很短而采样没有捕获。必须结合服务和 Timeline 判断。

## 19. 课后练习

1. Rubin、Vera Rubin 和 Vera Rubin NVL72 有什么区别？
2. 为什么两个计算 Die 不等于两张 GPU？
3. NV-HBI、NVLink-C2C、NVLink 6 和 PCIe 6.0 分别连接什么？
4. 896 个 Tensor Core 与 224 个 SM 可以得到什么关系？
5. 288 GB HBM4 与 22 TB/s 分别决定什么能力？
6. 为什么 Decode 比 Prefill 更容易受显存带宽限制？
7. TMA 为什么能减少普通线程参与地址生成和数据搬运的开销？
8. Inline Descriptor Update 为什么适合 MoE Expert？
9. Tensor Core 已经更快，为什么 Rubin 还要增强指数运算？
10. Counted Writes 优化的是 Payload 带宽还是同步路径？
11. 3.6 TB/s 与 260 TB/s 为什么不能直接比较？
12. 20.7 TB 机架 HBM 为什么不是一块平坦显存？
13. Compute Capability 10.7 与 CUDA 13.4 有什么区别？
14. 为什么一个 Blackwell 容器镜像不能未经验证就用于 Rubin？
15. GPU Util 低、HBM 吞吐高时，应该优先怀疑什么？
16. TP=1 正常而 TP=8 扩展效率很差，应该怎样建立证据链？

### 19.1 参考答案

1. Rubin 是 GPU；Vera Rubin 是 CPU、GPU、互联和软件的协同平台；NVL72 是由 36 颗 Vera CPU、72 颗 Rubin GPU 与 NVLink Switch Fabric 组成的机架级系统。
2. 两个 Die 在同一封装内由 NV-HBI 连接，并由硬件与软件呈现为统一 GPU 设备；两张 GPU 则有独立设备和跨设备通信语义。
3. NV-HBI 连接封装内两个计算 Die；NVLink-C2C 连接 Vera CPU 与 Rubin GPU；NVLink 6 连接 GPU 与机架内 NVLink Switch Fabric；PCIe 6.0 提供通用 Host/外设连接。
4. 每个 SM 配置 4 个 Tensor Core，但这不能直接换算为应用吞吐，因为还受精度、形状、数据与通信限制。
5. 288 GB 是容量，决定权重、KV Cache 等能放下多少；22 TB/s 是 HBM 带宽，决定芯片与本地显存之间搬运数据的理论速率。
6. Prefill 一次处理更多 Token，矩阵较大，数据能在较多计算中复用；Decode 每步 Token 少，却要反复读取权重和 KV Cache，算术强度更低。
7. TMA 用 Descriptor 描述多维 Tile，并由硬件执行地址生成、边界处理和异步搬运，使计算 Warp 更专注于计算并形成流水线。
8. 多个 Expert 可能共享形状和 Layout 但地址不同；同一 Descriptor 可复用公共布局，只在指令中替换 Pointer/Stride。
9. Attention 的 Softmax 需要指数和归约。矩阵乘法加速后，非矩阵部分会成为新的关键路径。
10. 它主要简化 GPU 发起的 NVLink 传输完成通知与同步；Payload 仍通过 NVLink 搬运。
11. 3.6 TB/s 是每 GPU 双向聚合接口带宽，260 TB/s 是 72 个 GPU 的机架聚合值；后者不是单个 GPU Pair 的带宽。
12. 每颗 GPU 的 HBM 仍是本地物理内存。框架需要分片和通信，远端数据访问仍有链路成本。
13. 10.7 是 Rubin 的硬件能力版本；13.4 是 CUDA Toolkit 软件版本，并提供 Rubin 的功能预览支持。
14. 镜像中的框架、库和自定义 Kernel 可能只携带 Blackwell Cubin，缺少 `sm_107` 或 Rubin 所需软件版本，也可能走不正确的兼容路径。
15. 优先判断 Decode 或其他 Kernel 是否 Memory-Bound，再检查实际 DRAM 吞吐、算术强度、Cache、Batch 和 KV 访问，而不是仅看计算峰值。
16. 固定请求和输入，比较 TP=1/2/4/8 的计算时间与 Collective 时间；结合 NVLink 拓扑、NCCL 日志、链路计数器和 Timeline 判断通信量、等待与重叠。

## 20. 本篇总结

Rubin 的核心变化可以压缩为五条协同路径：

```text
封装：双 Compute Die ← NV-HBI → 一颗逻辑 GPU
计算：224 SM + 896 Tensor Core + 第三代 Transformer Engine
存储：288 GB HBM4 + 22 TB/s + 增强 TMA
互联：NVLink-C2C 连接 CPU，NVLink 6 连接 Scale-Up GPU 域
系统：72 GPU 通过 NVLink Switch Fabric 组成 NVL72
```

真正的架构理解不是背参数，而是能把现象放回数据路径：

```text
算得慢       → 精度、矩阵形状、Tensor Core、Kernel
取数慢       → HBM、Cache、TMA、Layout
多卡慢       → 并行切分、NVLink、Collective、同步
请求有空洞   → CPU、Scheduler、Kernel Launch、依赖
机架不稳定   → 供电、液冷、固件、Fabric 与 RAS
```

Rubin 把 GPU 设计继续从“单颗芯片峰值”推进到“封装、CPU、GPU、显存、交换网络和机架共同完成一次模型执行”。这也是阅读后续 NVIDIA 架构时最重要的系统视角。

## 21. 继续学习

- [NVIDIA 主流 GPU 架构解剖：以 P100 为起点读懂 Pascal 到 Blackwell](./03-Tesla-P100与GP100架构解剖.md)
- [GPU 基础知识：从计算核心到显存](./01-GPU基础知识：从计算核心到显存.md)
- [HBM 显存原理：容量、带宽与访问效率](../memory/01-HBM显存原理：容量、带宽与访问效率.md)
- [CUDA 执行模型与 Kernel 性能基础](../cuda/01-CUDA执行模型与Kernel性能基础.md)
- [NVLink 与 NVSwitch 原理](../nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
- [GPU 服务器硬件拓扑与 NUMA](../pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)
- [大模型推理服务性能指标设计](../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)

## 22. 参考资料

- [Inside NVIDIA Rubin GPU Architecture](https://developer.nvidia.com/blog/inside-nvidia-rubin-gpu-architecture-powering-the-era-of-agentic-ai/)
- [Inside the NVIDIA Vera Rubin Platform](https://developer.nvidia.com/blog/inside-the-nvidia-vera-rubin-platform-six-new-chips-one-ai-supercomputer/)
- [NVIDIA NVLink: The Scale-Up Network for AI Factories](https://developer.nvidia.com/blog/nvidia-nvlink-the-scale-up-network-for-ai-factories/)
- [NVIDIA Vera Rubin Platform](https://www.nvidia.com/en-us/data-center/vera-rubin/)
- [CUDA Programming Guide — Compute Capabilities](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/compute-capabilities.html)
- [NVCC Compiler Options — GPU Architecture Targets](https://docs.nvidia.com/cuda/cuda-compiler-driver-nvcc/)
- [CUDA Toolkit 13.4 Release Notes](https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/)

本文中的结构图依据 NVIDIA 公开架构资料重新绘制，用于说明逻辑组件、层次和数据流，不是 NVIDIA 官方芯片 Floorplan、PCB 布局或机架布线图。
