---
title: "DPDK、SR-IOV 与 Kubernetes：设备、大页和 CPU 怎样进入 Pod"
sidebar_label: "06. DPDK、SR-IOV 与 Kubernetes"
sidebar_position: 6
description: "解释 PF/VF、SR-IOV Device Plugin、Multus、HugePage、CPU Manager、Topology Manager 与 DPDK Pod 的完整资源链路。"
tags: [DPDK, SR-IOV, Kubernetes, Multus, HugePage, CPU Manager]
---

# DPDK、SR-IOV 与 Kubernetes：设备、大页和 CPU 怎样进入 Pod

DPDK Pod 需要的不只是一个容器镜像。稳定性能依赖四类资源同时满足：PCIe 设备、HugePage、独占 CPU 和 NUMA 拓扑。Kubernetes 分别通过不同组件管理这些资源。

## 1. 完整资源链路

```text
物理 NIC PF
→ 创建 SR-IOV VF
→ VF 绑定 vfio-pci 或由支持的 Bifurcated Driver 管理
→ SR-IOV Device Plugin 把 VF 注册为 Extended Resource
→ Scheduler 根据 requests 分配节点
→ Topology Manager 协调 CPU、HugePage 与 VF 的 NUMA Hint
→ Multus/SR-IOV CNI 配置 Pod 网络附件
→ Device Plugin 将 /dev/vfio 与设备信息注入容器
→ DPDK EAL 初始化目标 VF、HugePage 和 lcore
```

### 1.1 PF 与 VF

- PF（Physical Function）拥有完整管理能力，可创建和配置 VF；
- VF（Virtual Function）是可独立分配的轻量 PCIe Function；
- 不同 NIC 对 VF 数量、Flow、RSS、Offload、Trust、Spoof Check 和带宽控制的支持不同。

SR-IOV 解决设备切分与直通，不自动保证 DPDK 性能。VF、Core 和 HugePage 跨 NUMA 时仍会掉速。

## 2. Kubernetes 中各组件负责什么

| 组件 | 职责 | 不负责什么 |
|------|------|------------|
| SR-IOV Network Operator | 部分发行版中的节点策略、VF、驱动和组件生命周期 | 业务应用调度逻辑 |
| SR-IOV Device Plugin | 发现设备并注册 Extended Resource | 给 Pod 创建第二网络接口 |
| Multus | 让 Pod 使用多个 CNI 网络 | 自己配置 VF 硬件 |
| SR-IOV CNI | 把 VF 配置/移动到 Pod Namespace | 选择调度节点 |
| CPU Manager | 分配独占 CPU | 自动确保 NIC 同 NUMA |
| Topology Manager | 协调设备、CPU、HugePage 拓扑 Hint | 修复物理拓扑不合理 |
| Kubelet HugePage | 暴露并分配预留大页资源 | 动态交换普通内存为大页 |

## 3. 节点前置条件

至少检查：

```bash
lscpu -e=CPU,CORE,SOCKET,NODE,ONLINE
lspci -Dnn | grep -i ethernet
find /sys/class/net -maxdepth 2 -name sriov_totalvfs -print -exec cat {} \;
grep -E 'HugePages|Hugepagesize' /proc/meminfo
cat /var/lib/kubelet/cpu_manager_state
kubectl describe node <node-name>
```

关键 Kubelet 策略通常包括：

```yaml
cpuManagerPolicy: static
topologyManagerPolicy: single-numa-node
topologyManagerScope: pod
reservedSystemCPUs: "0-1,16-17"
```

具体字段支持范围取决于 Kubernetes 版本与发行版。修改 Kubelet 配置属于节点级变更，需要逐节点滚动、排空和回滚方案。

## 4. Pod 资源示例

下面只展示资源关系，SR-IOV Resource 名称和网络注解必须替换为集群实际配置：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dpdk-testpmd
  annotations:
    k8s.v1.cni.cncf.io/networks: dpdk-sriov-net
