---
title: "GPU 服务器机架拓扑、供电、散热与网络布线"
sidebar_label: "01. 机架、供电、散热与布线"
sidebar_position: 1
description: "从机架级故障域理解 GPU 服务器的双路供电、热设计、管理网络、业务网络与 RDMA Fabric。"
tags: [GPU服务器, 机架, 供电, 散热, RDMA]
---

# GPU 服务器机架拓扑、供电、散热与网络布线

## 1. 机架不是简单的服务器容器

高密度 GPU 服务器的功率、热量和网络端口密度远高于普通计算节点。规划必须从单机峰值上升到 PDU、机架和供电回路：

```text
IT负载功率 = GPU + CPU + 内存 + NIC/DPU + NVMe + 风扇 + 主板损耗
机架设计功率 ≥ 同时运行节点峰值 × 安全余量
```

不能用平均功耗决定断路器容量。训练负载可能让 GPU 同时进入高功率状态，电源或制冷没有余量时会出现 PDU 跳闸、PSU 限功率、GPU 降频，而 Kubernetes 只会看到性能抖动或节点失联。

## 2. 双路供电

典型服务器使用 A/B 两路独立 PDU。需要验证：

- 每个 PSU 是否分别连接 A、B 路；
- 任一路失电后，另一路能否承担整机峰值；
- PDU、上游 UPS 和配电回路是否真正独立；
- BMC 是否能识别 PSU 缺失、输入异常和冗余降级；
- 线缆、插座额定电流与持续负载限制。

“插了两根电源线”不等于具备电源冗余。如果两根线接到同一 PDU 或单路容量不足，故障域没有被消除。

## 3. 风冷与液冷

温度治理关注的是进风温度、温升、风量、冷板/歧管状态和芯片节流，不只是 GPU 核心温度。

```text
环境/进风异常
→ 风扇升速
→ GPU/CPU达到温控阈值
→ Clock Throttle
→ Step Time和TPOT抖动
→ 过温保护或节点掉线
```

液冷还要监控供回液温度、流量、压力、泄漏传感器和 CDU 状态。任何冷却告警都应能映射到机架和节点范围。

## 4. 四类网络

| 网络 | 典型用途 | 设计重点 |
| --- | --- | --- |
| OOB 管理网 | BMC、Redfish、远程控制台 | 与业务隔离、强认证、禁止公网暴露 |
| 管理/业务网 | SSH、Kubernetes、镜像、API | 高可用、DNS/NTP、控制面保护 |
| 存储网 | Ceph、NFS、对象存储、Checkpoint | 吞吐、突发、故障域和 QoS |
| 训练 Fabric | RoCE/InfiniBand、NCCL/HCCL | Clos 拓扑、无损、ECMP、NUMA/GPU 亲和 |

双 Rail 网络要确保每台服务器的两条链路进入不同交换机和故障域，并明确进程、GPU、HCA 与 Rail 的映射。

## 5. GPU、NIC 和 CPU 拓扑

机内需要记录：

- GPU 到 CPU Socket 的 PCIe 路径；
- GPU 之间的 NVLink/NVSwitch 域；
- HCA/NIC 所属 NUMA Node；
- NVMe 到 Root Complex 的位置；
- PCIe Switch 是否共享上行带宽。

验收时保存 `lspci -tv`、`nvidia-smi topo -m`、`numactl -H` 和 RDMA Device 映射。调度器标签只是这份物理事实的派生结果。

## 6. 机架级故障域

容量不能只按“总共有多少张卡”计算。至少区分：

- 单节点损失；
- 单 ToR/Rail 损失；
- 单 PDU/供电回路损失；
- 单机架冷却损失；
- 单存储路径损失。

对要求 N 张卡同时运行的训练，应验证任一设计故障发生后，剩余拓扑仍能满足最小并行规模，而不是只满足卡数。

## 7. 验收输出

最终应形成机架 Elevation、线缆表、电源表、端口表、资产表和拓扑基线，并用一次 A/B 电源切换、单 Rail 中断与温控告警验证监控和故障域假设。

参考：[NVIDIA DGX BasePOD Reference Architecture](https://docs.nvidia.com/dgx-basepod/reference-architecture-infrastructure/latest/)。
