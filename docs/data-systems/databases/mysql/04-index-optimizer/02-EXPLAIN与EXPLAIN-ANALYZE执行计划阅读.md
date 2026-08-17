---
title: "EXPLAIN、EXPLAIN ANALYZE 与执行计划阅读"
sidebar_label: "02. EXPLAIN、EXPLAIN ANALYZE 与执行计划阅读"
sidebar_position: 2
tags: [MySQL, EXPLAIN, EXPLAIN ANALYZE, 执行计划, SQL优化]
description: "从访问类型、估算行数到迭代器真实时间，建立可重复的 MySQL 执行计划阅读与验证方法。"
---

# EXPLAIN、EXPLAIN ANALYZE 与执行计划阅读

执行计划不是一张“出现 `ALL` 就失败、出现 `Using index` 就成功”的成绩单。它描述优化器准备怎样访问数据，或查询真实执行时各迭代器做了多少工作。正确目标是解释成本来自哪里，并用真实指标验证修改是否有效。

---

## 1. 三种最常用的观察方式

### 1.1 传统表格

```sql
EXPLAIN
SELECT ...;
```

适合快速查看每张表的访问类型、候选索引、选中索引、估算行数和 `Extra`。

### 1.2 TREE / JSON

```sql
EXPLAIN FORMAT=TREE
SELECT ...;

EXPLAIN FORMAT=JSON
SELECT ...;
```

`TREE` 更接近执行器的迭代器树，适合阅读执行顺序和算子关系；`JSON` 包含更结构化的成本和查询块信息，适合工具处理。MySQL 8.4 的默认格式还可能受 `explain_format` 变量影响，因此排查记录中应写明格式。

### 1.3 真实执行

```sql
EXPLAIN ANALYZE FORMAT=TREE
SELECT ...;
```

它会真正执行语句，并给出估算成本、估算行数、首行时间、全部时间、真实返回行数和循环次数。

:::danger 生产安全边界

`EXPLAIN ANALYZE` 不是只读模拟。对一个会扫描十亿行、长时间持锁或消耗大量临时空间的查询，它仍然会造成真实负载。先用普通 `EXPLAIN` 评估风险，再在只读副本、隔离环境或受控时段验证；不要把写语句、未知 SQL 或故障中的重查询直接拿到主库执行。

:::

---

## 2. 执行计划来自一条流水线

```text
SQL 文本
→ 解析与语义检查
→ 查询重写
→ 枚举可行访问路径与 Join 顺序
→ 根据统计信息估算行数和成本
→ 选择计划
→ 执行器拉取迭代器
→ 存储引擎读取记录
```

普通 `EXPLAIN` 展示“预计如何执行”；`EXPLAIN ANALYZE` 才能比较“预计”与“实际”。如果计划本身看似合理却仍很慢，还要继续检查锁等待、I/O、CPU、网络返回和并发竞争。

---

## 3. 先准备一个可推导的例子

```sql
CREATE TABLE customers (
  id        BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name      VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_tenant_id (tenant_id, id)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id          BIGINT UNSIGNED NOT NULL,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  status      TINYINT UNSIGNED NOT NULL,
  created_at  DATETIME(6) NOT NULL,
  amount      DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_tenant_status_created
      (tenant_id, status, created_at, customer_id)
) ENGINE=InnoDB;
```

目标 SQL：

```sql
SELECT c.id, c.name, SUM(o.amount) AS total_amount
FROM customers AS c
JOIN orders AS o
  ON o.customer_id = c.id
 AND o.tenant_id = c.tenant_id
WHERE c.tenant_id = 42
  AND o.status = 1
  AND o.created_at >= '2026-08-01'
GROUP BY c.id, c.name
ORDER BY total_amount DESC
LIMIT 20;
```

在看输出前先做预测：哪个表先访问、每层预计产生多少行、是否需要排序或临时结果。带着预测阅读比机械背字段更有效。

---

## 4. 传统 EXPLAIN 的核心列

### 4.1 `id` 与 `select_type`

它们帮助识别查询块、子查询、派生表和 `UNION`。但执行顺序不能只按 `id` 数字猜测，复杂计划优先看 `FORMAT=TREE` 的父子关系。

常见 `select_type`：

- `SIMPLE`：没有子查询或 `UNION`；
- `PRIMARY`：最外层查询块；
- `SUBQUERY`：子查询；
- `DERIVED`：派生表；
- `UNION`：`UNION` 后的查询块；
- `MATERIALIZED`：某部分被物化。

### 4.2 `table`

表示当前步骤访问的表、别名、派生结果或物化子查询。必须结合 Join 顺序阅读，同一张表的别名也应视作不同访问节点。

### 4.3 `type`：访问类型

常见值可大致从访问更集中到扫描更多排列：

