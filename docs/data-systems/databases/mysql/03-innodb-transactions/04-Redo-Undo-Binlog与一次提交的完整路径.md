---
title: "Redo、Undo、Binlog 与一次提交的完整路径"
sidebar_label: "04. Redo、Undo、Binlog 与一次提交的完整路径"
sidebar_position: 4
description: "以 MySQL 8.4 追踪 Redo、Undo、Binlog 与内部两阶段提交，解释刷盘取值、组提交、崩溃恢复和已确认事务的数据丢失边界。"
tags: [MySQL, Redo, Undo, Binlog, 事务提交]
---

# Redo、Undo、Binlog 与一次提交的完整路径

三个日志回答不同问题：崩溃后怎样恢复 Page、事务怎样回滚/构造旧版本、变更怎样复制和做 PITR。把它们都称为“事务日志”会掩盖关键差异。

本文以 **MySQL 8.4 LTS、InnoDB、启用 Binary Log 的普通事务**为主线。数据页、日志、OS 文件缓存和稳定存储属于不同层次；参数的取值、故障类型与存储语义必须一起判断。示例输出用于教学，不是某台生产数据库的实测记录。

## 1. 职责表

| 日志 | 层次 | 记录视角 | 主要消费者 |
| --- | --- | --- | --- |
| Redo | InnoDB | 页修改的恢复信息 | Crash Recovery |
| Undo | InnoDB | 修改前版本/回滚信息 | Rollback、MVCC、Purge |
| Binlog | Server | 事务逻辑事件 | Replica、PITR、CDC |

Redo 循环复用；Binlog 按文件保留策略管理；Undo 在不再被事务/快照需要后清理。

## 2. Redo：Write-Ahead Logging

原则：相关数据页写回前，能重建该修改的 Redo 必须先安全写入日志。

```text
修改 Buffer Pool Page
→ Redo 写入 Log Buffer
→ 写入/刷入 Redo 文件
→ 数据页以后刷盘
```

因此提交不需要随机写回所有业务页，把同步持久化集中到顺序日志路径。

Redo 使用 LSN 标识日志位置。Checkpoint 推进可复用边界，意味着相应较早的修改已有足够的数据页持久化保障；不是客户端每次提交就立即写回所有脏页。

这里的“写入”与“同步刷盘”也要分开。写文件的调用完成，可能仍只是进入 OS 文件缓存；同步操作才要求下层按持久化语义完成。8.4 的日志线程与 I/O 实现可能让阶段并行或合并，不能把概念图当成每个箭头都对应一次独立系统调用。[Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)

## 3. Undo：回滚与历史版本

更新前生成 Undo，使事务可以反向恢复，并让一致性读沿版本链找到可见旧版本。

```text
current row
→ roll pointer
→ older version
→ older version ...
```

提交后 Undo 不一定立即删除；只要活跃 Read View 可能需要它就要保留。长事务会扩大 History List 和 Undo 空间。

## 4. Binlog：复制与恢复时间线

Binlog 保存事务等变更的事件序列，可用于：

- Source→Replica；
- 基于时间点恢复；
- CDC；
- 审计/回放边界（需控制权限和隐私）。

Binlog 格式、GTID、保留期和完整备份共同决定可恢复窗口。只有 Binlog、没有基础备份，无法高效从任意历史起点恢复整个实例。

写入 Binlog 与 InnoDB 最终提交之间还存在内部协调阶段，因此不能把“在文件中看见了部分事件”直接解释成事务已经完整提交。解析时需要识别事务边界和完整性，恢复时还要结合持久化状态。

## 5. 一次 UPDATE

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

概念路径：

```text
定位聚簇记录并加锁
→ 写 Undo
→ 修改内存 Page
→ 生成 Redo
→ Server 生成 Binlog Cache/Event
→ Prepare/Commit 协调
→ 按配置写入并刷日志
→ 返回 Commit 成功
→ 脏页以后刷回表空间
→ Undo 以后 Purge
```

Redo 描述的底层页修改与行变更生成的 Binlog 事件不是一份相同字节流；Undo 又有回滚与可见性职责。这三者并行参与一次事务，不是互相替代的三种备份格式。

## 6. 两阶段提交心智模型

MySQL 需要让 InnoDB 提交状态与 Binlog 一致：

```text
InnoDB Prepare
→ Binlog 写入/提交
→ InnoDB Commit
```

