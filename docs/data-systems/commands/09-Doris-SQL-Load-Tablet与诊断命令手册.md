---
title: Doris SQL、Load、Tablet 与诊断命令手册
sidebar_position: 9
description: 覆盖 Doris FE/BE 状态、SQL 计划、Stream Load、Routine Load、Tablet 副本健康、诊断与生产故障排查。
tags: [Doris, 命令手册, OLAP, Tablet, 故障排查]
---

# Doris SQL、Load、Tablet 与诊断命令手册

Doris 的一张表会按 Partition、Bucket 切成 Tablet，并在 BE 上保存副本；FE 负责元数据和查询规划，BE 负责存储与执行。排障要沿着 **SQL → Fragment → Tablet → Replica → BE 磁盘/网络** 逐层定位。

## 1. 安全分级与连接

- `[R]`：查看状态、元数据、执行计划和任务。
- `[W]`：写数据、暂停/恢复导入、修改属性。
- `[D]`：删除/覆盖数据、停止任务、Kill 查询、修复或均衡操作。

Doris 兼容 MySQL 协议，默认查询端口常见为 9030，但应以当前环境配置为准：

```bash
# -p 不带密码值，交互输入
mysql -h doris-fe.example.com -P 9030 \
  -u analyst -p --default-character-set=utf8mb4
```

```sql
-- [R]
SELECT VERSION();
SHOW DATABASES;
SHOW TABLES FROM analytics;
SHOW CREATE TABLE analytics.orders;
DESC analytics.orders ALL;
```

## 2. FE 与 BE 健康

```sql
-- [R]
SHOW FRONTENDS;
SHOW BACKENDS;

-- [R] PROC 视图提供更深入状态，路径以当前版本为准
SHOW PROC '/frontends';
SHOW PROC '/backends';
```

FE 关注：角色、是否 Master、是否存活、心跳、元数据日志同步。BE 关注：Alive、Decommissioned、Tablet 数、磁盘使用、心跳与错误信息。

仅看到 `Alive=true` 不足以证明健康。还要检查磁盘剩余、Compaction、查询/导入失败率、Tablet 副本和节点负载是否均衡。

## 3. 表、分区与 Tablet

```sql
-- [R]
SHOW PARTITIONS FROM analytics.orders;
SHOW TABLETS FROM analytics.orders;

-- [R] 按条件缩小结果，支持的列以当前版本 SHOW TABLETS 文档为准
SHOW TABLETS FROM analytics.orders
WHERE State = 'NORMAL';
```

建表信息中重点关注：

- Key 模型：Duplicate、Aggregate、Unique。
- 分区键与范围：影响裁剪、生命周期和维护范围。
- Bucket 数和分桶键：影响并行度、Tablet 数和数据倾斜。
- 副本数：决定容错和存储成本。
- 分布方式、动态分区、存储介质与 colocate 属性。

Tablet 太多会放大元数据、心跳、Compaction 和调度开销；Tablet 太少会限制并行度并增加单 Tablet 压力。

## 4. EXPLAIN 与执行计划

```sql
-- [R]
EXPLAIN
SELECT customer_id, sum(amount)
FROM analytics.orders
WHERE business_date = '2026-08-10'
GROUP BY customer_id;

-- [R] 更详细计划；支持情况以目标版本为准
EXPLAIN VERBOSE
SELECT o.customer_id, c.level, sum(o.amount)
FROM analytics.orders o
JOIN analytics.customers c
  ON o.customer_id = c.id
GROUP BY o.customer_id, c.level;
```

重点判断：

- 扫描了多少 Partition 和 Tablet，分区裁剪是否生效。
- 谓词、列裁剪和 Runtime Filter 是否下推。
- Join 分布方式是 Broadcast、Shuffle 还是 Colocate。
- 聚合是否分阶段，Exchange 在哪里发生。
- 估算行数与真实数据是否明显偏离。

生产慢查询还应结合 Profile，确认各 Fragment/Operator 的时间、扫描量、网络、内存和长尾实例。

## 5. 当前会话与查询

```sql
-- [R]
SHOW PROCESSLIST;

-- [D] 按精确连接 ID 终止会话/查询
KILL <connection-id>;
```

Kill 前核对用户、数据库、SQL、执行时长和是否正在导入或写入。优先通过查询 Profile 找根因，Kill 只用于止损。

## 6. Stream Load

Stream Load 通过 HTTP 将本地文件或数据流导入单表。以下为 CSV 示例：

```bash
export DORIS_FE=http://doris-fe.example.com:8030
export DORIS_USER=loader

# [W] 密码交互输入；curl 会把请求转发到负责导入的节点
curl --location-trusted \
  --user "$DORIS_USER" \
  --upload-file orders.csv \
  --header "label:orders_20260810_001" \
  --header "column_separator:," \
  --header "format:csv" \
  "$DORIS_FE/api/analytics/orders/_stream_load"
```

在自动化环境使用 Secret 或权限受控的凭据文件，不要把 `user:password` 明文提交到脚本仓库。

返回 JSON 重点字段：

- `Status`：Success、Publish Timeout、Label Already Exists 等。
- `NumberTotalRows`、`NumberLoadedRows`、`NumberFilteredRows`。
- `LoadBytes`、`LoadTimeMs`。
- `ErrorURL`：过滤数据样例的诊断入口，注意权限与敏感数据。

`Publish Timeout` 不一定代表导入失败，应按 label 查询最终事务状态。稳定、唯一的 label 是重试幂等性的基础。

