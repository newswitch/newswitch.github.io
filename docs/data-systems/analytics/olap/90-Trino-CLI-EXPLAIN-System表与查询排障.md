---
title: Trino CLI、EXPLAIN、System 表与查询排障
sidebar_label: "90. Trino CLI、EXPLAIN、System 表与查询排障"
sidebar_position: 90
description: 掌握 Trino CLI、Catalog 元数据、执行计划、会话参数、运行时系统表，以及跨数据源查询故障和性能定位。
tags: [Trino, SQL, 命令手册, 查询引擎, 故障排查]
---

# Trino CLI、EXPLAIN、System 表与查询排障

Trino 本身通常不保存业务数据。一次查询会经过 **Coordinator 解析和调度 → Connector 获取元数据与切片 → Worker 扫描和交换数据 → 下游数据源返回结果**。因此慢查询不一定是 Trino 算力不足，也可能是元数据、对象存储、数据库或网络问题。

## 1. 安全分级与连接

- `[R]`：查看元数据、执行计划和运行时状态。
- `[W]`：执行 INSERT/CREATE、修改会话。
- `[D]`：终止查询、删除对象或运行 `EXPLAIN ANALYZE` 对写 SQL。

```bash
# TLS 环境；--password 会交互提示，不把密码明文写入历史
./trino \
  --server https://trino.example.com:8443 \
  --user analyst \
  --password \
  --catalog iceberg \
  --schema analytics
```

若使用 OAuth2、JWT、Kerberos 或外部密码文件，按目标版本 CLI 认证文档配置。不要用 `--password your-password`。

## 2. CLI 常用方式

```bash
# [R] 单条查询
./trino --server https://trino.example.com:8443 \
  --user analyst --password \
  --execute "SHOW CATALOGS"

# [R/W] SQL 文件内容决定是否写入
./trino --server https://trino.example.com:8443 \
  --user analyst --password \
  --file check_orders.sql

# [R] 便于脚本消费的输出格式；可选项以 --help 为准
./trino --server https://trino.example.com:8443 \
  --user analyst --password \
  --output-format CSV_HEADER \
  --execute "SELECT * FROM iceberg.analytics.orders LIMIT 10"
```

自动化脚本还应检查退出码、标准错误和查询 ID，不能只判断输出文件是否存在。

## 3. Catalog、Schema 与表元数据

```sql
-- [R]
SHOW CATALOGS;
SHOW SCHEMAS FROM iceberg;
SHOW TABLES FROM iceberg.analytics;
SHOW COLUMNS FROM iceberg.analytics.orders;
SHOW CREATE TABLE iceberg.analytics.orders;
SHOW STATS FOR iceberg.analytics.orders;
```

`SHOW STATS` 的行数、NDV、空值比例和范围会影响优化器决策。若统计缺失或严重过期，Join 顺序和分布类型可能不合理；是否支持收集统计及语法取决于 Connector。

## 4. EXPLAIN：只看计划，不执行查询

```sql
-- [R] 默认逻辑/分布式计划
EXPLAIN
SELECT customer_id, sum(amount)
FROM iceberg.analytics.orders
WHERE business_date = DATE '2026-08-10'
GROUP BY customer_id;

-- [R] 查看分布式执行计划
EXPLAIN (TYPE DISTRIBUTED)
SELECT *
FROM iceberg.analytics.orders o
JOIN postgresql.crm.customers c
  ON o.customer_id = c.id;

-- [R] 查看 Connector 预计读取的输入
EXPLAIN (TYPE IO)
SELECT * FROM iceberg.analytics.orders
WHERE business_date = DATE '2026-08-10';
```

重点识别：

- `TableScan`：扫描哪些列、约束是否下推。
- `Exchange`：数据在节点间重分布、广播或汇聚。
- `RemoteSource`：读取其他 Stage 输出。
- Join 的 `PARTITIONED` / `REPLICATED`：大表广播会造成 Worker 内存压力。
- 估算行数和大小：与实际差距大时应检查统计信息。

## 5. EXPLAIN ANALYZE：会真的执行

```sql
# [R/W/D] SELECT 会读取真实数据；INSERT/DELETE 等会真的产生副作用
EXPLAIN ANALYZE
SELECT customer_id, sum(amount)
FROM iceberg.analytics.orders
WHERE business_date = DATE '2026-08-10'
GROUP BY customer_id;
```

输出可对比每个 Operator 的 CPU、Scheduled、Blocked、Input 和 Output。重点问：

1. 时间消耗在 CPU 还是 Blocked？
2. 输入行数在某一步为何突然膨胀？
3. 各 Driver 的输入是否严重不均？
4. Filter 是否在扫描端生效？
5. Join build side 是否合理？

