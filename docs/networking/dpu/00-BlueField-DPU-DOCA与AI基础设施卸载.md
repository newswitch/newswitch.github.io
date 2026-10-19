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

## 9. 继续学习

1. [Host 与 Arm 管理边界](./01-BlueField工作模式Host与Arm管理边界.md)：从谁控制设备理解模式、Representor 和管理网络。
2. [DOCA 服务生命周期](./02-DOCA服务镜像静态Pod与生命周期.md)：对照独立 kubelet、DMS 与 DPF，区分版本、服务依赖和部署权威，推演控制权迁移。
3. [遥测与故障定位](./03-DOCA遥测BlueMan与数据面故障分析.md)：从仪表盘追溯 DTS、采集源与真实硬件路径。
4. [DPF 控制对象与生命周期](./04-DPF控制对象与DPU生命周期.md)：沿 BFB、Flavor、服务配置和子对象解释异步协调。
5. [服务链与转发边界](./05-DPUServiceChain转发关系与故障边界.md)：区分外部接线、应用内部处理和实际数据面。
6. [版本契约与兼容矩阵](./06-DOCA软件栈版本契约与兼容矩阵.md)：区分 Host、Arm、BSP、固件、SDK 与服务之间的契约。
7. [升级激活与回退](./07-BlueField升级激活重置与回退边界.md)：解释暂存、激活、不同重置范围和业务可用性预算。
8. [Flow 异步规则与卸载证明](./08-DOCA-Flow匹配转发异步规则与卸载证明.md)：从 Pipe、Entry、Miss 与完成状态追到真实硬件路径。

先学模式和控制权，再学部署；否则同一个接口名可能被误当成 Host、Arm 或 Representor 中的不同对象。

参考：[NVIDIA BlueField Documentation](https://docs.nvidia.com/networking/display/bluefielddpuosv470)、[NVIDIA DOCA](https://docs.nvidia.com/doca/)。
