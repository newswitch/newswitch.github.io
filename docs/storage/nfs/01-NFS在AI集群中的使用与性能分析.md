---
title: "NFS 在 AI 集群中的使用与性能分析"
sidebar_label: "01. NFS 在 AI 集群中的使用与性能分析"
sidebar_position: 1
description: "NFS 的优点是简单、POSIX 兼容、多个节点可以看到同一个目录。它很适合中小规模模型共享，但也容易在多 Pod 冷启动和小文件数据集场景形成瓶颈。"
tags: [Kubernetes, GPU, NFS, CSI, 存储]
date: 2026-08-06 17:10:00
categories: 云原生
---

# NFS 在 AI 集群中的使用与性能分析

NFS 的优点是简单、POSIX 兼容、多个节点可以看到同一个目录。它很适合中小规模模型共享，但也容易在多 Pod 冷启动和小文件数据集场景形成瓶颈。

本文不把 NFS 简化为“一条 mount 命令”，而是从客户端 IO 一直追踪到 Kubernetes Pod。

## 1. 学习目标

完成本文后，你应该能够：

- 解释 NFS 客户端、服务端、导出目录和挂载点的关系。
- 判断模型权重、数据集和 Checkpoint 是否适合使用 NFS。
- 区分静态 NFS PV、NFS CSI 和子目录 provisioner。
- 创建支持 RWX 的 NFS PVC。
- 测量单客户端、多客户端、顺序 IO 和元数据性能。
- 排查权限、超时、挂载、容量和冷启动风暴。

## 2. NFS 的基本架构

```text
GPU Pod
  → 容器中的 /models
  → 节点 NFS Client
  → TCP/IP 网络
  → NFS Server
  → 服务端文件系统
  → RAID / SSD / NVMe / 后端存储
```

Pod 看见的是 POSIX 文件路径，但每次缓存未命中的读取最终可能变成网络请求。

因此 NFS 性能同时受这些因素影响：

- 客户端页缓存。
- NFS 协议版本和挂载参数。
- 节点到服务端的网络。
- 服务端 CPU、内存和网络。
- 服务端文件系统与磁盘。
- 并发客户端数量。
- 文件大小、目录规模和访问模式。

## 3. NFSv3 与 NFSv4

学习阶段先掌握差异方向，不要死记所有协议字段：

| 维度 | NFSv3 | NFSv4.x |
|------|-------|---------|
| 状态模型 | 相对简单 | 有状态，包含更完整的锁与恢复语义 |
| 端口 | 可能依赖多个 RPC 服务 | 通常以 2049 为核心 |
| 身份 | 常见 AUTH_SYS | 可结合更强认证机制 |
| 并发能力 | 成熟、兼容广 | 4.1+ 支持会话等改进 |
| 选择 | 兼容旧环境 | 新建环境通常优先评估 4.1+ |

具体版本应根据 NFS 服务端、Linux 内核、网络和厂商支持矩阵确定。不要只因版本数字更高就跳过压测。

## 4. AI 工作负载是否适合 NFS

### 4.1 模型权重

适合度：较高。

模型权重通常是大文件、读取为主，多个 Pod 可以用 RWX/ROX 共享同一份目录。

主要风险是副本同时启动：

```text
100 GiB 模型 × 20 个 Pod
```

如果客户端缓存均未命中，NFS 服务端可能在短时间承担接近 2 TiB 的读取请求。

### 4.2 训练数据集

- 大分片顺序读：相对适合。
- 数百万小文件：容易被元数据和 RPC 往返限制。
- 高并发随机采样：必须实测。

改善方式包括把小文件打包成适合框架的数据分片、增加 DataLoader 并发但避免过载、使用节点缓存。

### 4.3 Checkpoint

NFS 能提供共享命名空间，但 Checkpoint 常产生集中写流量。

建议：

- 每个训练任务使用独立目录。
- 只让约定的 rank 写主 Checkpoint。
- 写临时文件后原子重命名。
- 保留上一个可用版本。
- 监控 `fsync` 和尾延迟，不只看平均带宽。

### 4.4 高频临时文件

编译缓存、临时解压和可重建中间数据优先放本地 NVMe，避免让 NFS 承担不必要的元数据压力。

## 5. 三种 Kubernetes 接入方式

### 5.1 Pod 直接声明 nfs

```yaml
volumes:
  - name: models
    nfs:
      server: 10.0.20.10
      path: /exports/models
      readOnly: true
```