## 7. Batch Load 与导入状态

```sql
-- [R] 查看近期 Load
SHOW LOAD FROM analytics
ORDER BY CreateTime DESC
LIMIT 20;

-- [R] 按 label 查询
SHOW LOAD FROM analytics
WHERE LABEL = 'orders_20260810_001';

-- [D] 取消仍在运行的 Load
CANCEL LOAD FROM analytics
WHERE LABEL = 'orders_20260810_001';
```

关注状态、进度、过滤比例、错误信息、开始/结束时间和 Tracking URL。取消前确认任务是否支持安全重试以及 label 是否会复用。

## 8. Routine Load

Kafka 持续导入通常用 Routine Load：

```sql
-- [R]
SHOW ROUTINE LOAD FOR analytics.orders_kafka_job;

-- [R] 查看近期任务错误
SHOW ROUTINE LOAD TASK
WHERE JobName = 'orders_kafka_job';

-- [W] 暂停与恢复
PAUSE ROUTINE LOAD FOR analytics.orders_kafka_job;
RESUME ROUTINE LOAD FOR analytics.orders_kafka_job;

-- [D] 停止后不能简单等同于暂停恢复
STOP ROUTINE LOAD FOR analytics.orders_kafka_job;
```

排查积压时要同时看 Kafka Consumer Lag、Routine Load 任务并发、过滤行、错误原因、BE 导入能力和下游 Compaction。只增加并发可能把瓶颈推到 BE。

## 9. Tablet 副本与诊断

先从 `SHOW TABLETS` 找到异常 Tablet ID，再执行针对性查询：

```sql
-- [R] 查看一个 Tablet 的副本位置和状态
SHOW TABLET <tablet-id>;

-- [R] 诊断 Tablet；当前官方文档说明适用于存算一体模式
SHOW TABLET DIAGNOSIS <tablet-id>;

-- [R] 集群级 Tablet 健康汇总；PROC 路径以当前版本为准
SHOW PROC '/cluster_health/tablet_health';
```

诊断结果可帮助检查：Tablet 是否存在、FE 元数据副本数、BE 是否可用、版本是否完整、副本是否健康。存算分离部署的诊断入口和语义不同，不能照搬。

常见状态思路：

- 副本缺失：先确认 BE 是否永久故障，再让系统调度修复。
- 版本不完整：看 BE 失败原因、磁盘与复制状态。
- Tablet 长期不均衡：检查节点空间、标签、介质和均衡调度限制。
- 单 Tablet 热点：检查分桶键、数据倾斜和查询过滤条件。

不要在不知道副本状态和调度机制时手工删除 Tablet 文件。

## 10. 容量和 Compaction 方向

```sql
-- [R] BE 磁盘和 Tablet 总览
SHOW BACKENDS;

-- [R] 表/分区的数据量和分桶信息
SHOW DATA FROM analytics;
SHOW PARTITIONS FROM analytics.orders;
```

Compaction 积压常见表现：导入变慢、版本数量上升、查询扫描碎片增加、BE IO 高。应结合 BE metrics、日志、磁盘和导入批次判断；“手工触发 Compaction”只是应急手段，不是长期治理。

## 11. 标准排障顺序

```text
SQL / Load Label / Tablet ID
  → FE、BE 是否健康
  → 分区裁剪和执行计划/Profile
  → 导入任务状态与过滤数据
  → Tablet 副本、版本和节点位置
  → BE 磁盘、Compaction、CPU、网络
  → Kafka/对象存储等外部依赖
```

| 现象 | 首批证据 |
|---|---|
| 查询变慢 | EXPLAIN、Profile、扫描 Partition/Tablet |
| Stream Load 超时 | 返回 JSON、label 最终状态、BE 日志 |
| Routine Load 积压 | Routine Load 状态、Kafka Lag、过滤行 |
| 数据分布不均 | SHOW TABLETS、BACKENDS、分桶键与 Bucket 数 |
| 副本异常 | SHOW TABLET、DIAGNOSIS、BE 心跳和磁盘 |

## 12. 30 分钟实验

1. 创建一个按日期分区、Hash 分桶的实验表。
2. 使用相同 label 重试 Stream Load，观察幂等行为。
3. 查询 `SHOW LOAD` 并核对总行、成功行和过滤行。
4. 用 `EXPLAIN` 比较带/不带分区过滤的扫描范围。
5. 从 `SHOW TABLETS` 选择一个 Tablet，追踪它所在的 BE 和副本。
6. 若有 Kafka 实验环境，创建 Routine Load，暂停、观察 Lag、再恢复。

## 13. 掌握标准

- 能解释 FE、BE、Partition、Bucket、Tablet、Replica 的关系。
- 能用 Plan/Profile 区分扫描、Join、Exchange 和节点长尾。
- 能用 label 保证 Stream Load 可追踪、可安全重试。
- 能联查 Kafka Lag、Routine Load、BE 资源和 Compaction。
- 能从 Tablet ID 定位副本、节点、版本和健康问题。

## 官方参考

- [Doris SQL Manual](https://doris.apache.org/docs/sql-manual/)
- [Stream Load](https://doris.apache.org/docs/data-operate/import/import-way/stream-load-manual/)
- [Routine Load](https://doris.apache.org/docs/data-operate/import/import-way/routine-load-manual/)
- [Tablet Repair and Balance](https://doris.apache.org/docs/admin-manual/maint-monitor/tablet-repair-and-balance/)

