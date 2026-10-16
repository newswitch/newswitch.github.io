---
title: "Ascend 910B AI Core、Cube、Vector、UB 与 HBM 执行路径"
sidebar_label: "03. 910B AI Core 与片上存储"
sidebar_position: 3
description: "以 Atlas 800I A2 与 Ascend 910B 环境为背景，从 CANN 公开的 AI Core 抽象架构解释 Cube、Vector、Scalar、MTE、L0/L1/UB、Global Memory 与 HBM 的协作关系。"
tags: [Ascend 910B, AI Core, Cube, Vector, Scalar, Unified Buffer, HBM, CANN, Ascend C]
---

# Ascend 910B AI Core、Cube、Vector、UB 与 HBM 执行路径

“NPU 利用率低”不能直接归因于算力不足。一次算子执行要经过 Host、CANN Runtime、Stream/Task、片外 HBM、片上 Buffer、DMA 搬运与不同计算单元；任何一层供给不足、同步过多或算子路径不合适，都可能让 AI Core 等待。

本文使用 CANN/Ascend C 公开的抽象硬件架构解释执行原理，不给未公开的芯片内部规格补数字。AI Core 数量、Buffer 容量、AIC/AIV 组织和支持指令会随具体 Ascend 产品与架构版本变化，应以目标 910B 服务器、CANN 版本和 `get_soc_spec` 等能力查询结果为准。

## 1. 先分清五个层次

| 层次 | 示例 | 主要职责 |
| --- | --- | --- |
| 服务器 | Atlas 800I A2 | CPU、内存、NPU、网卡、磁盘、供电与散热 |
| 加速器 | Ascend 910B | AI 计算、HBM、设备互联与 I/O |
| 计算核心 | AI Core/AIC/AIV | 执行矩阵、向量、标量和搬运指令 |
| 软件栈 | Driver/Firmware、CANN | 设备管理、Runtime、图、算子与通信 |
| 框架 | torch-npu、vLLM-Ascend、MindIE | 模型表达、调度、服务和请求生命周期 |

Atlas 800I A2 不是一颗芯片，CANN 也不是 NPU。看到错误时必须先确认它属于整机、设备、运行时、算子还是框架。

## 2. 一次算子怎样到达 AI Core

```text
Python / vLLM-Ascend / PyTorch
→ torch-npu
→ CANN Graph / Runtime / Operator Library
→ Stream
→ Task Queue
→ Device Runtime / Firmware
→ AI Core Kernel
→ Cube / Vector / Scalar / DMA Pipeline
→ HBM 与片上 Buffer
```

Host CPU 负责 Python、请求解析、调度、图构建和 Runtime 调用。NPU 负责执行已下发的设备任务。因为下发与执行通常异步，真正的设备错误可能在后续同步、取结果或另一个 API 上才暴露。

## 3. AI Core 的抽象组成

CANN 公开文档把 AI Core 抽象为三类组件：

```text
AI Core
├── Control / Scalar
│   ├── 地址计算
│   ├── 循环与分支
│   └── 指令发射与同步
├── Compute
│   ├── Cube：矩阵/张量密集计算
│   └── Vector：元素级、归一化、激活、重排等
├── Local Storage
│   ├── L1 Buffer
│   ├── L0A / L0B / L0C
│   ├── Unified Buffer（UB）
│   └── 其他产品相关 Buffer/Register
└── Data Movement
    ├── MTE / DMA
    └── BIU / 总线接口
```

这是一套面向算子开发的软件可见抽象，不等同于芯片版图，也不能据此推导未公开的 Core 数量和内部带宽。

## 4. Scalar、Cube 与 Vector 分别做什么

### 4.1 Scalar

Scalar 单元更接近控制中心，负责：

- 地址和 Offset 计算；
- 循环、条件和边界处理；
- 向 Cube、Vector、MTE 发射指令；
- 队列同步与流水协调；
- 少量标量计算。

Scalar 很忙时，Cube/Vector 可能因为指令发射、复杂控制流或切分不合理而等待。它不是用于替代 Host CPU 的通用处理器。

### 4.2 Cube

Cube 面向矩阵乘加等规则、计算密集操作。大模型中的典型关联包括：

- Linear/GEMM；
- Attention 中的矩阵乘；
- MLP/FFN 中的矩阵计算；
- 卷积和其他可映射到矩阵计算的算子。

Cube 计算通常需要数据进入 L1、L0A/L0B，结果或累加值进入 L0C。只拥有高峰值 Cube 算力，没有合适的 Tiling、布局和数据供给，仍无法达到高利用率。

### 4.3 Vector

Vector 面向更灵活的 SIMD 运算，例如：

