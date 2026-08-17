---
title: "Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat"
sidebar_label: "09. Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat"
sidebar_position: 9
tags: [PostgreSQL, Vacuum, Autovacuum, Bloat, XID]
description: "理解旧版本回收、冻结、防回卷、表索引膨胀和 Autovacuum 调优。"
---

# Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat

UPDATE/DELETE 产生旧 tuple，只有不存在需要它的快照后才能回收。普通 VACUUM 标记空间供表内复用，通常不把文件缩回操作系统。

## Autovacuum

触发近似由 threshold + scale factor × table size 决定。大表按比例可能积累太多 dead tuples，热点表应设置表级阈值；worker 数、cost limit、I/O 和业务峰值共同调优。

## Freeze 与 Wraparound

事务 ID 有限，需要 Freeze 让足够旧的行永久可见。若数据库接近 wraparound，Autovacuum 会以防故障模式工作，极端时停止写。监控 database/table age，而非只看 dead tuple。

## 阻碍回收

```text
long transaction / idle in transaction
replication slot retained xmin/WAL
standby feedback / long standby query
prepared transaction
```

先处理阻塞回收的根因，再加大 Vacuum 资源。

## Bloat

表/索引膨胀表现为文件大、缓存效率差和扫描 I/O 增加。普通 Vacuum 复用空间；`VACUUM FULL` 重写并持强锁。可用在线重建/分区替换等策略，但都需额外空间和 WAL 预算。

## 证据

看 `pg_stat_all_tables`、last vacuum/analyze、dead/live tuple、事务年龄、Autovacuum 日志、I/O 与 WAL。估算值需结合扩展或采样验证。

## 验收题

- 普通 VACUUM 为什么不缩小文件？
- 长事务怎样阻止回收？
- Freeze 防止什么故障？
- 为何大表需更小 scale factor？

## 参考资料

- [Routine vacuuming](https://www.postgresql.org/docs/18/routine-vacuuming.html)
