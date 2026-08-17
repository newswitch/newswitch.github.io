---
title: Ceph RBD、CephFS 与 RGW 在 AI 集群中的选型
sidebar_label: "30. Ceph RBD、CephFS 与 RGW 在 AI 集群中的选型"
date: 2026-08-06 17:20:00
categories: 云原生
tags: [Kubernetes, GPU, Ceph, RBD, CephFS, RGW]
---

# Ceph RBD、CephFS 与 RGW 在 AI 集群中的选型

Ceph 不是一种单一的“共享盘”。它在同一个 RADOS 底座上提供块、文件和对象三种接口：

```text
                    ┌─ RBD：块设备
应用 / Kubernetes ─┼─ CephFS：共享文件系统
                    └─ RGW：S3 / Swift 对象接口
                              │
                              ▼
                         RADOS / OSD
```

三者共用 Ceph 集群，不代表使用方式和性能模型相同。本篇只讨论它们在 AI/GPU 工作负载中的选择；Ceph 原理、部署和日常运维请按独立 Ceph 系列学习。

---

## 1. 学习目标

完成本文后，你应该能够：

- 区分块、文件和对象接口的访问语义。
- 为模型权重、训练数据集、Checkpoint 和缓存选择接口。
- 解释 RBD、CephFS 和 RGW 到 GPU Pod 的数据路径。
- 理解 Ceph CSI 在 RBD 与 CephFS 中承担什么工作。
- 建立应用、CSI、Ceph 客户端和 OSD 四层排障方法。

---

## 2. 先从应用需要的语义选择

不要先问“哪个性能最好”，先问应用怎样访问数据：

| 应用需求 | 首选方向 |
|----------|----------|
| 一个 Pod/节点需要独立卷 | RBD |
| 多节点需要同一个 POSIX 目录 | CephFS |
| 通过 HTTP/S3 API 管理不可变制品 | RGW |
| 多 Pod 共享只读模型路径 | CephFS，或 RGW + 本地缓存 |
| 单写者 Checkpoint 卷 | RBD |
| 多 rank 需要共享 Checkpoint 目录 | CephFS |
| 模型和数据集的权威仓库 | RGW |
| GPU 节点高速热缓存 | Local NVMe，源数据可来自 RGW/CephFS |

性能只有在语义正确之后才有意义。

---

## 3. RBD：给 Pod 一块网络块设备

RBD 把 Ceph 中的对象组织成块设备。Linux 节点可以通过内核 RBD 或其他受支持方式映射它，再创建文件系统并挂载给 Pod。

```text
Pod /checkpoint
  → ext4 / XFS
  → /dev/rbdX
  → RBD Client
  → Ceph Public Network
  → Primary OSD
  → 副本或纠删码写入
```

### 3.1 适合场景

- 单训练任务的 Checkpoint 卷。
- 推理服务独立模型卷。
- 需要快照、克隆和独立容量管理的工作负载。
- 应用需要普通文件系统，但不需要多节点共享写目录。

### 3.2 不适合直接解决的问题

一个普通文件系统格式的 RBD 卷通常面向单节点挂载。不能把“RBD 底层是分布式存储”误解成“任意节点可以同时挂载同一个 ext4 卷读写”。

多节点同时访问相同目录，应使用 CephFS，或由应用通过对象接口协作。

### 3.3 Kubernetes 路径

```text
PVC
  → ceph-csi RBD Controller 创建 RBD Image
  → 调度 Pod
  → 映射 RBD 到目标节点
  → 格式化（首次）并挂载
  → bind mount 到容器
```

一个使用现有 StorageClass 的 PVC：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: train-checkpoint
  namespace: ai
spec:
  accessModes:
    - ReadWriteOnce
  volumeMode: Filesystem
  storageClassName: ceph-rbd
  resources:
    requests:
      storage: 2Ti
```

`ceph-rbd` 的真实参数应由集群管理员配置，不能照抄未知集群的 FSID、Pool 和 Secret。

---

## 4. CephFS：多节点共享 POSIX 文件系统

CephFS 提供目录、文件、权限和一致的文件系统命名空间。

```text
GPU Pod
  → CephFS Kernel Client / FUSE Client
  ├─ 元数据请求 → MDS
  └─ 文件数据   → OSD
```

MDS 主要管理目录、inode、权限等元数据；文件数据仍存放在 RADOS。

### 4.1 适合场景

- 多个推理 Pod 共享只读模型目录。
- 多节点训练读取同一数据集。
- 分布式训练共享 Checkpoint 目录。
- 需要 POSIX 工具链和路径语义的工作流。

### 4.2 主要性能边界

- 大文件顺序读取：主要看 OSD、网络和客户端并发。
- 海量小文件：MDS、目录分布和客户端缓存更关键。
- 多 Pod 同时冷启动：共享后端带宽可能被打满。
- 多 rank 写同一目录：需要应用避免文件名冲突和元数据风暴。

### 4.3 Kubernetes PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-dataset
  namespace: ai
spec:
  accessModes:
    - ReadWriteMany
  volumeMode: Filesystem
  storageClassName: cephfs
  resources:
    requests:
      storage: 20Ti
```

