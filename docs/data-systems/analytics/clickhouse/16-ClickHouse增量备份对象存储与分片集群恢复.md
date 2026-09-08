---
title: "ClickHouse 增量备份、对象存储与分片集群恢复"
sidebar_label: "16. 增量备份、对象存储与分片集群恢复"
sidebar_position: 16
description: "深入 ClickHouse 原生 BACKUP/RESTORE、增量链、S3、ReplicatedMergeTree、分片集群、Keeper 边界和生产恢复演练。"
tags: [ClickHouse, BACKUP, RESTORE, S3, ReplicatedMergeTree, 灾难恢复]
---

# ClickHouse 增量备份、对象存储与分片集群恢复

ClickHouse 的 Replica 能承受一台节点或一块磁盘故障，但 DROP、错误 Mutation、TTL 配错和应用写坏数据会传播到所有 Replica。原生 BACKUP/RESTORE 负责保存独立历史恢复点，本章把它扩展到对象存储、增量链和多 Shard 集群。

## 1. 先画出需要保护的状态

~~~text
业务数据
  → 每个 Shard 的 MergeTree Part
  → Replica 保存同一 Shard 的副本

集群元数据
  → Database/Table/View/Dictionary DDL
  → ReplicatedMergeTree 的 Keeper 路径
  → Distributed Table 的集群名和分片键

运行依赖
  → clusters.xml / macros / storage policy
  → users.xml 或 SQL RBAC
  → Named Collection / Secret / KMS
  → Kafka、S3、MySQL 等外部数据源
~~~

Part 是核心数据，Keeper 主要保存复制协调信息而不是 Part 内容，Distributed Table 主要保存路由定义而不是另一份数据。三者不能混为一谈。

## 2. 原生 BACKUP 能保护什么

ClickHouse 可以备份：

- Table、Partition、Database、View、Dictionary；
- 多个对象或 ALL DATABASES；
- DDL 与数据，或只备份结构；
- SQL 管理的用户、角色、配额、Row Policy、Settings Profile；
- Full 或基于 base_backup 的 Incremental；
- 本地 Disk、S3 Disk、S3 Endpoint 和 Azure Blob；
- 同步或 ASYNC 任务；
- ON CLUSTER 的分布式操作。

节点配置文件中的 users.xml、clusters.xml、macros、磁盘策略和外部凭据不在普通数据备份中，必须由 GitOps/配置管理和 Secret 系统单独恢复。

## 3. 配置独立对象存储

推荐把备份写到与生产数据不同的 Bucket、账号和地域。可把 S3 作为只用于备份的 Disk：

~~~xml
<clickhouse>
  <storage_configuration>
    <disks>
      <s3_backup>
        <type>s3_plain</type>
        <endpoint>https://s3.example.com/ch-backup/prod/</endpoint>
        <access_key_id from_env="CH_BACKUP_ACCESS_KEY"/>
        <secret_access_key from_env="CH_BACKUP_SECRET_KEY"/>
      </s3_backup>
    </disks>
  </storage_configuration>
  <backups>
    <allowed_disk>s3_backup</allowed_disk>
  </backups>
</clickhouse>
~~~

字段和 Secret 注入能力以目标稳定版本为准。不要把长期密钥硬编码在 SQL、XML、镜像或 Query Log 中；Named Collection、云工作负载身份或环境 Secret 更便于轮换。

验证配置：

~~~sql
SELECT name, type, path
FROM system.disks
WHERE name = 's3_backup';
~~~

生产数据本身也位于 S3 时，应压测 Disk 与 S3 Endpoint 两种备份路径。官方说明不同 Disk 类型可能触发下载再上传，而直接 S3 路径在兼容场景可利用服务端复制，实际吞吐和费用差异很大。

## 4. Full Backup

备份单表：

~~~sql
BACKUP TABLE analytics.events
TO Disk('s3_backup', 'full/2026-09-08/events');
~~~

备份数据库：

~~~sql
BACKUP DATABASE analytics
TO Disk('s3_backup', 'full/2026-09-08/analytics')
ASYNC;
~~~

ASYNC 会立即返回 ID，不代表已经完成。查询：

~~~sql
SELECT
    id,
    name,
    status,
    start_time,
    end_time,
    num_files,
    uncompressed_size,
    compressed_size,
    error
FROM system.backups
ORDER BY start_time DESC;
~~~

长期审计使用 system.backup_log。调度器必须等待 BACKUP_CREATED；只判断 SQL 返回 0 会把仍在运行或最终失败的任务误判为成功。

### 4.1 备份路径不可覆盖

