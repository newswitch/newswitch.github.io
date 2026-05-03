---
title: "K8s 学习 · Part I：基础架构与核心抽象 之 开放接口"
date: 2026-03-20 16:00:00
categories: 云原生
tags: [Kubernetes, 学习路线, CRI, CNI, CSI, 开放接口]
---

# K8s 学习 · Part I：基础架构与核心抽象 之 开放接口

> 可与同系列 **《K8s 学习 · Part I：基础架构与核心抽象 之 Kubernetes 架构》** 对照阅读：**kubelet** 通过 **CRI** 调运行时，**CNI** 负责 Pod 网络，**CSI** 负责持久卷生命周期。

---

## 1. 综述：Kubernetes 中的开放接口

Kubernetes 作为云原生调度平台，通过 **标准化开放接口** 将**计算、网络、存储**与核心控制面解耦，便于对接不同厂商实现、独立演进。

### 1.1 核心接口协作关系

![Kubernetes 核心接口（CRI / CNI / CSI）协作关系](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes 核心接口协作关系.png)

*图：Kubernetes 核心接口（CRI / CNI / CSI）协作关系*


### 1.2 三大接口对比

| 接口 | 全称 | 主要功能 | 作用说明 | 常见实现 |
| --- | --- | --- | --- | --- |
| **CRI** | Container Runtime Interface | 计算资源管理 | 标准化 kubelet 与容器运行时的交互 | containerd、CRI-O 等 |
| **CNI** | Container Network Interface | 网络资源管理 | 统一容器网络配置与生命周期 | Flannel、Calico、Cilium 等 |
| **CSI** | Container Storage Interface | 存储资源管理 | 标准化卷的创建、挂载、扩容、快照等 | 云盘驱动、Ceph CSI 等 |

### 1.3 插件化架构的优势

- **解耦**：各组件职责清晰，可独立开发与发布。  
- **可扩展**：同一接口多种实现，适配不同基础设施。  
- **标准化**：降低集成与运维心智负担。  
- **生态**：促进云原生工具链繁荣。

### 1.4 本节小结

CRI / CNI / CSI 分别覆盖**计算、网络、存储**，是 Kubernetes **可插拔**设计的基石。

---

## 2. 容器运行时接口（CRI）

**CRI（Container Runtime Interface）** 为 kubelet 提供**统一的容器运行时抽象**，由 **Protocol Buffers** 与 **gRPC** 定义，专用于 **kubelet ↔ 运行时** 及 **crictl** 等节点侧工具，**不是**面向通用容器管理的公共 API。

### 2.1 CRI 解决的问题

在 CRI 之前，接入新运行时往往需要**改 kubelet 源码并重新编译**，带来：

- 难以并行支持多种运行时  
- 运行时厂商无法独立交付  
- Kubernetes 代码库臃肿  

CRI 将 **编排（kubelet）** 与 **容器生命周期（运行时实现）** 分离。

![CRI 作为 kubelet 与容器运行时之间的抽象层](/images/K8s学习-PartI-基础架构与核心抽象/CRI 作为抽象层.png)

*图：CRI 作为 kubelet 与容器运行时之间的抽象层*


### 2.2 CRI 服务架构：RuntimeService 与 ImageService

| 服务 | 职责 |
| --- | --- |
| **RuntimeService** | Pod **沙箱**与**容器**的创建、启停、删除；与 Pod 级环境（网络命名空间等）衔接 |
| **ImageService** | **镜像**拉取、查看、删除等，可与运行时分层存储策略配合 |

![CRI 的两大 gRPC 服务及其主要操作](/images/K8s学习-PartI-基础架构与核心抽象/CRI 的两大服务及其操作.png)

*图：CRI 的两大 gRPC 服务及其主要操作*


### 2.3 技术基础：gRPC 与 Protocol Buffers

![gRPC 与 Protocol Buffers 在 CRI 中的作用](/images/K8s学习-PartI-基础架构与核心抽象/gRPC 与 Protocol Buffers 在 CRI 中的作用.png)

