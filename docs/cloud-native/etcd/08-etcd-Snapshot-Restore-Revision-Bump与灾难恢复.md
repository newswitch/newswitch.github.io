---
title: "Snapshot Backup/Restore、Revision Bump 与灾难恢复"
sidebar_label: "08. Snapshot Backup/Restore、Revision Bump 与灾难恢复"
sidebar_position: 8
description: "从在线快照、etcdutl 恢复、新集群引导到 Kubernetes Revision Bump 完成灾备。"
tags: [etcd, Snapshot, Restore, Disaster Recovery]
---

# Snapshot Backup/Restore、Revision Bump 与灾难恢复

> 本文以 etcd 3.6 为基线。Restore 会生成新的集群和成员身份，必须在隔离环境演练；生产恢复前先阻断旧集群及所有写入方。

etcd 能自动处理少数成员重启或永久故障，但超过 `(N-1)/2` 个成员永久丢失后就没有 quorum，不能再靠普通重启或 `member add` 前进。灾难恢复的目标不是“让进程变绿”，而是用一个已知恢复点重建逻辑集群，并让上层客户端安全地重新同步。

## 1. 备份：拿到可证明能恢复的恢复点 {/* #备份拿到可证明能恢复的恢复点 */}

从一个健康 Endpoint 在线生成快照：

```bash
etcdctl --endpoints="$ETCD_ENDPOINT" snapshot save snapshot-20260818.db
etcdutl snapshot status snapshot-20260818.db -w table
sha256sum snapshot-20260818.db
```

`snapshot status` 至少要记录 Hash、Revision、Key 数和大小。再保存以下元数据，否则灾难时只有一个 DB 文件仍可能无法快速重建：

- etcd 精确版本、二进制来源和启动参数；
- `member list`、成员 name、peer/client URL 与故障域；
- CA、成员证书的恢复方式，以及证书到期时间；
- 加密配置、Kubernetes API Server 参数和外部依赖；
- 快照时间、业务事件、校验和、保留位置与责任人。

在线 `etcdctl snapshot save` 是首选。直接复制 `member/snap/db` 可能遗漏仍在 WAL、尚未写入 Backend 的更新。备份应加密、异地、不可变保存，并定期在隔离环境恢复；“命令返回成功但从未 Restore”不算通过备份验收。

RPO 由“最近一份可恢复快照距故障时刻多久”决定，而不是备份任务多久启动一次。持续失败、上传失败或校验不一致都必须告警。

## 2. 恢复模型：三个阶段、两条隔离线 {/* #恢复模型三个阶段两条隔离线 */}

恢复不是覆盖某个运行目录，也不是把一个修好的 data-dir 复制给其他节点：

```text
阶段 1：冻结
  隔离旧 etcd + 停止 API Server/应用写入
阶段 2：重建
  选择快照 → 校验 → 每个新成员独立 etcdutl restore → 启动新集群
阶段 3：验证与放流
  etcd 自检 → 上层控制面小流量接入 → 业务一致性检查 → 全量放流
```

第一条隔离线是网络：旧集群不能与新集群同时接受同一批客户端写入。第二条隔离线是存储：每个新成员必须有唯一 name、data-dir 和 peer URL，且都从**同一份已校验快照**独立生成目录。

## 3. 三成员恢复示例 {/* #三成员恢复示例 */}

先在三台目标机器准备空目录和相同快照。以下成员列表必须与实际证书 SAN、DNS/IP 和防火墙一致：

```text
etcd-1=https://10.0.0.11:2380
etcd-2=https://10.0.0.12:2380
etcd-3=https://10.0.0.13:2380
```

在第一台执行：

```bash
etcdutl snapshot restore snapshot-20260818.db \
  --name=etcd-1 \
  --data-dir=/var/lib/etcd-restored \
  --initial-cluster="etcd-1=https://10.0.0.11:2380,etcd-2=https://10.0.0.12:2380,etcd-3=https://10.0.0.13:2380" \
  --initial-advertise-peer-urls=https://10.0.0.11:2380 \
  --initial-cluster-token=etcd-recovery-20260818
```

另外两台分别把 `--name`、`--data-dir` 和 `--initial-advertise-peer-urls` 改成自己的值，成员列表与 token 保持相同。Restore 会重写 membership 并形成新的 cluster identity。生成目录后，使用与之匹配的 name、peer/client TLS 和监听配置启动 etcd；不要再次执行初次部署的错误引导流程，也不要复用原运行目录。

:::warning
`etcdutl snapshot restore` 是离线工具。执行前确认目标 data-dir 是本次恢复专用空目录；不要对正在运行的 data-dir 操作，也不要用未经校验的旧集群目录覆盖它。
:::

## 4. Revision Bump：解决“数据恢复了，控制器却没刷新” {/* #revision-bump解决数据恢复了控制器却没刷新 */}

