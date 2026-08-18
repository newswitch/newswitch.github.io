---
title: "RDB、AOF、多段 AOF、fork 与 Copy-on-Write"
sidebar_label: "07. RDB、AOF、多段 AOF、fork 与 Copy-on-Write"
sidebar_position: 7
description: "理解 Redis 快照、追加日志、刷盘、重写、恢复优先级和 fork 风险。"
tags: [Redis, RDB, AOF, Fork, COW]
---

# RDB、AOF、多段 AOF、fork 与 Copy-on-Write

持久化要回答 RPO、恢复时间和资源峰值，而不是争论 RDB/AOF 谁“绝对更安全”。

## 1. RDB {/* #rdb */}

```text
fork child → child scans snapshot view → writes temp RDB
→ fsync/rename → new snapshot
```

优点是文件紧凑、恢复快；风险是两次快照间数据窗口、fork 时延和写时复制内存。父进程继续写被子进程引用的页会产生 COW。

## 2. AOF {/* #aof */}

AOF 记录可重放写命令。`appendfsync always/everysec/no` 分别交换持久性和吞吐；内核、磁盘和故障类型使 everysec 不能解释为绝对只丢一秒。

多段 AOF 由 base 和 incremental 文件及 manifest 组成，rewrite 生成更紧凑 base。不要手工删除单个 segment；恢复工具必须理解 manifest。

## 3. 同时启用 {/* #同时启用 */}

恢复优先级和文件有效性以目标版本文档为准。备份必须包含一致的文件集合、配置/ACL/模块和版本信息，并在隔离实例执行恢复。

## 4. 监控 {/* #监控 */}

```text
latest_fork_usec, rdb_bgsave_in_progress
aof_rewrite_in_progress, aof_pending_bio_fsync
rdb_last_bgsave_status, aof_last_write_status
COW size/peak, disk fsync latency, free space
```

## 5. 故障实验 {/* #故障实验 */}

在隔离实例持续写递增序号，分别执行 BGSAVE、BGREWRITEAOF、正常终止和强制终止，恢复后比较最大连续序号、加载时间和日志。生产禁止用故障实验代替备份演练审批。

## 6. 持久化与恢复实验 {/* #持久化与恢复实验 */}

在隔离实例持续写入，分别触发 `BGSAVE`、AOF rewrite 和进程异常，记录 fork 耗时、`latest_fork_usec`、RSS/CoW、磁盘吞吐、写延迟及可恢复数据点：

```bash
redis-cli INFO persistence
redis-cli CONFIG GET appendonly appendfsync save
redis-check-rdb dump.rdb
redis-check-aof --fix appendonly.aof.manifest  # 只对副本操作并先备份
```

RDB、AOF、复制和离线备份解决不同问题。生产恢复必须在隔离目录复制备份后执行，保留原文件并核对 key 数、抽样值、TTL、Stream/模块数据和应用读写。Redis 7+ 使用多部分 AOF manifest，版本升级或搬迁时要复制完整 AOF 目录，不能只拿单个文件。

fork 期间的 CoW 峰值取决于数据集和写入率，容器内存要为此留余量；仅根据静态数据大小设置 limit 容易被 OOMKill。

## 7. 验收题 {/* #验收题 */}

- BGSAVE 为什么不阻塞全部写却仍会造成 P99？
- AOF 写入 Page Cache 与 fsync 有何区别？
- 多段 AOF 为什么不能随意删“旧文件”？
- RDB/AOF 同时启用时备份要保存什么？

## 8. 参考资料 {/* #参考资料 */}

- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
