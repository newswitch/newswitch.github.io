---
title: "Join、子查询、CTE、排序与临时表的执行原理"
sidebar_label: "04. Join、子查询、CTE、排序与临时表的执行原理"
sidebar_position: 4
tags: [MySQL, Join, 子查询, CTE, Filesort, 临时表]
description: "从数据流理解 Join 顺序与算法、子查询改写、CTE 合并和物化、排序以及内存与磁盘临时表。"
---

# Join、子查询、CTE、排序与临时表的执行原理

复杂 SQL 慢，往往不是因为语法写得长，而是中间数据集在某一步急剧膨胀，又被重复扫描、排序、物化或写入临时空间。真正需要掌握的是“数据怎样在算子之间流动”。

---

## 1. 先画出逻辑关系，再看物理计划

```sql
WITH recent_orders AS (
  SELECT tenant_id, customer_id, amount
  FROM orders
  WHERE created_at >= CURRENT_DATE - INTERVAL 30 DAY
    AND status = 'PAID'
)
SELECT c.segment,
       COUNT(DISTINCT c.id) AS customers,
       SUM(r.amount) AS revenue
FROM customers AS c
JOIN recent_orders AS r
  ON r.tenant_id = c.tenant_id
 AND r.customer_id = c.id
WHERE c.tenant_id = 42
GROUP BY c.segment
ORDER BY revenue DESC;
```

逻辑需求是“最近 30 天已付款订单按客户分群聚合”。物理执行却存在多个选择：

- CTE 合并进外层，还是先物化；
- 先过滤 `customers`，还是先扫描 `orders`；
- 使用 Nested Loop，还是 Hash Join；
- 通过索引顺序聚合/排序，还是使用临时结果；
- 中间结果留在内存，还是转到磁盘。

用 `EXPLAIN FORMAT=TREE` 看优化器选了哪条数据路径，用 `EXPLAIN ANALYZE` 验证每层真实行数。

---

## 2. Join 不等于“先写左表，再写右表”

对普通内连接，优化器通常可以调整表的访问顺序。SQL 中的书写顺序不一定是物理执行顺序。

### 2.1 驱动输入与被探测输入

Nested Loop 可以抽象为：

```text
for each row in outer input:
    find matching rows from inner input
```

如果外层实际产生 100 行，内层每次索引点查很便宜；如果外层被误估为 100 行、实际产生 100 万行，内层访问就会执行 100 万次。

所以优化 Join 的第一问题不是“哪张表小”，而是：

```text
经过过滤后，哪条输入实际产生多少行？
内层每次探测的成本是多少？
平均匹配多少行？
```

### 2.2 Join 键必须对齐

```sql
ON o.customer_id = c.id
AND o.tenant_id = c.tenant_id
```

检查两侧：

- 数据类型与有无符号是否一致；
- 字符串长度、字符集、排序规则是否一致；
- 是否对 Join 列套函数或隐式转换；
- 内层是否有适合当前外层顺序的联合索引；
- 多租户场景是否遗漏 `tenant_id`，造成跨租户错误匹配。

性能修复不能破坏关联语义。

---

## 3. Nested Loop 与 Hash Join

### 3.1 Nested Loop

适合外层经过过滤后较小，且内层可以高效索引访问的场景：

```text
100 outer rows
× 1 fast unique lookup
→ about 100 probes
```

危险信号：

- 内层节点 `loops` 极大；
- 每次返回多行，逐层相乘；
- 内层没有合适索引；
- 访问键随机且数据不在缓存；
- 估算与实际相差数量级。

### 3.2 Hash Join

可以简化为：

```text
读取一侧并建立 hash table
→ 扫描另一侧
→ 用等值 Join 键探测 hash table
```

它适合某些无可用索引的等值连接，避免对内表做大量重复全扫描。代价包括构建哈希结构的内存、读取两侧输入，以及大数据集下的额外资源压力。

MySQL 的 `EXPLAIN FORMAT=TREE` 能明确显示 Hash Join；不要只用传统 `EXPLAIN` 猜测算法。Hash Join 也不是“不需要索引”的普遍理由，OLTP 高频点查和小结果 Join 通常仍受益于正确索引。

---

## 4. Join 行数爆炸

假设：

```text
customers 过滤后：10,000
每个 customer 匹配 orders：200
Join 输出：2,000,000
```

外层最终只按 `segment` 聚合成 5 行，也不能抹掉前面处理两百万行的成本。

常见修复方向：

- 先在订单侧过滤更小的时间和状态范围；
- 在正确粒度上先聚合，再 Join；
- 使用 `EXISTS` 表达“是否存在”，避免为存在性需求生成所有匹配行；
- 修复缺失或重复的关联条件；
- 为内层访问设计联合索引；
- 避免一对多再一对多导致笛卡尔式放大。

### 聚合后再连接