| 类型 | 含义 | 判断重点 |
|---|---|---|
| `system` / `const` | 最多得到一行常量结果 | 主键或唯一键常量条件 |
| `eq_ref` | 对前一步每行按唯一键最多匹配一行 | 一对一 Join 常见 |
| `ref` | 按非唯一索引等值匹配 | 每次平均匹配多少行 |
| `range` | 扫描一个或多个索引范围 | 范围大小和回表量 |
| `index` | 扫描整棵索引 | 仍可能读很多记录 |
| `ALL` | 扫描整表 | 表大小、过滤比例和是否本就合理 |

`type=index` 不是“小范围索引查询”，它可能是全索引扫描。`ALL` 也不必然错误：很小的表，或本来就要读取大部分行时，顺序扫描可能更经济。

### 4.4 `possible_keys`、`key` 与 `key_len`

- `possible_keys`：优化器认为可能可用的索引；
- `key`：最终选择的索引；
- `key_len`：用于访问的键长度估算，可辅助判断联合索引用到了哪些部分。

`key_len` 受类型、可空性、字符集和前缀长度影响，不要把它当作绝对易读的“用了几列”。更可靠的方法是结合 `key_parts`、条件、TREE/JSON 输出共同判断。

### 4.5 `ref`

显示使用常量或前一张表的哪一列与索引比较。Join 中它能帮助验证关联键是否按预期驱动访问。

### 4.6 `rows` 与 `filtered`

`rows` 是预计读取行数，`filtered` 是预计通过表条件的百分比。粗略的输出行数为：

```text
estimated output ≈ rows × filtered / 100
```

多表 Join 中，上游误差会逐层放大。一个节点估少 100 倍，可能导致错误的 Join 顺序或算法。

---

## 5. 正确理解 Extra

### `Using index`

通常表示覆盖索引访问，不必读取完整表行。它描述取列方式，不等于只扫描少量索引记录。

### `Using index condition`

表示 Index Condition Pushdown：存储引擎可在索引记录层判断部分条件，减少回表。它不代表所有条件都变成了索引定位边界。

### `Using where`

读取候选记录后还要做条件过滤。这很常见，不是单独的故障结论；关键是读取多少、过滤掉多少。

### `Using filesort`

表示不能直接利用访问顺序完成排序，要执行额外排序算法。“filesort” 是 MySQL 的术语，不代表一定落盘。应继续看排序行数、行宽、内存和磁盘临时文件。

### `Using temporary`

表示查询使用内部临时表处理某些聚合、排序、去重或物化。临时表可能在内存，也可能转到磁盘；要用状态和 Performance Schema 继续确认。

这些标记不是见到就必须消除。一个只排序 20 行的 `Using filesort`，通常比为了消除它而维护一个巨大索引更便宜。

---

## 6. 读取 TREE：从叶子理解数据流

示意计划：

```text
Limit: 20 row(s)
└─ Sort: total_amount DESC
   └─ Aggregate using temporary table
      └─ Nested loop inner join
         ├─ Index lookup on c using idx_tenant_id
         └─ Index range scan on o using idx_tenant_status_created
```

读法：

1. 叶子节点先产生记录；
2. Join 组合上下游记录；
3. 聚合形成每个客户的结果；
4. 按聚合值排序；
5. 最外层只返回 20 行。

外层 `LIMIT 20` 不代表底层只读 20 行。由于要按聚合结果排序，通常必须先处理全部相关分组。

---

## 7. 读取 EXPLAIN ANALYZE

典型节点：

```text
-> Index range scan on orders using idx_orders
   (cost=420 rows=1800)
   (actual time=0.080..12.4 rows=23600 loops=1)
```

含义：

- `cost=420`：优化器成本单位，不是毫秒；
- 估算返回 `1800` 行；
- 真实首行约 `0.080 ms`；
- 该次循环产生全部行约到 `12.4 ms`；
- 真实返回 `23600` 行；
- 执行 `1` 次。

这里最重要的信号是估算与实际相差约 13 倍，后续应检查统计信息、数据倾斜、列相关性和谓词表达方式。

### 7.1 `loops` 的乘法效应

```text
actual time=0.020..0.040 rows=3 loops=100000
```

显示的是每次循环的平均时间和平均输出行数。单次只有零点几毫秒，但执行十万次仍可能成为主成本。Nested Loop 的内表查询尤其要看 `loops`。

### 7.2 父节点时间包含子节点工作

迭代器等待其子节点提供数据，因此不能把每一行的“全部时间”简单相加当作总耗时。定位时应寻找时间、行数或循环数在哪一层发生明显跃升。

### 7.3 首行时间和全部时间

两者差异能帮助判断算子是否阻塞：

- 索引点查通常很快返回首行；
- 大排序、完整聚合或物化可能先消费大量输入，首行较晚；
- 流式扫描首行快，但全部结果可能仍很慢。

