---
title: "SR-IOV RDMA 独占数据路径"
sidebar_label: "03. SR-IOV RDMA 独占数据路径"
sidebar_position: 3
description: "从 PF/VF 创建、资源发现、Device Plugin 分配、SR-IOV CNI 配置到 Pod 内 RDMA 验收。"
tags: [SR-IOV, VF, RDMA, Device Plugin, CNI, IOMMU]
---

# SR-IOV RDMA 独占数据路径

SR-IOV 把一个 PF 划分为多个 VF。Kubernetes Device Plugin 将 VF 作为 Extended Resource
分配给 Pod，SR-IOV CNI 把对应 Netdev/VF 配进 Pod Namespace。

## 1. 组件链

```text
NIC PF
→ 创建 VF
→ VF 绑定驱动并具备 RDMA 能力
→ SR-IOV Device Plugin 发现并发布 Resource
→ Scheduler 选择有空闲 VF 的 Node
→ Kubelet 分配 VF
→ Multus + SR-IOV CNI 配置 Pod Interface
→ Pod 使用 VF/RDMA Device
```

任意一层资源名或选择器不一致都会失败。

## 2. PF 与 VF

PF：

- 管理物理端口和 VF；
- 配置 VF 数量、VLAN、Trust、Spoof Check、Rate 等；
- 由 Host Driver 管理。

VF：

- 独立 PCI Function；
- 可分配给 Container/VM；
- 拥有部分 Queue 和硬件资源；
- 隔离能力优于共享 PF，但仍共享物理端口、PCIe 和 Fabric。

## 3. 前置条件

检查：

```bash
lspci -nn | grep -Ei 'Ethernet|Infiniband'
cat /sys/class/net/<pf>/device/sriov_totalvfs
cat /sys/class/net/<pf>/device/sriov_numvfs
ip link show <pf>
rdma link show
```

确认：

- BIOS SR-IOV/IOMMU；
- NIC Firmware/Driver；
- PF Link Layer 与模式；
- VF 是否支持 RDMA；
- VF 数量上限；
- PCIe/IOMMU Group；
- Kubernetes/Operator 支持矩阵。

## 4. VF 创建与生命周期

VF 创建会改变设备状态，可能影响现有流量。生产应由 Operator/Node Policy 管理：

```text
Drain Node
→ 创建/修改 VF
→ 配置 Driver/Link Type
→ 重启/Reload（若需要）
→ 验证
→ 恢复调度
```

不要在运行训练的节点上直接修改 `sriov_numvfs`。

## 5. Resource Pool

Device Plugin 使用 Selector 把 VF 分组：

```text
Vendor / Device ID
Driver
PF Name / Root Device
PCI Address
Link Type
VF Range
```

建议按 Rail 和 NUMA 拆 Resource：

```text
example.com/roce_rail_a_numa0
example.com/roce_rail_b_numa1
```

但资源过细会增加调度碎片。需要在拓扑表达和可调度性间权衡。

## 6. SR-IOV Network

NAD/平台 CR 通常关联：

- Resource Name；
- VLAN；
- MTU；
- IPAM；
- Spoof Check；
- Trust；
- Link State；
- RDMA Enable；
- CNI 类型。

资源分配与网络配置必须指向同一 VF Pool。

## 7. Pod 请求

概念示例：

```yaml
metadata:
  annotations:
    k8s.v1.cni.cncf.io/networks: ai/roce-rail-a
spec:
  containers:
    - name: trainer
      resources:
        limits:
          example.com/roce_rail_a: 1
```

如果 Annotation 请求网络但没有对应 Extended Resource，CNI 可能拿不到 VF；反之只请求 VF
没有 NAD，也不会自动配置 IP/接口。

## 8. VF 安全

- VLAN/VRF/PKey 限制；
- Trust 只对需要修改标记/MAC 的工作负载开启；
- Spoof Check；
- Rate Limit；
- Namespace RBAC 控制谁能请求 NAD/Resource；
- 不把 PF 管理能力暴露给 Pod；
- VF 驱动和设备文件最小化；
- IOMMU 隔离；
- 记录 Pod→VF→PF→Port。

训练容器需要某些能力，不等于必须 `privileged: true`。

## 9. 拓扑

VF 继承 PF 的 PCI/NUMA 位置。Device Plugin 应提供 TopologyInfo，Kubelet Topology Manager
可协调 CPU、GPU、VF。

验证：

```bash
kubectl describe pod <pod>
kubectl exec <pod> -- lspci
kubectl exec <pod> -- rdma link show
kubectl exec <pod> -- ibv_devinfo
kubectl exec <pod> -- ip -br addr
```

映射到 Host：

```bash
readlink /sys/class/net/<vf-netdev>/device
cat /sys/bus/pci/devices/<vf-bdf>/numa_node
ip link show <pf>
```

## 10. 性能与隔离

VF 独占 Queue/PCI Function，但以下仍共享：

- PF Physical Link；
- ASIC/Port Buffer；
- PCIe 上行；
- PFC/ECN；
- Fabric；
- NIC Firmware 故障域。

并发 VF 需要做真实吞吐和 P99 测试。不要把 VF 数乘单 VF 峰值当成 PF 容量。

## 11. 常见故障

| 现象 | 检查 |
|---|---|
| VF 没创建 | Node Policy、BIOS、PF Driver |
| Resource=0 | Selector、VF Driver、Device Plugin |
| Pod Pending | VF 用尽、Affinity/Topology |
| CNI Add 失败 | Resource/NAD 不匹配、IPAM |
| Pod 有 VF 无 RDMA | VF RDMA 能力、Driver、Namespace |
| DSCP/PFC 不生效 | VF Trust/QoS/PF/交换映射 |
| Node 重启后资源变化 | VF 持久化、命名、Operator |

## 12. 实验

1. 在单个隔离节点创建少量 VF。
2. 按 Rail 建 Resource Pool。
3. 创建 SR-IOV NAD。
4. Pod 请求 VF 和 GPU。
5. 验证 PCI/NUMA/GID/IP。
6. 运行 Host/GPU Memory RDMA。
7. 两个 Pod 并发测共享 PF。
8. 删除 Pod，验证 VF 归还和清理。
9. Node Reboot 后验证配置持久化。
10. 错配 Resource Name，记录 Event/日志。

## 13. 掌握标准

能够从 Pod Resource Request 追到 VF BDF、PF、NUMA、RDMA Device 和交换端口；能解释
SR-IOV 的隔离收益及其仍然共享的故障域。

## 14. 参考资料 {/* #参考资料 */}

- [SR-IOV Network Device Plugin](https://github.com/k8snetworkplumbingwg/sriov-network-device-plugin)
- [NVIDIA Network Operator](https://docs.nvidia.com/networking/display/kubernetes2640/)