- Activation；
- RMSNorm/LayerNorm 的部分步骤；
- Softmax 的部分步骤；
- Element-wise Add/Multiply；
- 类型转换、数据重排和后处理。

Vector 操作的输入、临时值与输出通常围绕 Unified Buffer 组织。矩阵算得快但 Vector、重排或同步跟不上，端到端算子仍会受限。

## 5. AIC、AIV 和 AI Core 名称为什么容易混淆

不同架构版本可能采用 Cube 与 Vector 耦合或分离的组织方式。公开的 Ascend C 文档中可见：

- AIC/Cube Core：以 Cube 路径为核心；
- AIV/Vector Core：以 Vector 路径为核心；
- 每类 Core 可能拥有自己的 Scalar 与搬运能力；
- 混合算子可以组织 Cube 与 Vector 协同。

不要把其他架构版本的 Core 比例、寄存器或指令能力直接套到 910B。文章、日志和 Profiler 中出现 `AIC`、`AIV`、`AI Core` 时，要结合目标 SoC 与 CANN 文档解释。

## 6. Global Memory、HBM 与 Local Memory

### 6.1 Global Memory 是软件地址空间概念

Ascend C 中的 Global Memory（GM）描述设备侧可访问的全局内存空间。在 910B 数据中心设备上，模型权重、KV Cache、Activation 和工作区通常主要落在设备 HBM 中。

```text
HBM：物理存储介质/设备显存
Global Memory：算子编程中看到的全局内存层次
```

二者经常对应，但不是同一个抽象层的词。

### 6.2 Local Memory 是片上可编程存储总称

Local Memory 包含 L1、L0、UB 等片上 Buffer。它容量远小于 HBM，但延迟更低、带宽更高，需要算子通过 Tiling 和搬运管理。

```text
HBM / Global Memory
→ 切分 Tile
→ DMA/MTE 搬入片上 Buffer
→ Cube/Vector 计算
→ 结果搬回 Global Memory
```

这与 GPU 中“从 HBM 搬入 Shared Memory/Register 再计算”的思想相似，但组件名称、编程模型和硬件实现不能一一等同。

## 7. L1、L0 与 UB 的分工

| 存储层 | 典型用途 | 主要服务对象 |
| --- | --- | --- |
| L1 Buffer | 较大的片上数据中转与复用 | Cube/Tiling 数据 |
| L0A/L0B | Cube 输入操作数 | Cube |
| L0C | Cube 输出和累加中间值 | Cube |
| Unified Buffer | Vector 输入、输出和临时变量 | Vector/Scalar |
| Global Memory | 权重、Activation、KV Cache、工作区 | 整个设备 |

具体映射会随产品变化。例如同一个 Ascend C `TPosition` 在不同产品上可能映射到不同物理 Buffer。因此阅读算子源码时，先确认目标 SoC 版本，而不是只背名称。

## 8. MTE/DMA 为什么决定算力能否被喂饱

计算单元不能直接对任意 HBM 数据高效执行。常见流水是：

```text
CopyIn：GM/HBM → Local Buffer
Compute：Cube/Vector 执行
CopyOut：Local Buffer → GM/HBM
```

MTE/搬运单元负责不同存储层之间的数据搬运，并可能进行布局或类型转换。理想状态下：

```text
Tile N 在计算
同时 Tile N+1 在搬入
同时 Tile N-1 在搬出
```

如果算子没有形成流水重叠，就会出现：

- Cube/Vector 等待输入；
- 搬运单元等待 Buffer；
- 同步事件过多；
- HBM 带宽没有转化为计算吞吐。

## 9. Tiling 解决什么问题

模型 Tensor 通常大于 L0/L1/UB，必须切成 Tile：

```text
大 Tensor
→ 按形状、数据类型和硬件容量切分
→ 分配每个 Core 的工作
→ 安排 CopyIn / Compute / CopyOut
→ 合并结果
```

Tiling 决定：

- 每次搬多少数据；
- Local Buffer 是否装得下；
- Cube/Vector 能否连续工作；
- 是否产生大量尾块和边界处理；
- 多 Core 负载是否均衡；
- HBM 访问是否连续、对齐并可合并。

模型 Shape、Batch、Sequence Length 改变后，原来合适的 Tiling 可能不再合适，这也是动态 Shape 性能不稳定的原因之一。

## 10. 以 Linear + Activation 为例

一个简化融合路径可能是：

```text
输入与权重位于 HBM
→ MTE 将 Tile 搬入 L1/L0A/L0B
→ Cube 执行矩阵乘
→ 结果进入 L0C
→ 搬运/转换到 UB
→ Vector 执行 Bias、Activation 或量化处理
→ MTE 搬回 HBM
```

