---
title: "GPU、NPU、FPGA、ASIC 与 DPU 加速器分类和边界"
sidebar_label: "04. 加速器类型与边界"
sidebar_position: 4
description: "从执行模型、内存、互联和软件栈比较 GPU、NPU、AI ASIC、FPGA、DPU 与 CPU，建立服务器加速器选型地图。"
tags: [GPU, NPU, FPGA, ASIC, DPU, 加速器]
---

# GPU、NPU、FPGA、ASIC 与 DPU 加速器分类和边界

加速器的本质是用专门的数据路径、并行结构或固定功能单元，以通用性换取吞吐、延迟或能效。GPU、NPU、FPGA、ASIC 和 DPU 不是简单的性能等级，它们解决的问题和编程方式不同。

## 1. CPU 为什么仍然是中心

CPU 擅长：

- 复杂分支和控制流；
- 操作系统、调度和中断；
- 串行或低并行任务；
- 多种数据结构和动态工作负载；
- 驱动加速器并处理异常路径。

典型异构系统：

```text
CPU：控制、调度、I/O、前后处理
GPU/NPU：矩阵、向量、Attention 等批量计算
DPU：网络、存储、安全和虚拟化数据面
FPGA/ASIC：特定低延迟或高能效流水线
```

加速器通常不会让 CPU 消失，而是改变 CPU 负责的工作比例。

## 2. GPU

GPU 使用大量并行执行单元处理相同或相似指令的数据集合，适合：

- 矩阵乘法和深度学习；
- 图形渲染；
- 科学计算；
- 数据并行处理。

典型组件：

```text
Command Processor / Scheduler
→ SM / Compute Unit × N
→ Warp/Wavefront 执行
→ Register / Shared Memory / Cache
→ HBM/GDDR
```

GPU 可编程性高、软件生态成熟，但分支发散、小批量和频繁 Host-Device 搬运可能降低效率。

## 3. NPU

NPU 是面向神经网络/张量计算的统称，不是一个统一 ISA。常见结构包括：

- Matrix/Cube/Tensor Engine；
- Vector Engine；
- 片上 SRAM/Buffer；
- DMA/Data Movement Engine；
- HBM 或设备内存；
- 专用 Collective/互联。

不同厂商 NPU 的算子、图编译器、Runtime、通信库和调试工具差异很大。即使都支持 PyTorch，上层算子最终仍要适配目标硬件 Kernel。

## 4. AI ASIC

ASIC 是为特定应用设计的专用集成电路。AI ASIC 可能针对训练、推理、推荐或边缘场景设计：

```text
更固定的数据流和算子集合
→ 更高能效/密度
→ 较低的非目标工作负载灵活性
```

“NPU”和“AI ASIC”可能重叠：许多 NPU 本质上就是 AI 专用 ASIC。分类时应描述实际架构，不必强行追求唯一名称。

## 5. TPU

TPU 是特定厂商对 Tensor Processing Unit 产品的名称，可归入 AI 专用加速器/ASIC。不能把所有张量加速器都统称为 TPU。

判断一个 TPU 类设备时仍需查看：

- 训练还是推理；
- 支持的数值精度；
- 片上/外部内存；
- 多芯片互联；
- 编译器和 Framework 支持；
- 服务形态是本地 PCIe、专用系统还是云服务。

## 6. FPGA

FPGA 由可编程逻辑、DSP、Block RAM、SerDes 和互联构成，可在部署后重新配置数字电路。

优势：

- 可构建定制流水线；
- 低延迟、确定性好；
- 适合协议处理、网络、视频和快速迭代硬件逻辑；
- 可集成专用 I/O。

限制：

- 开发和验证门槛高；
- 频率和面积效率通常不及成熟 ASIC；
- 编译时间长；
- 调试方法不同于普通软件。

HLS 可以用高级语言描述逻辑，但不会自动消除时序、资源和数据流设计问题。

## 7. 固定功能 ASIC

除 AI ASIC 外，服务器还有大量固定功能加速：

- NIC Packet Processing；
- Encryption/Compression；
- RAID XOR/Erasure Coding；
- Video Encode/Decode；
- Storage Controller；
- Switch Pipeline。

固定功能单元能效高、延迟稳定，但功能和算法升级受硬件边界限制。

## 8. DPU/IPU/SmartNIC

DPU/IPU 面向基础设施数据面，通常组合：

- 高速 NIC；
- 嵌入式 CPU；
- 独立内存；
- Network/Storage/Security Accelerator；
- PCIe 和管理能力。

