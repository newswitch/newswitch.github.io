---
title: "Kubernetes 数据库备份与 CSI Snapshot 边界"
sidebar_label: "07. Kubernetes 与 CSI Snapshot"
sidebar_position: 7
description: "区分数据库一致性备份、CSI VolumeSnapshot、Operator 和对象存储，设计可跨 Namespace、集群与存储故障域恢复的 Kubernetes 数据保护流程。"
tags: [Kubernetes, 数据库, CSI, VolumeSnapshot, Operator, PITR]
---

# Kubernetes 数据库备份与 CSI Snapshot 边界

StatefulSet、PVC 和多副本只描述数据库怎样运行，不自动提供历史恢复能力。Kubernetes 数据保护必须同时处理数据库事务一致性、存储快照、集群对象、外部备份目录和密钥。

## 1. 数据分成五类

```text
数据库数据页、Redo/WAL/Binlog
数据库全局对象：用户、角色、Extension、参数
Kubernetes 对象：CR、StatefulSet、Service、PVC、RBAC
外部状态：DNS、证书、KMS、对象存储、负载均衡
恢复证据：Backup ID、日志位置、Checksum、版本、Runbook
```

只备份 PVC 会缺少 Kubernetes 和外部配置；只备份 YAML 又没有数据库数据。

## 2. VolumeSnapshot 三个对象

| 对象 | 作用 |
| --- | --- |
| `VolumeSnapshotClass` | 指定 CSI Driver、删除策略和存储参数 |
| `VolumeSnapshot` | Namespace 内用户发起的快照请求 |
| `VolumeSnapshotContent` | 集群级对象，绑定存储后端真实 Snapshot |

示例：

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: database-snapshot-retain
driver: <csi-driver-name>
deletionPolicy: Retain
---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: orders-db-20260908
  namespace: database
spec:
  volumeSnapshotClassName: database-snapshot-retain
  source:
    persistentVolumeClaimName: orders-db-data
```

`readyToUse: true` 表示 CSI 快照对象已经准备好供恢复使用，不证明数据库业务一致性已经验证。

## 3. CSI Snapshot 默认不是数据库备份协议

普通 VolumeSnapshot 主要捕获存储卷的某一块状态。数据库正在写入时，它通常至多提供类似突然断电后的 Crash Consistency；恢复依赖数据库日志完成 Crash Recovery。

应用一致性需要更高层协调：

```text
确认副本和数据库健康
→ 数据库进入备份模式/创建检查点/暂停特定写入
→ 记录 LSN、GTID 或日志位置
→ 对相关卷创建快照
→ 等待快照完成
→ 退出 Quiesce/备份模式
→ 生成并保存 Manifest
```

不要执行全局 `fsfreeze` 后长时间等待远端 API；冻结窗口失控可能让数据库和节点 I/O 阻塞。应由经过验证的 Operator、备份工具或短时 Hook 协调。

## 4. 多卷一致性

数据库可能将数据、WAL/Redo、表空间和临时文件放在不同 PVC。如果依次创建独立快照：

```text
Data PVC snapshot at T1
WAL PVC snapshot at T2
Tablespace snapshot at T3
```

三个卷不在同一时点，恢复后可能缺少依赖文件。解决方向：

- 数据库级备份协议，把日志和数据绑定到同一恢复点；
- 应用 Quiesce 后在短窗口内完成快照；
- 存储和目标 Kubernetes 版本支持时使用 Volume Group Snapshot；
- 将 WAL/Binlog 持续归档到对象存储，为快照提供后续恢复链。

Volume Group Snapshot 提供的是一组卷的 Crash-consistent 时间点，仍不自动理解数据库事务语义。目标集群和 CSI Driver 是否支持，需要按版本验证。

## 5. `deletionPolicy` 与 Namespace 删除

`Delete` 表示删除 VolumeSnapshotContent 时，底层存储快照也会被删除；`Retain` 表示保留底层快照。还要注意：

- `VolumeSnapshot` 是 Namespace 资源，Namespace 删除会影响请求对象；
- `VolumeSnapshotContent` 是集群级对象，但其生命周期仍受绑定和控制器逻辑影响；
- 底层快照可能仍位于同一个云账号、存储阵列或可用区；
- 集群管理员或存储管理员可能仍能删除真实快照；
- `Retain` 不是跨账号不可变备份。

重要数据库快照应复制/导出到独立备份存储，并保留外部 Backup Catalog。

## 6. Operator 提供了什么

数据库 Operator 可以协调：

- 选择健康主库或副本作为 Backup Source；
- 创建备份 Job、Sidecar 或数据库原生命令；
- 上传物理备份到 S3/对象存储；
- 连续归档 Binlog/WAL；
- 创建 Backup/Restore CR 并记录状态；
- 从备份引导新的数据库集群；
- 执行 PITR 和重建副本。

Operator 自动化生命周期，但不能替代：

- RPO/RTO 与故障模型设计；
- Bucket Versioning、Object Lock 和跨账号策略；
- 数据库与 Operator 版本兼容测试；
- Secret/KMS 的独立恢复；
- 业务数据校验和灾难演练。

## 7. 推荐的 Kubernetes 备份数据路径

```text
Database Pod/PVC
  ├─ Operator/数据库工具 → Physical Base Backup → Object Storage
  ├─ Binlog/WAL Archiver ───────────────────────→ Object Storage
  └─ CSI Snapshot ─→ 快速本地恢复点 ─→ 必要时跨域复制

