---
title: "Hive、Beeline 与 Metastore 命令手册"
sidebar_label: "91. Hive、Beeline 与 Metastore 命令手册"
sidebar_position: 91
description: "掌握 Beeline 安全连接、表与分区检查、EXPLAIN、统计信息、批量脚本和 Metastore schema 运维命令。"
tags: [Hive, Beeline, Metastore, SQL, 命令手册]
---

# Hive、Beeline 与 Metastore 命令手册

Hive CLI 已长期由 Beeline/HiveServer2 路径取代。本文以 Beeline 为主要入口，重点覆盖安全连接、元数据检查、SQL 计划、统计和 Metastore 运维。不同发行版的认证、执行引擎和事务能力不同，先用 `--help` 与 `SELECT version()` 核对。

## 1. 安全分级

- `[R]`：查询元数据、计划和状态。
- `[W]`：建实验表、插入、统计信息。
- `[D]`：DROP、分区删除、Metastore schema 升级或位置批量修改。

不要把密码直接写在命令行或 JDBC URL，因为 shell history、进程列表和日志可能泄露。优先使用 Kerberos、凭据文件、环境注入或平台身份。

## 2. 连接与会话

```bash
# [R] 帮助和版本
beeline --help
beeline --version

# [R] 连接 HiveServer2；-w 指向只含密码的受限文件
beeline -u 'jdbc:hive2://<hs2-host>:10000/default' -n '<user>' -w '<password-file>'

# [R] Kerberos 示例，principal 与 TLS 参数以平台配置为准
beeline -u 'jdbc:hive2://<hs2-host>:10000/default;principal=hive/_HOST@<REALM>'
```

交互命令：

```text
!help
!info
!list
!tables
!describe <table>
!set
!set outputformat table
!set verbose true
!reconnect
!quit
```

连接失败按 DNS/TCP → TLS → Kerberos/认证 → HiveServer2 → Metastore 顺序排查，不要用 `auth=noSasl` 绕过生产安全策略。

## 3. 批处理与变量

```bash
# [R] 执行单条 SQL
beeline -u '<jdbc-url>' -n '<user>' -w '<password-file>' -e 'SHOW DATABASES'

# [R/W] 执行 SQL 文件，文件内操作决定安全级别
beeline -u '<jdbc-url>' -n '<user>' -w '<password-file>' -f ./daily_etl.sql

# [R/W] 传入业务日期，不在 SQL 中使用当前时间替代 data interval
beeline -u '<jdbc-url>' -n '<user>' -w '<password-file>' \
  --hivevar biz_date=2026-08-10 \
  -f ./daily_etl.sql

# SQL 文件中引用
# SELECT * FROM fact_orders WHERE dt='${hivevar:biz_date}';
```

脚本应开启失败即非零退出的 Beeline 选项（具体名称以当前 `--help` 为准），工作流必须检查退出码，不能只解析“输出中有 OK”。

## 4. Catalog、表和分区

```sql
-- [R] Catalog 浏览
SHOW DATABASES;
USE analytics;
SHOW TABLES;
SHOW TABLES LIKE 'fact_*';

-- [R] Schema、位置、格式和表属性
DESCRIBE fact_orders;
DESCRIBE FORMATTED fact_orders;
SHOW CREATE TABLE fact_orders;
SHOW TBLPROPERTIES fact_orders;

-- [R] 分区
SHOW PARTITIONS fact_orders;
SHOW PARTITIONS fact_orders PARTITION (dt='2026-08-10');

-- [R] 函数和配置
SHOW FUNCTIONS LIKE '*date*';
DESCRIBE FUNCTION EXTENDED date_add;
SET;
SET hive.execution.engine;
```

`DESCRIBE FORMATTED` 中重点看 Location、Table Type、Input/OutputFormat、SerDe、partition columns、statistics。发现 Location 指向错误集群时先冻结写入。

## 5. EXPLAIN 与扫描范围

```sql
-- [R] 查看逻辑/物理计划
EXPLAIN
SELECT province, SUM(amount_cents)
FROM fact_orders
WHERE dt='2026-08-10'
GROUP BY province;

-- [R] 格式与支持项随版本确认
EXPLAIN FORMATTED
SELECT * FROM fact_orders WHERE dt='2026-08-10';

-- [R/W] ANALYZE 可能实际执行查询并消耗资源，只在受控数据上使用
EXPLAIN ANALYZE
SELECT COUNT(*) FROM fact_orders WHERE dt='2026-08-10';
```

检查是否只扫描目标分区、Join 是否广播/Shuffle、Stage 数和过滤下推。`EXPLAIN ANALYZE` 不是纯只读成本：它会执行查询。

## 6. 统计信息

```sql
-- [R] 查看表/列统计（输出形式随版本）
DESCRIBE FORMATTED fact_orders;

-- [W] 收集表级统计
ANALYZE TABLE fact_orders PARTITION (dt='2026-08-10') COMPUTE STATISTICS;

-- [W] 收集列统计，列越多扫描和 Metastore 压力越大
ANALYZE TABLE fact_orders PARTITION (dt='2026-08-10')
COMPUTE STATISTICS FOR COLUMNS order_id, user_id, amount_cents;
```