spec:
  containers:
    - name: testpmd
      image: registry.example.com/dpdk-testpmd:25.11.3
      securityContext:
        capabilities:
          add: ["IPC_LOCK"]
      resources:
        requests:
          cpu: "4"
          memory: 2Gi
          hugepages-1Gi: 2Gi
          example.com/dpdk_vf: "1"
        limits:
          cpu: "4"
          memory: 2Gi
          hugepages-1Gi: 2Gi
          example.com/dpdk_vf: "1"
      volumeMounts:
        - name: hugepage
          mountPath: /dev/hugepages
  volumes:
    - name: hugepage
      emptyDir:
        medium: HugePages
```

Guaranteed QoS 要求容器 CPU/内存的 Requests 与 Limits 相等。HugePage 不可超卖，节点必须事先预留对应页大小。

不要机械添加 `privileged: true`。应根据设备插件、VFIO 权限和应用行为授予最小设备、Capability 与 Seccomp/AppArmor 权限。

## 5. 调度成功不等于拓扑正确

Pod 可能拿到：

```text
CPU：NUMA 0
HugePage：NUMA 0
VF：NUMA 1
```

资源数量都满足，但数据路径跨 Socket。验证需要同时查看：

```bash
kubectl exec dpdk-testpmd -- grep Cpus_allowed_list /proc/self/status
kubectl exec dpdk-testpmd -- grep -E 'HugePages|Hugetlb' /proc/meminfo
kubectl exec dpdk-testpmd -- lspci -Dnn
kubectl get pod dpdk-testpmd -o wide
```

再回到节点检查 VF 的 `numa_node` 和分配的 CPU。Topology Manager 只有在各 Provider 提交正确 Hint 且策略允许时才能做对齐。

## 6. VFIO 在容器中的边界

设备插件通常把对应 `/dev/vfio/<group>` 和控制设备注入容器。还要满足：

- 宿主机 IOMMU 正常；
- VF 位于可安全分配的 Group；
- 容器用户有设备节点权限和 memlock；
- HugePage Mount 与 EAL 参数一致；
- Pod 不可访问未分配的其他 VFIO Group；
- 应用退出与 Pod 删除时设备能被正确回收。

把宿主机整个 `/dev` 挂入容器会破坏设备隔离，不应作为生产常规方案。

## 7. 发布与升级

DPDK 工作负载发布前记录：

```text
Kubernetes / Kernel / NIC Firmware
PF Driver / VF Driver / DPDK / PMD
Device Plugin / CNI / Operator
CPU Manager / Topology Manager Policy
HugePage Size / NUMA Distribution
Pod Image Digest / EAL Parameters
```

升级顺序应先在 canary 节点验证：设备发现、分配、释放、Pod 重建、节点重启、VF Reset、流量和性能回归，再逐批扩展。

## 8. 故障排查

```text
Pod Pending
→ Node allocatable 是否有 VF/HugePage/CPU
→ Device Plugin 是否注册资源
→ Topology Affinity Error 是否出现

Pod Running 但 EAL 看不到设备
→ Pod resource request
→ CDI/DeviceSpec 注入
→ /dev/vfio 权限
→ VF driver 与 IOMMU Group

能收包但性能差
→ CPU 独占与 Throttling
→ VF/Core/HugePage NUMA
→ Queue/RSS/Offload
→ CNI 和硬件限速
```

## 9. 课后练习与答案

**问题 1：只部署 Multus 能否把 VF 分给 Pod？**

不能。Multus 负责多个网络附件的编排，设备发现和资源分配通常还需要 SR-IOV Device Plugin，接口配置需要 SR-IOV CNI。

**问题 2：Pod 为 Guaranteed QoS 是否保证低抖动？**

不保证。还要考虑独占 CPU、IRQ、SMT、NUMA、CPU 电源状态、队列映射和节点其他负载。

**问题 3：为什么 HugePage Requests 和 VF Requests 都要写？**

它们是独立资源；获得 VF 不会自动获得大页，获得大页也不会自动获得设备。

## 10. 参考资料

- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [Kubernetes Huge Pages](https://kubernetes.io/docs/tasks/manage-hugepages/scheduling-hugepages/)
- [Kubernetes Topology Manager](https://kubernetes.io/docs/tasks/administer-cluster/topology-manager/)
- [SR-IOV Network Device Plugin](https://github.com/k8snetworkplumbingwg/sriov-network-device-plugin)
