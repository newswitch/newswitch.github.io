---
title: "WAL、Commit、Checkpoint、Crash Recovery 与 Timeline"
sidebar_label: "08. WAL、Commit、Checkpoint、Crash Recovery 与 Timeline"
sidebar_position: 8
description: "理解 WAL 先行、提交刷盘、检查点、崩溃重放、归档和 Timeline。"
tags: [PostgreSQL, WAL, Checkpoint, Recovery, Timeline]
---

# WAL、Commit、Checkpoint、Crash Recovery 与 Timeline

> 版本基线：PostgreSQL 18；最后核验：2026-08-18。旧版本中的统计视图和参数边界应查阅对应主版本文档。

WAL 的核心规则是：**相关 WAL 记录必须先达到稳定存储，数据页才能安全地写入数据文件。**

因此 COMMIT 成功通常不要求表和索引的所有脏页已经落盘，只要求 Commit Record 达到 `synchronous_commit` 所承诺的持久化阶段。崩溃后，PostgreSQL 用 WAL 重做尚未写入数据文件的变化。

## 1. Buffer、WAL 与数据文件

一次修改的简化路径：

```text
SQL modifies shared buffer
→ generate WAL record
→ append into WAL buffers
→ WAL writer/backend flushes required LSN
→ COMMIT acknowledgement
→ dirty data page written later
→ checkpoint bounds recovery start
```

三类对象：

| 对象 | 主要内容 | 是否每次 COMMIT 都全部刷盘 |
| --- | --- | --- |
| Shared Buffers | 表和索引的数据页缓存 | 否 |
| WAL Buffers / pg_wal | 变化记录和事务提交记录 | 按持久化承诺刷到所需 LSN |
| Data Files | 表、索引、FSM、VM 等持久文件 | 由后台写和 Checkpoint 推进 |

如果每个事务都同步写所有脏数据页，随机 I/O 和写放大会非常高。WAL 把提交关键路径转化为以顺序追加为主的日志持久化。

## 2. LSN：WAL 的位置坐标

Log Sequence Number 表示 WAL 字节流中的位置，常见格式类似：

```text
0/16B6C50
```

它不是时间戳。可以用 LSN 差值计算一段时间生成的 WAL 字节：

```sql
SELECT pg_current_wal_lsn();

SELECT pg_size_pretty(
  pg_wal_lsn_diff('0/2000000'::pg_lsn, '0/1000000'::pg_lsn)
);
```

生产容量规划应定时采集 LSN 和时间，而不是只看 `pg_wal` 目录当前大小，因为旧 Segment 会回收、复用，也可能被 Slot、归档失败或备库需求保留。

## 3. 一次 COMMIT 等待什么

简化时间线：

```text
backend creates commit record
→ obtain/insert WAL
→ wait until target LSN reaches required durability
→ mark transaction committed/visible
→ return to client
```

多个并发事务可以通过 Group Commit 共享一次刷盘，从而降低每事务 fsync 成本。低并发时，单次 fsync 尾延迟更容易直接反映到事务延迟。

`synchronous_commit` 的语义还会受到同步复制配置影响：

| 值 | 提交主要等待边界 | 风险/用途 |
| --- | --- | --- |
| `on` | 本地 WAL 持久化；配置同步备库时还等待其确认阶段 | 常规持久提交 |
| `remote_write` | 同步备库接收并写入其 OS | 远端 OS/电源故障仍需评估 |
| `remote_apply` | 同步备库重放后再确认 | 更强读后可见语义，延迟最高 |
| `local` | 本地持久化，不等待同步备库 | 主库安全但可能扩大主备数据差 |
| `off` | 不在每次提交路径等待本地 WAL flush | 崩溃可能丢失最近已返回成功的事务 |

`off` 不表示可以破坏 WAL 顺序规则，通常也不会造成数据库物理不一致，但会降低最近事务的持久性保证。只能按事务和业务损失边界使用，不能作为全局“提速开关”。

## 4. WAL Record 与 Full-Page Image

WAL 通常记录重做一个变化所需的信息。为防止数据页在操作系统崩溃或存储撕裂时只写入一部分，在 `full_page_writes=on` 时，一个数据页在每次 Checkpoint 后第一次被修改，通常会把完整页面镜像写入 WAL。

因此 Checkpoint 太频繁会：

- 更频繁触发 Full-Page Image；
- 增加 WAL 生成量；
- 增加脏页写入；
- 造成 I/O 和延迟波动。

压缩 WAL 或调整 Full-Page Image 相关设置前必须验证 CPU、WAL 带宽、恢复能力和目标版本支持，不能只看磁盘空间。

## 5. Checkpoint 真正做了什么