原生备份不会覆盖已有目标。同名路径报 BACKUP_ALREADY_EXISTS 是保护机制。每次使用包含集群、时间和唯一 ID 的新前缀：

~~~text
prod/analytics/full/2026/09/08/backup-id/
~~~

不能在任务开始前无条件删除旧前缀；这会把脚本重试变成数据删除器。

## 5. Incremental Backup 怎样工作

先创建 Base：

~~~sql
BACKUP DATABASE analytics
TO Disk('s3_backup', 'base/2026-09-07');
~~~

再显式引用 Base：

~~~sql
BACKUP DATABASE analytics
TO Disk('s3_backup', 'incremental/2026-09-08')
SETTINGS
    base_backup = Disk('s3_backup', 'base/2026-09-07');
~~~

Incremental 只保存相对 Base 的变化，恢复时只指定 Incremental，ClickHouse 会读取其 Base 依赖：

~~~sql
RESTORE DATABASE analytics AS analytics_recovery
FROM Disk('s3_backup', 'incremental/2026-09-08');
~~~

### 5.1 Incremental 的依赖风险

~~~text
Incremental 可恢复
  ⇔ 自身元数据和对象完整
  ∧ base_backup 可访问
  ∧ 两者凭据/KMS 仍有效
  ∧ 目标版本兼容
~~~

删除 Base 会让所有引用它的 Incremental 失效。对象存储 Lifecycle 不理解 ClickHouse 的 base_backup 依赖，因此必须由备份目录/清单统一决定删除顺序。

### 5.2 一个实用周期

~~~text
每周 Full
  ├── 周一 Incremental → 本周 Full
  ├── 周二 Incremental → 本周 Full
  └── ...
~~~

都引用本周 Full 的链较浅、恢复依赖清楚；具体策略仍应通过数据变化率、对象数量、恢复吞吐和目标 RTO 选择。

## 6. 备份进行时能否继续写

MergeTree Part 不可变，使在线备份具有良好基础。对单表，备份可以得到一致的 Part 集合；但跨多个 Table、Shard 和外部摄取系统时，不应宣称获得了同一业务事务时刻。

例如：

~~~text
Kafka Offset 已提交
  → Materialized View 正在写本地表
  → 多个 Shard 备份窗口不同
~~~

恢复后可能需要从某个 Offset 重放，且必须有去重键。若业务要求批次级一致，可在上游建立 Batch ID/Watermark，短暂停止摄取，等待分布式队列和 Mutation 收敛后再备份。

## 7. 分片、副本和备份对象

假设 2 Shard × 2 Replica：

~~~text
Shard 01: ch01a ↔ ch01b  保存数据 A
Shard 02: ch02a ↔ ch02b  保存数据 B
Distributed Table        只负责 A/B 路由和汇总
~~~

完整数据集是 A+B，不是四台节点数据简单相加。Replica 是同一 Shard 的冗余副本。

原生 ON CLUSTER 让 ClickHouse 协调各 Host 的备份：

~~~sql
BACKUP DATABASE analytics
ON CLUSTER 'prod_cluster'
TO Disk('s3_backup', 'cluster/full/2026-09-08')
ASYNC;
~~~

所有相关节点都必须：

- 识别相同 Cluster 名称；
- 能访问备份目标；
- 有一致的 Named Collection/Disk 配置；
- 能访问 Keeper；
- 拥有备份权限；
- 使用不会相互覆盖的协调路径。

不要在每台节点上独立运行一遍相同 BACKUP SQL 来模拟 ON CLUSTER。那会绕开协调，产生冲突或含义不清的重复备份。

## 8. ON CLUSTER 不代表全局事务快照

ON CLUSTER 解决“在多 Host 执行和协调任务”，并不让业务写入在所有 Shard 同一纳秒冻结。要判断恢复点是否满足需求，必须记录：

- 每个 Host 的开始、结束和状态；
- 各 Shard 的 Part、Row、Byte 水位；
- 上游 Kafka/CDC Offset 或业务 Batch ID；
- 备份期间的 Mutation、Merge 和 TTL；
- Distributed Insert 是否仍有未发送数据。

只有所有 Host 成功且业务水位一致，才能把这次集群备份标记为可发布恢复点。

## 9. 哪些表需要备份

### 9.1 Local MergeTree

数据实际位于 Local Table，是核心备份对象。

### 9.2 Distributed Table

主要备份 DDL。恢复后必须让 clusters.xml 中的 Cluster 名称、Shard/Replica 拓扑和远端数据库表名匹配。

### 9.3 Materialized View

要同时保存 View 定义与目标表数据。若恢复后重新消费源数据，必须防止与已恢复目标表重复。