*图：gRPC 与 Protocol Buffers 在 CRI 中的作用*


### 2.4 关键概念

**Pod 沙箱**  
运行时表示，提供容器间共享环境，例如网络 / IPC / PID（视配置）及 Pod 级约束。典型流程：**RunPodSandbox** 就绪后，再在沙箱内 **CreateContainer / StartContainer**。

**容器生命周期（幂等）**  

| 阶段 | 说明 |
| --- | --- |
| 创建 | CreateContainer 在沙箱内分配容器资源 |
| 启动 | StartContainer |
| 停止 | StopContainer（可带超时） |
| 删除 | RemoveContainer |

**版本协商**  
**Version** RPC 返回 `version`、`runtime_name`、`runtime_version`、`runtime_api_version` 等，供 kubelet 校验兼容性。

### 2.5 预期使用者

1. **kubelet**：Pod/容器生命周期、资源统计、exec、日志、端口转发等（调用顺序由 kubelet 约定）。  
2. **crictl**：节点排障，**不适用于**集群外通用编排或替代 Kubernetes。

### 2.6 主流 CRI 实现

| 运行时 | 维护方 | 特点 | 典型场景 |
| --- | --- | --- | --- |
| **containerd** | CNCF | 轻量、高性能、生产成熟 | 多数云与自建集群 |
| **CRI-O** | Red Hat / CNCF | 面向 K8s、OCI 兼容 | OpenShift、安全合规场景 |

**安全增强运行时**（常通过 **RuntimeClass** 接入，非直接实现 CRI）：**Kata Containers**、**gVisor** 等。

### 2.7 RuntimeClass 示例

```yaml
# 通过 RuntimeClass 使用不同的容器运行时
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-containers
handler: kata
---
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  runtimeClassName: kata-containers
  containers:
  - name: app
    image: nginx
```

### 2.8 运维与最佳实践

- **选型**：性能（多选 containerd）、与发行版绑定（CRI-O）、安全（Kata/gVisor）。  
- **排障**：结合 **crictl** 查看运行时、容器、日志、exec。

```bash
crictl info
crictl ps
crictl logs <container-id>
crictl exec -it <container-id> /bin/bash
```

### 2.9 CRI 要点速查

| 方面 | 详情 |
| --- | --- |
| 目的 | kubelet 插件式对接多种容器运行时 |
| 技术 | Protocol Buffers v3 + gRPC |
| 服务 | RuntimeService、ImageService |
| 消费者 | kubelet、crictl |
| 设计理念 | 以 Kubernetes 为中心，非通用容器 API |
| 定义 | 上游 `api.proto`（随版本演进） |

---

## 3. 容器网络接口（CNI）

**CNI（Container Network Interface）** 是 **CNCF** 项目，定义**容器网络配置规范**与参考实现（如 **libcni**），聚焦：**容器加入网络（ADD）** 与 **退出网络（DEL）** 等，**不负责** Service 负载均衡（通常由 **kube-proxy** 等组件完成）。

### 3.1 核心组成

- **规范**：配置格式、插件调用协议、返回结果类型。  
- **库**：以 Go **libcni** 为主，供运行时集成。  
- **插件**：可执行文件，完成具体网络配置。

### 3.2 高层架构

![CNI 高层架构](/images/K8s学习-PartI-基础架构与核心抽象/CNI 高层架构.png)

*图：CNI 高层架构*


### 3.3 关键组件关系

![CNI 关键组件关系](/images/K8s学习-PartI-基础架构与核心抽象/CNI 组件关系.png)

*图：CNI 关键组件关系*


### 3.4 网络配置示例（JSON）

```json
{
  "cniVersion": "1.1.0",
  "name": "example-network",
  "plugins": [
    {
      "type": "bridge",
      "bridge": "cni0",
      "ipam": {
        "type": "host-local",
        "subnet": "10.22.0.0/16"
      }
    }
  ]
}
```

### 3.5 插件操作类型

