---
title: "Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat"
sidebar_label: "09. Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat"
sidebar_position: 9
description: "理解旧版本回收、冻结、防回卷、表索引膨胀和 Autovacuum 调优。"
tags: [PostgreSQL, Vacuum, Autovacuum, Bloat, XID]
---

# Vacuum、Autovacuum、Freeze、XID Wraparound 与 Bloat

> 版本基线：PostgreSQL 18.x。本文所有阈值和维护命令都要在测试环境测量 I/O、WAL 与锁影响后再用于生产。

MVCC 让读写并发：UPDATE 通常写入新 Tuple 版本，DELETE 把旧版本标记为不可见。只要还有事务 Snapshot、复制槽或 Standby 可能需要旧版本，PostgreSQL 就不能安全回收它。

```text
UPDATE / DELETE
→ 产生 Dead Tuple
→ 所有可能看到旧版本的 Snapshot 结束
→ VACUUM 确认不可见并回收
→ 空间留在 Relation 内供后续 INSERT/UPDATE 复用
```

普通 `VACUUM` 通常不缩小表文件；它更新 Free Space Map，让空间可复用，并维护 Visibility Map。Visibility Map 的 all-visible 页可以让 Index-only Scan 避免访问 Heap；Vacuum 落后不仅占空间，也可能降低查询效率。

## 1. Vacuum、Analyze 与 Rewrite 的边界 {/* #vacuumanalyze-与-rewrite-的边界 */}

| 操作 | 作用 | 锁/空间特征 |
| --- | --- | --- |
| `VACUUM` | 回收 Dead Tuple、更新 VM/FSM、Freeze | 可与普通读写并发，但消耗 I/O/WAL/CPU |
| `ANALYZE` | 采样并更新 Planner 统计 | 不回收空间 |
| `VACUUM (ANALYZE)` | 两者一起执行 | 适合维护后同步更新统计 |
| `VACUUM FULL` | 重写表并把空间还给 OS | 需要强锁、额外磁盘、索引重建与 WAL 预算 |
| `REINDEX [CONCURRENTLY]` | 重建索引 | 只解决索引，不解决 Heap Bloat；并发模式仍有阶段锁和额外空间 |

`VACUUM FULL` 不是日常 Autovacuum 的替代品。生产选择 Rewrite 前必须测业务锁等待、磁盘、WAL、复制延迟与回退。

## 2. Autovacuum {/* #autovacuum */}

UPDATE/DELETE 触发 Vacuum 的核心近似式：

```text
触发 Dead Tuple 数
≈ autovacuum_vacuum_threshold
 + autovacuum_vacuum_scale_factor × 估算表行数
```

Analyze 使用对应的 `autovacuum_analyze_threshold/scale_factor`。目标版本还可能根据 INSERT 数量触发 Vacuum。最终行为受表级参数、全局参数、Worker、Cost Delay/Limit 和 Anti-wraparound 任务影响。

对于 10 亿行大表，默认比例即使很小也可能允许数千万 Dead Tuple；热点大表应使用更小 scale factor 和合适 threshold：

```sql
ALTER TABLE public.orders SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_vacuum_threshold = 50000,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_analyze_threshold = 25000
);
```

示例不是推荐值。根据每秒 UPDATE/DELETE、可接受 Dead Tuple、单轮 Vacuum 时长和 I/O 预算计算，再观察至少一个完整业务周期。

调大 Worker 只增加并发机会；如果磁盘已饱和、Cost Budget 被多个 Worker 分摊或长事务阻挡，Worker 更多可能让业务更抖。应同时调整调度频率、表级阈值、Cost、I/O 和分区策略。

## 3. Freeze 与 Wraparound {/* #freeze-与-wraparound */}

普通事务 ID 是有限循环空间。PostgreSQL 通过 Freeze 把足够旧且对所有未来事务都可见的 Tuple 处理为不再依赖普通 XID 年龄，避免新旧事务判断反转。

必须分别监控数据库和表年龄：

```sql
SELECT datname,
       age(datfrozenxid) AS xid_age,
       mxid_age(datminmxid) AS multixact_age
FROM pg_database
ORDER BY xid_age DESC;

SELECT c.oid::regclass AS relation,
       age(c.relfrozenxid) AS xid_age,
       mxid_age(c.relminmxid) AS multixact_age,
       pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class AS c
WHERE c.relkind IN ('r', 'm')
ORDER BY xid_age DESC
LIMIT 50;
```

接近 `autovacuum_freeze_max_age` 时，Anti-wraparound Vacuum 会优先运行，某些普通 Cost 限制不再按平时方式约束；若继续逼近安全边界，PostgreSQL 最终会拒绝产生新 XID 的命令以保护数据。不能等到业务写失败才告警，应按消费速率预估“距离阈值还剩多少时间”。

MultiXact 也会 Wraparound，锁多行、外键等工作负载要同时监控 `relminmxid/datminmxid`。

## 4. 阻碍回收 {/* #阻碍回收 */}

```text
长事务或 idle in transaction 的 backend_xmin
逻辑/物理复制槽保留的 xmin、catalog_xmin 或 restart_lsn
hot_standby_feedback 与长 Standby 查询
长时间 Prepared Transaction
```

取证查询：