收集前记录分区大小、并发和执行窗口。统计新鲜不等于数据正确，仍需 count、主键和金额质量规则。

## 7. 实验表与原子发布思路

```sql
-- [W] 使用专用实验库和外部位置
CREATE DATABASE IF NOT EXISTS command_lab;

CREATE TABLE command_lab.orders_stage (
  order_id STRING,
  amount_cents BIGINT
)
PARTITIONED BY (dt STRING)
STORED AS PARQUET;

INSERT OVERWRITE TABLE command_lab.orders_stage PARTITION (dt='2026-08-10')
SELECT 'o-1', 100;

SELECT dt, COUNT(*), SUM(amount_cents)
FROM command_lab.orders_stage
GROUP BY dt;

-- [D] 确认 SHOW CREATE、Location 和无下游依赖后再删除
DROP TABLE command_lab.orders_stage;
DROP DATABASE command_lab;
```

Managed/External 表 DROP 是否删除数据依赖版本与配置，必须在实验表验证，不能只按表类型名称推断。

## 8. 分区修复与危险操作

```sql
-- [W] 手工注册已验证存在的单个分区
ALTER TABLE fact_orders ADD IF NOT EXISTS
PARTITION (dt='2026-08-10')
LOCATION '<verified-uri>';

-- [D] 只删除 Metastore 分区还是连数据一起处理，取决于表语义和配置
ALTER TABLE fact_orders DROP IF EXISTS PARTITION (dt='2026-08-10');

-- [D] 批量扫描目录并修复分区可能给 NameNode/对象存储和 Metastore 带来压力
MSCK REPAIR TABLE fact_orders;
```

执行 `MSCK REPAIR` 前先统计目录/分区规模，在副本表或小范围验证；Iceberg 等表格式不应靠目录修复来管理 snapshot。

## 9. Metastore Schema Tool

```bash
# [R] 查看帮助、当前 schema 信息和一致性
schematool -help
schematool -dbType <mysql-or-postgres> -info
schematool -dbType <mysql-or-postgres> -validate

# [D] 初始化/升级会修改 Metastore 数据库
schematool -dbType <db-type> -initSchema
schematool -dbType <db-type> -upgradeSchema
```

升级前必须备份 Metastore RDBMS、停止不兼容 writer、核对 from/to 版本、演练恢复。不要通过关闭 schema verification 强行让不兼容二进制访问生产库。

## 10. 服务和日志

```bash
# [R] 打印配置值（不同发行版脚本路径可能不同）
hive --service help

# [W] 服务启动通常由 systemd/Kubernetes 管理；手工启动仅用于实验
hive --service metastore
hiveserver2
```

生产优先查看服务管理器状态、进程日志、JMX/指标、Metastore DB 连接池和 HiveServer2 operation 状态，不在现有进程旁边手工再起一个实例占端口。

## 11. 故障判断速查

| 现象 | 第一批命令 | 重点判断 |
|---|---|---|
| 连接失败 | `beeline --verbose=true`、网络/TLS工具 | DNS、证书、Kerberos、HS2 |
| SQL 卡在编译 | `DESCRIBE FORMATTED`、Metastore 指标 | 分区过多、DB 慢、锁 |
| 扫描过大 | `EXPLAIN FORMATTED` | 分区裁剪、谓词下推 |
| 找不到分区 | `SHOW PARTITIONS`、HDFS/对象只读列表 | 文件与 Metastore 是否一致 |
| 计划异常 | 统计、`EXPLAIN` | 统计过期、Join 选择 |
| 升级后无法启动 | `schematool -info/-validate` | schema/binary 不兼容 |

## 12. 掌握验收

- 使用凭据文件安全连接并执行 SQL 文件；
- 从 `SHOW CREATE`/`DESCRIBE FORMATTED` 找到真实存储路径和格式；
- 用 `EXPLAIN` 证明分区裁剪与 Join 路径；
- 安全收集统计并观察计划变化；
- 在任何 DROP、REPAIR、schema upgrade 前完成备份和影响确认。

上一篇：[Hadoop 命令手册](./90-Hadoop-HDFS-YARN-MapReduce命令手册.md)

下一篇：[Kafka 命令手册](../../messaging/kafka/13-Kafka-Topic-Producer-Consumer与Group命令手册.md)

## 13. 参考资料 {/* #参考资料 */}

- [HiveServer2 Clients and Beeline](https://hive.apache.org/docs/latest/user/hiveserver2-clients/)
- [Hive CLI Language Manual](https://hive.apache.org/docs/latest/language/languagemanual-cli/)
- [Hive Metastore Administration](https://hive.apache.org/docs/latest/admin/adminmanual-metastore-3-0-administration/)
