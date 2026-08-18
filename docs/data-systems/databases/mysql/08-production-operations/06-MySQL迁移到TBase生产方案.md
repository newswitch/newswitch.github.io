---
title: "MySQL 迁移到 TBase 生产方案：评估、改造、同步、割接与回滚"
sidebar_label: "06. MySQL 迁移到 TBase 生产方案"
sidebar_position: 6
description: "从产品辨识、兼容性评估和分布键设计开始，完整设计 MySQL 到 TBase 的全量与增量迁移、数据校验、停写割接、回滚和生产验收。"
tags: [MySQL, TBase, TDSQL PostgreSQL, 数据迁移, CDC, 分布式数据库]
---

# MySQL 迁移到 TBase 生产方案：评估、改造、同步、割接与回滚

MySQL 迁移到 TBase 不是把 `mysqldump` 文件换一个客户端导入。源端和目标端分属不同数据库体系，迁移同时改变了 SQL 方言、类型语义、事务实现、执行计划和数据分布方式。真正需要迁移的是下面五层：

```text
数据库对象：库、表、索引、约束、视图、Sequence、权限
数据本身：存量行、增量 INSERT/UPDATE/DELETE、字符与时间语义
应用协议：驱动、连接串、占位符、事务、SQL、错误码
分布模型：分布键、复制表、数据倾斜、跨节点 Join、热点
生产体系：监控、备份、容灾、发布、割接、回滚和故障 Runbook
```

本文给出一套可以落地到生产项目的模板。示例以“订单系统从 MySQL 迁移到 TBase”为主，但所有版本号、DDL、工具能力和参数都必须在自己的目标版本上重新验证。

:::warning 先确认目标产品

“TBase”在不同环境里可能指腾讯开源的 TBase、商业化或私有化的 TDSQL PostgreSQL 系产品，也可能被误写成 MySQL 兼容的 TDSQL MySQL。它们的协议、语法、版本和迁移工具不是一回事。

开源 TBase 基于 PostgreSQL/Postgres-XL 路线，应用连接 Coordinator，由 Coordinator 拆分 SQL 并在 DataNode 执行，GTM 参与全局事务管理。本文讨论的是这一类 PostgreSQL 协议的分布式目标库，不适用于 TDSQL MySQL。

:::

## 1. 先定义迁移目标，而不是先选择工具

项目立项时先把以下内容写入迁移任务书：

| 项目 | 必须确认的答案 | 示例 |
|---|---|---|
| 源端 | MySQL 版本、拓扑、数据量、峰值写入 | MySQL 8.0，主从，3 TB，峰值 8 万行/秒 |
| 目标端 | 产品全名、内核版本、节点拓扑、驱动协议 | TBase V2，2 CN、6 DN、GTM 主备 |
| 范围 | 哪些 Schema、表、历史数据和数据库对象 | `trade` 库 126 张表，保留 3 年 |
| 停机预算 | 最长停写和不可用时间 | 停写不超过 10 分钟 |
| RPO | 允许丢失多少已提交数据 | RPO = 0 |
| RTO | 失败后多久恢复到可服务状态 | 30 分钟内回到 MySQL |
| 性能目标 | 延迟、吞吐、并发和批处理窗口 | 核心接口 P99 不劣化 20% |
| 回滚边界 | TBase 开始写入后如何回到 MySQL | 反向同步，或明确不可自动回滚点 |

“迁移完成”至少应满足：

1. 对象、数据和业务语义校验通过；
2. 增量延迟归零且不存在无法重放的 Binlog 缺口；
3. 核心 SQL 的正确性和执行计划经过真实数据验证；
4. 峰值压测、故障演练、备份恢复和节点切换达标；
5. 割接和回滚都完成过预生产演练；
6. 应用不再依赖 MySQL 专有行为。

## 2. 理解目标架构发生了什么变化

MySQL 单主架构中，一条 SQL 通常在一个实例内完成。TBase 中，应用不应直接连接 DataNode，而是连接 Coordinator：

```text
Application / PostgreSQL Driver
             │
             ▼
     Coordinator（解析、规划、路由、汇总）
        │             │
        ▼             ▼
   DataNode 1 ... DataNode N（保存和计算用户数据）
             │
             ▼
      GTM / 全局事务相关组件
```

同一条业务 SQL 可能出现三种执行路径：

```text
带分布键等值条件       → 只访问一个 DataNode
不带分布键条件         → 广播到多个 DataNode
跨分布键 Join/聚合     → 节点间重分布，再由 Coordinator 汇总
```

因此，MySQL 中的“有索引就快”在 TBase 中还不够。还要回答：查询能否路由到单节点、Join 表是否共置、是否产生节点间数据搬运、Coordinator 是否成为瓶颈。

## 3. 迁移总体路线

生产迁移推荐使用蓝绿方式，MySQL 在整个迁移期仍是权威源：

```text
                 ┌──────── 全量快照 / 分片抽取 ────────┐
                 │                                      ▼
应用写入 → MySQL ┼→ Binlog → CDC / 迁移服务 → TBase 暂存或正式表
                 │                                      │
                 └──────── 校验基线与增量位点 ──────────┘

兼容性改造 → 目标建模 → 全量加载 → 增量追平 → 影子读
→ 停写 → 最终追平与校验 → 切换连接 → 观察 → 下线旧库
```