Snapshot 只包含备份时刻的 Revision。故障前客户端可能已经看过更高 Revision；恢复后，Kubernetes Informer/Controller 的本地缓存可能无法仅凭 Revision 回退发现数据变化，从而继续使用错误缓存。

etcd 3.6 的 `etcdutl snapshot restore` 支持：

- `--bump-revision N`：在快照 Revision 上增加一个足够大的数，避免新集群 Revision 比客户端记忆的更低；
- `--mark-compacted`：把包括 Bump 在内的 Revision 标记为已压缩，让旧 Watch 失败并迫使客户端重新 List/Watch。

```bash
etcdutl snapshot restore snapshot-20260818.db \
  --bump-revision=1000000000 \
  --mark-compacted \
  --name=etcd-1 \
  --data-dir=/var/lib/etcd-restored \
  --initial-cluster="etcd-1=https://10.0.0.11:2380,etcd-2=https://10.0.0.12:2380,etcd-3=https://10.0.0.13:2380" \
  --initial-advertise-peer-urls=https://10.0.0.11:2380 \
  --initial-cluster-token=etcd-recovery-20260818
```

数字不能照抄。可用“历史峰值写 Revision/秒 × 快照最大年龄秒 × 安全系数”估算，并保证大于故障前可能到达的 Revision。Kubernetes 和其他使用 Watch/本地缓存的系统，通常应同时使用 Bump 与 mark-compacted；没有 Watch 缓存的独立 etcd 应用也要按客户端语义评估。

## 5. 启动后的分层验收 {/* #启动后的分层验收 */}

### 5.1 第一层：etcd 自身 {/* #第一层etcd-自身 */}

```bash
etcdctl --endpoints="$NEW_ETCD_ENDPOINTS" endpoint health --cluster
etcdctl --endpoints="$NEW_ETCD_ENDPOINTS" endpoint status --cluster -w table
etcdctl --endpoints="$NEW_ETCD_ENDPOINTS" member list -w table
etcdctl --endpoints="$NEW_ETCD_ENDPOINTS" alarm list
etcdctl --endpoints="$NEW_ETCD_ENDPOINTS" endpoint hashkv --cluster
```

确认三成员身份与 URL 正确、只有一个 Leader、Revision 符合 Bump 预期、Hash 一致、无 Alarm、Raft applied index 接近。再做一个隔离测试 Prefix 的 Put/Get/Delete，避免误改真实对象。

### 5.2 第二层：控制面或应用客户端 {/* #第二层控制面或应用客户端 */}

先只恢复一个 API Server 或一小组应用实例，观察认证、TLS、线性读、Watch 重建和错误率。Kubernetes 场景重点确认 API Server 能读写、Informer 出现重新 List/Watch、Controller 不再持有旧缓存，并检查关键 Namespace、Node、Deployment、StatefulSet、PV/PVC、Secret 与 CRD。

### 5.3 第三层：外部业务一致性 {/* #第三层外部业务一致性 */}

etcd 快照不能原子地覆盖云盘、负载均衡器、对象存储、外部数据库和正在运行的工作负载。逐类找出“etcd 有对象但外部资源没有”和“外部资源存在但 etcd 已回退”的孤儿状态，再由对应控制器或业务 Runbook 修复。不要看到 `/health` 正常就立即全量启动全部控制器。

## 6. 回退与停止条件 {/* #回退与停止条件 */}

- 新集群未对外写入前，如果成员配置或证书错误，可以停止全部新成员，删除**本次恢复专用目录**后按同一快照重新 Restore。
- 新集群一旦接受新写入，就不能简单切回旧集群，否则会形成两条数据历史。此时要冻结双方并重新选择权威恢复点。
- Hash 不一致、成员身份错误、Revision Bump 不符合预期、持续选举或关键对象缺失时，都应停止放流并保留证据。
- 永远不要让旧集群在隔离解除后“自己又活过来”。旧节点应关机、隔离或销毁其服务凭据。

## 7. 灾备演练怎样才算完成 {/* #灾备演练怎样才算完成 */}

至少每季度在隔离环境完成一次：下载异地快照、验证校验和、三成员 Restore、Revision Bump、启动客户端、验证 Watch 重建、抽查业务对象，并记录 RTO。把“找备份、拿证书、生成目录、启动、验证、决定放流”各阶段耗时拆开，瓶颈才有改进依据。

## 8. 验收题 {/* #验收题 */}

- 为什么恢复要建立新逻辑集群？
- 每个成员为何独立 restore？
- Revision 回退怎样影响 Informer？
- etcd 快照为何不能保证外部云资源一致？
- 新集群已经接受写入后，为什么不能直接切回旧集群？
- 怎样用历史写速率估算 Bump，而不是复制示例数字？

## 9. 参考资料 {/* #参考资料 */}

- [Disaster recovery](https://etcd.io/docs/v3.6/op-guide/recovery/)
- [Maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
