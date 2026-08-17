---
title: 本地 NVMe 与 Local PV 实践
sidebar_label: "03. 本地 NVMe 与 Local PV 实践"
date: 2026-08-06 17:00:00
categories: 云原生
tags: [Kubernetes, GPU, NVMe, Local PV, 存储]
---

# 本地 NVMe 与 Local PV 实践：给 GPU 任务准备高速缓存盘

本篇解决一个具体问题：

> GPU 节点上有高速 NVMe，怎样把它安全地交给 Kubernetes 工作负载，并让调度器知道“数据和磁盘在哪台节点”？

本地 NVMe 很快，但它不是共享存储，也不会因为 Pod 漂移而自动跟着移动。理解这个限制，比记住一份 YAML 更重要。

---

## 1. 学习目标

完成本文后，你应该能够：

- 区分 NVMe、SSD、文件系统、`hostPath`、`emptyDir` 和 Local PV。
- 解释 Local PV 为什么必须带 `nodeAffinity`。
- 理解 `WaitForFirstConsumer` 怎样协调磁盘、GPU 和节点调度。
- 创建 StorageClass、PV、PVC 和测试 Pod。
- 设计“对象存储/共享存储 + 节点 NVMe 缓存”的模型分发方案。
- 排查 PVC Pending、Pod Pending、挂载失败、磁盘写满和节点故障。

---

## 2. NVMe 到底是什么

NVMe 是主机访问非易失性存储设备的一套协议，常见设备通过 PCIe 连接。它不是文件系统，也不等于某一种 NAND 介质。

```text
应用 read()
  → 文件系统（ext4 / XFS）
  → Linux 块层
  → NVMe 驱动
  → PCIe
  → NVMe SSD
```

对 AI 工作负载，常关注：

| 指标 | 影响 |
|------|------|
| 顺序读带宽 | 模型权重、大分片数据集加载 |
| 随机读 IOPS | 随机采样、大量小块访问 |
| 读延迟 | 高频、小批量同步读取 |
| 写带宽与尾延迟 | Checkpoint、缓存回写 |
| 容量 | 可缓存多少模型和数据 |
| 写入寿命 | 高频 Checkpoint、反复淘汰缓存 |

NVMe 快不代表应用一定快。大量小文件仍可能被元数据、目录遍历、反序列化和 CPU 处理限制。

---

## 3. 四种“使用节点磁盘”的方式

### 3.1 容器可写层

容器直接写根文件系统最简单，但数据随容器重建而变化，容量和回收难治理，不适合作为模型仓库。

### 3.2 emptyDir

`emptyDir` 与 Pod 生命周期绑定。Pod 在同一节点内重启容器时数据还在；Pod 被删除或重新创建后不能依赖数据继续存在。

适合：

- 临时解压目录。
- 推理进程的临时文件。
- 从对象存储下载的可重建缓存。

### 3.3 hostPath

`hostPath` 把节点目录直接暴露给 Pod。它绕过 PV/PVC 生命周期和存储调度，路径、权限、容量与安全都需要人工保证。

适合受控实验和系统组件，不建议让普通业务随意声明。

### 3.4 Local PersistentVolume

Local PV 用标准 PV/PVC 抽象表示节点本地磁盘或目录，并用 `nodeAffinity` 告诉调度器该卷属于哪台节点。

```text
Local PV = 本地介质 + PV 生命周期 + 节点拓扑约束
```

它解决了“让 Kubernetes 看见本地盘”的问题，但不提供跨节点复制和高可用。

---

## 4. 为什么必须使用 WaitForFirstConsumer

假设：

- `gpu-node-01` 有空闲 A100。
- `gpu-node-02` 有模型数据所在的 Local PV。

如果 PVC 先随意绑定到 `gpu-node-02`，而 Pod 又因为 GPU 条件只能去 `gpu-node-01`，任务就无法运行。

`WaitForFirstConsumer` 会推迟绑定，让调度器同时考虑：

- GPU 资源请求。
- NodeSelector / NodeAffinity。
- Taint / Toleration。
- PodAffinity / PodAntiAffinity。
- Local PV 的节点位置。

```text
创建 PVC
  → 暂不绑定
  → 创建消费 PVC 的 Pod
  → 调度器综合 GPU 与 Local PV 位置
  → 选出可行节点
  → PVC 绑定对应节点上的 PV
```

---

## 5. 实验前盘点

### 5.1 查看设备

```bash
lsblk -o NAME,MODEL,SIZE,TYPE,FSTYPE,MOUNTPOINTS
findmnt
df -hT
sudo nvme list
```

重点确认：

- 设备名称和容量。
- 是否已经有分区、文件系统或挂载点。
- 是否被系统、容器运行时或其他业务使用。
- NVMe 与 GPU、CPU NUMA 的物理关系。

```bash
lspci -tv
nvidia-smi topo -m
numactl -H
```

### 5.2 准备挂载目录

格式化磁盘会清除原有数据，生产操作前必须再次核对设备标识和备份。本文假设管理员已经把目标文件系统稳定挂载到：

```text
/mnt/local-nvme/models
```