如果没有融合，可能变成：

```text
Cube 结果写回 HBM
→ 下一个 Vector Kernel 再从 HBM 读出
→ Vector 结果再次写回 HBM
```

融合减少 Kernel Launch、中间 Tensor 和 HBM 往返，但也可能增加片上存储压力、编译复杂度和 Shape 限制。不是算子越大越好。

## 11. Attention 为什么同时使用多种资源

Attention 不是一个单独的矩阵乘：

```text
Q/K/V Projection       → Cube 为主
QKᵀ                    → Cube 为主
Mask / Scale / Softmax → Vector、搬运与同步
Probability × V        → Cube 为主
KV Cache 读写          → HBM/Cache/搬运
输出整理               → Vector/搬运
```

Decode 阶段 Batch、Sequence Length、KV Layout 和单步 Token 数改变后，瓶颈可能从 Cube 转向 HBM、Vector、同步或调度。只看 `AICore Usage Rate` 无法判断是哪一段慢。

## 12. AI CPU 与 AI Core 不是一回事

AI CPU 是设备软件栈中用于处理部分控制或 CPU 类型算子的执行资源；AI Core 是矩阵/向量 AI 计算核心。算子因不支持而落到 AI CPU 路径时，可能出现：

- 性能显著下降；
- Host/Device 同步增加；
- 图被切分；
- 日志出现不支持算子或回退信息。

但不能看到 AI CPU 日志就认定发生回退，必须结合算子图、Profiler 和目标 CANN 版本确认。

## 13. Stream、Task 与异步执行

Host 通常向 Stream 提交 Task：

```text
Host Thread
→ Runtime API
→ Stream Queue
→ Kernel/Memcpy/Event Task
→ Device 执行
```

异步带来两个重要现象：

1. Python 调用返回不表示设备任务已经完成；
2. 第一个错误可能在后续同步点才被观察到。

排障应保留最早的设备日志、Task/Stream、Rank 和时间线，不能只看最后一条 Python Stack。

## 14. HCCS、PCIe、RoCE 与 HCCL 的层次

```text
HCCL：集合通信库/通信语义
├── 机内设备互联：可能使用 HCCS 等平台路径
├── Host/Device 与控制路径：涉及 PCIe/平台 I/O
└── 跨机通信：涉及 HCA、RoCE 与交换 Fabric
```

HCCL 是软件通信层，不等于 HCCS。Tensor Parallel 慢 Rank 可能来自：

- 某个 AI Core 执行慢；
- HBM/搬运慢；
- 机内 HCCS Link；
- PCIe/Host 路径；
- 跨机 RoCE；
- Rank/Device/NUMA 映射错误。

必须先确认通信发生在机内还是跨机，再决定查看哪种链路。

## 15. 三个容易误读的利用率

### 15.1 HBM/Memory Usage

这是容量占用：权重、KV Cache、Activation、Workspace 等用了多少 HBM。它不表示 HBM 正在高速传输。

### 15.2 Memory Bandwidth Usage Rate

这是采样窗口内 HBM 带宽忙碌程度的近似指标。它更接近“道路流量”，但仍要结合算子阶段、采样窗口和工具口径。

### 15.3 AI Core Usage Rate

它反映 AI Core 在采样窗口内的忙碌程度，不等于模型达到了峰值 FLOPS。忙碌期间也可能：

- 只使用 Vector，没有充分使用 Cube；
- 小 Shape 导致并行度不足；
- 精度/算子没有走最佳 Kernel；
- Core 间负载不均衡；
- 频率或功耗受限。

因此可能同时看到：

```text
HBM 容量占用 90%
Memory Bandwidth Usage 10%
AI Core Usage 5%
```

合理解释是模型权重和缓存已经驻留 HBM，但当前请求少，计算与带宽都不忙；不能说“90% 显存占用导致计算繁忙”。

## 16. 从指标组合判断瓶颈

| AI Core | Memory BW | Host/Queue | 更可能的方向 |
| ---: | ---: | --- | --- |
| 高 | 低/中 | 正常 | Compute Bound 或高效复用 |
| 低 | 高 | 正常 | HBM/数据搬运/低算术强度 |
| 低 | 低 | 请求队列为空 | 当前负载不足 |
| 低 | 低 | 请求排队、Host CPU 高 | Tokenizer、调度、Runtime 或同步 |
| 各 Rank 不一致 | 各 Rank 不一致 | Collective 等待 | 慢 Rank、Shape、链路或映射 |
| 周期性下降 | 波动 | Batch/Graph 变化 | 动态 Shape、编译、同步或调度 |

这张表用于缩小范围，不是自动根因判定。

## 17. 一次 vLLM-Ascend Decode 的简化路径