它们适合卸载 vSwitch、Overlay、Firewall、NVMe-oF、存储虚拟化和安全隔离。DPU 也可能包含 FPGA/ASIC 单元，因此“DPU”和“FPGA”不是互斥分类。

## 9. 执行模型对比

| 类型 | 执行模型 | 强项 | 主要代价 |
| --- | --- | --- | --- |
| CPU | 少量复杂 Core、低延迟控制 | 通用、分支、OS | 并行吞吐/能效有限 |
| GPU | 大量 SIMT/SIMD Core | 通用并行、AI/HPC | 搬运、发散、软件栈 |
| NPU/AI ASIC | 张量/数据流阵列 | AI 吞吐和能效 | 算子适配和生态 |
| FPGA | 可重构硬件流水线 | 定制协议、确定性 | 开发和验证复杂 |
| 固定 ASIC | 固定逻辑 | 极高效率 | 灵活性最低 |
| DPU/IPU | 嵌入式 CPU + 网络/存储引擎 | 基础设施卸载与隔离 | 新管理面和故障域 |

## 10. 内存决定有效性能

```text
Compute Throughput
受限于
├── 算术单元数量
├── Register/片上 SRAM
├── HBM/GDDR 带宽
├── Host DDR 与 PCIe/CXL
└── 多设备互联
```

模型或数据无法留在设备内存时，Host-Device 搬运可能吞掉加速收益。必须同时计算容量、带宽、数据复用和通信。

## 11. 数值精度

AI 加速器常支持 FP32、TF32、BF16、FP16、FP8、INT8、INT4 等。低精度可提高吞吐并降低内存占用，但需要：

- 模型和算子支持；
- Scale、Accumulation 和溢出控制；
- 量化/校准或训练适配；
- 精度与稳定性验证；
- 对应 Kernel 真正命中加速路径。

规格表的峰值算力必须与实际使用精度对应。

## 12. 互联与扩展

| 层次 | 常见连接 |
| --- | --- |
| CPU ↔ Accelerator | PCIe、CXL、专有一致性互联 |
| Accelerator ↔ Accelerator | NVLink、HCCS、PCIe P2P、专有 Fabric |
| Node ↔ Node | InfiniBand、RoCE、Ethernet |
| Accelerator ↔ Storage/NIC | GPUDirect/RDMA、DMA、P2P |

单卡算力高不表示多卡扩展效率高。训练还受 Collective、拓扑和通信重叠限制。

## 13. 软件栈

```text
Framework
→ Graph Compiler / Runtime
→ Operator Library
→ Driver
→ Firmware
→ Accelerator Hardware
→ Collective Communication Library
```

GPU 常见 CUDA/ROCm 等栈，NPU 可能使用 CANN 或其他厂商 Runtime，FPGA 使用综合和 Bitstream 工具。硬件兼容不是只看 PCIe 能否枚举。

## 14. 选型方法

1. 列出必须支持的模型、算子和动态形状；
2. 计算模型、KV Cache、激活和 Batch 的内存；
3. 用实际精度比较有效吞吐，而不是混比峰值；
4. 评估单卡延迟、多卡扩展和网络通信；
5. 核对 Framework、Compiler、Kernel 和版本矩阵；
6. 计算功耗、散热、采购和迁移成本；
7. 验证监控、隔离、故障恢复和升级；
8. 用真实业务端到端基准做最终选择。

## 15. 练习与答案

**问题：NPU 是否一定比 GPU 更适合所有大模型推理？**

答案：不一定。NPU 可能在目标算子和精度上具有效率优势，但还要看模型覆盖、动态形状、编译器、Kernel、通信、框架适配和运维成熟度。

**问题：FPGA 可以重新编程，是否比 ASIC 更通用且同样高效？**

答案：FPGA 更灵活，但可编程互联和逻辑资源带来面积、频率和功耗代价；成熟固定 ASIC 在目标功能上通常更高效。

## 16. 延伸学习

- [GPU 与加速计算学习路线](../../gpu/00-GPU与加速计算学习路线.md)
- [NIC、HCA、SmartNIC、DPU 与 IPU](../network-devices/04-NIC-HCA-CNA-SmartNIC-DPU-IPU与OCP网卡.md)
- [昇腾 910B 软硬件架构](../../ai-systems/inference/vllm-ascend/05-Atlas-800I-A2与Ascend-910B软硬件架构.md)