Checkpoint 的目标是建立一个恢复起点：保证检查点要求覆盖的数据页已经写入数据文件，并写入相应 Checkpoint Record。

触发因素主要包括：

- 到达 `checkpoint_timeout`；
- WAL 量接近 `max_wal_size` 的检查点压力；
- 管理动作或关机；
- 显式 `CHECKPOINT`。

`max_wal_size` 不是严格磁盘上限。高峰、归档、复制 Slot 和恢复过程都可能让 `pg_wal` 超过它，磁盘必须保留额外安全空间。

关键参数关系：

| 参数 | 影响 |
| --- | --- |
| `checkpoint_timeout` | 时间上限和恢复窗口 |
| `max_wal_size` | WAL 压力触发检查点的目标阈值 |
| `checkpoint_completion_target` | 尽量把写脏页分散到检查点周期 |
| `checkpoint_warning` | 频繁请求型检查点日志提示 |

强制执行 `CHECKPOINT` 会产生显著 I/O，只能用于明确实验或运维流程，不应被监控脚本周期调用。

## 6. Background Writer 与 Checkpointer

Background Writer 逐步写出一部分脏 Buffer，使后端更容易获得可复用 Buffer；Checkpointer 负责完成检查点要求的写入和同步。

当 Backend 自己频繁写 Buffer，可能说明后台写入节奏、Shared Buffers、工作集或存储吞吐需要分析。不能看到 Backend Write 就直接调大某个参数，应同时查看：

- 工作集是否超出内存；
- Checkpoint 是否过于集中；
- 存储写延迟；
- WAL 生成速率；
- Buffer 命中和扫描行为；
- Bulk Load 是否与在线流量重叠。

PostgreSQL 18 可使用 `pg_stat_checkpointer`、`pg_stat_bgwriter` 和 `pg_stat_wal`；旧版本视图字段不同，监控 SQL 必须按主版本维护。

## 7. Crash Recovery

异常退出后：

```text
read control/checkpoint information
→ find redo start LSN
→ replay valid WAL records
→ restore page consistency
→ resolve transaction visibility
→ reach end of WAL
→ open database
```

未提交事务的变化不会作为已提交事实对外可见。WAL 主要提供 REDO，事务可见性和 MVCC 状态让未提交版本保持不可见。

恢复时间受以下因素影响：

- 从 Redo 起点到 WAL 末尾的量；
- WAL 重放速度；
- 数据页读取和写入延迟；
- Full-Page Image 和工作负载类型；
- 恢复期间的存储争用；
- 是否需要从 Archive 获取 Segment。

看到 `database system was interrupted` 或 recovery 日志时，不要删除 `pg_wal`、控制文件或 `postmaster.pid` 猜测修复。先确认进程是否真实存在、保存日志和目录证据，再按恢复手册处理。

## 8. WAL Archive 与 PITR

PITR 需要两部分：

```text
consistent base backup
+ uninterrupted WAL chain after backup start
= recover to target time/LSN/name
```

`archive_command` 或归档组件必须：

- 同一 Segment 重复执行仍安全；
- 先写临时对象，再原子发布完整对象；
- 校验大小或校验和；
- 目标已存在且一致时返回成功；
- 失败时返回非零并告警；
- 不覆盖内容不同的同名对象。

归档失败会让未归档 Segment 滞留在 `pg_wal`。磁盘满后主库可能停止服务，所以必须同时监控归档失败、最后成功时间、积压字节和文件系统剩余空间。

流复制不能替代备份：误删、逻辑错误和部分损坏也可能被快速复制到备库。WAL Archive 也不能替代已验证的 Base Backup。

## 9. Timeline：恢复历史的分支

每次 Archive Recovery 完成或 Standby 提升，都会产生新的 Timeline：

```text
timeline 1 ────────────────X old primary history
                         \
timeline 2                └──── new writes
```

Timeline History 文件记录从哪个 Timeline、哪个 LSN 分叉。恢复工具需要它选择正确 WAL 链。

故障切换后，旧主的数据目录属于旧历史，不能直接作为主库或备库重新加入。通常需要：

- 使用 `pg_rewind`，且满足其前置条件；
- 或从新主重新做 Base Backup；
- 校验复制 Slot、Timeline 和起始 LSN；
- 确认旧主隔离，避免双主写入。

## 10. 容量规划

### 10.1 WAL 生成速率 {/* #wal-生成速率 */}

```text
wal_rate = wal_bytes_delta / sample_seconds
```

至少分别记录平均、业务高峰和批处理峰值。

### 10.2 归档空间 {/* #归档空间 */}

```text
archive_capacity
≥ peak_wal_rate × required_retention
  × safety_factor
```

还要考虑 Base Backup、多个 Timeline、对象存储版本和恢复演练副本。

