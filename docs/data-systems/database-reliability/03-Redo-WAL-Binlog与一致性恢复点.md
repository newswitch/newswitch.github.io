---
title: "Redo、WAL、Binlog 与一致性恢复点"
sidebar_label: "03. 日志与一致性恢复点"
sidebar_position: 3
description: "理解数据库本地恢复日志、逻辑变更日志、复制位置和归档链，建立从提交成功到崩溃恢复与 PITR 的完整数据路径。"
tags: [数据库, Redo, WAL, Binlog, LSN, GTID, PITR]
---

# Redo、WAL、Binlog 与一致性恢复点

事务日志的共同思想是 Write-Ahead Logging：数据页落盘前，能够重做该修改的日志必须先达到规定的持久化位置。但不同数据库中的 Redo、WAL、Binlog 处于不同层，不能把名称相近的文件混为一种东西。

## 1. 一次提交的通用路径

```text
客户端执行事务
→ 数据库修改内存页/版本
→ 生成事务日志记录
→ 日志进入数据库缓冲
→ 按提交策略写入并 fsync
→ 返回 COMMIT 成功
→ 后台 Checkpoint 将脏数据页写回数据文件
```

Checkpoint 不等于备份。它缩短崩溃后需要重放的日志范围，并推进可回收日志边界；如果数据盘整体丢失，Checkpoint 也随之丢失。

## 2. 三类日志的职责

### 2.1 本地物理恢复日志

InnoDB Redo、PostgreSQL WAL 等记录足以重现页变化的信息，用于：

- 进程或操作系统崩溃后的 Crash Recovery；
- 在线物理备份的一致性修复；
- 物理流复制；
- 基线备份后的连续归档与 PITR。

它们与数据页格式紧密相关，通常不能被当作跨数据库通用事件格式。

### 2.2 逻辑或复制变更日志

MySQL Binlog 记录数据库更改事件，主要服务于复制和 PITR。它可以采用 Statement、Row 或 Mixed 等格式。对于 InnoDB，一次提交涉及 Redo 与 Binlog 的协调；只保留其中一类，能够完成的恢复范围不同。

PostgreSQL 逻辑复制则从 WAL 解码变化，不是再创建一套与 MySQL Binlog 完全对应的文件。逻辑解码 Slot、WAL 保留和下游 Offset 需要一起治理。

### 2.3 Undo/MVCC 历史

Undo 或旧版本让并发事务看到一致性快照并支持回滚。它通常有生命周期和清理边界，不是长期历史备份，也不能代替 PITR 日志归档。

## 3. LSN、Position、GTID 与 Timeline

| 标识 | 表达什么 | 不能单独证明什么 |
| --- | --- | --- |
| LSN | 日志字节流中的位置 | 不自动证明已归档或副本已回放 |
| Binlog file/position | 某 Binlog 文件中的事件位置 | 跨拓扑切换后不如 GTID 稳定 |
| GTID | 全局标识一个已提交事务 | 不代表目标副本一定已执行或持久化 |
| Timeline | PostgreSQL 恢复后产生的新历史分支 | 不表示新旧时间线可以随意拼接 |

恢复工具需要知道基线备份结束位置以及之后完整、按顺序可用的日志。备份时间戳只是辅助信息，精确边界应使用数据库原生位置和事务边界。

## 4. 为什么基线和日志必须绑定

```text
Base Backup B0
  ├─ start_lsn
  ├─ end_lsn
  ├─ database_version
  ├─ backup/checksum/key metadata
  └─ required log sequence ─→ L1 → L2 → L3 → ...
```

缺少 `L2` 时，不能简单跳到 `L3`。后续日志建立在前序状态之上，日志链出现缺口后，缺口之后的恢复点通常全部不可达。保留策略必须从“拥有多少文件”转为“有哪些连续可恢复区间”。

## 5. 日志归档 RPO

最新提交发生在主库，不代表已经安全归档：

```text
latest_commit_lsn
latest_local_flush_lsn
latest_replica_flush_lsn
latest_archived_lsn
latest_verified_recovery_lsn
```

真正的备份 RPO 应看 `latest_verified_recovery_lsn` 对应的时间，而不是最后一个备份任务完成时间。

低流量数据库也需要关注日志段切换。若归档只处理已完成的日志段，一个长时间未写满的段会延迟进入归档；数据库通常提供主动切换或 `archive_timeout` 类参数。设置过短又会产生大量未填满日志文件，必须在 RPO 与容量之间权衡。

## 6. 提交刷盘参数改变了什么

数据库和操作系统可能将“write 完成”和“介质稳定”区分开。常见风险包括：

- 数据库只写入 OS Page Cache 就返回；
- 磁盘控制器缓存没有掉电保护；
- 虚拟化或网络存储错误报告 Flush 已完成；
- 同步副本只收到日志但没有持久化；
- 异步副本存在 Receive、Flush、Replay 三种不同延迟。

因此性能压测时不能只调低刷盘级别再宣称吞吐提升；必须同时记录耐久性变化和允许的数据损失窗口。

## 7. PITR 怎样停止在正确位置

误删发生后，标准流程是：

```text
保护现场与日志
→ 选择早于误删的基线
→ 恢复到隔离实例
→ 连续应用日志
→ 在破坏事务开始前停止
→ 验证完整事务和业务状态
```

按时间停止存在时钟、时区和边界误差。先用时间缩小范围，再结合事务 ID、GTID、LSN、Binlog Position、审计日志和业务请求 ID 确定边界。停止点不能落在事务中间。

如果事故后还有合法写入，整库回退会丢掉这些写入。可以在隔离恢复实例中提取被删除对象，再以业务主键、版本号和冲突策略回灌；不能盲目覆盖现网新值。

## 8. 归档链常见故障

| 现象 | 应检查的证据 |
| --- | --- |
| 归档延迟持续增大 | 日志产生速率、上传吞吐、失败重试、对象存储延迟 |
| 主库日志目录膨胀 | Archive 失败、Slot/副本滞后、保留上限 |
| PITR 找不到目标时间 | 基线范围、日志缺口、时区、Timeline/GTID 集合 |
| 恢复中途报损坏 | 文件 Checksum、下载完整性、介质、错误恢复链 |
| 副本显示延迟为零但恢复点旧 | 指标取的是 Receive、Flush 还是 Replay/Archive |
| 切换后日志覆盖或冲突 | 新旧主标识、Timeline、Server ID、归档前缀 |

## 9. 监控的最小集合

- 当前提交、写入、持久化、复制接收、复制回放和归档位置；
- 日志生成字节率与归档吞吐；
- 最新连续可恢复时间及其年龄；
- 日志缺口、Checksum 和重复对象冲突；
- 本地日志目录空间与增长速率；
- Slot/副本/归档消费者状态；
- 每次恢复实际使用的基线、日志范围和停止点。

## 10. 参考资料

- [MySQL Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [MySQL Point-in-Time Recovery Using Binary Log](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery-binlog.html)
- [PostgreSQL WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html)
- [PostgreSQL Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