模型服务仍建议只读挂载：

```yaml
volumeMounts:
  - name: dataset
    mountPath: /dataset
    readOnly: true
```

RWX 表示后端和卷允许多节点读写，不表示每个使用者都应该拥有写权限。

---

## 5. RGW：S3 兼容对象接口

RGW 通过 HTTP API 提供 Bucket、Object、Key 和元数据语义。

```text
应用 / SDK / CLI
  → HTTP(S)
  → Load Balancer / Ingress
  → RGW
  → RADOS
  → OSD
```

### 5.1 适合场景

- 模型权重的权威版本仓库。
- 原始数据集、归档数据。
- Checkpoint 归档和跨集群分发。
- 由应用或数据流水线直接使用 S3 API 的场景。

### 5.2 它不是普通文件系统

对象存储没有天然的 POSIX 目录、随机覆盖写、文件锁和 `rename()` 语义。所谓目录通常只是 Key 前缀。

不要未经验证就把 S3 通过 FUSE 挂成目录，让所有训练框架当成本地文件系统使用。兼容层可能在元数据、随机 IO、一致性和错误恢复上表现不同。

### 5.3 推荐使用方式

```text
RGW 中的不可变模型版本
  → 下载器并发拉取
  → 校验 manifest / checksum
  → 节点 Local NVMe 或共享文件卷
  → GPU Pod 从 POSIX 路径加载
```

RGW 更适合“制品分发源”，Local NVMe 更适合“热缓存”。

---

## 6. 同一个模型的三种路径

### RBD

```text
RBD Image → 节点块设备 → 文件系统 → Pod → CPU 内存 → HBM
```

每个卷独立，容易做快照和克隆；多个节点共享同一路径不方便。

### CephFS

```text
CephFS → 多节点内核客户端 → Pod 共享路径 → CPU 内存 → HBM
```

共享方便，但冷启动并发会集中打向 MDS、OSD 和存储网络。

### RGW + NVMe

```text
RGW → HTTP 下载 → 节点 NVMe 缓存 → Pod → CPU 内存 → HBM
```

首次分发多一步，命中本地缓存后的加载路径更短，也能隔离推理高峰对 Ceph 的持续压力。

---

## 7. AI 场景选型表

| 工作负载 | RBD | CephFS | RGW |
|----------|-----|--------|-----|
| 单 Pod 模型卷 | 推荐 | 可用 | 先下载 |
| 多 Pod 共享模型 | 每 Pod/节点独立卷或克隆 | 推荐 | 推荐作为源 + 缓存 |
| 大文件训练数据 | 可为单任务独立提供 | 推荐共享 | 适合分片式数据管道 |
| 海量小文件 | 文件系统本身可用，管理不便 | 需关注 MDS | 建议重新组织为较大对象 |
| 单写 Checkpoint | 推荐 | 可用 | 适合上传完成版本 |
| 多节点共享 Checkpoint | 不推荐普通多挂载 | 推荐 | 应用需按对象语义实现 |
| 归档与版本仓库 | 一般 | 可用 | 推荐 |
| 快照/克隆 | 推荐 | 视能力与方案 | 用版本/复制语义 |

这张表是起点，不替代真实业务压测。

---

## 8. Pool 与故障域不能忽略

RBD、CephFS 和 RGW 可以共用一套 OSD，但生产中仍需考虑：

- 不同用途是否使用独立 Pool。
- 副本或纠删码策略。
- CRUSH failure domain 是否符合机架/主机故障模型。
- NVMe、SSD、HDD 设备类别。
- 恢复流量是否会挤占训练读取。
- 模型冷启动与 Checkpoint 是否互相干扰。

例如：

```text
模型读取高峰 + 大规模 Checkpoint + OSD recovery
```

三者可能同时争用存储网络和 OSD。只观察 GPU 和 NCCL，容易误判成计算或通信问题。

---

## 9. 容量规划

Ceph 用户看到的可用容量不能简单等于所有裸盘之和。

至少考虑：

- 副本数或纠删码开销。
- 预留恢复空间。
- 模型多个 revision。
- 数据集副本和临时转换结果。
- Checkpoint 保留代数。
- RBD 快照/克隆的后续增量。
- RGW 不完整 Multipart Upload。

完整方法见：

- [Ceph 容量计算](../03-deployment/08-Ceph容量计算.md)
- [副本、纠删码与一致性](../02-architecture/06-副本纠删码与一致性.md)

---

## 10. 压测要按接口进行

### 10.1 RBD

在专用测试卷内使用 `fio`，记录：

- 顺序读写带宽。
- 随机 IOPS。
- 平均与 P99 延迟。
- 单卷与多卷并发。

### 10.2 CephFS

除 `fio` 外还要测试：

- 多客户端并发。
- 目录遍历。
- 文件创建/删除。
- 真实 DataLoader。
- 多 Pod 同时模型加载。

### 10.3 RGW

测试：

- 单对象与并发对象 GET/PUT。
- Multipart Upload。
- Range GET。
- 首字节延迟。
- 网关负载均衡。
- 下载器端到端校验时间。