这与 API 的 TTFT 和总响应时间分析思路相同。

---

## 8. 一套稳定的计划阅读顺序

### 第一步：确认语义与运行上下文

记录：

- MySQL 版本；
- Schema、索引与统计信息时间；
- 参数值和字符集；
- 事务隔离级别；
- 数据规模与分布；
- 是否主库、只读副本或测试库。

### 第二步：看最终返回目标

返回几行、几列？是否真的需要全部大字段？排序和分页是否稳定？

### 第三步：从叶子看访问路径

每张表是点查、范围还是全扫描？扫描多少、返回多少？是否回表？

### 第四步：看行数如何逐层放大

```text
leaf output
× loops
→ join output
→ filter
→ aggregate/sort
→ final rows
```

### 第五步：找估算和实际的分叉点

最早出现数量级误差的节点，往往比最外层“慢”节点更接近根因。

### 第六步：确认额外工作

排序、临时表、物化、重复回表、去重、网络返回和锁等待分别有多少成本？

---

## 9. 典型误判

### 9.1 “用了索引，所以 SQL 没问题”

索引范围可能覆盖 80% 的表，再加数百万次回表，比全表扫描还贵。要看真实行数和读取比例。

### 9.2 “`rows=1`，所以只读了一行”

普通 `EXPLAIN` 是估算。用 `EXPLAIN ANALYZE` 验证实际行数，或结合运行统计观察。

### 9.3 “只要消灭 filesort”

为一个低频小结果排序新增宽索引，可能让所有写入变慢。比较总收益，而不是追求漂亮标记。

### 9.4 “强制索引后这次快了，就永久加 hint”

Hint 固化了当前数据分布下的选择。数据增长、参数变化或版本升级后可能反而变慢。先修统计、SQL 和索引，Hint 应有失效条件和复查机制。

### 9.5 “测试库执行快，生产也会快”

计划依赖数据量、倾斜、缓存和并发。必须使用脱敏但具有代表性的数据分布进行验证。

---

## 10. 计划变化不一定是根因

查询变慢时，不要只截两张 `EXPLAIN` 图。同步采集：

```text
SQL digest 与参数分布
计划和统计信息
执行时段 QPS、连接和并发
锁等待
Buffer Pool 与磁盘延迟
CPU 与运行队列
临时表和排序
复制/备份/DDL 等后台事件
```

即使计划没变，缓存从热变冷、I/O 抖动或锁竞争也会让延迟突增；即使计划变了，也可能是统计信息变化对数据分布的合理响应。

---

## 11. 安全实验模板

```sql
-- 1. 只估算，不执行目标 SELECT
EXPLAIN FORMAT=TREE
SELECT ...;

-- 2. 结构化输出留档
EXPLAIN FORMAT=JSON
SELECT ...;

-- 3. 在受控环境执行并采集真实值
EXPLAIN ANALYZE FORMAT=TREE
SELECT ...;
```

修改索引或 SQL 后，至少比较：

| 指标 | 修改前 | 修改后 |
|---|---:|---:|
| 实际扫描行 |  |  |
| 返回行 |  |  |
| 估算/实际误差 |  |  |
| 首行时间 |  |  |
| 全部时间 |  |  |
| loops |  |  |
| 是否排序/临时表 |  |  |
| P95/P99 |  |  |
| 写入吞吐变化 |  |  |

还要校验结果集完全一致，特别是 `NULL`、时区、字符集、去重和排序稳定性。

---

## 12. 进阶工具

### 查看正在执行连接的计划

有相应权限时，可对目标连接使用：

```sql
EXPLAIN FORMAT=TREE FOR CONNECTION <connection_id>;
```

它适合观察长查询的当前计划，但不替代等待事件和事务状态分析。

### 查看语句摘要

```sql
SELECT DIGEST_TEXT,
       COUNT_STAR,
       ROUND(SUM_TIMER_WAIT / 1e12, 3) AS total_seconds,
       SUM_ROWS_EXAMINED,
       SUM_ROWS_SENT
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = DATABASE()
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

先用 digest 找到“总资源消耗最大”的查询类型，再选代表性参数分析计划，比盯着一次偶发慢查询更系统。

---

## 13. 结论

读执行计划的主线是：

```text
访问路径
→ 每层估算行数
→ 实际行数与 loops
→ 排序/聚合/物化
→ 等待与系统环境
→ 业务结果和回归指标
```

下一篇将继续解释优化器为什么会估错，以及统计信息、直方图和成本模型如何影响计划选择。

---

## 参考资料

- [MySQL 8.4 Reference Manual：EXPLAIN Statement](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [MySQL 8.4 Reference Manual：Obtaining Execution Plan Information](https://dev.mysql.com/doc/refman/8.4/en/execution-plan-information.html)
- [MySQL 8.4 Reference Manual：Performance Schema Statement Digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html)