```sql
SELECT pid, usename, application_name, state,
       xact_start, backend_xmin, wait_event_type, wait_event,
       left(query, 200) AS query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL OR backend_xmin IS NOT NULL
ORDER BY xact_start NULLS LAST;

SELECT slot_name, slot_type, active, active_pid,
       xmin, catalog_xmin, restart_lsn,
       wal_status, safe_wal_size
FROM pg_replication_slots;

SELECT gid, prepared, owner, database
FROM pg_prepared_xacts
ORDER BY prepared;
```

先联系 Owner、确认业务和复制语义，再终止事务、推进/删除槽或调整反馈；不能看到 `idle in transaction` 就批量 Kill。逻辑槽删除会破坏下游增量位置，Standby 取消查询可能影响报表，Prepared Transaction 需要明确提交/回滚决定。

## 5. Bloat {/* #bloat */}

Bloat 是“Relation 物理空间明显大于当前有效数据合理需求”，不等同于存在 Dead Tuple。普通 Vacuum 后 Dead Tuple 可复用，但文件仍大；如果工作集长期缩小，空闲页可能再也用不到。

`n_dead_tup` 是统计估算，不是精确字节；`pg_total_relation_size` 大也可能只是有效数据和索引本来就大。判断要组合：行数与平均行宽、Dead/Live 趋势、更新模式、FSM/VM、索引页密度、Cache/IO、扩展或抽样估算。

索引也会因随机更新、页分裂和无效 Item 膨胀。Heap Vacuum 不一定让索引缩小；选择 `REINDEX CONCURRENTLY`、在线重写工具、分区滚动或维护窗口 `VACUUM FULL` 时，都要计算额外磁盘、WAL、复制和最终切换锁。

HOT Update 能在索引列不变且 Heap 页有空间时避免新增索引条目。过高 Fillfactor 会减少页内更新空间；降低 Fillfactor 可提高 HOT 概率，但会增加基础表大小，需要实测。

## 6. 监控与进度 {/* #监控与进度 */}

```sql
SELECT relid::regclass AS relation,
       n_live_tup, n_dead_tup, n_mod_since_analyze,
       last_autovacuum, autovacuum_count,
       last_autoanalyze, autoanalyze_count,
       vacuum_count, analyze_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 50;

SELECT pid, datname, relid::regclass AS relation,
       phase, heap_blks_total, heap_blks_scanned,
       heap_blks_vacuumed, index_vacuum_count,
       dead_tuple_bytes, max_dead_tuple_bytes,
       num_dead_item_ids, indexes_processed, indexes_total
FROM pg_stat_progress_vacuum;
```

同时采集 Autovacuum 日志、`pg_stat_io`、WAL、Checkpoint、业务 P99 和复制延迟。进度视图的 Phase 与块数能区分“仍在扫 Heap”“处理索引”还是“清理”；没有进度不代表没问题，任务也可能一直排队、被锁阻塞或刚被取消。

## 7. 分层处理流程 {/* #分层处理流程 */}

1. 确认风险是 XID/MultiXact 年龄、Dead Tuple、Bloat，还是统计过期。
2. 找出阻塞回收的 Oldest xmin/slot/prepared transaction。
3. 修阻塞根因，确认可回收边界前进。
4. 对热点表调整阈值/Cost/Worker，并观察业务 I/O。
5. 需要归还 OS 空间时，单独规划 Rewrite/REINDEX。
6. 验证表年龄下降、Dead 趋势恢复、计划与 P99 改善、复制追平。

### 7.1 紧急 XID Runbook {/* #紧急-xid-runbook */}

若年龄快速逼近安全边界：冻结 DDL/批任务和非必要写入 → 找并处理 Oldest xmin/复制槽/Prepared Transaction → 确保 Autovacuum 没被表级禁用且磁盘有余量 → 对最高龄表运行受控 Vacuum → 持续观察年龄下降速度。不要先执行 `VACUUM FULL`；强锁和重写可能浪费最宝贵的时间。

```sql
VACUUM (VERBOSE, ANALYZE) public.target_table;
```

命令会产生明显 I/O/WAL，必须在确定阻塞边界已解除、维护资源足够时执行。恢复后根据 XID 消耗速度建立提前量告警，而不是保留临时大资源配置不管。

## 8. 常见错误 {/* #常见错误 */}

| 错误做法 | 为什么无效或危险 |
| --- | --- |
| 每晚固定 `VACUUM FULL` | 强锁、重写和 WAL 大，掩盖 Autovacuum 根因 |
| 只看 `n_dead_tup` | 忽略 XID、Slot、Index Bloat、统计误差 |
| 只增大 Worker | 可能加重 I/O，且无法越过 Oldest xmin |
| 长期关闭 Autovacuum | 失去回收、统计与防 Wraparound 保护 |
| 为保 Standby 查询无限开 feedback | Primary Bloat/WAL 可能持续增长 |
| 未评估就删除复制槽 | 下游丢失增量起点，可能必须全量重建 |

## 9. 验收题 {/* #验收题 */}

- 普通 VACUUM 为什么不缩小文件？
- 长事务怎样阻止回收？
- Freeze 防止什么故障？
- 为何大表需更小 scale factor？
- `n_dead_tup` 很低为什么仍可能有严重 Bloat？
- XID 紧急时为什么通常不先做 `VACUUM FULL`？

## 10. 参考资料 {/* #参考资料 */}

- [Routine vacuuming](https://www.postgresql.org/docs/18/routine-vacuuming.html)
- [Vacuum configuration](https://www.postgresql.org/docs/18/runtime-config-vacuum.html)
- [Statistics monitoring](https://www.postgresql.org/docs/18/monitoring-stats.html)