不要一开始就双写。没有全局原子提交时，应用同时写两个异构数据库会产生一边成功、一边失败的分叉状态。除非已经实现可审计的 Outbox、幂等消费、补偿和对账，否则迁移期应保持单一权威写入源。

## 4. 方案选型

### 4.1 离线迁移 {/* #离线迁移 */}

```text
停止 MySQL 写入 → 导出 → 转换 → 导入 TBase → 校验 → 切换
```

适用于数据量较小、允许较长停机或一次性归档系统。实现简单、状态边界清楚，但停机时间包含全量导出、网络传输、导入和校验，不适合 TB 级高写入业务。

### 4.2 全量加增量在线迁移 {/* #全量加增量在线迁移 */}

```text
建立一致性基线 → 并行全量导入 → 持续消费 Binlog
→ 增量追平 → 短暂停写 → 最终追平 → 校验与切换
```

这是大多数生产系统的首选。难点不是“能否读取 Binlog”，而是如何证明全量快照与增量起点之间没有缺口、事务顺序没有被破坏、重试不会造成错误覆盖。

### 4.3 云上 DTS 路线 {/* #云上-dts-路线 */}

如果目标是腾讯云文档中明确支持的 TDSQL PostgreSQL 版，可以优先评估 DTS。其官方链路支持全量初始化和 DML 增量同步，但目标 Schema 和表需要预先创建，DDL 不会随 DML 自动同步。

截至本文核对的官方说明，DTS 该链路列出的源端版本最高到 MySQL 8.0，且要求同步表具有主键、`binlog_format=ROW`、`binlog_row_image=FULL`。如果源端使用 MySQL 8.4，不能因为“也是 MySQL 8”就默认兼容，必须让厂商对具体补丁版本和目标内核出具支持结论并完成 PoC。

### 4.4 自建迁移链路 {/* #自建迁移链路 */}

开源或私有部署环境没有适配好的商业迁移服务时，可以组合：

```text
Schema 转换脚本 / 人工评审
+ JDBC/ETL/CSV-COPY 全量通道
+ MySQL Binlog CDC 增量通道
+ Checkpoint、死信、重放、校验和监控平台
```

DataX 一类工具适合并行抽取全量数据，但不能单独解决持续 Binlog 增量、DDL 演进、跨表事务顺序和无损割接。Debezium 可以读取 MySQL 快照与 Binlog，但把事件正确写入 TBase、维护目标事务和幂等仍是迁移系统的责任。不要把“组件能连通”误认为“链路已具备生产一致性”。

## 5. 源库盘点

迁移前冻结范围，并把每次盘点结果保存到版本库或制品库。

### 5.1 版本、容量和写入特征 {/* #版本容量和写入特征 */}

```sql
SELECT VERSION();

SELECT table_schema,
       ROUND(SUM(data_length + index_length) / 1024 / 1024 / 1024, 2) AS total_gib,
       SUM(table_rows) AS estimated_rows
FROM information_schema.tables
WHERE table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
GROUP BY table_schema
ORDER BY total_gib DESC;

SELECT table_schema, table_name, engine, table_rows,
       ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mib
FROM information_schema.tables
WHERE table_schema = 'trade'
ORDER BY data_length + index_length DESC;
```

`information_schema.tables.table_rows` 对 InnoDB 可能是估算值，只用于规模摸底，最终校验不能依赖它。还要从监控平台取得至少一个完整业务周期内的 QPS、TPS、每秒变更行数、Binlog 生成速率、长事务、峰谷和批处理窗口。

### 5.2 无主键表、非 InnoDB 表和对象清单 {/* #无主键表非-innodb-表和对象清单 */}

```sql
SELECT t.table_schema, t.table_name
FROM information_schema.tables AS t
LEFT JOIN information_schema.table_constraints AS c
  ON c.table_schema = t.table_schema
 AND c.table_name = t.table_name
 AND c.constraint_type = 'PRIMARY KEY'
WHERE t.table_type = 'BASE TABLE'
  AND t.table_schema = 'trade'
  AND c.constraint_name IS NULL;

SELECT table_schema, table_name, engine
FROM information_schema.tables
WHERE table_schema = 'trade'
  AND table_type = 'BASE TABLE'
  AND engine <> 'InnoDB';

SELECT routine_schema, routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trade';

SELECT trigger_schema, trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'trade';
```

无主键表不仅增量 UPDATE/DELETE 难以唯一定位，也常常不能使用厂商在线同步服务。处理方式按优先级排序：补稳定主键、只做停机全量、改为全表替换，或明确排除。不能临时把非唯一列当主键。

### 5.3 MySQL 专有类型与默认值 {/* #mysql-专有类型与默认值 */}