应通过 `/etc/fstab`、systemd mount unit 或节点初始化系统保证重启后仍能挂载。不能只手工 `mount` 一次。

### 5.3 先测节点，不要先测 Pod

```bash
fio --name=seqread \
  --directory=/mnt/local-nvme/models \
  --rw=read --bs=1M --size=8G \
  --direct=1 --iodepth=32 --numjobs=1 \
  --runtime=60 --time_based --group_reporting
```

测试文件会占用空间；不要在包含唯一模型副本的目录中随意执行写测试。记录带宽、IOPS、平均延迟和高分位延迟。

---

## 6. 创建 Local PV

### 6.1 StorageClass

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-nvme
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
```

这里的 `no-provisioner` 表示 Kubernetes 不会自动创建实际磁盘。管理员仍需准备目录或使用外部 Local Volume Static Provisioner 管理发现过程。

### 6.2 PersistentVolume

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-nvme-models-gpu-node-01
  labels:
    storage.example.com/media: nvme
    storage.example.com/purpose: model-cache
spec:
  capacity:
    storage: 1Ti
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-nvme
  local:
    path: /mnt/local-nvme/models
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - gpu-node-01
```

注意：

- `path` 必须在对应节点真实存在。
- `nodeAffinity` 是 Local PV 的核心，不要省略。
- PV 声明容量不会自动限制目录实际使用量。
- `Retain` 能减少误删数据风险，但回收需要管理员介入。

### 6.3 PersistentVolumeClaim

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: model-cache
  namespace: ai
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-nvme
  resources:
    requests:
      storage: 500Gi
  selector:
    matchLabels:
      storage.example.com/purpose: model-cache
```

PVC 创建后暂时处于 `Pending` 不一定是故障。使用 `WaitForFirstConsumer` 时，要等消费它的 Pod 出现。

### 6.4 GPU Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: model-reader
  namespace: ai
spec:
  restartPolicy: Never
  containers:
    - name: app
      image: ubuntu:24.04
      command: ["bash", "-lc"]
      args:
        - |
          set -e
          echo "node=$NODE_NAME"
          df -hT /models
          find /models -maxdepth 2 -type f | head
          sleep 3600
      env:
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
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
        claimName: model-cache
        readOnly: true
```

验证：

```bash
kubectl -n ai get pvc,pod -o wide
kubectl get pv local-nvme-models-gpu-node-01
kubectl -n ai describe pod model-reader
kubectl -n ai exec model-reader -- df -hT /models
```

---

## 7. RWO 不等于“只允许一个 Pod”

`ReadWriteOnce` 的含义是卷可由一个节点以读写方式挂载。同一节点上的多个 Pod 是否能同时使用，还取决于驱动和挂载方式。

如果必须保证全群只有一个 Pod 写，应研究 CSI 支持的 `ReadWriteOncePod`，并在应用侧继续做好锁和原子提交。

模型权重通常应只读挂载：

```yaml
volumeMounts:
  - name: models
    mountPath: /models
    readOnly: true
```

只读能够降低误改风险，但模型版本管理仍应使用独立目录或不可变 revision。

---

## 8. 推荐的两级缓存架构

Local NVMe 最适合作为缓存层，而不是唯一数据源。

```text
对象存储 / CephFS / NFS（权威副本）
             │
             ▼
预下载 Job / 节点缓存 DaemonSet
             │ 校验 SHA256 / manifest
             ▼
节点 Local NVMe（可重建缓存）
             │
             ▼
同节点 GPU Pod 只读加载
```

推荐流程：

1. 模型以 revision 目录存储，例如 `/models/Qwen/rev-20260806`。
2. 下载到临时目录。
3. 校验文件数量、总容量和校验和。
4. 同文件系统原子重命名为正式目录。
5. 写入 `.complete` 标记。
6. 给节点增加对应模型缓存标签。
7. 推理 Pod 同时请求 GPU、PVC 和缓存标签。

不要先写 `.complete`，也不要让业务读取正在下载的目录。

---

## 9. 调度上的真实代价

Local PV 会把 Pod 约束到特定节点：

```text
可调度节点
= 有目标 Local PV
∩ 有所需 GPU
∩ 满足污点容忍
∩ 满足 CPU/内存
∩ 满足其他亲和条件
```

约束过多时，集群明明有空闲 GPU，Pod 仍会 Pending。

生产设计建议：

- 每个 GPU 节点准备结构一致的缓存盘。
- 把模型缓存当作“可重建资源”，不要只留单副本。
- 用节点标签表达缓存状态，不要用模糊的人工备注。
- 缓存标签必须由自动化程序在校验成功后写入。
- 调度失败时同时检查 GPU 和卷，不要只看 `nvidia.com/gpu`。

---

## 10. 容量与淘汰

容量规划：

```text
需要容量
= 热模型权重
+ 版本并存空间
+ 下载临时空间
+ 解压/转换空间
+ 运行时缓存
+ 安全余量
```

如果一个 200 GiB 模型采用“临时目录下载后原子切换”，升级期间至少要允许旧版、新版和下载临时文件同时存在。