不要拿 RBD 的 4 KiB 随机写结果直接推断 RGW 下载模型的性能。

---

## 11. 建立完整时间线

模型加载慢时，把时间拆开：

```text
T0 Pod 已调度
T1 CSI 挂载完成
T2 应用开始遍历目录/请求对象
T3 权重读取完成
T4 反序列化完成
T5 H2D 完成
T6 模型初始化完成
T7 Ready
```

判断：

- T0→T1 慢：CSI、挂载、映射或认证。
- T1→T3 慢：CephFS/RBD/RGW、网络或缓存。
- T3→T4 慢：CPU、文件格式、反序列化。
- T4→T5 慢：PCIe、pinned memory、NUMA。
- T5→T7 慢：GPU 初始化、Kernel 编译、CUDA Graph 或预热。

---

## 12. 四层排障

### 第一层：应用与 Pod

```bash
kubectl -n ai describe pod <pod>
kubectl -n ai logs <pod> --all-containers
kubectl -n ai exec <pod> -- df -hT
```

检查挂载路径、只读设置、UID/GID、文件是否完整。

### 第二层：Kubernetes 与 CSI

```bash
kubectl -n ai get pvc
kubectl get pv
kubectl get csidriver,csinode
kubectl -n <ceph-csi-namespace> get pods -o wide
```

检查 PVC 绑定、Controller、Node Plugin、Secret、StorageClass 和事件。

### 第三层：节点 Ceph 客户端

RBD 检查映射和挂载；CephFS 检查客户端挂载、内核日志和网络连通。

```bash
findmnt
lsblk
dmesg -T | tail -n 100
journalctl -u kubelet --since "30 min ago"
```

### 第四层：Ceph 集群

```bash
ceph -s
ceph health detail
ceph osd tree
ceph osd perf
ceph fs status
```

根据接口继续检查 MDS、RGW、Pool、慢请求和 OSD 恢复状态。

---

## 13. 常见误区

### CephFS 和 RBD 都在 Ceph 上，所以性能一样

错误。两者客户端路径、元数据模型、挂载方式和共享语义都不同。

### RBD 是分布式块存储，所以可以随意多节点挂同一个 ext4

错误。底层分布式不改变普通文件系统的单主机写入假设。

### RGW 兼容 S3，所以就是共享文件系统

错误。对象语义与 POSIX 文件语义不同。

### Ceph 健康为 OK，应用就不可能慢

错误。`HEALTH_OK` 不代表当前延迟满足 AI 业务 SLO，也不排除 CSI、客户端缓存、网络和应用解析瓶颈。

### GPU 利用率低一定是 GPU 问题

错误。训练进程等待 CephFS 数据或 Checkpoint 写入时，GPU 同样会空闲。

---

## 14. 推荐分层架构

```text
RGW：模型、数据集、Checkpoint 的权威版本和归档
  │
  ├─ CephFS：需要多节点共享的活跃数据
  │
  ├─ RBD：单任务独立卷、单写 Checkpoint
  │
  └─ Local NVMe：GPU 节点热缓存与临时空间
```

并非每个集群都要同时使用四层。小规模环境可以从 CephFS 或 NFS 开始；规模和性能问题出现后，再基于测量增加本地缓存或对象分发。

---

## 15. 本篇总结

选择方法：

```text
需要块设备和独立卷 → RBD
需要多节点共享 POSIX 路径 → CephFS
需要大规模制品仓库和 API 访问 → RGW
需要最低加载延迟 → 再叠加 Local NVMe 缓存
```

上一篇：[NFS 在 AI 集群中的使用与性能分析](../../nfs/01-NFS在AI集群中的使用与性能分析.md)。下一篇：[对象存储与模型仓库设计](../../ai-workloads/04-对象存储与模型仓库设计.md)。

Ceph 系统学习入口：[Ceph 学习路线](../00-Ceph学习路线.md)。

---

## 16. 课后练习

1. 为什么多节点共享模型目录更适合 CephFS 而不是普通 RBD？
2. RGW 与 CephFS 中的“目录”有什么本质区别？
3. 为模型、数据集、Checkpoint、缓存分别选择接口并说明理由。
4. 创建一个 RBD PVC 和一个 CephFS PVC，比较 AccessMode 与 Pod 挂载方式。
5. 同时启动多个 Pod 读取 CephFS 模型，记录 Ceph 和 GPU 指标。
6. 人为停止一个 CSI Node Plugin，观察 Pod 事件并恢复。

---

## 参考与致谢

- [Ceph Architecture](https://docs.ceph.com/en/latest/architecture/)
- [Ceph Beginner's Guide — Storage Interfaces](https://docs.ceph.com/en/latest/start/beginners-guide/)
- [CephFS](https://docs.ceph.com/en/latest/cephfs/)
- [Ceph Block Devices and Kubernetes](https://docs.ceph.com/en/latest/rbd/rbd-kubernetes/)
- [Ceph Object Gateway](https://docs.ceph.com/en/latest/radosgw/)

本文根据 Ceph 官方文档整理，并与本站 Ceph 系列建立交叉链接。