```sql
SELECT table_name, column_name, column_type, is_nullable,
       column_default, extra, character_set_name, collation_name
FROM information_schema.columns
WHERE table_schema = 'trade'
  AND (
    data_type IN ('tinyint', 'mediumint', 'enum', 'set', 'json',
                  'year', 'datetime', 'timestamp', 'bit',
                  'binary', 'varbinary', 'blob', 'longblob')
    OR extra <> ''
    OR column_type LIKE '%unsigned%'
  )
ORDER BY table_name, ordinal_position;
```

另行扫描：

- `0000-00-00` 和非法日期；
- `AUTO_INCREMENT`；
- `ON UPDATE CURRENT_TIMESTAMP`；
- `ENUM`、`SET`、无符号整数和 `ZEROFILL`；
- 列级字符集、排序规则和大小写唯一性；
- 生成列、空间类型、全文索引、函数索引和前缀索引；
- 分区表、外键、触发器、Event、Procedure、Function 和 View；
- 反引号、保留字、大小写混用的对象名。

### 5.4 Binlog 和快照条件 {/* #binlog-和快照条件 */}

```sql
SHOW VARIABLES WHERE Variable_name IN (
  'log_bin',
  'binlog_format',
  'binlog_row_image',
  'gtid_mode',
  'enforce_gtid_consistency',
  'binlog_expire_logs_seconds',
  'lower_case_table_names',
  'character_set_server',
  'collation_server',
  'time_zone'
);

SHOW BINARY LOG STATUS;
```

MySQL 旧版本可能使用 `SHOW MASTER STATUS`。命令名以实际源端版本为准。Binlog 保留时间必须覆盖“全量耗时 + 最大暂停时间 + 故障修复与重放时间 + 安全余量”，只保留三天不一定足够。

## 6. 兼容性改造矩阵

先生成逐表、逐列、逐 SQL 的兼容性清单。下面是设计起点，不是可以直接批量替换的规则：

| MySQL 特性 | TBase/PostgreSQL 方向 | 风险与处理 |
|---|---|---|
| database/schema 同义 | 一个目标 database 下的 schema | 明确连接数据库和 `search_path`，防止同名对象落错 Schema |
| 反引号对象名 | 双引号或不加引号的小写名 | 推荐迁移前统一小写蛇形命名，避免永久依赖大小写引用 |
| `AUTO_INCREMENT` | Sequence 或 Identity 能力 | 导入后校准 Sequence，防止新写入主键冲突 |
| `TINYINT(1)` | `boolean` 或 `smallint` | 先看真实值域；存在 2、-1 时不能转 boolean |
| `INT UNSIGNED` | 更大一级有符号类型或 `numeric` | 校验最大值，避免溢出；应用 DTO 也要修改 |
| `DATETIME` | `timestamp without time zone` | 明确它是否表示业务本地时间，禁止隐式时区转换 |
| `TIMESTAMP` | 按业务选择有/无时区时间戳 | 校验 MySQL session time zone 与驱动行为 |
| 零日期 | 无合法等价值 | 迁移前清洗为 `NULL` 或业务约定值并记录数量 |
| `ENUM` / `SET` | `varchar`、检查约束或关系表 | 不把 MySQL 内部序号直接当业务值 |
| `JSON` | 按目标版本选择 `json/jsonb/text` | 验证操作符、索引、数值精度和字段顺序依赖 |
| `BLOB` / `VARBINARY` | `bytea` 等二进制类型 | 全链路禁止经过字符集转换，抽样比较字节哈希 |
| `ON UPDATE` | 应用显式赋值或 Trigger | 防止更新时间静默不再变化 |
| `REPLACE INTO` | 明确 DELETE+INSERT 语义后改写 | 通常不能机械替换成 `ON CONFLICT` |
| `ON DUPLICATE KEY` | `ON CONFLICT` | 冲突目标、唯一约束和返回值语义必须重写 |
| `IFNULL` | `COALESCE` | 同时验证类型推断 |
| `GROUP_CONCAT` | `string_agg` 类能力 | 顺序、去重和分隔符需显式指定 |
| `DATE_FORMAT` | `to_char` 类能力 | 格式符不同，逐条测试 |
| `LIMIT offset,count` | `LIMIT count OFFSET offset` | 深分页仍应改成游标/键集分页 |

字符集兼容不是“都叫 UTF-8”就结束。MySQL `utf8mb4` 的排序规则会影响大小写、重音、尾随空格和唯一键判断；目标端排序规则不同可能使两条源数据在目标唯一索引中冲突，也可能让排序和比较结果变化。

## 7. 分布键和目标表模型

目标 DDL 不能由 MySQL DDL 机械翻译后统一补一个 `DISTRIBUTE BY`。分布键决定数据落在哪个 DataNode，也决定查询和 Join 是否需要跨节点搬运。

### 7.1 分布键选择规则 {/* #分布键选择规则 */}

一个好的分布键应尽量同时满足：

1. 高基数且数据分布均匀；
2. 值稳定，业务生命周期中不更新；
3. 高频查询携带其等值条件；
4. 大表 Join 可以使用相同分布键共置；
5. 不存在少数超级租户或热点值；
6. 主键、唯一约束和目标内核限制可以兼容；
7. 扩容、归档和数据保留策略可接受。

