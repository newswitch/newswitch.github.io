---
title: "WAL、Commit、Checkpoint、Crash Recovery 与 Timeline"
sidebar_label: "08. WAL、Commit、Checkpoint、Crash Recovery 与 Timeline"
sidebar_position: 8
tags: [PostgreSQL, WAL, Checkpoint, Recovery, Timeline]
description: "理解 WAL 先行、提交刷盘、检查点、崩溃重放、归档和 Timeline。"
---

# WAL、Commit、Checkpoint、Crash Recovery 与 Timeline

WAL 先记录“页面如何变化”，相关 WAL 落盘后数据页才可写入稳定存储。提交成功通常等待 commit record 达到 `synchronous_commit` 承诺的阶段，而非所有脏页立即落盘。

```text
modify buffer → generate WAL → flush required WAL
→ COMMIT ack → dirty page written later
→ checkpoint establishes recovery start
```

## Checkpoint

Checkpoint 刷写脏页并记录检查点。过于频繁会造成写入尖峰和更多 full-page images；过慢会延长恢复和增加 WAL。观察 `pg_stat_checkpointer`、WAL 生成速率、写/同步时间和存储延迟。

## Crash Recovery

异常退出后从最近 checkpoint 重放 WAL，使数据页达到一致状态；未提交事务不会成为可见事实。不要看到启动时 recovery 日志就删除 `postmaster.pid` 或 WAL。

## Archive/PITR

连续 WAL archive + 一致 base backup 可恢复到时间/LSN/事务。归档命令必须原子、幂等：只有远端文件完整校验后返回成功。监控 archive lag 和失败，不能让 `pg_wal` 因归档失败填满。

## Timeline

恢复/提升会创建新 Timeline，表示历史分叉。恢复时需要正确 history 和 WAL 链；旧主不能未经 rewind/重建直接回到新主拓扑。

## 验收题

- COMMIT 成功为何不要求数据页落盘？
- Checkpoint 太频繁有哪些代价？
- WAL archive 和流复制分别解决什么？
- Timeline 为什么对主备切换后恢复重要？

## 参考资料

- [WAL](https://www.postgresql.org/docs/18/wal.html)
- [Continuous archiving and PITR](https://www.postgresql.org/docs/18/continuous-archiving.html)
