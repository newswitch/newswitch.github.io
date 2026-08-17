---
title: "Snapshot Backup/Restore、Revision Bump 与灾难恢复"
sidebar_label: "08. Snapshot Backup/Restore、Revision Bump 与灾难恢复"
sidebar_position: 8
tags: [etcd, Snapshot, Restore, Disaster Recovery]
description: "从在线快照、etcdutl 恢复、新集群引导到 Kubernetes Revision Bump 完成灾备。"
---

# Snapshot Backup/Restore、Revision Bump 与灾难恢复

## 备份

对一个健康 Endpoint 使用 `etcdctl snapshot save`，再用 `etcdutl snapshot status` 检查 Revision、Key 数、Hash；加密、校验和、异地不可变保存。记录 member list、版本、证书和启动配置。

## 恢复模型

恢复不是覆盖运行目录：

```text
isolate old writers/API servers
→ select and verify snapshot
→ etcdutl snapshot restore for each new member
   with unique name/data-dir/peer URL
→ form a new logical cluster
→ validate endpoints/hash/revision
→ reconnect clients/controllers
```

Restore 重写 membership/cluster identity。每个成员从同一快照独立生成目录，不能复制一个已运行 data dir 给所有节点。

## Revision 回退

Kubernetes Informer/Controller 缓存可能记得比快照更高的 Revision；恢复到较低 Revision 后 Watch 行为/缓存可能不更新。按 etcd/Kubernetes 官方流程执行 Revision Bump 并 mark compacted，迫使客户端重新 List/Watch。

## 业务一致性

快照内 Kubernetes 状态与外部云资源、PV、LB 可能时间不一致。恢复后核对关键对象、Secret/证书、Node/Pod、存储和控制器行为，不能直接全量放流。

## 验收题

- 为什么恢复要建立新逻辑集群？
- 每个成员为何独立 restore？
- Revision 回退怎样影响 Informer？
- etcd 快照为何不能保证外部云资源一致？

## 参考资料

- [Disaster recovery](https://etcd.io/docs/v3.6/op-guide/recovery/)