不要只计算 `COUNT(DISTINCT key)`。还要计算最大桶、P99 桶、空值比例、头部租户占比，并用目标节点数的数倍桶数模拟哈希分布。

```sql
SELECT tenant_id, COUNT(*) AS rows_per_tenant
FROM trade.orders
GROUP BY tenant_id
ORDER BY rows_per_tenant DESC
LIMIT 100;
```

### 7.2 Shard 表与复制表 {/* #shard-表与复制表 */}

以下是开源 TBase 文档风格的示意 DDL，具体语法以目标内核为准：

```sql
CREATE SCHEMA IF NOT EXISTS trade;

CREATE TABLE trade.orders (
  tenant_id   bigint NOT NULL,
  order_id    bigint NOT NULL,
  customer_id bigint NOT NULL,
  status      varchar(32) NOT NULL,
  amount      numeric(18, 2) NOT NULL,
  created_at  timestamp without time zone NOT NULL,
  updated_at  timestamp without time zone NOT NULL,
  PRIMARY KEY (tenant_id, order_id)
)
DISTRIBUTE BY SHARD (tenant_id)
TO GROUP default_group;
```

`tenant_id` 同时出现在主键和分布键中，使同租户查询可以单节点路由，也便于把 `order_items`、`payments` 等大表按同一键共置。代价是只给 `order_id` 的查询可能访问多个节点，应用接口和索引必须一起改造。

小而稳定、经常与各分片 Join 的字典表可以评估复制表：

```sql
CREATE TABLE trade.order_status_dict (
  status_code varchar(32) PRIMARY KEY,
  status_name varchar(128) NOT NULL
)
DISTRIBUTE BY REPLICATION
TO GROUP default_group;
```

复制表在所有目标节点保留副本，不适合大表或高频更新表。分布键在部分 TBase 版本中不能直接更新；这会影响源端更新分布列的 CDC 事件，必须改成目标端同事务内的删除旧行、插入新行，或在迁移前彻底禁止该行为。

### 7.3 用执行计划验证路由 {/* #用执行计划验证路由 */}

```sql
EXPLAIN SELECT *
FROM trade.orders
WHERE tenant_id = 1001 AND order_id = 90001;

EXPLAIN SELECT *
FROM trade.orders
WHERE order_id = 90001;
```

验收时记录访问的 DataNode 数量、是否出现数据重分布、Coordinator 汇总量和实际执行时间。不能只看语句执行成功。

## 8. Schema 转换与应用改造

### 8.1 对象转换顺序 {/* #对象转换顺序 */}

```text
角色与 Schema
→ Sequence/基础类型
→ 主表和分布策略
→ 主键/必要唯一约束
→ 全量数据
→ 二级索引
→ 外键/检查约束
→ View/Function/Trigger
→ 权限
→ ANALYZE
```

大表二级索引通常在全量导入后创建更快，但 CDC 开始回放前必须具备正确定位 UPDATE/DELETE 和冲突处理所需的主键或唯一约束。

每份 DDL 都应经过代码评审，转换产物纳入 Git，禁止迁移工具在生产目标库中不留痕地自动建表。

### 8.2 应用改造清单 {/* #应用改造清单 */}

- JDBC/语言驱动切换到目标明确支持的 PostgreSQL 协议驱动；
- 修改连接 URL、TLS、认证、连接池初始化 SQL 和健康检查；
- 修改参数占位符、分页、Upsert、批量写入和获取生成主键方式；
- 清理 MySQL Hint、`sql_mode`、`SET NAMES`、反引号和专有函数；
- 重新定义事务隔离级别、只读事务、超时、取消和重试边界；
- 不按 MySQL 错误码判断唯一冲突、死锁和连接异常；
- 处理 `NULL` 排序、字符串拼接、整数除法、布尔和大小写差异；
- 核对 ORM 方言生成的 DDL 和 SQL，不能只替换驱动；
- 给所有核心 SQL 建立“输入、结果集、排序、异常和性能”回归用例。

## 9. 全量迁移设计

### 9.1 一致性基线 {/* #一致性基线 */}

全量与增量的边界必须用可恢复的位点表示：GTID 集或 Binlog 文件与位置。正确的链路需要满足：

```text
全量快照中的每一行
+ 快照边界之后的每一个已提交变更
= 割接前 MySQL 的最终状态
```

如果全量工具分别打开普通连接逐表扫描，而增量工具从一个“差不多的时间”开始读 Binlog，就既可能漏数据，也可能重复覆盖。优先使用能建立一致性快照并记录精确增量起点的迁移服务；自建链路必须把快照事务、GTID/Binlog 位点和 CDC Checkpoint 作为一个可证明的协议设计。

### 9.2 并行抽取与限流 {/* #并行抽取与限流 */}

按稳定主键范围切片，不使用无确定顺序的 `LIMIT/OFFSET`：

```text
[min_id, p1)
[p1, p2)
...
[pn, max_id]
```

每个分片记录源端范围、预期行数、读取开始/结束时间、重试次数、目标写入数和校验状态。并发上限由源库剩余 IOPS、Buffer Pool 污染、网络带宽、目标 Coordinator/DN 写入和 WAL/日志能力共同决定。

