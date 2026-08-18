---
title: "共享 RDMA、Host Device 与 Macvlan"
sidebar_label: "02. 共享 RDMA、Host Device 与 Macvlan"
sidebar_position: 2
description: "理解多个 Pod 共享 PF/HCA 的资源模型、Host Device/Macvlan 数据面、隔离边界和容量治理。"
tags: [RDMA Shared Device Plugin, Host Device, Macvlan, Kubernetes]
---

# 共享 RDMA、Host Device 与 Macvlan

共享 RDMA 让多个 Pod 使用同一 PF/HCA 的 RDMA 能力，资源利用率高、部署简单，但硬件、
Queue、带宽和故障域仍共享。

## 1. 典型数据路径

```text
Pod Process
→ Pod Netns 中的 Macvlan/Host Interface
→ Host PF Netdev
→ 同一个 RDMA HCA/Port
→ Fabric
```

RDMA Shared Device Plugin 把逻辑 Extended Resource 发布给 Kubelet。它控制可分配数量，
不自动提供与 VF 相同的硬件隔离。

## 2. 共享的是什么

多个 Pod 可能共享：

- PF 物理端口；
- Link Bandwidth；
- HCA Context/QP/CQ/MR 等硬件资源池；
- PCIe 上行；
- PFC/ECN/DCQCN 配置；
- 驱动和固件；
- 故障域。

需要限制每个 Pod/作业的 HCA 资源和并发，避免一个作业耗尽 QP/MR。

## 3. RDMA Namespace 模式

Linux RDMA Subsystem 可有共享/独占 Namespace 行为。平台和 Operator 配置决定 RDMA Device
在容器 Namespace 中如何可见。

检查：

```bash
rdma system show
rdma link show
lsns -t net
```

不要假设把 Netdev 移入 Pod 后 RDMA Device 一定以预期方式出现。

## 4. Macvlan

Macvlan 在同一 Lower Device 上创建多个 MAC 接口，常见模式包括 Bridge、Private 等。

优点：

- 数据路径短；
- 每 Pod独立 MAC/IP；
- 可与共享 RDMA 结合。

限制：

- Pod 与 Host 直接通信可能需要额外设计；
- 交换端口需要容纳更多 MAC；
- 所有 Pod 仍共享 PF 和带宽；
- NetworkPolicy 支持取决于 CNI；
- VLAN/QoS/MTU 必须与 PF 一致。

## 5. Host Device

Host Device CNI 把现有网络设备移动到 Pod Namespace，通常是独占接口使用。

风险：

- 设备从 Host Namespace 消失；
- Pod 删除/异常时要正确归还；
- 不能误移动管理口；
- 设备名和 PCI 身份要稳定；
- 与 Device Plugin 分配必须一致。

适合需要直接使用整个接口且生命周期可控的工作负载。

## 6. Resource 配置

概念性 Device Plugin 资源：

```json
{
  "resourceName": "rdma_rail_a",
  "rdmaHcaMax": 63,
  "selectors": {
    "ifNames": ["ens5f0np0"],
    "linkTypes": ["ether"]
  }
}
```

字段和格式以当前 Operator/Plugin 文档为准。`rdmaHcaMax` 是可分配逻辑资源上限之一，
不是带宽保证。

Pod：

```yaml
resources:
  limits:
    example.com/rdma_rail_a: 1
```

真实 Resource Prefix 由部署配置决定。

## 7. 资源隔离

共享模式必须另行解决：

- Namespace/租户是否允许使用 RDMA；
- 单 Pod QP/MR 上限；
- 带宽公平；
- 作业并发；
- PKey/VRF/VLAN；
- Host Device 文件权限；
- Secret/Management Interface；
- 一个 Pod 触发 PFC/Congestion 对其他 Pod 的影响。

Extended Resource 只做整数调度，不等于完整 QoS。

## 8. 容量

如果一张 400G PF 被 8 个 Pod 各请求一个共享资源，不代表每个 Pod 保证 50G。

容量策略：

- 按作业级别预估；
- 一个节点同时运行多少通信重型 Pod；
- Admission 检查 Rail 剩余容量；
- 对吞吐和 Queue 建立作业标签；
- 防止 QP/MR 资源耗尽；
- 维护窗口时 Drain 所有共享 Pod。

## 9. Network Operator

Operator 可管理 Driver Container、NFD、Multus、RDMA Shared Device Plugin、SR-IOV 等组件。

生产升级要检查：

- 当前 Kubernetes、内核、NIC、GPU Operator 支持矩阵；
- Driver 宿主机/容器化选择；
- NFD 是否被 GPU/Network Operator 重复部署；
- Node Drain 和并发升级；
- 回滚后 Driver/Kernel Module 状态；
- CRD 与 Helm Values 版本。

不要把 Operator 安装成功当作数据面验收。

## 10. 验证

```bash
kubectl describe node <node>
kubectl get pods -A -o wide
kubectl describe pod <pod>
kubectl exec <pod> -- rdma link show
kubectl exec <pod> -- ibv_devinfo
kubectl exec <pod> -- ip -d link show
```

证明：

- Node Allocatable 有目标资源；
- Pod 已消费资源；
- Pod 的 Netdev/RDMA Device 指向预期 PF/Rail；
- GID/IP/MTU 正确；
- Host 与其他 Pod 未误失去接口；
- perftest 与计数器正常。

## 11. 常见故障

| 现象 | 根因方向 |
|---|---|
| Resource 不出现在 Node | Device Plugin/Selector/Driver |
| Resource 有但 Pod Pending | 请求数量、Affinity/Taint |
| Pod 有接口但 `ibv_devices` 空 | RDMA Namespace/Device Mount |
| 多 Pod 单测快、并发慢 | PF/PCIe/Fabric 共享容量 |
| Pod 删除后接口未恢复 | CNI DEL/Runtime/Node 状态 |
| 一个 Pod 导致全节点抖动 | 共享 HCA/Queue/PFC 故障域 |

## 12. 实验

1. 发布两个 Rail 的共享 RDMA Resource。
2. 两个 Pod 分别请求 Rail-A/Rail-B。
3. 验证接口、RDMA Device、PCI 和 NUMA。
4. 单 Pod 跑 perftest。
5. 多 Pod 并发，观察带宽公平和 HCA 资源。
6. 删除/重建 Pod，检查资源归还。
7. 让 Selector 指向错误接口，验证阻止错误发布。
8. 模拟 Driver/Plugin 重启，检查现有作业和恢复。

## 13. 掌握标准

能够解释 Shared Device Plugin 发布的是调度资源而非独占带宽；能判断 Host Device、
Macvlan 和共享 RDMA 的数据面、隔离和故障域。

## 14. 参考资料 {/* #参考资料 */}

- [NVIDIA Network Operator Deployment Guide](https://docs.nvidia.com/networking/display/kubernetes2640/)
- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
