---
title: "BlueField 工作模式 Host 与 Arm 管理边界"
sidebar_label: "01. BlueField 工作模式 Host 与 Arm 管理边界"
sidebar_position: 1
description: "以设备控制权为主线理解 BlueField 的 Host、Arm、PF/VF/SF、Representor、管理通道和升级故障域。"
tags: [BlueField, DPU, DOCA, SRIOV, Arm]
---

# BlueField 工作模式 Host 与 Arm 管理边界

DPU 既是 Host 可发现的 PCIe 设备，也是一台具有独立处理器、内存、固件和系统软件的计算环境。学习它时，应先回答谁拥有设备控制权，再讨论卸载性能。

## 1. 三个平面

管理平面用于登录、配置和恢复；控制平面决定转发规则与设备功能；数据平面实际处理数据包或存储请求。它们不一定经过同一接口。Host 到 Arm 的管理通道正常，不证明外部业务端口或 RDMA 数据路径正常。

```text
Host 应用 → Host VF/SF → DPU 上的交换与卸载路径 → 物理端口
Host 管理工具 ↔ 管理通道 ↔ Arm OS 与服务
带外管理或控制台 → 电源固件及故障恢复
```

这些是逻辑关系，不是所有模式下唯一拓扑。NIC/DPU 等模式会改变 Arm 参与方式及 Host 的可见功能；字段和权限随 BlueField 代际、BSP/DOCA 与固件变化，变更前必须对应版本手册。

## 2. PF VF SF 与 Representor

PF/VF/SF 表示物理或虚拟功能；Representor 是交换控制侧表示对应端点的网络设备，不等于真实业务进程直接使用的 VF。规则必须把正确的端点、Representor 与物理端口关联起来。

只根据接口名配置转发很危险。应以 PCI BDF、端口索引、功能标识、MAC、Representor 对应关系组成映射，再核对实际包计数。更换模式、重建 VF 或升级固件后，旧映射可能失效。

## 3. 规则存在不等于硬件卸载

教学例子：OVS 中规则存在，Ping 也通，但 Host CPU 没有下降。可能数据走软件转发、部分匹配不支持卸载，或流量没有命中预期规则。依次比较规则命中计数、Offload 状态、硬件计数、CPU 及延迟，而不是把连通性当成卸载证明。

反过来，硬件规则计数增长也不证明整个应用路径更快；解密、元数据、CPU 解码或远端存储仍可能成为瓶颈。比较前后必须固定输入与资源，保存 P99 和错误率，不能只比平均带宽。

## 4. 模式切换的影响

模式决定控制权和暴露功能，可能要求固件变更与重启。DPU 同时承载网络或存储时，Arm OS 维护也可能中断 Host 业务，因此要先迁移任务、保留带外访问、记录旧模式和固件，以及可执行的恢复入口。

不能把升级失败统一当作“重启 Host 即可”。应分别判断 Host OS、Arm OS、设备固件和带外管理的故障边界，避免唯一恢复通道恰好经过已被修改的数据路径。

继续阅读[版本契约](./06-DOCA软件栈版本契约与兼容矩阵.md)和[升级激活](./07-BlueField升级激活重置与回退边界.md)。对实际卸载路径，进一步区分[Flow 请求、完成状态与命中证据](./08-DOCA-Flow匹配转发异步规则与卸载证明.md)，不能从接口存在推断硬件规则已生效。

## 5. 掌握检查

Host 能访问 Arm，外部业务不通，优先查什么？先定位业务端点、Representor、转发规则和物理端口，而非宣告管理网络正常就排除 DPU。若 VF 消失，先检查设备模式与功能配置，不能从容器网络层反复重建业务。

## 6. 参考资料

- [BlueField 软件文档](https://docs.nvidia.com/networking/display/bluefielddpuosv470)
- [DOCA 文档](https://docs.nvidia.com/doca/)