### 9.3 暂存表与正式表 {/* #暂存表与正式表 */}

异构转换复杂时，可以先导入无业务索引的暂存表，完成类型清洗和拒绝行审计，再写入正式分布表。CSV 示例：

```sql
\copy migration_stage.orders_raw (
  tenant_id, order_id, customer_id, status,
  amount, created_at, updated_at
) FROM '/data/orders-0001.csv'
WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');
```

`\copy` 读取的是客户端文件并通过连接发送到目标库。生产执行前要验证目标版本对 Coordinator 导入、事务大小、错误隔离和并行连接的支持。CSV 必须使用成熟库编码，不能用字符串拼接处理换行、引号、分隔符、`\N`、空字符串和 `NULL`。

### 9.4 全量性能原则 {/* #全量性能原则 */}

- 使用批量/COPY 类接口，不逐行自动提交；
- 限制单事务大小，避免一次失败重做整个大表；
- 先建必要约束，后建可延迟的二级索引；
- 不以关闭持久性换取一个无法复现的漂亮速度；
- 导入后执行目标版本要求的统计信息收集；
- 将失败行写入隔离区，包含表、主键、原始值、错误和批次号；
- 每个批次可幂等重跑，不能靠“删目标库重来”作为唯一恢复方式。

## 10. 增量 CDC 设计

### 10.1 源端条件 {/* #源端条件 */}

通用要求是开启 Binlog，使用 Row 格式和完整 Row Image，并为迁移账号授予最小的读取、复制和元数据权限。具体权限以迁移工具官方文档为准，不直接复制互联网上的 `GRANT ALL`。

迁移期间执行以下控制：

- Binlog 不得提前清理；
- 冻结 DDL，或建立经演练的 DDL 变更流程；
- 禁止新增无主键表；
- 监控 Binlog 生成速率和可续传时间；
- 长事务、超大事务和批量更新提前拆分或安排窗口；
- 记录 CDC 的读取位点、应用位点和目标提交位点。

### 10.2 事件应用语义 {/* #事件应用语义 */}

| 源事件 | 目标动作 | 必须处理的问题 |
|---|---|---|
| INSERT | 插入或受控 Upsert | 重放、唯一冲突、默认值不得二次计算 |
| UPDATE | 按稳定主键更新 | 主键/分布键变化、before/after、零行更新 |
| DELETE | 按稳定主键删除 | 目标不存在是重放还是数据缺失 |
| DDL | 冻结或独立审批执行 | 不能与 DML 顺序失配 |
| Transaction | 保持必要的事务边界和顺序 | 跨表约束、中间态不可见性 |

“至少一次投递 + 幂等目标写入”通常比宣称端到端 exactly-once 更可信。幂等键至少包含源实例、库表、事务标识或 Binlog 位点和行事件序号。只有在目标事务成功提交后才能推进 Checkpoint。

### 10.3 反压和死信 {/* #反压和死信 */}

迁移系统必须暴露：

```text
source_binlog_position
read_position
applied_position
lag_seconds / lag_bytes
events_per_second
apply_error_total
retry_total
dead_letter_total
oldest_unapplied_event_age
```

目标变慢时应暂停或限速读取，保留可恢复位点，而不是无限堆积内存。无法转换的事件进入死信区并阻断对应表的完成判定；不能记录一条日志后继续宣布“延迟为零”。

## 11. 数据校验

校验至少分五层进行。

### 11.1 对象校验 {/* #对象校验 */}

对比 Schema、表、列、类型、可空、默认值、主键、唯一约束、索引、分布方式、权限和依赖对象。MySQL Trigger/Event/Procedure 没有迁移时，要有明确的应用替代项和负责人。

### 11.2 行数和边界校验 {/* #行数和边界校验 */}

对每张表按主键范围或业务日期分块比较：

- 精确 `COUNT(*)`；
- `MIN/MAX` 主键和业务时间；
- `SUM` 金额、数量等关键指标；
- `NULL` 数量和枚举值分布；
- 最近 1 小时、1 天、1 月等增量窗口。

全表一次 `COUNT(*)` 只能证明总数相同，不能证明每行相同。

### 11.3 分块内容校验 {/* #分块内容校验 */}

对字段按确定顺序做规范化，再计算分块哈希。规范化规则必须显式定义：

```text
NULL 与空字符串分别编码
decimal 使用固定精度文本
时间转换到约定时区和精度
二进制按原始字节计算
JSON 先解析并按键规范化
字符串明确字符集和尾随空格规则
每个字段使用长度前缀，防止拼接歧义
```

不能直接比较 MySQL 与 TBase 各自的物理页或内部校验和，也不要用简单 `CONCAT(col1,col2)`，因为 `('ab','c')` 与 `('a','bc')` 会得到相同文本。

### 11.4 业务语义校验 {/* #业务语义校验 */}

运行订单总额、库存守恒、账户余额、状态机、报表和对账等业务不变量。让同一批脱敏请求分别读取 MySQL 和 TBase，对结果进行规范化 Diff；对没有稳定排序的查询先补显式 `ORDER BY`。

### 11.5 在线持续校验 {/* #在线持续校验 */}

