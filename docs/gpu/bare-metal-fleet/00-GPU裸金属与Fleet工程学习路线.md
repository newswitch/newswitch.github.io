---
title: "GPU 裸金属与 Fleet 工程学习路线"
sidebar_label: "00. 裸金属与 Fleet 学习路线"
sidebar_position: 0
description: "从机架、带外管理、自动装机和固件开始，掌握 GPU 服务器验收、健康判定、隔离修复与重新入池。"
tags: [GPU, 裸金属, BMC, Redfish, DCGM, Fleet]
---

# GPU 裸金属与 Fleet 工程学习路线

GPU Fleet 工程管理的是“进入 Kubernetes 之前”和“退出调度之后”的服务器生命周期。Device Plugin 只能发布一台已经健康的设备；它不能替你配置 BIOS、升级 NIC 固件、判断 Xid 是否应送修，也不能证明一台维修后的机器可以重新承载训练任务。

```text
机架与供电设计
→ BMC带外发现
→ PXE自动装机
→ BIOS/固件/驱动基线
→ Burn-in验收
→ 加入节点池
→ 持续健康检测
→ 隔离、诊断、维修、复验、重新入池
```

## 1. 学习顺序

1. [GPU 服务器机架拓扑、供电、散热与网络布线](./01-GPU服务器机架拓扑供电散热与网络布线.md)；
2. [BMC、IPMI、Redfish 与带外管理](./02-BMC-IPMI-Redfish与带外管理原理.md)；
3. [PXE、UEFI、Kickstart 与节点自动装机](./03-PXE-UEFI-Kickstart与GPU节点自动装机.md)；
4. [BIOS、IOMMU、NUMA、SR-IOV 与固件兼容矩阵](./04-BIOS-IOMMU-NUMA-SR-IOV与固件兼容矩阵.md)；
5. [GPU 服务器 Burn-in 压力测试与交付验收](./05-GPU服务器Burn-in压力测试与交付验收.md)；
6. [DCGM、NVML、Xid、ECC、PCIe、NVLink 健康模型](./06-DCGM-NVML-Xid-ECC-PCIe-NVLink健康模型.md)；
7. [GPU 节点自动隔离、修复、重新入池与 RMA 判定](./07-GPU节点自动隔离修复重新入池与RMA判定.md)。

## 2. 需要建立的对象模型

| 对象 | 唯一标识 | 关键状态 |
| --- | --- | --- |
| 机架/机位 | Rack/U | 功率、温度、网络上联、故障域 |
| 服务器 | Asset Tag/Serial | BMC、BIOS、CPLD、PSU、风扇 |
| GPU/NPU | Serial/UUID | 固件、ECC、链路、温度、功耗 |
| NIC/DPU | PCI BDF/Serial | Firmware、Link、RDMA、错误计数 |
| 系统盘/NVMe | Serial/WWN | SMART、寿命、介质错误 |
| OS 镜像 | Image Digest/Build ID | Kernel、驱动、配置基线 |
| Kubernetes Node | Node UID | 可调度、污点、资源、健康标签 |

资产名、主机名、BMC 地址、设备序列号和 Kubernetes Node 名必须能互相映射，否则批量故障时无法确认影响范围。

## 3. 完成标准

- 能画出一个 GPU 机架的电源、管理网、业务网、存储网和 RDMA Fabric；
- 能通过 Redfish 获取库存、传感器、电源和事件，不依赖进入 OS；
- 能建立可重放的 UEFI/PXE 自动装机链路；
- 能维护 BIOS、固件、Kernel、驱动、CUDA/CANN 和容器栈兼容矩阵；
- 能设计计算、显存、PCIe、NVLink、NIC、存储联合 Burn-in；
- 能把瞬时告警、可重试错误、节点隔离和硬件 RMA 分开；
- 能证明节点重新入池前已经通过相同基线复验。

参考：[DMTF Redfish 标准](https://www.dmtf.org/standards/redfish)、[NVIDIA DCGM 文档](https://docs.nvidia.com/datacenter/dcgm/latest/)。
