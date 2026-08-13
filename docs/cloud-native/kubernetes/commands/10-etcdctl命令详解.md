---
title: etcdctl 命令详解：Endpoint 健康、快照与恢复
sidebar_position: 10
description: 使用 etcdctl v3 检查成员和 Endpoint、读取受控键空间、保存并验证快照，并以 etcdutl 完成现代恢复流程。
tags: [Kubernetes, etcd, etcdctl, etcdutl, 备份恢复]
---

# etcdctl 命令详解

Kubernetes 的 etcd 保存 API 对象与控制面状态。`etcdctl` 是在线客户端，`etcdutl` 是离线数据文件/快照工具。现代 etcd 中应使用 `etcdctl snapshot save` 获取在线快照，用 `etcdutl snapshot status/restore` 验证和恢复；旧文档中的 `etcdctl snapshot restore` 已不应作为新流程基线。

:::danger 控制面关键数据
直接写/delete Kubernetes 前缀会绕过 API Server 的认证、准入、默认值和审计，可能永久破坏集群。日常只允许健康检查和受控快照，恢复必须在停写、隔离和完整演练的灾备流程中执行。
:::

## 1. 连接、TLS 与环境

```bash
etcdctl version
etcdutl version

export ETCDCTL_ENDPOINTS='https://127.0.0.1:2379'
export ETCDCTL_CACERT='/etc/kubernetes/pki/etcd/ca.crt'
export ETCDCTL_CERT='/etc/kubernetes/pki/etcd/healthcheck-client.crt'
export ETCDCTL_KEY='/etc/kubernetes/pki/etcd/healthcheck-client.key'
```

参数也可用 `--endpoints`、`--cacert`、`--cert`、`--key`、`--dial-timeout`、`--command-timeout`。环境变量方便但路径会暴露在进程环境/诊断中；私钥权限必须最小化。不同发行/管理平台的证书路径不同。

## 2. Endpoint 与 Member `[R]`

```bash
etcdctl endpoint health --cluster
etcdctl endpoint status --cluster -w table
etcdctl endpoint hashkv --cluster
etcdctl member list -w table
etcdctl alarm list
```

Status 重点看 Endpoint、Member ID、Version、DB Size/In Use、Leader、Learner、Raft Term/Index/Applied Index、Errors。各 Endpoint Applied Index 长时间不追平、频繁换 Leader、DB Size 明显异常或 Alarm 都需继续查网络、磁盘延迟、空间与日志。

`hashkv` 在相同 Revision/Compaction 条件下比较键空间哈希；差异不能直接用复制数据库文件修复。

## 3. 只读键空间审计

```bash
etcdctl get /registry/namespaces/default
etcdctl get /registry/ --prefix --keys-only --limit=20
etcdctl get /registry/pods/ --prefix --count-only
```

Kubernetes 值使用内部序列化，可能包含 Secret 与个人数据。大范围 Prefix Get 会给 etcd 增加负载并泄密；问题调查优先通过 API Server。不要依赖手工解析底层 Key 作为稳定 API。

## 4. 在线快照 `[R/A]`

```bash
install -d -m 0700 /var/backups/etcd
etcdctl snapshot save /var/backups/etcd/snapshot-20260812.db
etcdutl snapshot status /var/backups/etcd/snapshot-20260812.db -w table
sha256sum /var/backups/etcd/snapshot-20260812.db
```

快照来自单个健康 Endpoint 即可，不需要对每个成员分别保存。快照含完整 Kubernetes 状态和 Secret 密文/数据，应加密、异地、限制访问并定期恢复演练。仅 `cp member/snap/db` 得到的文件可能缺少 WAL 中最新提交，不替代在线快照。

## 5. 恢复模型 `[D]`

恢复不是“把文件写回正在运行的集群”。一般流程：停止/隔离 API Server 和旧 etcd 写入 → 确认恢复点与哈希 → 用 `etcdutl snapshot restore` 为每个新成员生成独立 Data Dir 和一致的新集群参数 → 修改 Static Pod/服务配置 → 按计划启动 → 验证 Member、Endpoint、Revision 与 Kubernetes API → 重启 Informer/Controller 或使用官方 Revision Bump 方案避免缓存不一致。

结构示例（参数必须按实际拓扑填写）：

```bash
etcdutl snapshot restore snapshot.db \
  --name=cp-1 \
  --data-dir=/var/lib/etcd-restored \
  --initial-cluster='cp-1=https://10.0.0.11:2380,cp-2=https://10.0.0.12:2380,cp-3=https://10.0.0.13:2380' \
  --initial-advertise-peer-urls='https://10.0.0.11:2380'
```

不要把示例地址照抄。必须在隔离集群完整演练，包括证书 SAN、Member Name、Peer URL、Data Dir 权限和 Kubernetes Revision/Watch 行为。

## 6. 高风险管理操作

`member add/remove/promote`、`defrag`、`compact`、`alarm disarm`、用户/角色和 Lease 操作都会改变状态。Defrag 是逐 Endpoint 的阻塞性维护，应一次一成员、观察延迟和 Quorum；Compaction 删除历史 Revision，必须与 Auto Compaction、Watch 和备份策略协调。

## 7. 常见故障

| 现象 | 排查 |
|---|---|
| context deadline exceeded | Endpoint、证书、时间、网络、磁盘 fsync、Leader/Quorum |
| x509/permission denied | CA/Client Cert/SAN、文件权限、Auth Role |
| NOSPACE Alarm | 配额、DB Size/In Use、历史版本；按流程 compact + 逐成员 defrag + disarm |
| 无 Leader | 多数成员是否存活、Peer 网络/证书、时钟和磁盘，避免同时重启多数成员 |
| DB 很大 In Use 很小 | 存在可回收碎片，计划逐成员 Defrag |
| 恢复后对象状态异常 | 快照时间点、Revision 回退、Informer Cache、外部资源与集群证书 |

## 8. 掌握标准

能解释 Member 与 Endpoint、Leader/Term/Index；能安全生成、验证、加密和演练快照；能说明为何现代恢复使用 etcdutl；不会绕过 API Server 修改 `/registry`；能在不破坏 Quorum 的情况下规划维护。

## 官方参考

- [etcd Operations Guide](https://etcd.io/docs/latest/ops-guide/)
- [etcd Disaster Recovery](https://etcd.io/docs/latest/op-guide/recovery/)
- [Operating etcd Clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
