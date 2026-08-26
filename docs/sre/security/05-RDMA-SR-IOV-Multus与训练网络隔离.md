---
title: "RDMA、SR-IOV、Multus 与训练网络隔离"
sidebar_label: "05. RDMA 网络隔离"
sidebar_position: 5
description: "理解 VF、RDMA Device、NetworkAttachment、P_Key/VLAN/QoS 与租户边界，避免训练网绕过安全控制。"
tags: [RDMA, SR-IOV, Multus, NetworkPolicy, 多租户]
---

# RDMA、SR-IOV、Multus 与训练网络隔离

## 1. 为什么普通 NetworkPolicy 不够

Kubernetes NetworkPolicy 通常控制主 CNI 的 IP 数据面。Pod 通过 Multus 获得第二张 SR-IOV/RDMA 网卡后，这条数据面可能不经过主 CNI 的 Policy Enforcement。

```text
Pod eth0 → 主CNI → NetworkPolicy
Pod net1 → VF/RDMA → Fabric策略
```

因此必须分别设计 Kubernetes API 准入、VF 分配、二层/三层隔离和 Fabric 权限。

## 2. 对象链

```text
PF（物理网卡）
→ SR-IOV VF
→ RDMA Device/Representor
→ Device Plugin资源
→ NetworkAttachmentDefinition
→ Pod网络与设备
→ VLAN/P_Key/GID/Queue/QoS
```

排障和审计必须能从 Pod 反查 VF PCI BDF、PF、交换机端口和租户。

## 3. 隔离维度

| 层级 | 控制 |
| --- | --- |
| Kubernetes | Namespace、RBAC、NAD 使用权限、ResourceQuota |
| Host | VF、IOMMU、Device cgroup、Representor |
| Ethernet/RoCE | VLAN/VRF、ACL、PFC/ECN Queue |
| InfiniBand | P_Key、Partition、SM 策略 |
| 应用 | NCCL/HCCL Interface、端口、身份 |

VLAN/P_Key 不是加密。跨不可信网络还要考虑链路或应用层机密性。

## 4. SR-IOV 边界

VF 共享 PF 总带宽、缓冲、Firmware 和故障域。每 VF 可配置的 MAC/VLAN/Spoof Check/Trust/Rate 取决于 NIC。开启 Trust 或允许任意 Promiscuous 会扩大租户能力，必须明确原因。

IOMMU 为 DMA 隔离提供基础。没有正确 IOMMU Group 和驱动边界，设备直通风险会扩大到宿主内存。

## 5. QoS 与安全相互影响

一个租户发送过量无损流量可能触发 PFC Pause，影响同优先级其他租户。需要按 Traffic Class、Queue、Rate 和 Fabric Admission 控制，并监控 Pause、ECN、CNP、Buffer 和每 VF 流量。

## 6. 验证矩阵

1. 未授权 ServiceAccount 无法引用目标 NAD；
2. Pod 只获得申请数量的 VF/RDMA Device；
3. 不同租户 VLAN/P_Key 互不可达；
4. 伪造 MAC/VLAN 被阻止；
5. 带宽上限和 QoS 生效；
6. 删除 Pod 后 VF 被正确清理和复用；
7. PF Reset 时受影响租户范围符合预期。

参考：[Kubernetes Network Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/)、[Multus CNI](https://github.com/k8snetworkplumbingwg/multus-cni)、[SR-IOV Network Operator](https://github.com/k8snetworkplumbingwg/sriov-network-operator)。