它是 Server 与存储引擎内部的提交协调，不是把任意微服务、HTTP 请求和消息系统一起纳入事务。

以下按必要日志成功持久化、OS/存储正确兑现同步语义的条件推演，区别“提交决定”和“客户端是否知道”：

| 故障位置 | 恢复时的关键状态 | 处理含义 |
| --- | --- | --- |
| 事务仍未形成可提交的持久状态 | 没有完整提交依据 | 按恢复协议回滚未完成事务 |
| 有 InnoDB Prepare，但没有对应有效 Binlog 提交依据 | 引擎准备了，Server 尚无完整提交决定 | 不能仅凭 Prepare 宣布提交 |
| 有 Prepare 与有效持久 Binlog 提交依据，最终引擎提交尚未完成 | 有完整提交决定 | 崩溃恢复可完成相应 Prepared 事务 |
| 已提交，返回包在网络中丢失 | 服务端可能成功，客户端暂时未知 | 不能因为客户端超时就认定回滚 |

如果主动放宽两类日志的持久化要求，上述“必要日志存在”的前提也可能被破坏，不能再照搬最强持久性结论。MySQL 会按可恢复的日志状态处理，不会仅凭客户端曾收到 OK 就把已经丢失的日志变回来。[Binlog 与 InnoDB 的崩溃协调](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)

## 7. 刷盘参数与数据丢失窗口

### 7.1 先读取实际配置

```sql
SELECT @@version AS mysql_version,
       @@GLOBAL.log_bin AS binary_logging,
       @@GLOBAL.innodb_flush_log_at_trx_commit AS redo_policy,
       @@GLOBAL.innodb_flush_log_at_timeout AS redo_interval_seconds,
       @@GLOBAL.sync_binlog AS binlog_sync_groups;
```

教学输出可以整理为下表；`8.4.x` 表示所用补丁版本占位，不是固定版本字符串：

| mysql_version | binary_logging | redo_policy | redo_interval_seconds | binlog_sync_groups |
| --- | ---: | ---: | ---: | ---: |
| 8.4.x | 1 | 1 | 1 | 1 |

这里表示 Binlog 已开启，两类提交日志使用同步安全基线。它不表示数据页每次都同步写回，也不表示远端副本已经应用。

### 7.2 innodb_flush_log_at_trx_commit

这是 Global 动态枚举参数，8.4 默认 `1`，合法值为 `0/1/2`。下表描述参数自身要求，内部活动可能提前触发写入或同步：

| 值 | 提交时要求 | 周期任务 | 主要故障边界 |
| --- | --- | --- | --- |
| `0` | 不要求每次提交都将相应 Redo 写出并同步 | 后台周期性写出并同步 | 仅进程异常也可能丢失尚在进程内的日志 |
| `1` | 相应 Redo 要求写出并同步持久化 | 不依赖下一轮周期完成该提交的持久性 | 常规崩溃持久性基线，仍依赖下层存储语义 |
| `2` | 相应 Redo 写出，但不要求每次提交都同步到稳定介质 | 后台周期性同步 | OS 缓存可能保留到进程重启，但主机/OS 故障仍可丢失未同步部分 |

周期受 `innodb_flush_log_at_timeout` 影响，8.4 默认 1 秒、范围 1～2700 秒。定时调度并非严格实时，内部行为也可能增加同步，所以不能把 `0/2` 固定解释为“绝对最多丢一秒”。参数及硬件边界见 [8.4 InnoDB 参数](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_flush_log_at_trx_commit)。

### 7.3 sync_binlog

这是 Global 动态整数参数，8.4 默认 `1`，合法范围为 `0～4294967295`。它控制 Binary Log 同步，计数单位是提交组，不替 InnoDB 决定 Redo 刷盘：

| 值 | 同步含义 | 需要注意的风险 |
| --- | --- | --- |
| `0` | MySQL 不按该策略主动同步 Binlog，由 OS 回写 | 事务已提交，但对应 Binlog 可能尚未持久化 |
| `1` | 提交前按提交组同步 Binlog | 可合并一组事务，不是每条 SQL 都单独 fsync |
| `N > 1` | 收集 N 个 Binlog 提交组后同步 | 组大小与到达率变化，不能转换成固定 N 条事务或固定秒数 |