### 9.4 Dictionary 与外部表

Dictionary DDL 可能只包含外部 MySQL/HTTP/S3 的连接定义，外部数据不因此进入 ClickHouse Backup。恢复时要单独验证数据源、凭据和刷新。

### 9.5 SQL RBAC

SQL 创建的用户、角色、配额和 Row Policy 可作为 Access Management 对象备份；users.xml 中定义的账号不会自动包含。

## 10. 恢复到新集群

### 10.1 先恢复基础设施

按顺序准备：

1. 兼容的 ClickHouse Server/Client 版本；
2. 独立 Keeper 集群或 Namespace；
3. 正确的 macros、remote_servers 和 storage policy；
4. 只读备份 Bucket 权限；
5. 目标数据盘/对象存储容量；
6. 插件、UDF、Dictionary 外部依赖；
7. 隔离的 DNS 和业务账号。

目标集群绝不能错误连接生产 Keeper 路径。否则恢复的 ReplicatedMergeTree 可能把自己当成现有 Replica，触发错误同步或路径冲突。

### 10.2 先结构，后数据

可以先验证 DDL：

~~~sql
RESTORE DATABASE analytics AS analytics_recovery
FROM Disk('s3_backup', 'full/2026-09-08')
SETTINGS structure_only = true;
~~~

检查 Engine、ORDER BY、PARTITION BY、TTL、Storage Policy、Keeper Path 和宏展开。通过后在干净数据库恢复数据。

### 10.3 默认恢复到空表或新名字

~~~sql
RESTORE TABLE analytics.events AS analytics_recovery.events
FROM Disk('s3_backup', 'full/2026-09-08');
~~~

allow_non_empty_tables=true 会把备份数据混入已有表，可能造成重复。除非已经用主键/分区设计证明幂等，否则不要把它作为故障恢复默认值。

## 11. 分片集群恢复顺序

~~~text
新 Keeper 与集群配置
  → 各 Shard 建立一个目标 Replica
  → 恢复 Local ReplicatedMergeTree 数据
  → 验证每个 Shard
  → 添加/同步其他 Replica
  → 恢复 Distributed Table、View、Dictionary
  → 恢复 SQL RBAC
  → 全局查询验收
  → 切换入口
~~~

先每 Shard 恢复一个 Replica，可以减少初始数据重复写入；之后通过复制扩展冗余。是否由 Restore 自动创建复制路径、是否需要先建表，取决于目标版本和 DDL，应在演练环境固定流程。

### 11.1 Keeper Snapshot 不能替代数据 Backup

Keeper 保存复制日志、队列和协调元数据，不保存全部 Part。只恢复 Keeper 会得到表路径和复制状态，却没有数据文件。

Keeper 自身仍需独立备份，用于恢复协调服务；但把业务迁移到新集群时，通常更安全的是新建干净 Keeper，再由 ClickHouse DDL 与数据 Backup 重建，而不是带入旧节点会话和陈旧复制队列。

## 12. 对象存储恢复边界

备份 Bucket 需要：

- 独立账号与最小权限；
- 版本控制、Object Lock 和跨地域复制；
- KMS Key、Key Policy 与恢复账号；
- 生命周期规则晚于备份 Retention；
- 足够的 List/Get 请求和下载吞吐配额；
- 清单、对象数量和总字节监控。

演练必须从灾备地域、灾备账号和灾备 KMS 权限读取，不能只在生产 VPC 内验证。

## 13. 备份对生产性能的影响

BACKUP 会读 Part、计算元数据、压缩并写对象存储，可能与查询、Merge、Mutation 和 TTL 争用磁盘、CPU、网络与 S3 请求。

可观察：

~~~sql
SELECT *
FROM system.backups
ORDER BY start_time DESC;

SELECT *
FROM system.backup_log
ORDER BY event_time_microseconds DESC
LIMIT 20;

SELECT
    metric,
    value
FROM system.metrics
WHERE metric ILIKE '%Backup%';
~~~

结合 system.query_log、system.part_log、Disk I/O、S3 请求延迟和 Merge 队列判断影响。使用 max_backup_bandwidth、backup_threads 或错峰前，先通过压测找到瓶颈，不能只调大并发。

## 14. 恢复验收

### 14.1 DDL

~~~sql
SHOW CREATE TABLE analytics_recovery.events;
SELECT database, name, engine
FROM system.tables
WHERE database = 'analytics_recovery';
~~~

### 14.2 Part 与数据水位

~~~sql
SELECT
    table,
    partition,
    count() AS active_parts,
    sum(rows) AS rows,
    sum(bytes_on_disk) AS bytes
