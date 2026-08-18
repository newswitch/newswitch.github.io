---
title: "ClickHouse Client、System 表与运维命令手册"
sidebar_label: "15. ClickHouse Client、System 表与运维命令手册"
sidebar_position: 15
description: "从 clickhouse-client、安全连接和执行计划，到 parts、merges、replicas、mutations、query_log 与慢查询排障。"
tags: [ClickHouse, 命令手册, OLAP, System Tables, 故障排查]
---

# ClickHouse Client、System 表与运维命令手册

ClickHouse 排障要把一张逻辑表拆成：**分片与副本 → Part → Merge/Mutation → 查询 Pipeline → 磁盘与后台任务**。System 表是这条链路的主要证据来源。

## 1. 安全分级与连接

- `[R]`：查询元数据、System 表和计划。
- `[W]`：写入、触发同步、修改设置。
- `[D]`：Kill、Mutation、强制合并、删除数据。

```bash
# --password 不带值时交互输入
clickhouse-client \
  --host clickhouse.example.com \
  --port 9440 \
  --secure \
  --user analyst \
  --password \
  --database analytics
```

```bash
# [R] 单条查询
clickhouse-client --host <host> --secure --user analyst --password \
  --query "SELECT version()"

# [R/W] 文件内容决定副作用
clickhouse-client --host <host> --secure --user analyst --password \
  --queries-file check.sql
```

认证信息优先放入权限受控的客户端配置或 Secret，不要拼接到 shell 历史。

## 2. 元数据查询

```sql
-- [R]
SHOW DATABASES;
SHOW TABLES FROM analytics;
DESCRIBE TABLE analytics.events;
SHOW CREATE TABLE analytics.events;

SELECT database, name, engine, total_rows, total_bytes
FROM system.tables
WHERE database = 'analytics';
```

从 `SHOW CREATE TABLE` 读出：引擎、分区键、排序键、主键、TTL、副本路径和集群宏。ClickHouse 的主键主要用于稀疏索引，不等同于关系数据库的唯一约束。

## 3. EXPLAIN 与查询 Pipeline

```sql
-- [R] 查询计划
EXPLAIN PLAN
SELECT user_id, count()
FROM analytics.events
WHERE event_date = today()
GROUP BY user_id;

-- [R] 处理 Pipeline 与并行度
EXPLAIN PIPELINE
SELECT user_id, count()
FROM analytics.events
WHERE event_date = today()
GROUP BY user_id;

-- [R] 查看索引裁剪信息；选项以当前版本为准
EXPLAIN indexes = 1
SELECT * FROM analytics.events
WHERE event_date = today() AND user_id = 1001;
```

重点判断：分区是否裁剪、主键/跳数索引是否减少 Granule、读取行数是否远高于结果行数、Pipeline 并发是否匹配资源。

## 4. 正在执行的查询

```sql
-- [R]
SELECT
  query_id, user, elapsed, read_rows, read_bytes,
  memory_usage, query
FROM system.processes
ORDER BY elapsed DESC;

-- [D] 精确终止一个查询
KILL QUERY WHERE query_id = '<query-id>' SYNC;
```

Kill 前确认它是否为 INSERT、Mutation 或分布式查询的一部分。集群环境还要确认是在单节点还是通过 `ON CLUSTER` 操作；不要用宽泛条件批量 Kill。

## 5. Part 与小文件

```sql
-- [R] 当前活动 Part 的数量和大小
SELECT
  database, table, partition,
  count() AS active_parts,
  sum(rows) AS rows,
  formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE active
  AND database = 'analytics'
  AND table = 'events'
GROUP BY database, table, partition
ORDER BY active_parts DESC;

-- [R] 查看最小 Part
SELECT partition, name, rows,
       formatReadableSize(bytes_on_disk) AS bytes
FROM system.parts
WHERE active AND database='analytics' AND table='events'
ORDER BY bytes_on_disk ASC
LIMIT 20;
```

大量小 Part 会增加元数据、文件句柄、查询规划和合并压力。根因通常是高频小批写入或分区过细，应先修写入批次和分区设计。

## 6. 后台 Merge

```sql
-- [R]
SELECT
  database, table, elapsed, progress,
  num_parts, total_size_bytes_compressed,
  result_part_name
FROM system.merges
ORDER BY elapsed DESC;

-- [D] 强制把分区合并到一个 Part，可能消耗大量 IO
OPTIMIZE TABLE analytics.events
PARTITION '202608' FINAL;
```

`OPTIMIZE ... FINAL` 不是日常清理万能命令。大分区强制合并可能长时间占用 CPU、磁盘和空间；优先让后台合并正常工作，并解决持续产生小 Part 的源头。

## 7. 副本状态与复制队列

