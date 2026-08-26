---
title: "BlueField DPU、DOCA 与 AI 基础设施卸载"
sidebar_label: "00. BlueField DPU 与 DOCA"
sidebar_position: 0
description: "理解 DPU Arm SoC、Embedded/Host 模式、Representor、OVS/网络、存储和安全卸载在 AI 集群中的边界。"
tags: [BlueField, DPU, DOCA, 网络卸载, AI Infra]
---

# BlueField DPU、DOCA 与 AI 基础设施卸载

## 1. DPU 的位置

BlueField 类 DPU 把高速 NIC、Arm Core、内存和硬件加速器组合在一张卡上，可在 Host 与网络之间执行交换、加密、存储和管理任务。

```text
Host CPU/GPU
↔ PCIe
↔ DPU Arm OS与硬件加速
↔ 高速网口
↔ Fabric
```

DPU 不替代 GPU 计算，也不自动提高 NCCL 性能。收益取决于把哪些基础设施工作从 Host 卸载，以及数据是否真的走硬件路径。

## 2. 工作模式

常见概念包括 DPU/Embedded Function、NIC Mode、Host/Separated Host 等，具体名称随代际和软件版本变化。模式决定 Arm OS 是否控制设备、Host 如何看到 PF/VF/SF、管理通道和启动顺序。

改变模式通常涉及 Firmware 配置和重启，必须纳入节点兼容矩阵。

## 3. Representor 与数据路径

PF/VF/SF 可对应 Representor，OVS/OVN 或 DOCA Flow 在 DPU 上建立转发规则。排障要区分：

- Host Netdev；
- VF/SF 和 PCI BDF；
- Representor；
- DPU Arm 侧 Netdev；
- Hardware Offload Rule；
- Physical Port 和交换机。

规则存在于 OVS 不代表已经 Offload 到硬件，需要查看 Offload 标志和硬件计数。

## 4. AI 场景

- Kubernetes CNI/OVS 数据面卸载；
- SR-IOV 和租户网络隔离；
- IPsec/TLS 等安全卸载；
- NVMe-oF、Virtio-blk 等存储路径；
- Telemetry 与基础设施 Agent 隔离；
- GPUDirect/RDMA 路径中的 NIC 能力。

## 5. DOCA

DOCA 提供面向 DPU 的 SDK、Runtime 和服务。应用需要选择目标硬件、Host/DPU 运行位置和安全权限。DOCA 版本、DPU Firmware、OFED/Driver 和 Arm OS 必须兼容。

## 6. 资源与故障域

DPU 自身有 CPU、内存、Firmware 和 OS，也会出现资源耗尽、升级失败和重启。DPU 故障可能同时影响节点网络、存储和管理，必须独立监控并具备恢复控制台。

## 7. 性能验证

比较 Offload 前后 Host CPU、吞吐、P99、GPU Collective 和功耗。若卸载降低 Host CPU 但增加尾延迟或破坏 GPUDirect，不能视为成功。

## 8. 安全

DPU 管理面与业务隔离，Arm OS 最小化服务和权限；控制 API 需要强身份；Firmware 与镜像签名；Host 不应无条件获得 DPU Root。

参考：[NVIDIA BlueField Documentation](https://docs.nvidia.com/networking/display/bluefielddpuosv470)、[NVIDIA DOCA](https://docs.nvidia.com/doca/)。
