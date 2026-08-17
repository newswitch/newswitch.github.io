---
title: "WAL、Snapshot、bbolt、Compaction、Defrag 与 Quota"
sidebar_position: 5
tags: [etcd, WAL, Snapshot, Compaction, Defrag]
description: "理解 etcd Raft WAL、快照、MVCC Backend、历史压缩、物理碎片和 NOSPACE。"
---

# WAL、Snapshot、bbolt、Compaction、Defrag 与 Quota

```text
Raft WAL/snapshot → consensus recovery
MVCC revisions → bbolt backend db
```

在线 `etcdctl snapshot save` 从 Backend 获取一致快照；直接复制 `member/snap/db` 可能缺少 WAL 中更新，不能作为标准在线备份。

## Compaction

删除指定 Revision 之前的 MVCC 历史，使旧 Watch/Range 返回 compacted。自动 Compaction 按时间/Revision控制历史窗口。它释放逻辑可用页，不一定缩小 DB 文件。

## Defrag

Defrag 重写单成员 Backend 回收物理空间，会阻塞该 Endpoint。三节点一次一个、先 follower 后 leader（按运维计划），每次确认 quorum/延迟再继续。不要同时 Defrag 多数成员。

## Quota/NOSPACE

Backend 达 quota 会触发 NOSPACE alarm 并限制写。流程：停止异常写 → 确认快照 → compact 合理 Revision → 逐成员 defrag → 验证 size/in-use → alarm disarm。直接调大 quota 只延后根因。

## 监控

DB total/in-use、WAL fsync、backend commit、proposal/apply、snapshot、compaction、alarm 和磁盘空间。

## 验收题

- Compaction 与 Defrag 分别释放什么？
- 为什么 Defrag 要逐成员？
- NOSPACE 时为何先止住异常写？
- 在线快照与复制 db 文件有何差异？

## 参考资料

- [Maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