优点是简单，缺点是服务端地址散落在工作负载 YAML 中，不利于权限和生命周期治理。

### 5.2 静态 PV/PVC

管理员预先建立 PV，用户通过 PVC 申请。适合目录和权限已提前规划的环境。

### 5.3 NFS CSI 动态供给

NFS CSI 驱动使用已有的 NFSv3/NFSv4 服务端，并可在共享目录下为 PVC 创建子目录。

```text
PVC
  → external-provisioner
  → NFS CSI Controller
  → 创建子目录并生成 PV
  → kubelet 调用 Node Plugin
  → 节点 mount NFS
  → bind mount 到 Pod
```

CSI 管理的是 Kubernetes 接入过程，不会把单台 NFS Server 自动变成高可用存储。

## 6. 使用 NFS CSI

安装驱动时应固定经过验证的发布版本，并检查该版本与 Kubernetes 的兼容矩阵。下面只展示安装完成后的 StorageClass 和工作负载。

### 6.1 StorageClass

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-models
provisioner: nfs.csi.k8s.io
parameters:
  server: 10.0.20.10
  share: /exports/kubernetes
  subDir: ${pvc.metadata.namespace}/${pvc.metadata.name}
  onDelete: retain
reclaimPolicy: Retain
volumeBindingMode: Immediate
allowVolumeExpansion: true
mountOptions:
  - nfsvers=4.1
  - hard
```

说明：

- NFS CSI 需要已经存在并正常导出的 NFS 服务。
- `subDir` 用命名空间和 PVC 名称隔离目录。
- `onDelete` 与 `reclaimPolicy` 都要按数据保留要求审查。
- `hard` 挂载在服务端短暂不可用时会持续重试，能降低静默数据错误风险，但进程可能长时间处于不可中断 IO 等待。
- 不要复制未经验证的性能参数到生产环境。

### 6.2 PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-models
  namespace: ai
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: nfs-models
  resources:
    requests:
      storage: 500Gi
```

注意：部分基于 NFS 子目录的动态供给方式只是创建目录，PVC 声明的容量不一定会在服务端形成真正硬配额。必须确认具体驱动和服务端是否实施 quota。

### 6.3 多 Pod 只读使用

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: model-server
  namespace: ai
spec:
  replicas: 2
  selector:
    matchLabels:
      app: model-server
  template:
    metadata:
      labels:
        app: model-server
    spec:
      containers:
        - name: model-server
          image: ubuntu:24.04
          command: ["bash", "-lc", "ls -lah /models && sleep 3600"]
          resources:
            limits:
              nvidia.com/gpu: 1
          volumeMounts:
            - name: models
              mountPath: /models
              readOnly: true
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: shared-models
            readOnly: true
```

PVC 可以是 RWX，但模型服务仍应按容器只读挂载。访问模式表示卷能力，不代替目录权限和应用写入控制。

## 7. 权限模型

NFS 常见权限问题来自数字 UID/GID 不一致：

```text
容器用户 UID 1000
        │
        ▼
NFS Server 看到的仍是 UID 1000
        │
        ▼
目录所有者/权限是否允许访问
```

检查：

```bash
id
stat -c '%u:%g %a %n' /models
kubectl -n ai exec <pod> -- id
```

常见方案：

- 组织统一 UID/GID。
- 使用 Pod `securityContext` 的 `runAsUser`、`runAsGroup`、`fsGroup`。
- 预先在服务端创建正确属主和权限。
- 对多租户使用独立导出或严格目录隔离。

不要用全局 `0777` 掩盖权限设计问题。`root_squash` 是重要保护机制，不应为了方便随意关闭。

## 8. 缓存怎样影响测试

第一次读：

```text
Pod → NFS 网络 → 服务端磁盘
```

第二次读可能变成：

```text
Pod → 客户端 Linux 页缓存
```

也可能命中服务端页缓存。因此“第二次加载很快”不等于后端存储有同样吞吐。

压测至少区分：

- 冷缓存与热缓存。
- 单客户端与多客户端。
- 单文件与多文件。
- 顺序读、随机读和元数据。
- 平均延迟与 P95/P99。

清理系统缓存会影响整台机器，只能在隔离测试环境由管理员执行，不应在生产 GPU 节点随意操作。

## 9. 分层压测

### 9.1 网络

```bash
iperf3 -c <nfs-server> -P 4
```

先确认网络上限，再讨论文件系统。

### 9.2 挂载与协议

```bash
findmnt -t nfs,nfs4
nfsstat -m
mount | grep nfs
```

记录实际协商的 NFS 版本和挂载参数。

### 9.3 大文件读取

在专用测试目录：

```bash
fio --name=nfs-seqread \
  --directory=/models/benchmark \
  --rw=read --bs=1M --size=8G \
  --direct=1 --iodepth=16 --numjobs=1 \
  --runtime=60 --time_based --group_reporting
