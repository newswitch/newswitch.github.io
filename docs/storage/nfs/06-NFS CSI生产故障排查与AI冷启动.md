---
title: "NFS CSI、生产故障排查与 AI 冷启动"
sidebar_label: "06. NFS CSI、生产故障排查与 AI 冷启动"
sidebar_position: 6
description: "串联 PVC、NFS CSI、kubelet、Linux mount、RPC 与后端存储，处理 Pending、FailedMount、权限、D 状态、stale handle 和模型冷启动风暴。"
tags: [NFS, Kubernetes, CSI, 故障排查, 模型冷启动, Runbook]
---

# NFS CSI、生产故障排查与 AI 冷启动

Kubernetes 使用 NFS 后，故障链更长：

```text
PVC/StorageClass
→ CSI Controller 创建 PV/子目录
→ Scheduler 放置 Pod
→ kubelet 调用 CSI Node
→ 节点 mount NFS
→ bind mount 到容器 namespace
→ 应用 open/read
→ NFS Client/RPC/network/server/backend
→ 模型进入 page cache/主机内存/HBM
```

本篇以症状为入口，建立控制面、挂载面和 I/O 数据面的联合 Runbook。

## 1. NFS CSI 管什么、不管什么

常见 `nfs.csi.k8s.io` 驱动使用现有 NFS Server：

- Controller 侧可为 PVC 创建子目录/卷对象；
- Node 侧在节点挂载 NFS，并 bind mount 到 Pod；
- 处理卷发布、卸载和清理。

它通常不会自动提供：

- 高可用 NFS Server；
- 后端容量硬配额；
- 备份与灾备；
- 性能隔离；
- 模型版本和 checksum；
- 跨租户 UID/GID 安全。

## 2. 动态供应链路

```text
PVC created
→ external-provisioner watches PVC
→ CSI CreateVolume
→ driver prepares subdirectory/volume context
→ PV object created and bound
→ Pod references PVC
→ kubelet on chosen node calls NodePublishVolume
→ NFS mount exists on host
→ bind mount into container
```

NFS 不像云块盘通常需要真正 attach，因此可能没有 ControllerPublish/VolumeAttachment；具体取决于驱动。排障应看实际 CSI 调用和对象，而不是机械期待每类卷都有 VolumeAttachment。

## 3. StorageClass 设计

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-models
provisioner: nfs.csi.k8s.io
parameters:
  server: <nfs-vip-or-dns>
  share: /exports/kubernetes
  subDir: ${pvc.metadata.namespace}/${pvc.metadata.name}
  onDelete: retain
reclaimPolicy: Retain
mountOptions:
  - nfsvers=4.1
  - hard
