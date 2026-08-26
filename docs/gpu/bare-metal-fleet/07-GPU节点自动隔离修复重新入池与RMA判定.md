---
title: "GPU 节点自动隔离、修复、重新入池与 RMA 判定"
sidebar_label: "07. 隔离、修复与重新入池"
sidebar_position: 7
description: "设计有证据、有状态和有安全边界的 GPU 节点隔离、诊断、修复与复验控制闭环。"
tags: [GPU Fleet, 自动隔离, RMA, Kubernetes, 修复]
---

# GPU 节点自动隔离、修复、重新入池与 RMA 判定

## 1. 自动修复不是收到告警就重启

自动化需要先保护工作负载，再保存证据，最后才决定动作：

```text
异常事件
→ 去重与关联
→ 标记Suspect
→ 停止新调度
→ 保存Pod/驱动/BMC/拓扑证据
→ 安全终止或等待Checkpoint
→ 主动诊断
→ 软恢复/固件处理/硬件维修
→ 完整复验
→ 重新入池或RMA
```

无限重启会丢失现场、重复伤害业务，并把永久硬件故障伪装成间歇性软件问题。

## 2. 隔离动作

Kubernetes 常见动作是 Cordon 加专用 Taint。Drain 是否执行取决于训练能否 Checkpoint、推理副本是否满足 N-1 和 Pod 的终止语义。执行前验证目标 Node UID，防止主机名复用导致操作错误节点。

隔离控制器应限制：

- 单次最多隔离节点数；
- 每机架/故障域最小剩余容量；
- 同一节点动作冷却时间；
- 已处于维护状态时不重复处理；
- API Server 或监控数据过旧时停止自动写操作。

## 3. 证据包

在重启前采集：

- Node、Pod、Event、设备资源和时间；
- `dmesg` 中 Xid、AER、MCE、OOM；
- DCGM/NVML 快照及 GPU UUID；
- NVLink/PCIe/NIC/RDMA 计数；
- BMC SEL、传感器、电源和固件版本；
- 受影响任务的 Rank、退出码和首个异常时间；
- 最近驱动、Kernel、固件和配置变化。

证据包使用校验和和不可变存储，敏感信息先脱敏。

## 4. 分级恢复

| 等级 | 动作 | 适用边界 |
| --- | --- | --- |
| L0 | 重启应用进程 | 明确为进程级故障 |
| L1 | GPU Reset | 设备支持、无其他使用者、错误允许复位 |
| L2 | 重载驱动/重启 OS | 驱动状态异常且证据已保存 |
| L3 | BMC Power Cycle | OS 无法恢复或设备未重新枚举 |
| L4 | 固件/线缆/部件维修 | 诊断指向硬件或链路 |
| L5 | RMA | 重复失败、不可纠正错误或厂商判定 |

每升一级都扩大影响面。恢复成功只表示设备重新出现，不代表性能和数据正确。

## 5. 重新入池门禁

至少验证：

1. 库存、Firmware 和 PCIe 拓扑与基线一致；
2. Kernel、驱动和 DCGM 无活动错误；
3. GPU 计算、显存与 P2P 诊断通过；
4. 单机 NCCL/HCCL 基线通过；
5. 多机 RDMA/Collective 与同组节点无明显偏差；
6. 持续压力下温度、功率和频率稳定；
7. 解除 Taint 后先承载 Canary 工作负载。

## 6. RMA 判定

RMA 证据应证明问题绑定到具体 Serial，并排除线缆、交换机端口、主板 Slot、驱动版本和应用。常见强信号包括不可纠正 ECC、设备持续掉线、相同硬件在替换环境仍失败、DCGM Field Diagnostic 重复失败，以及厂商明确的 Xid 判定。

参考：[NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/dcgm-diagnostics.html)、[Kubernetes Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/)。