| 操作 | 目的 | 典型环境变量 |
| --- | --- | --- |
| **ADD** | 将容器加入网络 | `CNI_COMMAND`, `CNI_CONTAINERID`, `CNI_NETNS`, `CNI_IFNAME` |
| **DEL** | 从网络移除容器 | `CNI_COMMAND`, `CNI_CONTAINERID`, `CNI_IFNAME` |
| **CHECK** | 校验网络配置 | `CNI_COMMAND`, `CNI_CONTAINERID`, `CNI_NETNS`, `CNI_IFNAME` |
| **GC** | 清理过期资源 | `CNI_COMMAND`, `CNI_PATH` |
| **VERSION** | 查询插件版本 | `CNI_COMMAND` |

### 3.6 插件执行流程

![CNI 插件执行流程（含 IPAM 委托）](/images/K8s学习-PartI-基础架构与核心抽象/CNI 插件执行流程.png)

*图：CNI 插件执行流程（含 IPAM 委托）*


### 3.7 插件类型与 libcni

- **Main**：bridge、macvlan、ipvlan 等，创建接口。  
- **IPAM**：host-local、dhcp、static 等，地址分配。  
- **Chain**：portmap、bandwidth、tuning 等，在链上增强。  
- **Meta**：如 multus，串联多插件。

**libcni** 核心接口示意：

```go
type CNI interface {
    AddNetworkList(net *NetworkConfigList, rt *RuntimeConf) (types.Result, error)
    DelNetworkList(net *NetworkConfigList, rt *RuntimeConf) error
    CheckNetworkList(net *NetworkConfigList, rt *RuntimeConf) error
    // ...
}
```

### 3.8 结果类型关系

![CNI 结果类型关系](/images/K8s学习-PartI-基础架构与核心抽象/CNI 结果类型关系.png)

*图：CNI 结果类型关系*


主要类型包括 **Result**、**DNS**、**Route**、**Error** 等（见 CNI `pkg/types`）。

### 3.9 常用插件（摘录）

| 类型 | 插件 | 功能 |
| --- | --- | --- |
| Main | bridge | Linux 网桥连接主机与容器 |
| Main | macvlan / ipvlan | 独立 MAC 或 L2/L3 虚拟接口 |
| IPAM | host-local | 本地地址池 |
| Chain | portmap | 端口映射（如 iptables） |
| Chain | bandwidth | 带宽限制 |

### 3.10 链式配置示例

```json
{
  "cniVersion": "1.0.0",
  "name": "mynet",
  "plugins": [
    {
      "type": "bridge",
      "bridge": "mynet0",
      "ipam": {
        "type": "host-local",
        "subnet": "10.10.0.0/16"
      }
    },
    {
      "type": "portmap",
      "capabilities": {"portMappings": true}
    }
  ]
}
```

### 3.11 设计原则（摘要）

- 运行时在调用插件前准备好**网络命名空间**。  
- **ADD** 按配置顺序执行；**DEL** 逆序；**DELETE 幂等**。  
- **同一容器**不并行 CNI 操作；不同容器可并行。  
- 以 **ContainerID** 唯一标识容器。

### 3.12 生态与排障

- **采用方**：Kubernetes、OpenShift、Mesos、ECS 等。  
- **方案**：Calico、Cilium、Weave、AWS VPC CNI、Azure CNI 等。  
- **排障**：kubelet 日志、CNI Pod 日志、节点路由 / 策略（iptables、eBPF 等）。

### 3.13 本节小结

CNI 把**容器网络配置**标准化为**可插拔插件**，是 Kubernetes **Pod 网络**的事实基础。

---

## 4. 容器存储接口（CSI）

**CSI（Container Storage Interface）** 统一**编排系统与存储后端**的交互；在 Kubernetes 中以 **out-of-tree** 驱动形式部署，与核心代码解耦。

> **说明**：当前配图目录中**无单独 CSI 架构示意图**，下文以**组件表 + YAML** 说明；若后续补充图片，可放在同一 `images` 目录并在此处引用。

