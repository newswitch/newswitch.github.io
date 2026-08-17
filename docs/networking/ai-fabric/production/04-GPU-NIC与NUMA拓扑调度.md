---
title: GPU、NIC 与 NUMA 拓扑调度
sidebar_label: "04. GPU、NIC 与 NUMA 拓扑调度"
sidebar_position: 4
tags: [Kubernetes, Topology Manager, CPU Manager, NUMA, GPU, NIC]
description: 协调 CPU、HugePage、GPU、VF/RDMA NIC 和 NUMA，避免资源数量满足但物理拓扑错误。
---

# GPU、NIC 与 NUMA 拓扑调度

Kubernetes 默认按“节点是否还有资源数量”调度，不天然保证 Pod 得到的 CPU、GPU 和 NIC
位于同一 NUMA/PCIe 域。Kubelet Topology Manager 在节点准入阶段协调 Hint Provider。

## 1. 两个阶段

```text
Scheduler：选择一个资源数量和约束满足的 Node
Kubelet Topology Manager：在 Node 内协调 CPU/Memory/Device NUMA Hint
```

Scheduler 可能把 Pod 送到最终无法满足严格 NUMA 对齐的节点，随后 Kubelet Admission 拒绝。
大规模集群可结合拓扑感知调度扩展，但先理解节点内 Resource Manager。

## 2. Topology Manager Policy

Kubernetes 常见策略：

| Policy | 行为 |
|---|---|
| `none` | 不做拓扑协调 |
| `best-effort` | 尽量对齐，不满足仍可准入 |
| `restricted` | Hint 不满足策略时拒绝 |
| `single-numa-node` | 要求资源来自单一 NUMA Node |

还可配置 Pod/Container Scope 和 Policy Options，具体能力随 Kubernetes 版本变化。

严格策略可能提高性能一致性，也会降低可调度率并增加碎片。

## 3. Hint Provider

可能提供 NUMA Hint：

- CPU Manager；
- Memory Manager；
- Device Manager/Device Plugin；
- HugePages；
- GPU Device Plugin；
- SR-IOV/RDMA Device Plugin。

如果 Device Plugin 没有提供 TopologyInfo，Topology Manager 无法可靠对齐该设备。

## 4. CPU Manager

Guaranteed Pod 请求整数 CPU，并在合适的 CPU Manager Static Policy 下可获得独占 CPU。

概念要求：

```yaml
resources:
  requests:
    cpu: "8"
    memory: 64Gi
  limits:
    cpu: "8"
    memory: 64Gi
```

GPU/NIC 请求也应在 Limits 中。具体 QoS、Reserved CPU 和 Policy 由集群配置决定。

仅给 `cpu: 8` 不代表这些 CPU 与 GPU/NIC 同 NUMA，需 Topology Manager 协调。

## 5. GPU 与 NIC 拓扑

建立 Node Hardware Inventory：

```text
NUMA 0: CPU0-63, GPU0-3, NIC Rail-A PF/VF
NUMA 1: CPU64-127, GPU4-7, NIC Rail-B PF/VF
```

调度目标可能是：

- 单 GPU+单 NIC 同 NUMA；
- 4 GPU+一张 NIC 同 PCIe Root；
- 8 GPU 跨两个 NUMA，分别使用两 Rail；
- TP Group 留在 NVLink/NVSwitch 域。

`single-numa-node` 不适合天然跨多个 NUMA 的整机 8 GPU 请求，需要根据服务器架构选择策略。

## 6. 资源命名表达 Rail

一种方式按 Rail/NUMA 建资源池：

```text
example.com/roce_rail_a
example.com/roce_rail_b
```

Pod 同时请求对应 GPU/NIC 资源。风险：

- 资源碎片；
- 用户需要理解硬件；
- 换卡/拓扑变化时标签漂移；
- Scheduler 仍需知道组间约束。

另一种方式由更高层调度器/Operator 根据拓扑自动选择。无论哪种，都要用 Pod 内证据验收。

## 7. Node Labels 与 SoT

标签示例：

```text
ai.example.com/fabric=roce
ai.example.com/rail-count=2
ai.example.com/topology-class=8gpu-2numa
ai.example.com/network-health=ready
```

标签应该由自动发现/验证控制，避免用户手工把坏节点标为 Ready。高基数 PCI 明细不适合全部塞进 Label，
可保存在 CRD/SoT。

## 8. Pod 内验证

```bash
nvidia-smi topo -m
nvidia-smi --query-gpu=index,pci.bus_id --format=csv
rdma link show
ibv_devices
lspci -tv
numactl --hardware
taskset -pc 1
cat /sys/fs/cgroup/cpuset.cpus.effective
```

验证：

- 分配的 GPU PCI；
- VF/PF PCI 和 RDMA Device；
- CPU Set 与 NUMA；
- Memory Node；
- GPU-NIC 相对距离；
- NCCL 实际 HCA。

## 9. 调度失败

查看：

```bash
kubectl describe pod <pod>
kubectl describe node <node>
journalctl -u kubelet
```

区分：

- Scheduler Pending：节点资源/亲和/污点不满足；
- Kubelet Topology Affinity Error：节点选中后无法拓扑对齐；
- Device Plugin 分配失败；
- CNI 配置失败；
- Pod 启动后应用选错设备。

## 10. 碎片与整机作业

零散小 Pod 可能占用各 NUMA 的 GPU/NIC，导致后续 8 GPU 作业无法对齐。

治理：

- GPU 节点专用；
- Gang Scheduling；
- 整机/拓扑块分配；
- 队列配额；
- 小任务与大任务分池；
- Defragmentation/Drain 策略；
- 作业启动前 Reservation。

## 11. 实验

1. 导出 Node GPU/NIC/NUMA 拓扑。
2. 分别使用 `none`、`best-effort`、严格策略的隔离集群对比。
3. 请求 GPU+VF+整数 CPU。
4. 验证 Pod 内物理对齐。
5. 故意碎片化 GPU/VF，观察准入。
6. 用错误 Resource Pool 造成跨 NUMA。
7. 比较 perftest/NCCL P99。
8. 恢复节点并验证调度状态。

## 12. 掌握标准

能够解释 Scheduler 与 Kubelet Topology Manager 的职责差异；能从 Pod 请求证明 CPU、Memory、
GPU 和 NIC 的真实 NUMA 对齐，并量化错误拓扑的性能影响。

## 参考资料

- [Kubernetes Topology Manager](https://kubernetes.io/docs/tasks/administer-cluster/topology-manager/)
- [Kubernetes Resource Managers](https://kubernetes.io/docs/concepts/workloads/resource-managers/)
- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