淘汰策略应记录：

- 模型 revision。
- 最后访问时间。
- 文件总量和校验结果。
- 是否有运行中的 Pod 使用。
- 可否从权威存储重新下载。

不要只用 `rm -rf` 按目录名字猜测是否可删。

---

## 11. 监控指标

节点侧至少采集：

- 文件系统使用率和 inode 使用率。
- NVMe 设备读写吞吐、IOPS、延迟和队列深度。
- NVMe 健康状态、温度、介质错误、可用备用空间。
- 模型缓存命中率和下载耗时。
- Pod 冷启动分段耗时。

常用检查：

```bash
iostat -x 1
pidstat -d 1
df -hT
df -ih
sudo nvme smart-log /dev/nvme0
```

判断思路：

- `%util` 高、延迟升高：设备或队列饱和。
- 设备不忙、应用仍慢：检查小文件、CPU 解码、锁或页缓存。
- 磁盘读很低、GPU 空闲：应用可能在网络下载或元数据阶段。
- 第一次慢、第二次快：可能是 Linux 页缓存，不一定是 NVMe 本身变快。

---

## 12. 故障排查

### 12.1 PVC 一直 Pending

```bash
kubectl -n ai describe pvc model-cache
kubectl get pv -o wide
kubectl get sc local-nvme -o yaml
```

检查：

- StorageClass 名称。
- PV 容量、AccessMode、标签选择器。
- 是否因为 `WaitForFirstConsumer` 尚未创建 Pod。

### 12.2 Pod 一直 Pending

```bash
kubectl -n ai describe pod model-reader
kubectl get nodes -L kubernetes.io/hostname
```

重点看事件中是否同时存在：

- GPU 不足。
- PV node affinity conflict。
- 节点标签不匹配。
- 未容忍 GPU 节点污点。

### 12.3 FailedMount

在目标节点检查：

```bash
findmnt /mnt/local-nvme/models
ls -ld /mnt/local-nvme/models
journalctl -u kubelet --since "30 min ago"
```

常见根因：

- 节点重启后磁盘没有重新挂载。
- 路径不存在。
- 权限或 SELinux/AppArmor 限制。
- 底层文件系统损坏或只读。

### 12.4 节点故障

Local PV 数据留在故障节点，Pod 不能简单漂移到其他节点继续使用同一份卷。

恢复策略只能来自预先设计：

- 从权威存储重建另一节点缓存。
- 在其他节点准备相同模型 revision。
- 对不可重建数据使用共享或复制存储，而不是单机 Local PV。

---

## 13. 什么时候不应该用 Local PV

以下场景通常不合适：

- 数据必须随 Pod 自动跨节点恢复。
- 多节点需要同时读写同一个 POSIX 目录。
- Checkpoint 只有这一份且不能丢失。
- 团队没有节点磁盘巡检、缓存重建和容量回收能力。
- 工作负载常在节点间漂移，又无法提前缓存。

Local PV 的优势是低延迟和高带宽，代价是位置绑定与运维复杂度。

---

## 14. 与整条 GPU 链路的关系

```text
对象/共享存储
  → 下载到节点 NVMe
  → Local PV 暴露给 Pod
  → CPU read / mmap
  → pinned memory
  → PCIe H2D
  → HBM
  → GPU 计算
```

如果使用受支持的 GPUDirect Storage，部分场景可以缩短 CPU 主存中转路径，但 Local PV、文件系统、驱动和 GPU 拓扑仍需逐层验证。

---

## 15. 本篇总结

记住四句话：

1. NVMe 是高速介质和协议，不自动等于 Kubernetes 存储。
2. Local PV 用 `nodeAffinity` 把卷的位置告诉调度器。
3. `WaitForFirstConsumer` 让 GPU 和本地盘参与同一次放置决策。
4. 本地盘适合可重建缓存，不应默认承担唯一持久副本。

上一篇：[GPUDirect Storage 原理与实践](./02-GPUDirect-Storage原理与实践.md)。下一篇：[NFS 在 AI 集群中的使用与性能分析](../nfs/01-NFS在AI集群中的使用与性能分析.md)。

---

## 16. 课后练习

1. `hostPath` 和 Local PV 的核心区别是什么？
2. 为什么 Local PV 必须设置节点亲和性？
3. `WaitForFirstConsumer` 解决了什么调度冲突？
4. 为什么模型缓存适合 Local PV，唯一 Checkpoint 不适合？
5. 创建一个 10 GiB 实验 Local PV，并验证 Pod 被调度到正确节点。
6. 人为修改 Pod 的节点选择器，让它与 PV 冲突，记录调度事件。
7. 测量共享存储首次加载和 NVMe 缓存命中后的加载时间。

---

## 参考与致谢

- [Kubernetes Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Kubernetes Storage Classes — Local](https://kubernetes.io/docs/concepts/storage/storage-classes/#local)
- [Kubernetes Storage Capacity](https://kubernetes.io/docs/concepts/storage/storage-capacity/)

本文根据 Kubernetes 官方文档整理，示例中的节点名、容量、路径和镜像应按实际环境调整。