### 4.1 在 Kubernetes 中的演进（摘要）

| 版本 | 说明 |
| --- | --- |
| v1.9 | Alpha |
| v1.10 | Beta |
| v1.13 | GA |
| v1.14+ | 推荐作为存储扩展主方式 |

### 4.2 CSI 驱动典型组件

| 侧 | 组件 | 职责 |
| --- | --- | --- |
| **Controller** | CSI Controller + external-provisioner 等 | 监听 PVC、Create/Delete Volume 等 |
| **Controller** | external-attacher | VolumeAttachment 挂载协调 |
| **Controller** | external-resizer / snapshotter | 扩容、快照（视驱动能力） |
| **Node** | CSI Node + node-driver-registrar | 节点上 Stage/Publish 卷、向 kubelet 注册 |

### 4.3 PV 中 CSI 字段（摘录）

| 字段 | 说明 |
| --- | --- |
| `driver` | CSI 驱动名（必填） |
| `volumeHandle` | 卷唯一标识 |
| `readOnly` | 是否只读 |
| `fsType` | 文件系统类型 |
| `volumeAttributes` | 驱动自定义参数 |

### 4.4 动态供给：StorageClass + PVC

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd-storage
provisioner: csi.example.com
parameters:
  type: ssd
  replication: "3"
  fsType: ext4
allowVolumeExpansion: true
reclaimPolicy: Delete
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-storage-claim
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: fast-ssd-storage
```

### 4.5 静态 PV 示例

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: existing-volume-pv
spec:
  capacity:
    storage: 10Gi
  volumeMode: Filesystem
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  csi:
    driver: csi.example.com
    volumeHandle: existing-volume-id
    readOnly: false
    fsType: ext4
    volumeAttributes:
      storage.kubernetes.io/csiProvisionerIdentity: csi.example.com
```

### 4.6 Pod 挂载 PVC

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-pod
spec:
  containers:
  - name: app-container
    image: nginx:1.20
    volumeMounts:
    - name: app-storage
      mountPath: /data
  volumes:
  - name: app-storage
    persistentVolumeClaim:
      claimName: app-storage-claim
```

### 4.7 CSI 接口与 Sidecar（摘要）

驱动需实现 **Identity / Controller / Node** 等 gRPC 服务（以 CSI spec 为准）。社区常见 **Sidecar**：external-provisioner、external-attacher、external-resizer、external-snapshotter、node-driver-registrar、livenessprobe 等。

### 4.8 快照与克隆（示例）

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: my-snapshot
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: app-storage-claim
```

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cloned-pvc
spec:
  dataSource:
    name: app-storage-claim
    kind: PersistentVolumeClaim
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

扩容：修改 PVC 的 `spec.resources.requests.storage`（需 StorageClass `allowVolumeExpansion` 且驱动支持）。

### 4.9 部署与排障建议

- Controller 多副本 Deployment；Node 侧 **DaemonSet**。  
- 配置 **RBAC**、**健康探针**。  

```bash
kubectl get csidrivers
kubectl get csinodes
kubectl get volumeattachments
kubectl get storageclass
```

常见问题：注册失败看 **node-driver-registrar**；挂载失败看 **CSI Node** 与 **kubelet**；动态供给失败看 **provisioner** 与 **StorageClass**。

### 4.10 本节小结

CSI 将**存储实现**移出 Kubernetes 核心，通过标准 gRPC 与 **PV/PVC/StorageClass** 集成，是云原生存储扩展的主路径。

---

## 5. 参考

- [Kubernetes 教程（Jimmy Song）— 开放接口](https://jimmysong.io/zh/book/kubernetes-handbook/)
- [CRI 与 kubelet](https://kubernetes.io/docs/concepts/containers/runtime-class/)
- [CNI Specification](https://github.com/containernetworking/cni/blob/main/SPEC.md)
- [CSI Specification](https://github.com/container-storage-interface/spec)