```

### 9.4 元数据与小文件

可使用 `mdtest`、应用自己的数据加载器，或记录：

```bash
time find /models/dataset -type f | wc -l
```

`find` 只能粗略观察目录遍历，不等于真实训练性能。

### 9.5 多节点并发

使用多个测试 Pod 同时启动，记录：

- NFS 服务端出口流量。
- 客户端吞吐。
- 模型加载完成时间分布。
- 服务端 CPU、磁盘延迟。
- GPU 空闲等待时间。

## 10. 多 Pod 冷启动风暴

单 Pod 加载 100 GiB 模型用了 100 秒，并不代表 20 个 Pod 仍是 100 秒。

共享带宽近似估算：

```text
每 Pod 可得带宽 ≈ NFS 有效总带宽 ÷ 同时读取 Pod 数
```

这只是上界，实际还会受到服务端磁盘、客户端数量、网络拥塞和元数据开销影响。

常用优化：

- 滚动或分批启动。
- 节点 Local NVMe 缓存。
- 预下载 DaemonSet/Job。
- 保持热副本，减少扩容时的集中读取。
- 把模型分发流量与业务流量隔离。
- 对大规模训练评估 CephFS、对象存储分层或并行文件系统。

## 11. 可观测性

客户端：

```bash
nfsstat -c
nfsiostat 1
iostat -x 1
ss -tan | grep ':2049'
```

服务端：

- 每个导出的读写吞吐。
- RPC 请求率、重传和错误。
- 网络吞吐与丢包。
- 后端磁盘利用率与延迟。
- CPU、内存和连接数。
- 目录容量与 inode 使用率。

应用：

- 模型下载/打开/读取/反序列化时间。
- DataLoader wait 时间。
- Checkpoint 持续时间。
- GPU 利用率中的周期性空洞。

## 12. 常见故障

### 12.1 PVC Pending

```bash
kubectl -n ai describe pvc shared-models
kubectl get sc nfs-models -o yaml
kubectl -n kube-system get pods -l app.kubernetes.io/name=csi-driver-nfs
```

检查 CSI Controller、StorageClass provisioner 名称、服务端和导出目录。

### 12.2 Pod ContainerCreating / FailedMount

```bash
kubectl -n ai describe pod <pod>
kubectl get csinode
journalctl -u kubelet --since "30 min ago"
```

在节点验证：

```bash
showmount -e 10.0.20.10
rpcinfo -p 10.0.20.10
nc -vz 10.0.20.10 2049
```

NFSv4 环境不应只依赖 `showmount` 结论，还要结合实际挂载和服务端配置。

### 12.3 Permission denied

检查：

- 容器 UID/GID。
- 服务端目录所有权。
- 导出规则。
- `root_squash`。
- `securityContext`。
- SELinux/AppArmor。

### 12.4 IO 卡住

`hard` 挂载在服务端或网络故障时可能让进程停在 IO 等待。

```bash
ps -eo state,pid,comm,wchan:32 | awk '$1=="D"'
nfsstat -c
ss -tan | grep ':2049'
```

不要把杀 Pod 当作根因修复；先检查 NFS 服务和网络恢复情况。

### 12.5 PVC 申请 500 GiB，却能写更多

基于共享目录的供给方式可能没有真正的后端 quota。需要在 NFS 后端建立配额，或明确将 PVC 容量视为调度/登记信息而非强制限制。

## 13. NFS 的高可用边界

NFS 协议支持共享访问，不代表一个 NFS 服务端天然高可用。

生产方案需要明确：

- 服务端是否单点。
- 后端磁盘是否有冗余。
- 服务 IP 如何漂移。
- 状态和锁怎样恢复。
- 故障切换的 RTO/RPO。
- 客户端在切换期间如何表现。

如果无法回答这些问题，NFS 仍可作为实验或缓存源，但不应直接承担关键训练数据的唯一副本。

## 14. 与 GPU 数据路径的关系

普通 NFS 模型加载：

```text
NFS Server
  → 存储网络
  → 节点 NFS Client
  → Linux Page Cache / 用户缓冲区
  → pinned memory
  → PCIe H2D
  → HBM
  → GPU 计算
