---
title: Iceberg Spark SQL 快照、时间旅行与维护命令手册
sidebar_position: 6
description: 使用 Spark SQL 查询 Iceberg 元数据表、执行时间旅行、演进 Schema 与分区，并安全完成小文件合并和快照清理。
tags: [Iceberg, Spark SQL, 湖仓, 快照, 命令手册]
---

# Iceberg Spark SQL 快照、时间旅行与维护命令手册

Iceberg 把“当前表”实现为一组可追溯的元数据和数据文件。运维时不要只看目录，而要沿着 **Catalog → Table Metadata → Snapshot → Manifest → Data/Delete Files** 分层判断。

本文使用 Spark SQL 与命名为 `lake` 的 Catalog。实际环境可能使用 Hive、Hadoop、REST、Glue 等 Catalog，请替换为自己的名称。

## 1. 安全分级

- `[R]`：读取表、元数据表和执行计划。
- `[W]`：写数据、改 Schema/分区、重写文件。
- `[D]`：回滚、过期快照、删除孤儿文件，可能使历史版本不可恢复。

```bash
$SPARK_HOME/bin/spark-sql \
  --conf spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions \
  --conf spark.sql.catalog.lake=org.apache.iceberg.spark.SparkCatalog \
  --conf spark.sql.catalog.lake.type=hive \
  --conf spark.sql.catalog.lake.uri=thrift://hive-metastore:9083
```

连接参数随 Catalog 类型不同。生产环境建议将稳定配置放入受控配置文件，而不是每次手写。

## 2. 表结构与属性

```sql
-- [R]
SHOW NAMESPACES IN lake;
SHOW TABLES IN lake.analytics;
DESCRIBE EXTENDED lake.analytics.orders;
SHOW CREATE TABLE lake.analytics.orders;

-- [R] 查看当前快照上的表数据
SELECT * FROM lake.analytics.orders LIMIT 10;
```

检查 `SHOW CREATE TABLE` 时关注：格式版本、分区变换、表属性、文件格式、位置。不要把对象存储目录中“有哪些文件”当成表的真实状态，Iceberg 只读取当前元数据引用的文件。

## 3. 元数据表：理解 Iceberg 的关键

Iceberg 将运维元数据暴露为只读表：

```sql
-- [R] 当前快照与父子关系
SELECT *
FROM lake.analytics.orders.snapshots
ORDER BY committed_at DESC;

-- [R] 当前引用的历史与快照
SELECT *
FROM lake.analytics.orders.history
ORDER BY made_current_at DESC;

-- [R] 当前快照的数据文件
SELECT file_path, file_format, record_count, file_size_in_bytes
FROM lake.analytics.orders.files
ORDER BY file_size_in_bytes DESC;

-- [R] Manifest 列表
SELECT * FROM lake.analytics.orders.manifests;

-- [R] 分区级统计
SELECT * FROM lake.analytics.orders.partitions;

-- [R] 分支和标签；需对应版本支持
SELECT * FROM lake.analytics.orders.refs;
```

部分 Spark/Catalog 组合使用带 `$` 的元数据表标识，部分使用点号形式。以当前 Iceberg 版本的 Spark Queries 文档和 `SHOW TABLES` 结果为准。

### 3.1 快照字段如何读

- `snapshot_id`：时间旅行、回滚和维护操作的主键。
- `parent_id`：快照父节点，可还原提交链。
- `operation`：append、overwrite、replace、delete 等。
- `summary`：新增/删除记录与文件数量等提交摘要。
- `committed_at`：提交完成时间，不等于业务事件时间。

### 3.2 小文件如何量化

```sql
-- [R] 统计文件数量、平均大小和总大小
SELECT
  count(*) AS file_count,
  avg(file_size_in_bytes) AS avg_file_bytes,
  sum(file_size_in_bytes) AS total_file_bytes
FROM lake.analytics.orders.files;
```

“文件多”不是充分结论。还要结合文件平均大小、查询扫描范围、分区数量、对象存储请求延迟和执行计划判断。

## 4. 时间旅行与版本对比

```sql
-- [R] 按 Snapshot ID 查询
SELECT count(*)
FROM lake.analytics.orders VERSION AS OF <snapshot-id>;

-- [R] 按时间查询
SELECT count(*)
FROM lake.analytics.orders
TIMESTAMP AS OF TIMESTAMP '2026-08-10 10:00:00';
```

生产事故中先做只读对比：

```sql
-- 当前版本
SELECT business_date, count(*), sum(amount)
FROM lake.analytics.orders
GROUP BY business_date;

-- 事故前快照：替换 snapshot-id 后执行同一查询
SELECT business_date, count(*), sum(amount)
FROM lake.analytics.orders VERSION AS OF <snapshot-id>
GROUP BY business_date;
```

时间旅行依赖历史快照及其文件仍未过期/删除。它不是永久备份。

## 5. Schema 演进

```sql
-- [W] 添加列
ALTER TABLE lake.analytics.orders
ADD COLUMN source STRING COMMENT 'order source';

-- [W] 重命名列
ALTER TABLE lake.analytics.orders
RENAME COLUMN source TO order_source;

-- [W] 扩大兼容的数据类型
ALTER TABLE lake.analytics.orders
ALTER COLUMN amount TYPE DECIMAL(20, 2);

-- [D] 删除列；先确认所有消费者和历史读取行为
ALTER TABLE lake.analytics.orders
DROP COLUMN order_source;
```