例如 `N=10`，每组可以有 1 条，也可能有很多事务。它不是“每十个 SQL”或“每十秒”的参数；因此不能凭 N 直接写出数据损失的事务数硬上限。[8.4 sync_binlog](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html#sysvar_sync_binlog)

### 7.4 为什么两个参数必须一起看

| Redo / Binlog 同步取值 | 主要含义 |
| --- | --- |
| `1 / 1` | 两类提交日志均要求相应同步，是启用 Binlog 的 InnoDB 常规持久性基线 |
| `2 / 1` | Binlog 同步不能替代 Redo 同步，Redo 仍有主机故障窗口 |
| `1 / 0` 或 `1 / N>1` | Redo 的持久化不能保证 Binlog 同样完整，复制/PITR 链可能缺失 |
| `0或2 / 0或N>1` | 不能给出与双 1 相同的已确认写入保证，需分别评估两类日志 |

这不是四种恢复结果一一固定的预测表。实际结果由故障点、实际已完成的 I/O 和恢复协议共同决定。所谓“双 1”也不保护物理介质彻底损毁、文件被误删或逻辑错误；仍需备份与故障域隔离。

### 7.5 用故障类型区分风险

假设最近一次后台同步在 `t=0`，`t=0.2` 一个事务返回成功，`t=0.6` 发生故障。若使用 Redo 策略 2，日志已经写入 OS 缓存，却可能没完成下一轮同步：

- 仅 mysqld 退出、OS 仍正常：已写入缓存的部分通常仍可保留，不能据此证明断电安全。
- OS 崩溃或断电：尚未同步部分可能丢失；即使 Binlog 已同步，也不能忽略 Redo 所需状态。
- 下层错误报告同步成功：即使参数为双 1，也不能凭 MySQL 配置证明设备断电保护可靠。

改变这些参数会改变已确认事务的风险，不是单纯的性能开关。本文不提供可直接复制到生产的降级命令；先定义允许的数据损失，再在隔离环境验证。

## 8. Group Commit

多个并发事务可在日志写入/刷盘阶段合并固定成本，提高吞吐。单并发延迟、并发吞吐和存储 fsync 能力相互作用。

例如一个教学批次中 10 个事务共同等待一轮相应日志同步，固定同步成本为 2 ms，可以被该组摊薄；这不意味着每个事务只等待 0.2 ms。每条事务还可能等待组形成、排队、另一类日志及自身执行。

因此双 1 与高吞吐并不天然矛盾。先观察提交组、并发、设备同步延迟与长事务；把持久性参数调弱后得到的更高 TPS，不能当作在相同正确性约束下的性能提升。

压测要记录：

- Commit/s 与延迟分位数；
- 并发；
- Redo/Binlog Bytes/s；
- fsync 延迟；
- Replica/CDC 消费；
- 持久性配置。

## 9. 大事务

大事务放大：

- Undo/Redo/Binlog；
- 锁持有；
- Replica 回放与 Lag；
- CDC 单事务延迟；
- 回滚和 Crash Recovery；
- 备份与网络峰值。

批量任务按业务原子性合理分批，使用幂等断点。不能为了性能随意拆开必须原子完成的账务事务。

## 10. 日志保留与磁盘满

Binlog 保留过短会破坏 PITR 和延迟 Replica 恢复；过长会占满磁盘。Redo 容量影响 Checkpoint 压力，Undo 受长事务/Purge 影响。

分别监控：

```text
Redo capacity/usage/rate
Checkpoint age
Undo tablespace/history
Binlog current size/growth/retention
filesystem free and inode
backup restore point coverage
```

磁盘告警必须预留应急和恢复时间，不在 99.9% 才处理。

不要直接删除当前 Redo 文件或仍被恢复链依赖的 Binlog 来“救空间”。Binlog 清理必须结合备份覆盖、复制消费位置及保留策略；完整步骤见 [Binlog PITR 与误删恢复](../07-backup-security/04-Binlog-PITR误删恢复与灾难恢复演练.md)。

还可以读取：

```sql
SHOW ENGINE INNODB STATUS\G
```

LOG 部分的教学摘录如下，具体补丁版本可能增加其他字段：

```text
Log sequence number 1050000
Log written up to   1050000
Log flushed up to   1048000
Last checkpoint at  1000000
```

当前 LSN 与已同步位置相差 2000，当前 LSN 与 Checkpoint 相差 50000。它们是日志位置差，不是丢失事务数或脏页数量；一帧差值也不能证明系统卡住，活动事务和后台推进都会影响它。结合采样时间、提交延迟与当前参数继续判断，而不是看见差值就直接降低同步策略。[InnoDB Monitor 输出](https://dev.mysql.com/doc/refman/8.4/en/innodb-standard-monitor.html)

## 11. 复制不是备份

误删事务会进入 Binlog 并复制到 Replica；逻辑错误不会被副本自动阻止。备份提供独立时间点和保留，Binlog 提供增量恢复，两者共同满足 RPO/RTO。

## 12. 实验

只在可丢弃的隔离数据库执行。客户端在被测实例之外记录业务 ID 与实际收到的提交成功，不用“服务端最大编号”替代成功集合。并发事务可能按不同顺序提交，自增 ID 也不是提交顺序。

1. 小事务与大事务比较 Redo/Binlog 增长和提交延迟；
2. 开长事务更新但不提交，观察 Undo/锁；
3. Commit 与 Rollback 比较最终数据和日志现象；
4. 在隔离环境模拟异常退出，观察恢复；
5. 使用备份 + Binlog 恢复到指定事务前；
6. 改变持久性参数仅做故障实验，明确丢失边界并恢复安全值。

恢复后对照成功集合与恢复集合，检查中间缺口、重复、金额守恒和复制/恢复链。测试日志应区分正常停止、单进程崩溃与测试虚拟机掉电；没有执行过后两者，就不宣称验证了它们。崩溃恢复的行为见 [InnoDB Recovery](https://dev.mysql.com/doc/refman/8.4/en/innodb-recovery.html)。

## 13. 验收题

### 13.1 Redo、Undo、Binlog 分别解决什么？

答案：Redo 支持页修改的崩溃恢复；Undo 支持回滚和旧版本读取；Binlog 提供复制与 PITR 等所需事件时间线。三者所在层次、消费方和保留方式不同。

### 13.2 WAL 为什么允许数据页延迟刷盘？

答案：只要按规则先持久化能重建修改的日志，就不必在每次提交中随机写回全部业务页。崩溃后可从数据文件和有效 Redo 恢复；这不免除数据页最终回写与 Checkpoint 推进。

### 13.3 提交后 Undo 为什么可能继续保留？

答案：其他活跃 Read View 可能仍需构造旧版本。提交不等于历史版本立即无人使用，长事务可能阻碍 Purge 并扩大 Undo/History List。

### 13.4 内部两阶段提交协调哪两个状态？

答案：协调 InnoDB 的事务状态与 Server 的 Binlog 提交依据。不是把 Redo 当成 Binlog，也不是跨任意外部系统的分布式事务。

### 13.5 为什么降低刷盘频率会改变 RPO？

答案：返回成功时可能仍有日志停留在进程或 OS 缓存。故障会让这些状态消失，扩大已确认事务的损失窗口；进程、OS 和介质故障不能混作一种实验。

### 13.6 大事务如何影响复制与恢复？

答案：它会增加 Undo/Redo/Binlog、锁持有和回滚工作量，并放大复制应用、CDC、传输及恢复的峰值成本。分批必须遵守业务原子性与幂等要求。

### 13.7 为什么 Binlog 不能单独替代完整备份？

答案：PITR 需要可验证的基线状态和之后连续、完整的增量链。只有某段 Binlog 不能自动重建缺失的全部基础数据，也不能覆盖错误保留期或文件损坏。

### 13.8 sync_binlog=100 是否等于最多丢 99 条事务？

答案：不是。它按提交组计数，一组可能含多条事务，OS 还可能提前回写；故障时的缺失取决于实际持久位置，不存在从这个数字直接推出的 99 条事务保证。

### 13.9 COMMIT 超时后能否直接再执行一次扣款？

答案：不能据超时认定事务失败。服务端可能已提交但响应丢失；应通过业务唯一 ID 查询结果，并使用幂等或明确的去重约束，避免一次不确定提交被重复执行。

下一篇进入并发可见性：ACID、隔离级别、MVCC 与 Read View。

## 14. 官方参考 {/* #官方参考 */}

- [InnoDB Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [InnoDB Undo Logs](https://dev.mysql.com/doc/refman/8.4/en/innodb-undo-logs.html)
- [Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [InnoDB and the ACID Model](https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html)
- [Redo 提交刷盘参数](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_flush_log_at_trx_commit)
- [Binlog 同步与提交组](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html#sysvar_sync_binlog)
- [InnoDB Recovery](https://dev.mysql.com/doc/refman/8.4/en/innodb-recovery.html)