```sql
WITH order_summary AS (
  SELECT tenant_id,
         customer_id,
         SUM(amount) AS revenue
  FROM orders
  WHERE tenant_id = 42
    AND status = 'PAID'
    AND created_at >= CURRENT_DATE - INTERVAL 30 DAY
  GROUP BY tenant_id, customer_id
)
SELECT c.segment, SUM(s.revenue)
FROM order_summary AS s
JOIN customers AS c
  ON c.tenant_id = s.tenant_id
 AND c.id = s.customer_id
GROUP BY c.segment;
```

这可能显著缩小 Join 输入，但是否更快仍取决于物化、聚合和索引，必须比较真实计划。

---

## 5. EXISTS、IN 和相关子查询

### 5.1 用语义选写法

只判断存在性：

```sql
SELECT c.id
FROM customers AS c
WHERE c.tenant_id = 42
  AND EXISTS (
    SELECT 1
    FROM orders AS o
    WHERE o.tenant_id = c.tenant_id
      AND o.customer_id = c.id
      AND o.status = 'PAID'
  );
```

如果改成普通 Join，需要考虑一位客户的多张订单会产生重复客户行，可能又要 `DISTINCT`。`EXISTS` 更直接表达“找到一个即可”。

### 5.2 优化器可能做的转换

子查询不必然“每行执行一次”。优化器可能：

- 转换为 Semijoin；
- 对 `NOT EXISTS` 等场景使用 Antijoin；
- 将子查询物化后查询；
- 合并派生表到外层；
- 对相关条件进行改写。

也有计划仍表现为依赖外层的重复执行。用 TREE 输出中的节点和 `loops` 确认，而不是仅凭 SQL 外形判断。

### 5.3 `NOT IN` 与 NULL

```sql
WHERE id NOT IN (SELECT customer_id FROM blacklist)
```

若子查询可能产生 `NULL`，三值逻辑会让结果与很多人的直觉不同。优先明确列是否 `NOT NULL`，并在业务语义允许时使用清晰的 `NOT EXISTS` 关联条件。改写前必须做结果集测试。

---

## 6. 派生表和 CTE：合并还是物化

CTE 首先是表达和复用查询逻辑的方式，不是固定的性能优化或固定的临时表。

优化器对非递归 CTE、视图或派生表可能：

### 合并（Merge）

把内部查询块合并到外层，让条件下推并联合优化：

```text
outer predicates
→ push into base tables
→ optimize as one query block
```

### 物化（Materialize）

先执行内部查询，把结果写入内部临时表，再由外层读取：

```text
execute CTE
→ materialize result
→ scan/reference result one or more times
```

物化可能带来收益：复杂结果复用、避免重复计算；也可能带来代价：先产生大量中间行、消耗内存/磁盘、阻碍外层条件下推。

影响选择的结构包括聚合、`DISTINCT`、`GROUP BY`、`LIMIT`、窗口函数、`UNION` 等。不要通过“CTE 一定只算一次”或“CTE 一定内联”下结论，直接看计划。

递归 CTE 还需要设置清晰的终止条件和结果上界，避免生成远超预期的中间集。

---

## 7. ORDER BY 与 Filesort

### 7.1 利用索引顺序

索引 `(tenant_id, status, created_at, id)` 可以支持某些查询在固定前导列后按 `(created_at, id)` 顺序读取：

```sql
SELECT id, created_at
FROM orders
WHERE tenant_id = 42
  AND status = 'PAID'
ORDER BY created_at, id
LIMIT 100;
```

但只要排序列、方向、前导过滤或 Join 顺序不满足索引顺序，仍可能额外排序。

### 7.2 Filesort 不一定写文件

它表示 MySQL 使用额外排序过程，不表示必定发生磁盘 I/O。排序成本大致受这些因素影响：

- 待排序行数；
- 排序键与携带数据宽度；
- 是否先过滤；
- 可用排序内存；
- 是否需要合并多个排序 run；
- `LIMIT` 能否提前停止。

优化方向通常是先减少待排序行，而不是盲目调大每连接的排序缓冲区。

### 7.3 稳定排序

分页必须有确定的唯一顺序：

```sql
ORDER BY created_at DESC, id DESC
```

只有 `created_at` 时，同一时间戳的行顺序可能不稳定，翻页会重复或遗漏。

---

## 8. GROUP BY、DISTINCT 与窗口函数

它们都可能需要保存中间状态：

- `GROUP BY`：为每个分组维护聚合状态；
- `DISTINCT`：识别和去除重复；
- 窗口函数：按分区与顺序计算；
- `COUNT(DISTINCT ...)`：维护不同值集合；
- 排序和分组条件不兼容时：额外处理多份中间结果。

设计时先问：

```text
能否更早过滤？
业务真正需要的分组粒度是什么？
是否因错误 Join 先制造重复，再用 DISTINCT 补救？
是否可以离线预聚合或使用汇总表？
```

`DISTINCT` 经常掩盖错误的一对多 Join。删掉它检查结果为何重复，往往比微调临时表更接近根因。

---

## 9. 内部临时表何时出现

MySQL 可能为以下工作使用内部临时表：