### 10.3 pg_wal 本地空间 {/* #pgwal-本地空间 */}

需要容纳：

- Checkpoint 周期所需 WAL；
- Archive 短时故障积压；
- 最慢复制 Slot/Standby 保留；
- 高峰突发；
- 运维安全余量。

`max_slot_wal_keep_size` 等参数只能作为保护边界，触发后可能让落后备库或消费者无法继续，必须同时有告警和重建流程。

## 11. 观测 SQL

```sql
SELECT * FROM pg_stat_wal;
SELECT * FROM pg_stat_checkpointer;
SELECT * FROM pg_stat_bgwriter;
SELECT * FROM pg_stat_archiver;

SELECT
  pg_current_wal_lsn() AS current_lsn,
  now() AS sampled_at;

SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'synchronous_commit',
  'checkpoint_timeout',
  'checkpoint_completion_target',
  'max_wal_size',
  'min_wal_size',
  'archive_mode'
);
```

将数据库统计与主机侧磁盘延迟、吞吐、队列深度和 fsync P99 对齐。统计视图是累计值，告警通常需要计算区间增量。

## 12. 可复现实验

只在一次性测试实例进行。

### 12.1 实验一：计算 WAL 放大 {/* #实验一计算-wal-放大 */}

1. 记录起始 LSN；
2. 插入一批窄行并记录结束 LSN；
3. 计算 `pg_wal_lsn_diff`；
4. 对相同行做 UPDATE；
5. 比较业务数据字节与 WAL 字节；
6. 在一次实验 Checkpoint 后再更新，观察 Full-Page Image 对 WAL 的影响。

不要在生产为了实验强制 Checkpoint。

### 12.2 实验二：观察 Group Commit 与 fsync {/* #实验二观察-group-commit-与-fsync */}

用相同事务总量比较：

- 单连接逐条提交；
- 多连接并发提交；
- 每事务一行；
- 每事务批量多行。

记录 TPS、事务 P99、`wal_sync_time`、`wal_write_time` 和存储 fsync。改变 `synchronous_commit` 前先写出可接受的数据损失边界。

### 12.3 实验三：Crash Recovery {/* #实验三crash-recovery */}

在可丢弃实例持续写入并记录已确认事务，然后使用数据库自带的 immediate stop 方式模拟异常退出：

```bash
pg_ctl -D /path/to/disposable/data -m immediate stop
pg_ctl -D /path/to/disposable/data start
```

记录 Redo 起止日志、恢复时间和最后可见事务。该命令禁止在生产或包含重要数据的实例执行。

### 12.4 实验四：PITR {/* #实验四pitr */}

1. 创建 Base Backup；
2. 确认 WAL 连续归档；
3. 写入带时间标记的测试数据；
4. 删除其中一批；
5. 恢复到删除前；
6. 验证业务数据、Timeline、恢复目标和 WAL 链；
7. 记录实际 RTO/RPO。

备份成功日志不等于恢复成功，只有恢复演练通过才算可用备份。

## 13. 故障排查 Runbook

### 13.1 COMMIT P99 升高 {/* #commit-p99-升高 */}

```text
确认 synchronous_commit/同步备库
→ 查看 WAL write/sync time
→ 对齐主机 fsync 和磁盘队列
→ 查看同步备库 write/flush/replay
→ 检查 Checkpoint 与 Full-Page Image 峰值
→ 检查并发和 Group Commit 变化
```

### 13.2 pg_wal 快速增长 {/* #pgwal-快速增长 */}

```text
计算 WAL 生成速率
→ 检查 archive failure/lag
→ 检查 replication slot retained WAL
→ 检查 standby lag
→ 检查频繁 checkpoint 和批量写
→ 先保护磁盘，再修复消费者/归档
```

不要直接删除 `pg_wal` 中的文件。

## 14. 验收题

- COMMIT 成功为什么不要求所有数据页落盘？
- LSN 与时间戳有什么区别？
- Checkpoint 太频繁为什么既增加数据页写，又增加 WAL？
- `synchronous_commit=off` 降低了哪一层保证？
- WAL Archive 和流复制分别解决什么，为什么都不能替代备份？
- Timeline 为什么决定旧主能否重新加入？
- `pg_wal` 增长时为什么不能直接调小 `max_wal_size`？

## 15. 参考资料 {/* #参考资料 */}

- [Write-Ahead Logging](https://www.postgresql.org/docs/18/wal-intro.html)
- [WAL configuration](https://www.postgresql.org/docs/18/wal-configuration.html)
- [Continuous archiving and PITR](https://www.postgresql.org/docs/18/continuous-archiving.html)
- [WAL reliability](https://www.postgresql.org/docs/18/wal-reliability.html)