Git/IaC ─→ Namespace、Operator、CR、Service、Policy
External Secret/KMS ─→ 恢复凭据与解密密钥
Backup Catalog ─→ Backup ID、位置、版本、Checksum、RPO/RTO
```

对象存储最好位于集群之外的账号/权限域。集群被误删时，备份 CR、Pod 和 Namespace 可以全部消失，但外部备份工件和目录仍应可发现。

## 8. 从 Snapshot 恢复 PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-db-data-restore
  namespace: database-restore
spec:
  storageClassName: <restore-storage-class>
  dataSource:
    name: orders-db-20260908
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Ti
```

请求容量不能小于快照恢复要求。还要验证 Snapshot Topology：某些快照只能在原可用区恢复，无法直接承担跨区或跨地域容灾。

## 9. 跨集群恢复流程

```text
在目标集群安装匹配版本的 CSI Snapshot CRD/Controller/Driver
→ 安装数据库 Operator 与所需 CRD
→ 恢复 Namespace、RBAC、NetworkPolicy 和 Secret 引用
→ 配置目标对象存储与 KMS 权限
→ 从备份引导一个新数据库集群
→ 应用 Binlog/WAL 到目标位置
→ 验证数据、角色、证书、Service 和复制状态
→ 重建备份策略后再接业务流量
```

不要直接恢复旧 StatefulSet 的 Pod UID、NodeName 或失效 PVC 引用。稳定身份由 Operator/控制器重建，数据恢复由数据库协议完成。

## 10. 常见误区

1. **StatefulSet 有三个副本，所以不需要备份**：三个副本会一起执行误删。
2. **Ceph 三副本，所以数据库不会丢**：Ceph 保护块设备可用性，不保留业务历史。
3. **VolumeSnapshot Ready，所以应用一致**：Ready 只反映快照控制面状态。
4. **Velero/集群备份包含所有数据库数据**：需要核对它是否调用 CSI Snapshot、数据库 Hook 和外部对象备份。
5. **备份在另一个 Namespace 就安全**：Namespace 不是账号、地域或存储故障域。
6. **Operator 的 Backup CR 还在，所以文件可恢复**：仍需检查对象、日志链、密钥和版本。

## 11. 验收清单

- [ ] CSI Driver 支持目标快照功能和恢复拓扑；
- [ ] 已确认 Snapshot 是 Crash-consistent 还是 Application-consistent；
- [ ] 多 PVC 数据具有同一恢复点或明确日志修复路径；
- [ ] `deletionPolicy`、存储侧保留和不可变策略一致；
- [ ] Base Backup 与 Binlog/WAL 位于集群外部；
- [ ] Namespace 和整个集群删除后仍能找到 Backup Catalog；
- [ ] KMS、Secret、证书和对象存储凭据可独立恢复；
- [ ] 已从真实备份恢复到另一个 Namespace 和另一个集群；
- [ ] 已验证业务数据并记录实际 RPO/RTO；
- [ ] 恢复完成后重新建立副本、监控和备份链。

## 12. 参考资料

- [Kubernetes Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- [Kubernetes Volume Snapshot Classes](https://kubernetes.io/docs/concepts/storage/volume-snapshot-classes/)
- [Kubernetes Volume Group Snapshot](https://kubernetes.io/docs/concepts/storage/volume-group-snapshots/)
- [CloudNativePG Backup](https://cloudnative-pg.io/docs/current/backup/)
- [CloudNativePG WAL Archiving](https://cloudnative-pg.io/docs/current/wal_archiving/)
- [Percona Operator for MySQL Backups](https://docs.percona.com/percona-operator-for-mysql/latest/backups.html)