- 某些 `UNION`；
- 某些派生表、视图和 CTE；
- 子查询或 Semijoin 物化；
- `ORDER BY` 与 `GROUP BY` 组合；
- `DISTINCT` 和聚合；
- 窗口函数；
- 需要保存中间结果的复杂执行。

MySQL 8.4 默认可使用 TempTable 引擎处理内存内部临时表；结果过大、数据类型或资源限制等条件可能使其使用磁盘临时空间。具体参数和默认值应查询目标版本：

```sql
SHOW VARIABLES LIKE 'internal_tmp_mem_storage_engine';
SHOW VARIABLES LIKE 'temptable_max_ram';
SHOW VARIABLES LIKE 'tmp_table_size';
SHOW VARIABLES LIKE 'tmpdir';
```

不要只因为磁盘临时表计数增加就把所有内存阈值调大。并发查询会竞争总内存，过度放大会从“临时表慢”变成 OOM 或交换分区抖动。

---

## 10. 如何观测排序和临时工作

会话或实例状态可用于趋势判断：

```sql
SHOW GLOBAL STATUS LIKE 'Created_tmp%';
SHOW GLOBAL STATUS LIKE 'Sort%';
```

还可以从语句摘要聚合：

```sql
SELECT DIGEST_TEXT,
       COUNT_STAR,
       SUM_ROWS_EXAMINED,
       SUM_ROWS_SENT,
       SUM_CREATED_TMP_TABLES,
       SUM_CREATED_TMP_DISK_TABLES,
       SUM_SORT_ROWS,
       SUM_SORT_MERGE_PASSES
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_CREATED_TMP_DISK_TABLES DESC
LIMIT 20;
```

列名和采集可用性要以目标 MySQL 版本为准。判断时使用速率和每次调用平均值，避免把实例启动以来的累计数直接当成当前故障。

---

## 11. 复杂 SQL 排查方法

### 第一步：确认结果粒度

最终是一行一个客户、一个订单，还是一个分群？每个 Join 前后的预期唯一键是什么？

### 第二步：给每个查询块单独计数

在测试或离线环境验证：

```text
base filter rows
→ first join rows
→ second join rows
→ grouped rows
→ final rows
```

### 第三步：看真实计划

重点记录：

- 每个叶子节点真实扫描行；
- Nested Loop 内层 `loops`；
- 第一个估算失真节点；
- Hash 构建输入；
- 排序/物化前的行数；
- 首行阻塞时间。

### 第四步：从最大中间集向前优化

通常优先级是：

1. 修复错误 Join 和重复；
2. 更早过滤；
3. 合适索引；
4. 必要时预聚合；
5. 减少返回列和行宽；
6. 最后评估内存参数或 Hint。

---

## 12. 改写必须通过语义回归

以下写法看似相近，却可能因 `NULL`、重复和外连接语义产生不同结果：

- `IN` 与 `EXISTS`；
- `NOT IN` 与 `NOT EXISTS`；
- `LEFT JOIN ... WHERE right.col IS NULL`；
- Join 后 `DISTINCT`；
- 先聚合再 Join；
- CTE 合并与显式临时结果。

至少准备这些测试数据：

```text
0 个匹配
1 个匹配
多个匹配
重复键
NULL
边界时间
跨租户同 ID
```

性能优化只有在业务结果完全一致时才成立。

---

## 13. 实验建议

构造三组数据：

1. 小外表 + 有索引内表；
2. 大外表 + 无索引等值 Join；
3. 严重倾斜且统计不准的 Join。

分别观察：

```sql
EXPLAIN FORMAT=TREE SELECT ...;
EXPLAIN ANALYZE FORMAT=TREE SELECT ...;
```

记录 Join 算法、顺序、真实行数、loops、首行时间和总时间。再增加/删除候选索引或改变过滤比例，观察成本决策如何改变。

---

## 14. 结论

复杂 SQL 的优化主线不是把语句拆得越短越好，而是控制数据流：

```text
尽早过滤
→ 保持正确粒度
→ 避免 Join 倍增
→ 让内层访问可控
→ 限制排序与物化输入
→ 观测内存和磁盘临时工作
```

掌握这些算子后，下一步就是把单条 SQL 分析升级成线上慢 SQL 的发现、归因、修复和回归闭环。

---

## 参考资料

- [MySQL 8.4 Reference Manual：Join Optimization](https://dev.mysql.com/doc/refman/8.4/en/join-optimization.html)
- [MySQL 8.4 Reference Manual：Hash Join Optimization](https://dev.mysql.com/doc/refman/8.4/en/hash-joins.html)
- [MySQL 8.4 Reference Manual：Subquery, Derived Table and CTE Optimization](https://dev.mysql.com/doc/refman/8.4/en/subquery-optimization.html)
- [MySQL 8.4 Reference Manual：Internal Temporary Table Use](https://dev.mysql.com/doc/refman/8.4/en/internal-temporary-tables.html)
- [MySQL 8.4 Reference Manual：ORDER BY Optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html)