全量后到割接前持续抽样和分块校验，记录：

```text
table, chunk_start, chunk_end,
source_count, target_count,
source_hash, target_hash,
source_position, target_position,
checked_at, result
```

比较前先确认 CDC 已经应用到校验所使用的源端位点，否则会把正常延迟误报为数据不一致。

## 12. 性能与容量验收

### 12.1 容量模型 {/* #容量模型 */}

目标容量不能只按 MySQL 数据目录大小等比购买。至少估算：

```text
表数据 + 目标索引 + WAL/日志 + 临时空间 + 迁移期间碎片
+ 副本/高可用开销 + 备份 + 增长余量 + 节点失效余量
```

同时检查 Coordinator CPU/连接/汇总内存、每个 DataNode 的容量与 IOPS、节点间网络、GTM/事务组件容量，以及单节点故障后的剩余吞吐。

### 12.2 数据倾斜验收 {/* #数据倾斜验收 */}

对每张 Shard 大表记录各 DataNode 的行数、字节数和写入量。建议定义项目阈值，例如：

```text
max_node_rows / avg_node_rows <= 1.20
max_node_bytes / avg_node_bytes <= 1.20
```

阈值应按业务和目标产品能力确定。发现倾斜时回到分布键模型修正，不能只给热点节点加 CPU。

### 12.3 工作负载回放 {/* #工作负载回放 */}

使用脱敏后的真实 SQL 形状、参数分布和并发比例进行回放：

- 单行点查、范围查询、Join、聚合、分页；
- 单行事务、批量写入、热点更新和大事务；
- 日终批处理、报表和备份并发；
- 正常峰值、1.5 倍峰值和单节点故障降级；
- P50/P95/P99、QPS、错误率、锁等待、网络搬运和节点倾斜。

只执行空库 `SELECT 1` 或平均延迟压测不能作为上线依据。

## 13. 迁移阶段和准入门禁

### 13.1 阶段一：发现与 PoC {/* #阶段一发现与-poc */}

产物：源库清单、兼容性矩阵、目标版本矩阵、Top SQL、分布键提案和工具 PoC 报告。

准入条件：所有 P0 不兼容项有明确改造方案；选取包含大表、热点表、复杂类型和事务的代表数据完成闭环。

### 13.2 阶段二：Schema 与应用改造 {/* #阶段二schema-与应用改造 */}

产物：目标 DDL、SQL 改造清单、驱动与配置变更、双数据库自动化回归测试。

准入条件：核心功能在 TBase 独立运行，目标 DDL 和分布策略完成 DBA/架构评审。

### 13.3 阶段三：全量与增量演练 {/* #阶段三全量与增量演练 */}

产物：全量作业、CDC 作业、Checkpoint、监控、数据校验报告和故障恢复记录。

准入条件：至少两次使用接近生产数据量的演练；人为中断源、目标、网络和迁移进程后可从正确位点恢复。

### 13.4 阶段四：影子读和压测 {/* #阶段四影子读和压测 */}

生产写入仍只进入 MySQL，异步复制到 TBase。复制真实只读请求到 TBase，不把影子结果返回用户，比较结果和延迟。

准入条件：连续观察一个完整业务周期，无未知数据差异，容量和 SLO 达标。

### 13.5 阶段五：割接和观察 {/* #阶段五割接和观察 */}

准入条件：变更审批、人员、监控、脚本、备份、回滚演练、厂商支持和业务低峰窗口全部就绪。

## 14. 生产割接 Runbook

### 14.1 T-14 天到 T-1 天 {/* #t-14-天到-t-1-天 */}

1. 冻结 Schema，禁止未进入迁移清单的 DDL；
2. 完成 MySQL 可恢复备份并演练恢复；
3. 延长 Binlog 保留，确认磁盘容量；
4. 完成 TBase 备份、监控、告警和节点故障演练；
5. 将连接地址、凭据放入可回滚的配置中心或 Secret；
6. 把 DNS/服务发现 TTL 调整到计划值；
7. 完成最终一次全量分块校验和真实流量影子读；
8. 确认迁移链路无死信、无未解决重试、延迟稳定。

### 14.2 T-60 分钟 {/* #t-60-分钟 */}

1. 建立变更群和统一指挥人；
2. 冻结发布、定时任务、报表补数和人工数据修复；
3. 保存 MySQL GTID/Binlog 位点、CDC 位点和 TBase 状态快照；
4. 核对应用实例数、长事务、连接数和当前业务基线；
5. 再次确认一键恢复 MySQL 连接配置可用。

### 14.3 T-10 分钟：进入停写 {/* #t-10-分钟进入停写 */}

1. 网关或应用进入维护/只读模式，拒绝新写请求；
2. 暂停消费者、定时任务和所有绕过主应用的写入者；
3. 等待在途事务结束，处理仍存在的长事务；
4. 记录最终源端位点；
5. 等待 CDC 应用到该位点，要求待处理事件为零；
6. 对核心表执行最终行数、分块哈希和业务不变量校验。

如果任何强制门禁失败，保持 MySQL 为权威源并取消割接，不要一边排障一边开放 TBase 写入。

