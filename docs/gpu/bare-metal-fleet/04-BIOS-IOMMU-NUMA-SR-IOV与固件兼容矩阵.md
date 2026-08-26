---
title: "BIOS、IOMMU、NUMA、SR-IOV 与固件兼容矩阵"
sidebar_label: "04. BIOS、NUMA 与固件矩阵"
sidebar_position: 4
description: "理解 BIOS 与设备固件如何影响 PCIe、NUMA、虚拟化、RDMA 和 GPU 软件栈，并建立可回滚兼容矩阵。"
tags: [BIOS, IOMMU, NUMA, SR-IOV, 固件]
---

# BIOS、IOMMU、NUMA、SR-IOV 与固件兼容矩阵

## 1. 兼容性不是两列版本号

GPU 节点运行结果由整条栈共同决定：

```text
BMC/CPLD/BIOS
→ CPU Microcode与PCIe设置
→ GPU/NIC/DPU/NVMe Firmware
→ Kernel与IOMMU
→ GPU/NIC Driver
→ CUDA/CANN、OFED/Inbox RDMA
→ Container Runtime
→ PyTorch与推理/训练框架
```

只记录“CUDA 对应 Driver”无法解释 PCIe 降速、SR-IOV VF 创建失败、ACS 改变 P2P 路径或 NIC Firmware 与 Driver 不匹配。

## 2. 关键 BIOS 设置

常见关注项包括：

- Above 4G Decoding：大量 PCIe BAR 地址空间；
- Resizable BAR：设备 BAR 映射能力；
- IOMMU/VT-d/AMD-Vi：设备隔离与直通；
- SR-IOV：创建 VF 的前提；
- NUMA/SNC/NPS：CPU、内存和 PCIe 的拓扑表达；
- PCIe Link Speed：代际和降级行为；
- Power Profile/C-State/P-State：时延与能效；
- Secure Boot：驱动模块信任链。

设置名称会随厂商变化。不要把某一机型的 BIOS JSON 无条件下发给所有型号，应按 Hardware Profile 管理。

## 3. IOMMU 的收益和代价

IOMMU 提供 DMA 地址转换与隔离，是设备直通和安全边界的一部分。错误配置可能导致：

- 设备落入不期望的 IOMMU Group；
- VFIO 绑定失败；
- DMA 映射开销或地址空间不足；
- GPUDirect/RDMA 路径不能按预期建立；
- Kernel 启动参数与 BIOS 状态不一致。

验证不能只看启动参数，还要检查 IOMMU Group、Kernel Log、设备 Driver 和实际 P2P/RDMA 测试。

## 4. NUMA 与 SR-IOV

SR-IOV 把一个 PF 划分为多个 VF，但 VF 数量不等于性能可以线性切分。要同时考虑 PF 总带宽、Queue、IRQ、NUMA、IOMMU 和交换机 QoS。

```text
训练进程CPU
↔ 本地NUMA内存
↔ GPU PCIe Root Complex
↔ 同NUMA HCA/VF
↔ Fabric
```

CPU、GPU 和 NIC 跨 Socket 会增加 UPI/Infinity Fabric 流量。验收应包含 `lspci -vv` 链路宽度、NUMA 距离、IRQ 亲和和端到端 Collective，而不是只确认 VF 可见。

## 5. 兼容矩阵的结构

每一条已验证基线至少记录：

| 维度 | 示例字段 |
| --- | --- |
| 硬件 | Server SKU、GPU/NIC Revision、主板版本 |
| 固件 | BIOS、BMC、CPLD、GPU VBIOS、NIC/DPU Firmware |
| OS | Distribution、Kernel、Microcode |
| 驱动 | GPU Driver、NIC Driver、OFED/Inbox |
| Runtime | CUDA/CANN、NCCL/HCCL、Container Toolkit |
| 框架 | PyTorch、vLLM、Megatron 等 |
| 结果 | 功能、性能、已知限制、验收时间 |

矩阵中的“支持”必须绑定测试结果和 Artifact，而不是口头结论。

## 6. 升级策略

先在相同硬件 Canary 节点升级，完成冷启动、Burn-in、RDMA/NCCL、存储和业务基准；再按机架和故障域分批。固件升级失败可能让 BMC 或设备不可用，因此必须确认双镜像、回滚能力、现场恢复方式和断电要求。

参考：[Linux Kernel VFIO 文档](https://docs.kernel.org/driver-api/vfio.html)、[Linux PCI 文档](https://docs.kernel.org/PCI/)。