对大查询先用 `EXPLAIN` 和小时间范围验证，再决定是否运行 `EXPLAIN ANALYZE`。

## 6. 会话参数

```sql
-- [R]
SHOW SESSION;

-- [W] 只修改当前会话
SET SESSION query_max_run_time = '30m';

-- [W] 恢复默认值
RESET SESSION query_max_run_time;
```

Catalog 还可以暴露 Connector 会话属性。属性名称和语义随版本变化，不应把临时调优参数写成永久“万能配置”。先记录基线，用同一查询与数据范围比较。

## 7. System Connector 运行时表

```sql
-- [R] Coordinator 和 Worker
SELECT * FROM system.runtime.nodes;

-- [R] 当前及近期查询
SELECT query_id, state, user, source,
       created, started, last_heartbeat,
       query
FROM system.runtime.queries
ORDER BY created DESC;

-- [R] 运行时任务
SELECT * FROM system.runtime.tasks
WHERE query_id = '<query-id>';

-- [R] 事务
SELECT * FROM system.runtime.transactions;
```

不同版本的列会变化，首次使用先 `DESCRIBE system.runtime.queries`。这些表适合现场查询；长期历史应进入监控、审计事件监听器或日志系统。

## 8. 终止异常查询

```sql
-- [D] 精确指定 query_id，并写明原因
CALL system.runtime.kill_query(
  query_id => '<query-id>',
  message => 'cancelled by oncall: excessive memory'
);
```

终止前核对用户、SQL、查询 ID、业务影响和是否正在写数据。取消查询不一定能立即终止外部数据源已经启动的工作，还应检查 Connector 和下游系统。

## 9. Connector 系统表与 Iceberg 元数据

System Connector 只反映 Trino 运行时；业务 Catalog 可能提供自己的系统表。例如 Iceberg：

```sql
-- [R] 双引号包住带 $ 的表名
SELECT *
FROM iceberg.analytics."orders$snapshots"
ORDER BY committed_at DESC;

SELECT file_path, file_size_in_bytes, record_count
FROM iceberg.analytics."orders$files"
ORDER BY file_size_in_bytes DESC;
```

这能把“Trino 扫描慢”继续拆为：文件过多、文件过小、分区未裁剪、对象存储慢，或 Trino 交换/计算慢。

## 10. 跨数据源查询排障

```text
Query ID
  → Coordinator 是否稳定
  → Worker 数量与状态
  → EXPLAIN 中扫描、过滤、Join、Exchange
  → EXPLAIN ANALYZE 的 CPU / Blocked / 输入输出
  → Connector 元数据和 Split 生成
  → 数据源延迟、限流、连接池和网络
```

| 现象 | 常见方向 |
|---|---|
| 长时间 Queued | 队列/资源组、Coordinator、集群容量 |
| Planning 很慢 | Metastore、Catalog、分区/文件元数据过多 |
| Blocked 很高 | 下游读取、网络交换、内存等待、输出客户端慢 |
| 单 Worker 热点 | 数据倾斜、分片不均、广播 Join |
| 外部数据库被打满 | 谓词未下推、并发过大、跨源 Join 策略不合理 |
| Worker lost | Pod/进程退出、GC、OOM、节点或网络故障 |

## 11. 20 分钟实验

1. 用 CLI 列出 Catalog、Schema 和表。
2. 对同一查询分别执行普通 `EXPLAIN`、`TYPE DISTRIBUTED` 和 `TYPE IO`。
3. 缩小数据范围后运行 `EXPLAIN ANALYZE`。
4. 从 `system.runtime.queries` 找到自己的 Query ID。
5. 比较有/无分区过滤的扫描输入和运行时间。
6. 查询 Iceberg `$files`，解释文件布局对 Trino 的影响。

## 12. 掌握标准

- 能区分 Coordinator、Worker、Connector 和数据源的责任边界。
- 能从计划中识别扫描下推、Join 分布和 Exchange。
- 能使用 System 表定位查询和 Task，而不是只看客户端报错。
- 能解释 CPU 高、Blocked 高、Planning 慢分别意味着什么。
- 能把 Trino 慢查询继续追踪到湖表文件、Metastore、网络或外部数据库。

## 官方参考

- [Trino Command Line Interface](https://trino.io/docs/current/client/cli.html)
- [EXPLAIN](https://trino.io/docs/current/sql/explain.html)
- [System Connector](https://trino.io/docs/current/connector/system.html)
- [Iceberg Connector](https://trino.io/docs/current/connector/iceberg.html)