Iceberg 以 field ID 跟踪列，重命名不等于删除再添加。但下游引擎、序列化层、视图和 BI 仍可能按列名工作，变更前必须做依赖分析。

## 6. 分区演进

```sql
-- [W] 对时间列增加按天分区变换
ALTER TABLE lake.analytics.orders
ADD PARTITION FIELD days(created_at);

-- [W/D] 删除旧分区字段只影响后续写入布局，旧文件不会自动重写
ALTER TABLE lake.analytics.orders
DROP PARTITION FIELD old_partition_field;
```

分区演进后，一张表可能同时存在不同布局的文件，Iceberg 会统一规划。若希望旧数据采用新布局，需要另外执行数据文件重写，并评估 IO 成本。

## 7. 执行计划与扫描验证

```sql
-- [R]
EXPLAIN FORMATTED
SELECT customer_id, sum(amount)
FROM lake.analytics.orders
WHERE created_at >= TIMESTAMP '2026-08-10 00:00:00'
  AND created_at <  TIMESTAMP '2026-08-11 00:00:00'
GROUP BY customer_id;
```

确认分区裁剪、列裁剪和谓词下推是否发生。如果 SQL 对分区列做复杂函数包装，可能妨碍引擎生成有效过滤条件。

## 8. 重写小文件

```sql
-- [W/D] 重写数据文件，产生新快照并占用大量 IO
CALL lake.system.rewrite_data_files(
  table => 'analytics.orders'
);

-- [W/D] 仅处理目标分区；过滤表达式按当前版本语法验证
CALL lake.system.rewrite_data_files(
  table => 'analytics.orders',
  where => 'business_date = DATE ''2026-08-10'''
);

-- [W] 重写 Manifest，改善元数据规划
CALL lake.system.rewrite_manifests(
  table => 'analytics.orders'
);
```

维护前后都查询 `files`、`snapshots`，并对比真实查询的规划时间、扫描文件数和运行时间。重写期间会有并发提交；需要理解目标版本的冲突检测与隔离语义。

## 9. 快照过期

```sql
-- [D] 过期指定时间之前的历史快照，同时至少保留一定数量
CALL lake.system.expire_snapshots(
  table => 'analytics.orders',
  older_than => TIMESTAMP '2026-07-01 00:00:00',
  retain_last => 10
);
```

执行前必须确认：

1. 流式任务、审计和回滚窗口不再引用这些快照。
2. 分支/标签是否仍引用目标快照。
3. 保留策略满足合规和恢复要求。
4. 调用者拥有预期权限，且删除范围经过评审。

过期后，旧快照的时间旅行可能永久失效。

## 10. 孤儿文件清理

```sql
-- [D] 删除未被表元数据引用、且早于给定时间的文件
CALL lake.system.remove_orphan_files(
  table => 'analytics.orders',
  older_than => TIMESTAMP '2026-07-01 00:00:00'
);
```

这是最需要谨慎的维护命令之一。对象存储最终一致性、并发写入、时间偏差、错误表路径或多表共享目录，都可能导致误删。先阅读当前版本参数，尽可能使用支持的预览/结果输出能力，并把 `older_than` 留出足够安全窗口。

## 11. 回滚当前快照

```sql
-- [D] 将表当前指针回滚到指定历史快照
CALL lake.system.rollback_to_snapshot(
  table => 'analytics.orders',
  snapshot_id => <snapshot-id>
);
```

回滚不是“删除错误提交”这么简单：回滚后继续写入会形成新的历史。先停止相关写入，记录当前 snapshot ID，做只读对账，再执行回滚并验证所有下游缓存和查询引擎。

## 12. 标准事故处理顺序

```text
冻结或隔离写入
  → 保存当前 snapshot_id 与提交摘要
  → 用 history/snapshots 找到事故提交
  → 时间旅行对账旧版本
  → 决定修复数据、回滚还是建立分支
  → 验证业务指标和下游任务
  → 最后再考虑快照/孤儿文件清理
```

## 13. 30 分钟实验

1. 创建 Iceberg 实验表并写入三批数据。
2. 查询 `history`、`snapshots`、`files`，画出提交链。
3. 删除或覆盖一批数据，然后用时间旅行读取旧快照。
4. 添加列和分区字段，观察新旧文件共存。
5. 制造小文件，运行 `rewrite_data_files` 并比较前后文件数。
6. 在实验环境过期一个不再需要的快照，验证时间旅行边界。

## 14. 掌握标准

- 能解释 Snapshot、Manifest、Data File 的引用关系。
- 能使用元数据表定位提交、文件和分区问题。
- 能用时间旅行对账，但不会把它误当备份。
- 能安全执行文件重写、快照过期和孤儿文件清理。
- 能设计带停止写入、留证、验证与回滚的表事故流程。

## 官方参考

- [Iceberg Spark Queries](https://iceberg.apache.org/docs/latest/spark-queries/)
- [Iceberg Spark Procedures](https://iceberg.apache.org/docs/latest/spark-procedures/)
- [Iceberg Spark DDL](https://iceberg.apache.org/docs/latest/spark-ddl/)