```sql
-- [R]
SELECT
  database, table, is_leader, is_readonly,
  is_session_expired, queue_size, inserts_in_queue,
  merges_in_queue, absolute_delay,
  total_replicas, active_replicas
FROM system.replicas
WHERE database = 'analytics';

-- [R] 查看卡住的复制任务
SELECT
  database, table, replica_name, type,
  create_time, num_tries, last_exception,
  source_replica
FROM system.replication_queue
WHERE database = 'analytics'
ORDER BY create_time;

-- [W/D] 等待指定副本追平；可能阻塞很久
SYSTEM SYNC REPLICA analytics.events;
```

判断顺序：Keeper 会话是否有效 → 副本是否只读 → active replicas 是否减少 → 队列中的任务类型与异常 → 网络/磁盘/源副本。

## 8. Mutation 进度

`ALTER TABLE ... UPDATE/DELETE` 通常以 Mutation 异步改写 Part，成本很高：

```sql
-- [R]
SELECT
  database, table, mutation_id, command,
  create_time, parts_to_do, is_done,
  latest_fail_reason
FROM system.mutations
WHERE database = 'analytics'
ORDER BY create_time DESC;

-- [D] 终止指定 Mutation；已完成的 Part 改写不会自动还原
KILL MUTATION
WHERE database = 'analytics'
  AND table = 'events'
  AND mutation_id = '<mutation-id>';
```

Mutation 失败时先保留 `latest_fail_reason`，确认磁盘空间、数据类型转换、损坏 Part 和副本状态。Kill 只停止后续处理，不等价于事务回滚。

## 9. 磁盘、后台任务与资源

```sql
-- [R]
SELECT name, path,
       formatReadableSize(free_space) AS free,
       formatReadableSize(total_space) AS total,
       formatReadableSize(keep_free_space) AS reserved
FROM system.disks;

SELECT metric, value
FROM system.metrics
WHERE metric IN (
  'Query', 'Merge', 'PartMutation',
  'ReplicatedFetch', 'ReplicatedSend'
);

SELECT event, value
FROM system.events
WHERE event IN (
  'SelectedRows', 'SelectedBytes',
  'InsertedRows', 'InsertedBytes'
);
```

指标名会随版本演进，可先 `SELECT * FROM system.metrics ORDER BY metric` 探索。瞬时值看 `system.metrics`，累积计数看 `system.events`，历史趋势应交给监控系统。

## 10. query_log 慢查询分析

`system.query_log` 的落盘存在刷新间隔。调试时可在有权限且明确理解影响时执行 `SYSTEM FLUSH LOGS`，生产环境不要高频调用。

```sql
-- [R]
SELECT
  event_time, query_id, user,
  query_duration_ms,
  read_rows, read_bytes,
  written_rows, memory_usage,
  exception_code, exception,
  query
FROM system.query_log
WHERE event_time >= now() - INTERVAL 1 HOUR
  AND type IN ('QueryFinish', 'ExceptionWhileProcessing')
ORDER BY query_duration_ms DESC
LIMIT 20;
```

将 `query_id` 与 `system.query_thread_log`、OpenTelemetry 或服务日志关联，可以继续定位到线程、节点和分布式子查询。

## 11. 标准排障顺序

```text
查询 ID / 表名 / 分区
  → processes 与 query_log
  → EXPLAIN 的裁剪、读取量和 Pipeline
  → parts 与 merges
  → replicas 与 replication_queue
  → mutations
  → disks、Keeper、CPU、网络
```

| 现象 | 优先证据 |
|---|---|
| 查询突然变慢 | query_log、EXPLAIN、读取行字节、Part 数 |
| 写入报 too many parts | system.parts、写入批次、merge 是否追不上 |
| 副本延迟 | system.replicas、replication_queue、Keeper |
| 磁盘快速增长 | parts、mutations、TTL、临时文件与副本数 |
| Mutation 不结束 | system.mutations、失败原因、剩余 Part |

## 12. 分钟实验 {/* #12-30-分钟实验 */}

1. 创建 MergeTree 实验表，分多次写入小批数据。
2. 查询 `system.parts`，观察 Part 数量。
3. 运行聚合的 `EXPLAIN PLAN` 与 `EXPLAIN PIPELINE`。
4. 查询 `system.processes` 和 `system.query_log`，关联同一个 Query ID。
5. 在实验小分区执行一次 `OPTIMIZE ... FINAL`，比较前后 Part；理解为什么生产大分区不能照搬。
6. 若有复制表，观察 `system.replicas` 与复制队列。

## 13. 掌握标准

- 能从排序键、分区键和计划判断扫描量。
- 能量化小 Part，而不是只说“小文件多”。
- 能区分 Merge、Mutation 与 Replication Queue。
- 能用 query_id 串联实时查询、历史日志和节点证据。
- 能解释为何强制 FINAL、批量 Mutation 和宽泛 Kill 是高风险操作。

## 14. 官方参考 {/* #官方参考 */}

- [ClickHouse Command-line Client](https://clickhouse.com/docs/interfaces/cli)
- [System Tables](https://clickhouse.com/docs/operations/system-tables)
- [EXPLAIN](https://clickhouse.com/docs/sql-reference/statements/explain)