allowVolumeExpansion: true
volumeBindingMode: Immediate
```

这是结构示例，参数支持以安装版本文档为准。评审：

- server 使用稳定 VIP/DNS；
- share 与导出/权限一致；
- subDir 防重名和路径注入；
- onDelete/reclaimPolicy 符合数据保留；
- mountOptions 经过测试；
- 容量扩展是否真正改变后端 quota；
- Secret/认证方式；
- 多租户是否需要不同 StorageClass/导出。

## 4. PVC Pending 排查

```bash
kubectl -n <ns> get pvc <pvc> -o wide
kubectl -n <ns> describe pvc <pvc>
kubectl get sc <storage-class> -o yaml
kubectl get pods -A | grep -i nfs
```

按事件判断：

- StorageClass 不存在/名称错误；
- provisioner 名称与驱动不符；
- CSI Controller 不健康或 leader election 问题；
- CreateVolume 调用失败；
- 服务端 share 不可访问，无法创建子目录；
- RBAC/Secret/参数错误；
- PVC selector/access mode 不匹配；
- API server 或 sidecar 版本兼容问题。

PVC Pending 发生在动态供应控制面，还未必到目标 GPU 节点。

## 5. Pod Pending 与存储拓扑

NFS 通常可从多个节点访问，`Immediate` 常可提前绑定；但 Pod Pending 仍可能来自：

- GPU、CPU 或内存不足；
- node affinity/taint；
- PV nodeAffinity 错误；
- 调度器认为 PVC 未绑定；
- 其他拓扑/队列/Gang 条件。

```bash
kubectl -n <ns> describe pod <pod>
kubectl get pv <pv> -o yaml
```

不要看到 Pod Pending 就重启 CSI。

## 6. ContainerCreating / FailedMount

事件常包含 `MountVolume.SetUp failed`、`NodePublishVolume` 或 mount 错误。检查：

```bash
kubectl -n <ns> describe pod <pod>
kubectl get csinode <node> -o yaml
kubectl -n <driver-ns> get pods -o wide
kubectl -n <driver-ns> logs <node-plugin-pod> -c <container> --since=30m
```

节点侧：

```bash
journalctl -u kubelet --since "30 minutes ago"
findmnt -t nfs,nfs4
rpcinfo -p <server>
nc -vz <server> 2049
```

需要区分：

- DNS/VIP；
- 防火墙/路由；
- 服务未监听；
- 导出路径错误；
- 客户端不在允许网段；
- 协议/安全 flavor 不匹配；
- 节点缺少 NFS 客户端工具/内核支持；
- mount option 无效；
- kubelet mount namespace/残留挂载。

## 7. 容器 Permission denied

挂载成功但应用无权限时，CSI 通常不是根因。检查：

```bash
kubectl -n <ns> exec <pod> -- id
kubectl -n <ns> exec <pod> -- stat -c '%u:%g %a %n' /models
```

再检查：

- 服务端目录 owner/group/mode/ACL；
- AUTH_SYS 数字 UID/GID；
- root_squash；
- Pod `runAsUser/runAsGroup/fsGroup`；
- SELinux/AppArmor；
- 导出只读与容器 readOnly；
- 子目录 provisioner 创建目录的身份。

`fsGroup` 对大目录递归改属主可能显著拖慢 Pod 启动，且 NFS 服务端权限可能不允许。预创建目录与统一 UID/GID通常更可控。

## 8. 申请容量与真实 quota

很多 NFS CSI 动态供应只是创建子目录：

```text
PVC requests 500Gi
→ PV capacity says 500Gi
→ backend directory may have no 500Gi quota
```

因此：

- `requests.storage` 可能只是 Kubernetes 声明；
- 所有 PVC 仍共享同一文件系统容量；
- 单租户可写满整个导出；
- 扩容 PVC 可能只改对象字段。

若需要强配额，要使用服务端 filesystem/project quota、支持配额的 NAS/驱动，或选择提供卷级容量语义的后端。

## 9. Pod 删除但挂载无法卸载

原因：

- 容器/宿主进程仍占用路径；
- NFS I/O 卡住；
- CSI Node/kubelet 异常；
- 残留 bind mount；
- 服务端不可达；
- lazy/force 操作带来状态残留。

先只读确认：

```bash
findmnt -R <kubelet-volume-path>
mount | grep nfs
fuser -vm <mountpoint>
ps -eo state,pid,comm,wchan:32 | awk '$1=="D"'
```

不要在不确认路径和占用者时批量 `umount -l`。Lazy unmount 只从当前命名空间断开路径，旧引用和 I/O 可能仍存在。

## 10. I/O 卡住与 D 状态

hard mount 在服务端/网络故障时可能持续重试。症状：

- Pod 无响应但未退出；
- 进程 D 状态；
- kubelet volume 操作卡住；
- 节点 drain 卡住；
- `df`/`ls` 访问挂载点也等待。

排查顺序：

1. 确认只影响一个挂载还是多个；
2. 解析 server/VIP/DNS；
3. TCP/RPC 连通；
4. nfsstat retrans、mountstats RTT/execute；
5. 服务端 nfsd、文件系统和后端；
6. HA role/切换；
7. 恢复服务后验证 I/O 与数据。

Pod 强删不能让内核中未完成的 NFS 请求消失。

## 11. Stale file handle

症状：应用 `ESTALE`、目录访问失败、个别客户端异常。收集：

```bash
findmnt <mountpoint>
nfsstat -m
stat <affected-path>
journalctl -k --since "1 hour ago"
```

服务端核对：导出、实际挂载、文件/目录是否重建、HA 后端是否一致。修复顺序：

1. 停止继续改变服务端对象；
2. 确认权威数据与导出；
3. 控制受影响工作负载；
4. 在维护流程中卸载/重挂；
5. 验证文件句柄、内容和权限；
6. 修复导致身份变化的发布/HA 流程。

## 12. NFS Server 慢

客户端证据：

- nfsiostat RTT/execute/retrans；
- READ/WRITE/GETATTR 操作分布；
- page fault、DataLoader wait；
- 节点 NIC。

服务端证据：

- nfsd CPU/线程/队列；
- NIC；
- page cache/Dirty/Writeback；
- 文件系统容量/inode；
- 后端 iostat/RAID/存储集群；
- 备份、快照、恢复任务。

“服务端 CPU 低”不能排除后端 I/O；“后端盘 util 低”也不能排除元数据锁或网络。

## 13. 模型冷启动分段

```text
Pod admitted/scheduled
→ image pull
→ CSI mount
→ initContainer/cache lookup
→ NFS open/metadata
→ NFS data read
→ checksum
→ deserialize/allocate host memory
→ H2D / TP rank load
→ graph capture/warmup
→ startup/readiness
```

记录每段，避免将所有时间记为“NFS 慢”。

### 13.1 NFS 数据慢的证据

- 冷读时 READ RPC、NIC、服务端后端均忙；
- 应用读取吞吐低且 nfsiostat RTT/execute 高；
- 相同文件热读显著恢复；
- checksum/H2D 不是主要耗时。

### 13.2 CPU/加载慢而非 NFS

- NFS 已完成或 page cache 命中；
- CPU 单核满、反序列化长；
- H2D/NCCL/显存分配耗时；
- 服务端无对应流量。

## 14. 多 Pod 冷启动风暴

控制方式：

- 部署 `maxSurge/maxUnavailable` 与实际 GPU/存储容量匹配；
- 使用 startupProbe 覆盖合理冷启动，但永久错误要快速失败；
- 节点 NVMe 缓存与不可变 revision；
- 分批预热；
- 全局/每节点下载并发；
- 保留旧 Ready 副本；
- 监控源端带宽、队列和每 Pod 完成分布；
- 大规模分发评估 S3/专用缓存层。

`replicas: 100` 同时启动不是并行优化，可能把共享 NFS 压成串行排队。

## 15. 训练数据与小文件

若 DataLoader 每个样本 open 多个小文件，GETATTR/LOOKUP/READ RPC 往返占主导。措施：

- 合并为较大 shard；
- 建立不可变索引；
- 适当 worker/prefetch，不盲目增加；
- 节点缓存；
- 将解码与 I/O profiler 对齐；
- 大规模训练评估并行文件/对象数据层。

优化最终用 GPU data stall 和 samples/s 验收。

## 16. Checkpoint 写入

分布式训练需要：

- 每任务/revision 独立目录；
- 分片避免同文件争用；
- 临时文件和 checksum；
- 所有参与 rank 按框架语义完成；
- manifest/完成标记最后提交；
- 只发现完整 Checkpoint；
- 写入期间监控服务端 Dirty/后端 P99；
- 恢复演练验证 global step/优化器/数据进度。

NFS 写带宽高不代表 Checkpoint 可恢复。

## 17. CSI 升级

1. 阅读目标版本 release note/兼容矩阵；
2. 保存 manifests/Helm values/RBAC；
3. 测试新 PVC、已有 PVC、新 Pod、重挂载、删除/Retain；
4. 先升级 canary 集群/节点；
5. 确保 Controller 与 Node sidecar 组合兼容；
6. 观察 kubelet volume errors；
7. 不把驱动升级与 NFS Server/内核升级混在同一窗口；
8. 保留回滚清单和镜像。

已有挂载可能继续工作，不能据此证明新 NodePublish/CreateVolume 正常。

## 18. 端到端 Runbook

```text
1. 用户现象：Pending/FailedMount/Permission/I/O slow/stale
2. 影响范围：PVC、Pod、Node、Export、Server、All clients
3. Kubernetes objects/events
4. CSI Controller or Node logs
5. Node mount/DNS/TCP/RPC
6. NFS client stats
7. Server nfsd/filesystem/backend
8. Application stage timing
9. Lowest-risk recovery
10. Same workload validation
11. Root cause and prevention
```

## 19. 故障演练

只在测试命名空间/导出：

1. StorageClass server 写成无效测试地址，验证 PVC/事件；
2. 删除 CSI Node canary Pod，验证自动恢复与已有挂载；
3. 创建错误 UID/GID，验证权限定位；
4. 短停测试 NFS，记录 hard mount 和恢复；
5. 测试服务端 VIP 切换与 v4 state；
6. 同时启动 1/2/4/8 模型读取 Pod，观察回源；
7. 制造不完整测试 revision，验证拒绝加载；
8. Checkpoint 副本缺少分片，验证回退；
9. CSI 升级后测试新旧卷。

不通过破坏唯一数据或制造真实生产 stale handle 来学习。

## 20. 常见误区

1. **PVC Bound 表示 NFS 可读。**Node mount 和应用权限尚未验证。
2. **CSI 提供 NFS HA。**它只消费已有服务。
3. **PV capacity 是后端硬配额。**子目录方案可能不实施 quota。
4. **FailedMount 就重启 kubelet。**可能是 DNS、导出、权限或服务端。
5. **D 状态杀 Pod即可。**内核 I/O 仍等待。
6. **Running/Ready 证明模型已正确加载。**探针可能过浅或 revision 错。
7. **所有冷启动慢都归因 NFS。**还需拆分 checksum、CPU、H2D/NCCL。
8. **多副本并发启动会更快完成发布。**可能触发回源风暴。

## 21. 掌握标准

应能从 PVC 事件定位 Controller，从 FailedMount 定位 CSI Node/kubelet/DNS/RPC，从 Permission 定位 UID/GID/export，从 I/O 卡住定位客户端/服务端/后端；能拆解模型冷启动、治理并发回源并验证 Checkpoint 正确性。

至此 NFS 模块形成：协议 → 缓存/锁 → 部署/HA → 性能调优 → CSI/排障/AI。

## 22. 参考资料 {/* #参考资料 */}

- [Kubernetes NFS volumes](https://kubernetes.io/docs/concepts/storage/volumes/#nfs)
- [Kubernetes CSI NFS Driver](https://github.com/kubernetes-csi/csi-driver-nfs)
- [NFS CSI driver parameters](https://github.com/kubernetes-csi/csi-driver-nfs/blob/master/docs/driver-parameters.md)
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Linux nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