### 14.4 T0：切换应用 {/* #t0切换应用 */}

1. 更新应用数据库连接和驱动配置；
2. 先启动一个或少量 Canary 实例；
3. 执行登录、下单、查询、更新、取消和对账等合成事务；
4. 确认结果、错误率、P99、连接池、Coordinator 和 DataNode 正常；
5. 分批扩大流量，最后解除维护模式；
6. MySQL 保持只读和原样保留，不立即删除实例、账号、Binlog 或备份。

### 14.5 T+0 到 T+24 小时 {/* #t0-到-t24-小时 */}

高频观察：

- 业务成功率、P95/P99、超时、重试和错误码；
- TBase Coordinator/DN/GTM 相关健康状态；
- CPU、内存、磁盘、WAL/日志、连接、锁和长事务；
- 单节点路由比例、跨节点数据搬运和慢 SQL；
- 节点数据与负载倾斜；
- 订单、余额、库存等持续对账；
- 备份任务和高可用状态。

## 15. 回滚设计

### 15.1 切换前回滚 {/* #切换前回滚 */}

在 TBase 尚未接收业务写入前，回滚最简单：保持或恢复应用连接 MySQL，解除只读，修复目标问题后重做迁移。此时 TBase 可以丢弃并重建，因为它不是权威源。

### 15.2 切换后回滚的真实难点 {/* #切换后回滚的真实难点 */}

一旦 TBase 接收了新写入，MySQL 就不再包含完整业务状态。仅把连接串改回 MySQL 会丢失切换后的订单和更新，不是回滚，而是数据事故。

上线前必须选择一种策略：

1. **短窗口阻断式回滚**：发现问题后立即再次停写，从 TBase 导出切换后变更，转换并补回 MySQL，完成校验后才恢复 MySQL；
2. **预建反向同步**：将 TBase 变更可靠同步回 MySQL，并完成冲突、类型、顺序和故障演练；
3. **明确不可自动回滚点**：超过某时间或产生某类写入后，改为在 TBase 前向修复，不再承诺直接切回。

双向同步容易形成回环和冲突，不能在割接当天临时搭建。若没有经过验证的反向通道，回滚 Runbook 必须包含停写、差异提取、数据补偿和最终校验所需时间，并据此重新评估 RTO。

### 15.3 回滚触发条件 {/* #回滚触发条件 */}

在变更前量化，例如：

```text
核心写入错误率连续 5 分钟 > 1%
核心接口 P99 连续 10 分钟超过 SLO
出现确认的数据丢失、重复扣款或约束破坏
任一关键组件故障且无法在 15 分钟内恢复
节点倾斜或 Coordinator 饱和导致容量无安全余量
```

阈值、持续时间、决策人和“前向修复还是回滚”必须提前审批，不能在事故中临时争论。

## 16. 常见失败与处置

| 现象 | 优先证据 | 常见根因 | 处置方向 |
|---|---|---|---|
| 全量越来越慢 | 源 IOPS、目标写入、网络、批次耗时 | 并发过高、索引维护、热点分布键 | 限流、调整批次、延后非必要索引、修正分布 |
| CDC 延迟持续上涨 | read/applied 位点、目标提交耗时 | 目标慢、单分区热点、大事务、重试风暴 | 找到瓶颈，暂停扩散，增加可安全并行度 |
| 目标唯一键冲突 | 冲突键和源行、排序规则 | 全量/增量重叠、大小写语义、目标已有数据 | 判断重放还是模型冲突，禁止盲目覆盖 |
| UPDATE 影响 0 行 | 主键、before/after、全量批次 | 基线缺行、事件乱序、键被修改 | 阻断该表，回到最后可信 Checkpoint 补齐 |
| 时间相差 8 小时 | 源/目标/session/JVM 时区 | DATETIME/TIMESTAMP 语义混淆 | 按字段业务语义修正，不做全局字符串替换 |
| 中文乱码 | 原始字节、连接字符集、CSV 编码 | 中间通道转码、错误声明编码 | 从源字节到目标逐段定位并重跑受影响分片 |
| 查询结果正确但很慢 | `EXPLAIN`、节点访问、网络流量 | 未带分布键、跨节点 Join、统计信息缺失 | 改 SQL/模型、共置、复制小表、收集统计信息 |
| 切换后回不去 | TBase 新写入清单 | 没有反向同步或补偿方案 | 再次停写，提取差异，校验后决定回切或前向修复 |

## 17. 监控与告警清单

### 17.1 MySQL 源端 {/* #mysql-源端 */}

- QPS/TPS、连接、Threads Running、锁和长事务；
- Buffer Pool、磁盘延迟、临时表和网络；
- Binlog 生成速度、最早可用位点和剩余保留时间；
- 复制延迟和备份状态；
- 迁移账号错误、连接中断和快照持续时间。

### 17.2 迁移链路 {/* #迁移链路 */}

- 全量表/分片完成率、行数、字节、速率和 ETA；
- CDC 读取位点、应用位点、秒/字节延迟；
- 每秒事件、批次提交延迟、重试和死信；
- 校验通过率、差异行数和最旧未解决差异；
- Checkpoint 持久化和恢复测试结果。