FROM system.parts
WHERE database = 'analytics_recovery' AND active
GROUP BY table, partition
ORDER BY table, partition;
~~~

### 14.3 业务结果

准备固定日期/租户的：

- count、sum、uniq 等业务汇总；
- min/max 事件时间；
- 固定 ID 抽样与哈希；
- 物化视图源表/目标表对账；
- Distributed 与各 Local Table 汇总对账；
- 权限和 Row Policy 测试；
- 典型查询结果、P95/P99 和峰值内存。

ClickHouse 的异步 Merge 会改变 Part 数，不能要求恢复前后 Part 数完全相同；应校验数据语义和有效 Row/Byte 水位。

## 15. 一次完整演练

### 15.1 场景

模拟错误 ALTER DELETE 已复制到所有 Replica，要求恢复删除前的最近备份。

### 15.2 流程

~~~text
冻结危险写入和 Mutation
  → 选择事故前 Full/Incremental
  → 在灾备账号创建 Keeper 和 ClickHouse 集群
  → 恢复每个 Shard 的 Local 数据
  → 建立 Replica
  → 恢复 Distributed/View/RBAC
  → 按 Partition 和业务指标对账
  → 压测关键查询
  → 切流并保留原集群只读
~~~

### 15.3 必须记录

| 阶段 | 指标 |
| --- | --- |
| 发现/决策 | 事故时间、选中恢复点 |
| 下载/恢复 | Byte/s、对象请求、失败重试 |
| Shard 重建 | 各 Shard 完成时间和数据水位 |
| Replica 重建 | 同步字节、队列和时长 |
| 验收 | 数据差异、查询差异、权限差异 |
| 切换 | DNS/网关/客户端恢复时间 |

## 16. 常见失败与排查

### 16.1 BACKUP_ALREADY_EXISTS

目标路径已经存在。生成新路径并调查为什么任务重复，不要直接删除现有恢复点。

### 16.2 增量恢复找不到 Base

检查 base_backup 路径、Bucket Lifecycle、KMS、跨地域复制和权限。Incremental 自身成功不能证明 Base 一直可用。

### 16.3 ON CLUSTER 某些 Host 失败

从 system.backups/system.backup_log 按 Host 汇总，核对 Cluster 配置、Keeper、Disk/Named Collection、IAM、DNS 和版本。不能只看发起节点状态。

### 16.4 恢复后 Table 只读

检查 Keeper 路径、Replica 名称和 macros 是否冲突，目标是否连到了旧 Keeper，Replica Queue 是否异常，以及磁盘/对象存储是否可写。

### 16.5 Distributed 查询少一部分数据

逐 Shard 查询 Local Table，确认是否漏恢复一个 Shard；再检查 remote_servers、Shard Weight、Distributed 表定义和权限。

## 17. 复盘题与答案

### 17.1 两个 Replica 都完整，为什么仍要备份

Replica 会同步 DROP、Mutation 和错误数据。备份保存独立时间点，能从逻辑故障中恢复。

### 17.2 为什么只备份 Distributed Table 不够

Distributed Table 主要保存路由定义，真实 Part 位于各 Shard 的 Local Table。

### 17.3 为什么 Incremental 文件存在仍可能无法恢复

它依赖 base_backup、凭据、KMS 和对象。任一依赖丢失都会破坏恢复闭包。

### 17.4 为什么恢复旧 Keeper Snapshot 可能比新建 Keeper 更危险

旧 Snapshot 包含原节点、Replica 路径和队列状态，可能把恢复集群重新连到旧拓扑；新 Keeper 可由受控 DDL 和数据备份重建干净状态。

## 18. 延伸阅读

- [数据库可靠性与备份恢复学习路线](../../database-reliability/00-数据库可靠性与备份恢复学习路线.md)
- [ClickHouse Backup and Restore Overview](https://clickhouse.com/docs/concepts/features/backup-restore/overview)
- [BACKUP/RESTORE to Disk or S3 Disk](https://clickhouse.com/docs/concepts/features/backup-restore/local-disk)
- [BACKUP/RESTORE with an S3 Endpoint](https://clickhouse.com/docs/concepts/features/backup-restore/s3-endpoint)
- [ClickHouse Restore Settings](https://clickhouse.com/docs/concepts/features/backup-restore/restore-settings)

ClickHouse 集群恢复的核心不是把四台节点目录都复制一遍，而是识别每个 Shard 的唯一数据、每个 Replica 的冗余关系、Keeper 的协调边界和外部摄取水位，再在隔离集群证明完整数据集可以重建。
