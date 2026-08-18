---
title: "Snapshot、Restore、CCR、跨集群搜索与灾备"
sidebar_label: "15. Snapshot、Restore、CCR、跨集群搜索与灾备"
sidebar_position: 15
description: "理解副本与备份差异、增量快照、CCR、CCS 和灾备切换。"
tags: [Elasticsearch, Snapshot, CCR, Disaster Recovery]
---

# Snapshot、Restore、CCR、跨集群搜索与灾备

Replica 与主分片共享错误域和逻辑删除，不是备份。Snapshot 将 segment 增量保存到独立 Repository，可恢复索引和部分集群状态。

## 1. Snapshot {/* #snapshot */}

Repository 可是 S3/对象存储/共享文件等受支持后端。多个集群写同一 Repository 需按文档控制，不能手工修改其文件。监控 SLM、失败、时长、存储和保留。

恢复先到隔离集群，处理同名索引、模板、Feature State、版本兼容和安全配置，再验证文档数、业务查询和权限。

## 2. CCR {/* #ccr */}

Cross-Cluster Replication 让 follower index 拉取 leader 操作，适合异地只读和 DR。它传播逻辑删除/错误，不替代 Snapshot；网络中断会积压 retention lease/WAL 类历史并影响恢复。

## 3. CCS {/* #ccs */}

Cross-Cluster Search 在查询时跨集群 fan-out，延迟和可用性受远端影响。设置 skip_unavailable 要与业务“部分结果是否可接受”一致。

## 4. DR 切换 {/* #dr-切换 */}

```text
freeze/fence source writes
→ confirm follower lag/restore point
→ promote/unfollow or restore
→ switch aliases/DNS/clients
→ validate writes and queries
→ plan reverse replication before failback
```

RPO/RTO 用故障演练证明，不用“有 CCR”推断。

## 5. 恢复演练：备份成功不等于可恢复 {/* #恢复演练备份成功不等于可恢复 */}

```http
POST _snapshot/lab_repo/_verify
PUT _snapshot/lab_repo/snap-2026-08-18?wait_for_completion=true
{"indices":"orders-*","include_global_state":false}
GET _snapshot/lab_repo/snap-2026-08-18
```

在隔离集群恢复到新名称，验证文档数、抽样查询、mapping/template、alias、权限和应用读写；记录实际 RPO/RTO。仓库必须由 Elasticsearch 管理，不能直接复制节点 data 目录或让多个集群对同一仓库并发写入。

CCR 是持续复制能力，不替代不可变备份；误删和坏数据也会复制。切换前冻结写入或明确冲突策略，确认 follower 追平、客户端 DNS/连接、密钥与回切方案。CCR 等能力还受发行版和许可约束，部署前按当前版本核对。

## 6. 验收题 {/* #验收题 */}

- Replica 为什么不是备份？
- Snapshot 增量复用了什么？
- CCR 为什么会复制误删除？
- Failback 为什么比 DNS 切回复杂？

## 7. 参考资料 {/* #参考资料 */}

- [Snapshot and restore](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore)
- [Cross-cluster replication](https://www.elastic.co/docs/deploy-manage/tools/cross-cluster-replication)