```text
API 请求
→ vLLM Scheduler 选择 Running Sequence
→ NPUModelRunner 准备 Input/Metadata
→ torch-npu/CANN 提交 Task
→ AI Core 读取权重与 KV Cache
→ Cube/Vector/MTE 协同执行
→ Logits/采样相关结果
→ Host 侧 Detokenize 与流式返回
```

GPU/NPU 通用的是请求、调度、KV Cache 语义和 API；不同的是执行层的 Worker、Graph、Attention/Kernel、通信和设备错误模型。

## 18. 现场观察顺序

### 18.1 确认完整版本和设备映射

```bash
npu-smi info
python3 -c "import torch, torch_npu; print(torch.__version__); print(torch_npu.__version__)"
```

记录：

- Atlas/Ascend 型号；
- Driver、Firmware、CANN、torch-npu；
- 容器逻辑 Device 与物理 NPU；
- Rank 与 Device；
- NUMA、HCCS 和 HCA 拓扑。

### 18.2 先看容量，再看活动

```text
HBM Usage：能否装下、是否泄漏或接近 OOM
Memory BW：当前是否大量访存
AI Core：当前是否执行设备计算
Host CPU：是否有前处理/调度瓶颈
HCCL：是否等待 Collective
```

### 18.3 用 Profiler 进入算子时间线

重点寻找：

- Kernel 之间的空洞；
- 大量 Memcpy/同步；
- Cube/Vector 比例异常；
- 单个长尾算子；
- 动态 Shape 重编译；
- Rank 之间时间不一致。

## 19. 常见误区

### 19.1 NPU 就是换了名字的 GPU

错误。两者都适合并行 AI 计算，但执行单元、存储层次、编程模型、图模式、算子库和通信栈不同。

### 19.2 UB 等于 GPU Shared Memory

只能做帮助理解的类比，不能一一等同。可见范围、指令、容量、编译器管理和数据路径都不同。

### 19.3 HBM 占用高就是 Memory Util 高

错误。容量占用和带宽利用率是两个指标。

### 19.4 AI Core 100% 就达到峰值算力

错误。忙碌不表示每个周期都执行最佳精度的 Cube 计算，也不表示端到端服务没有排队和通信瓶颈。

### 19.5 其他 Ascend 产品的 Buffer 映射可以直接套到 910B

错误。应按目标产品、NPU 架构版本和 CANN 文档确认 `TPosition` 与物理存储映射。

## 20. 练习与答案

**问题：为什么 Cube 峰值很高，Decode 阶段仍可能主要受内存限制？**

答案：Decode 每步计算量较小，却要反复读取权重和不断增长的 KV Cache；低 Batch 或小 Shape 也可能无法形成足够矩阵并行，因此瓶颈会转向 HBM、搬运、Vector、同步或调度。

**问题：Global Memory 与 HBM 是同一个概念吗？**

答案：不是同一抽象层。HBM 是物理设备存储；Global Memory 是 Ascend C/算子编程中的全局地址空间。在 910B 场景中它们经常对应，但不能把术语完全互换。

**问题：看到 Python 报错的位置，能否认定那里就是首个失败算子？**

答案：不能。设备异步执行可能让错误延迟到后续同步点暴露，应结合最早 CANN/Device 日志、Stream/Task、Profiler 和同步复现定位首错。

**问题：Memory Usage 90%、Memory Bandwidth 10%、AI Core 5% 通常说明什么？**

答案：大量权重或缓存已驻留 HBM，但采样窗口内请求较少，设备计算和显存总线都不忙。还需结合请求队列、TTFT、吞吐和 Host 指标判断是空闲还是上游供给不足。

## 21. 参考资料

- [昇腾 CANN 9.1：AI Core SIMD 编程模型概述](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/910/programug/Ascendcopdevg/docs/guide/%E5%85%A5%E9%97%A8%E6%95%99%E7%A8%8B/Ascend-C%E6%A6%82%E8%BF%B0%E4%B8%8E%E5%AD%A6%E4%B9%A0%E8%B7%AF%E5%BE%84.md)
- [昇腾 CANN：AI Core Compute Units](https://www.hiascend.com/document/detail/en/canncommercial/800/opdevg/Ascendcopdevg/atlas_ascendc_10_0009.html)
- [昇腾 CANN：Ascend C TPosition 与物理存储映射](https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/83RC1alpha003/API/ascendcopapi/atlasascendc_api_07_0004.html)
- [昇腾 CANN：Scalar Unit 访问存储](https://www.hiascend.com/doc_center/source/en/CANNCommunityEdition/850/opdevg/Ascendcopdevg/atlas_ascendc_10_00031.html)