### 17.3 TBase 目标端 {/* #tbase-目标端 */}

- Coordinator 连接、CPU、内存、慢 SQL 和汇总压力；
- 各 DataNode CPU、磁盘、日志、锁、会话和错误；
- 节点间网络吞吐、重分布流量和超时；
- 各节点行数/字节/写入倾斜；
- GTM/全局事务相关组件的可用性和延迟；
- 备份、复制、高可用和剩余容量。

## 18. 项目交付物

迁移完成不等于迁移项目结束。至少归档以下制品：

```text
01-source-inventory/       源库、对象、容量、写入和 Top SQL 清单
02-compatibility/          类型、SQL、对象和驱动兼容矩阵
03-target-schema/          评审后的 TBase DDL、分布键与索引
04-migration-jobs/         全量、CDC、配置模板和版本锁定
05-validation/             分块校验规则、报告和差异处置记录
06-performance/            回放、压测、容量和故障测试报告
07-cutover/                割接 Runbook、审批和执行时间线
08-rollback/               回滚/反向同步方案和演练证据
09-observability/          Dashboard、告警和日志查询
10-operations/             备份恢复、扩容、升级与故障 Runbook
```

迁移账号、数据库密码和连接串不能进入 Git；只保存 Secret 引用和轮换记录。

## 19. 上线检查表

### 19.1 兼容性 {/* #兼容性 */}

- [ ] 已确认目标是 TBase/TDSQL PostgreSQL，而不是 TDSQL MySQL；
- [ ] 源端、目标端、驱动和迁移工具版本得到明确支持；
- [ ] 所有表都有处置结论，无主键表没有被忽略；
- [ ] 类型、默认值、时区、排序规则和大小写语义已验证；
- [ ] View、Trigger、Routine、Event、权限有迁移或替代方案；
- [ ] 核心 MySQL 专有 SQL 已完成改写和自动化回归。

### 19.2 分布模型 {/* #分布模型 */}

- [ ] 每张表明确为 Shard、Replication 或其他目标支持的类型；
- [ ] 分布键通过真实数据倾斜分析；
- [ ] 高频查询能够单节点路由或有可接受的执行计划；
- [ ] 大表 Join 已共置或完成重分布性能验证；
- [ ] 分布键更新事件有明确处理方式。

### 19.3 数据链路 {/* #数据链路 */}

- [ ] 全量快照与增量起点之间可以证明无缺口；
- [ ] Binlog 保留覆盖最坏恢复时间；
- [ ] CDC Checkpoint 只在目标事务提交后推进；
- [ ] 重放、乱序、冲突、死信和大事务完成故障演练；
- [ ] 对象、行数、分块哈希、业务不变量和影子读全部通过。

### 19.4 生产切换 {/* #生产切换 */}

- [ ] 峰值、故障降级、备份和恢复达到 SLO；
- [ ] 所有写入入口都能进入维护模式；
- [ ] Canary、放量、停止和回滚命令已经过演练；
- [ ] 切换后新写入如何回到 MySQL 已有可执行答案；
- [ ] 回滚阈值、不可回滚点和决策人已审批；
- [ ] MySQL 保留周期和最终下线条件已确定。

## 20. 最小实战练习

学习时先用三张表完成小型闭环：

```text
tenant        小字典表，评估 Replication
orders        按 tenant_id Shard
order_items   与 orders 使用相同 tenant_id 共置
```

依次完成：

1. 在 MySQL 制造 `AUTO_INCREMENT`、`TINYINT(1)`、`DATETIME`、`JSON` 和 `ON DUPLICATE KEY`；
2. 生成目标 DDL，说明每个类型和 SQL 的改造理由；
3. 插入一个超级租户，观察错误分布键造成的倾斜；
4. 完成一份一致性全量和增量同步；
5. 中断 CDC、重复投递事件、制造唯一冲突并恢复；
6. 比较带/不带分布键查询的执行计划；
7. 执行停写、追平、校验、切换；
8. 在 TBase 产生新订单后，按回滚方案安全返回 MySQL；
9. 写出位点、证据、耗时、失败原因和改进项。

只有最后一步也能完成，才算真正理解迁移，而不是只会“把数据导进去”。

## 21. 参考资料 {/* #参考资料 */}

- [Tencent/TBase：架构、构建与基础用法](https://github.com/Tencent/TBase/blob/master/README.md)
- [TBase 基本使用篇：Shard 表、复制表与 DML](https://github.com/Tencent/TBase/wiki/2.-TBase%E5%9F%BA%E6%9C%AC%E4%BD%BF%E7%94%A8%E7%AF%87)
- [腾讯云 DTS：MySQL 同步至 TDSQL PostgreSQL](https://cloud.tencent.com/document/product/571/58366)
- [MySQL 8.4：Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)
- [MySQL 8.4：Point-in-Time Recovery](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery.html)
- [Debezium MySQL Connector](https://debezium.io/documentation/reference/stable/connectors/mysql.html)
- [DataX MySQLReader](https://github.com/alibaba/DataX/blob/master/mysqlreader/doc/mysqlreader.md)