```

如果启用 GDS，需要具体 NFS 客户端、网络、驱动和文件系统在支持矩阵内，不能因为“使用了 RDMA 网卡”就推断 NFS 数据已经直达 GPU。

## 15. 选型结论

适合 NFS：

- 中小规模共享模型目录。
- 团队需要简单 POSIX 路径。
- 读取为主，数据规模和并发可控。
- 已有可靠 NAS/NFS 服务。

需要谨慎：

- 数百节点同时冷启动。
- 海量小文件随机训练。
- 高频、大规模 Checkpoint。
- 对带宽横向扩展要求很高。
- 服务端是无冗余单机。

## 16. 本篇总结

NFS 的核心价值是共享 POSIX 目录；核心风险是所有客户端最终竞争服务端、网络和后端磁盘。

分析时按顺序定位：

```text
应用访问模式
→ 客户端缓存与挂载参数
→ 网络
→ NFS 服务
→ 服务端文件系统
→ 后端磁盘
```

上一篇：[本地 NVMe 与 Local PV 实践](../ai-workloads/03-本地NVMe与Local-PV实践.md)。下一篇：[Ceph RBD、CephFS 与 RGW 在 AI 集群中的选型](../ceph/08-ai-workloads/30-AI集群中的Ceph接口选型.md)。

## 17. 课后练习

1. NFS RWX 和“所有 Pod 都应该写模型目录”是一回事吗？
2. 为什么第二次读取模型更快不能证明 NFS 后端更快？
3. NFS CSI 驱动是否会自动提供高可用 NFS Server？
4. 创建 RWX PVC，让两个节点上的 Pod 同时读取同一文件。
5. 对比一个 4 GiB 文件和十万个小文件的读取时间。
6. 同时启动 1、2、4 个读取 Pod，记录总吞吐和完成时间。
7. 制造错误 UID/GID，使用事件、`id` 和 `stat` 定位权限问题。

### 17.1 参考答案 {/* #参考答案 */}

1. 不是。RWX只表示多个客户端可以挂载并读写，是否允许写模型目录还要由POSIX权限、只读挂载、发布流程和应用职责控制；生产模型revision通常应只读。
2. 第二次读取可能命中客户端Page Cache、服务端缓存或节点本地缓存，后端没有再次提供同等IO。必须控制缓存状态并同时观察NFS服务端磁盘和网络指标。
3. 不会。NFS CSI主要负责把已有NFS Export挂载给Pod，NFS Server本身的HA、复制、VIP和数据保护仍需独立建设。
4. 创建RWX PVC和两个带不同节点亲和性的Pod，分别挂载同一目录；Pod A写入带时间戳文件，Pod B校验内容和inode属性。验收还应包含只读/读写权限是否符合设计。
5. 两组总字节可相近，但十万个小文件会放大lookup、open、getattr和close，通常耗时更长、元数据RPC更多。记录总时间、文件/秒、RPC分布和服务端CPU。
6. 固定文件、缓存状态和节点，分别并发1/2/4个Pod，记录单Pod与聚合吞吐、完成时间、NFS Server网卡/磁盘和P95。若聚合不再增长而单Pod下降，说明共享瓶颈已出现。
7. 将容器运行UID/GID改为Export中文件不允许的身份；若挂载本身成功而读写失败，使用容器内`id`、`stat -c '%u:%g %a'`和服务端Export/root-squash配置核对身份映射。Kubernetes事件主要排除挂载阶段错误。

## 18. 参考与致谢 {/* #参考与致谢 */}

- [Kubernetes Volumes — NFS](https://kubernetes.io/docs/concepts/storage/volumes/#nfs)
- [Kubernetes Persistent Volumes — Access Modes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)
- [Kubernetes CSI NFS Driver](https://github.com/kubernetes-csi/csi-driver-nfs)
- [NFS CSI Driver Parameters](https://github.com/kubernetes-csi/csi-driver-nfs/blob/master/docs/driver-parameters.md)
- [NFS Subdir External Provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner)

本文根据 Kubernetes SIG Storage 官方项目与 Kubernetes 文档整理。挂载参数、协议版本和高可用方案必须在实际环境验证。
