---
title: "从 CRUD 到 Join、聚合、CTE 与窗口函数"
sidebar_label: "05. 从 CRUD 到 Join、聚合、CTE 与窗口函数"
sidebar_position: 5
description: "使用订单模型系统学习 SELECT、INSERT、UPDATE、DELETE、Join、聚合、子查询、CTE 和窗口函数，并建立正确性与执行计划意识。"
tags: [MySQL, SQL, CRUD, Join, CTE, 窗口函数]
---

# 从 CRUD 到 Join、聚合、CTE 与窗口函数

SQL 是声明式语言：你描述需要什么结果，优化器决定怎样执行。写出能运行的 SQL 只是第一步，还要保证：

- 结果语义正确；
- NULL、重复行和边界条件明确；
- 事务范围正确；
- 扫描行数与返回行数合理；
- 有稳定排序；
- 参数不通过字符串拼接；
- 能用执行计划和测试数据验证。

本篇使用上一章的 `shop` Schema。

## 1. 准备实验数据

```sql
USE shop;

INSERT INTO customers(email, display_name) VALUES
  ('alice@example.com', 'Alice'),
  ('bob@example.com',   'Bob'),
  ('carol@example.com', 'Carol');

INSERT INTO orders
  (order_no, customer_id, status, currency, total_amount, created_at)
VALUES
  ('O202608140001', 1, 1, 'CNY', 120.50, '2026-08-14 09:00:00'),
  ('O202608140002', 1, 2, 'CNY',  88.00, '2026-08-14 10:00:00'),
  ('O202608140003', 2, 2, 'CNY', 299.00, '2026-08-14 11:00:00');
```

实验数据很小，只能验证语义，不能证明性能。性能结论必须使用接近生产基数和数据分布的数据集。

## 2. `SELECT` 的逻辑组成

```sql
SELECT customer_id, order_no, total_amount
FROM orders
WHERE status = 2
ORDER BY created_at DESC
LIMIT 20;
```

各部分职责：

| 子句 | 作用 |
| --- | --- |
| `SELECT` | 选择输出表达式 |
| `FROM` | 指定数据来源 |
| `WHERE` | 在分组前过滤行 |
| `GROUP BY` | 形成分组 |
| `HAVING` | 过滤分组结果 |
| `ORDER BY` | 定义输出顺序 |
| `LIMIT` | 限制最终返回行数 |

SQL 文本顺序不等于内部物理执行顺序；优化器可以在保持语义的前提下重排访问路径。

## 3. 只查询需要的列

避免把 `SELECT *` 作为长期接口：

- Schema 新增列会改变返回结构和流量；
- 读取大文本/JSON 增加网络和内存；
- 可能失去覆盖索引机会；
- Join 时产生同名列；
- 应用对列顺序形成隐式依赖。

显式列：

```sql
SELECT id, order_no, status, total_amount
FROM orders
WHERE id = 1;
```

交互探索可以使用 `*`，稳定 API 和批处理应明确列契约。

## 4. `WHERE` 与三值逻辑

常见过滤：

```sql
WHERE status = 2
WHERE total_amount >= 100.00
WHERE created_at >= '2026-08-01' AND created_at < '2026-09-01'
WHERE status IN (1, 2)
WHERE deleted_at IS NULL
```

时间范围推荐左闭右开：

```text
[2026-08-01 00:00:00, 2026-09-01 00:00:00)
```

它避免手工构造“月底 23:59:59.999999”并更适合分区和索引范围。

### 4.1 NULL {/* #null */}

```sql
WHERE column IS NULL
WHERE column IS NOT NULL
```

普通比较遇到 NULL 的结果可能是 UNKNOWN，`WHERE` 只保留 TRUE。测试必须包含 NULL 数据。

## 5. `ORDER BY` 与稳定结果

没有 `ORDER BY`，关系结果没有承诺固定顺序。即使多次运行看起来相同，也可能因执行计划、并发和存储状态变化。

排序列可能不唯一时增加稳定 Tie-breaker：

```sql
SELECT id, order_no, created_at
FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

这对分页尤其重要。只按 `created_at` 排序时，同一微秒的多行顺序不确定。

## 6. `INSERT`

明确列名：

```sql
INSERT INTO customers(email, display_name)
VALUES ('dave@example.com', 'Dave');
```

批量插入：

```sql
INSERT INTO customers(email, display_name) VALUES
  ('erin@example.com',  'Erin'),
  ('frank@example.com', 'Frank');
```

明确列名能抵抗列顺序变化，也能说明依赖哪些默认值。

### 6.1 插入失败是约束在保护数据 {/* #插入失败是约束在保护数据 */}

可能原因：

- 唯一键重复；
- 外键不存在；
- NOT NULL；
- 类型超范围；
- 字符集无法编码；
- Check Constraint；
- 权限或只读状态。

应用应根据错误码处理，不要把所有失败无限重试。

## 7. `UPDATE` 的安全边界

```sql
UPDATE orders
SET status = 2,
    updated_at = CURRENT_TIMESTAMP(6)
WHERE id = 1
  AND status = 1;
```

`AND status = 1` 是乐观状态保护：只有处于预期旧状态才修改。

随后检查受影响行数。零行可能表示：

- 订单不存在；
- 状态已经变化；
- 条件类型/字符集不匹配；
- 连接了错误实例或 Schema。

### 7.1 生产更新前 {/* #生产更新前 */}

1. 在同一事务和相同条件下先 `SELECT`；
2. 确认实例身份与读写角色；
3. 用唯一键或可控范围限制；
4. 估算匹配行、锁、Redo、Binlog 与复制影响；
5. 设计回滚或反向修复；
6. 大批量修改分批，并在每批间观测。

没有 `WHERE` 的 `UPDATE` 会修改全表，是高风险写操作。

## 8. `DELETE` 与业务删除

```sql
DELETE FROM orders
WHERE id = 100
  AND status = 0;
```

删除不是“立刻释放所有磁盘空间”。它会产生 Undo、Redo、Binlog、锁和后台清理，并影响复制与备份。

业务要选择：

- 物理删除；
- 软删除标记；
- 归档到历史表/对象存储；
- 按保留策略批量清理。

软删除会让所有查询和唯一性规则更复杂，也不是默认最佳方案。

误删恢复通常依赖备份 + Binlog PITR，不应承诺“执行 ROLLBACK 就能恢复已提交删除”。

## 9. `JOIN`：把关系重新组合

### 9.1 INNER JOIN {/* #inner-join */}

只保留双方匹配：

```sql
SELECT
  o.order_no,
  c.email,
  o.total_amount
FROM orders AS o
JOIN customers AS c
  ON c.id = o.customer_id
WHERE o.status = 2;
```

### 9.2 LEFT JOIN {/* #left-join */}

保留左表所有行，右侧没有匹配时为 NULL：

```sql
SELECT
  c.id,
  c.email,
  o.order_no
FROM customers AS c
LEFT JOIN orders AS o
  ON o.customer_id = c.id;
```

### 9.3 `ON` 与 `WHERE` 的区别 {/* #on-与-where-的区别 */}

在 Outer Join 中，把右表过滤条件放在 `WHERE` 可能把 NULL 行过滤掉，语义退化为 Inner Join。

```sql
-- 保留没有已完成订单的客户
SELECT c.id, c.email, o.order_no
FROM customers AS c
LEFT JOIN orders AS o
  ON o.customer_id = c.id
 AND o.status = 2;
```

Join 正确性测试必须包含：无匹配、一对多、多对多和 NULL。

## 10. 重复行不是数据库“随机重复”

一位客户有两个订单，Join 后出现两行是关系基数的自然结果。

不要遇到重复就加 `DISTINCT`。先回答：

- 哪一侧是一对多？
- Join 条件是否缺列？
- 业务需要一行客户、每个订单一行，还是每个明细一行？
- 是否应该先聚合子表？

`DISTINCT` 可能掩盖错误 Join，并增加排序/去重成本。

## 11. 聚合与 `GROUP BY`

```sql
SELECT
  customer_id,
  COUNT(*)          AS order_count,
  SUM(total_amount) AS total_spent,
  AVG(total_amount) AS avg_order_amount
FROM orders
WHERE status = 2
GROUP BY customer_id;
```

### 11.1 `WHERE` 与 `HAVING` {/* #where-与-having */}

```sql
SELECT customer_id, SUM(total_amount) AS total_spent
FROM orders
WHERE status = 2
GROUP BY customer_id
HAVING SUM(total_amount) >= 100.00;
```

- `WHERE` 先过滤输入行；
- `HAVING` 过滤分组结果。

能在分组前过滤的条件通常放 `WHERE`，既符合语义也减少工作量。

### 11.2 COUNT 的区别 {/* #count-的区别 */}

```sql
COUNT(*)       -- 行数
COUNT(column)  -- 非 NULL 值数量
COUNT(DISTINCT column)
```

三者语义和成本不同。

## 12. `ONLY_FULL_GROUP_BY`

严格分组语义要求非聚合输出列与分组之间具有合法函数依赖，避免从一个分组中任意取值。

不要通过关闭 SQL Mode 让模糊查询“能跑”。应修正查询：

- 把列加入合理分组；
- 使用明确聚合；
- 先在子查询/CTE 得到目标粒度；
- 重新确认业务真正需要哪一行。

生产应用应固定并测试 SQL Mode，避免不同环境行为不一致。

## 13. 子查询

```sql
SELECT id, email
FROM customers
WHERE id IN (
  SELECT customer_id
  FROM orders
  WHERE status = 2
);
```

子查询可能被优化器重写为 Semi-Join、物化或其他计划。不能因为“子查询看起来慢”就机械改 Join，也不能假设等价 SQL 总有相同计划。

相关子查询会引用外层行：

```sql
SELECT c.id, c.email
FROM customers AS c
WHERE EXISTS (
  SELECT 1
  FROM orders AS o
  WHERE o.customer_id = c.id
    AND o.status = 2
);
```

只判断存在性时，`EXISTS` 能清楚表达业务意图；最终仍用执行计划和真实数据验证。

## 14. CTE 组织复杂查询

```sql
WITH completed_orders AS (
  SELECT customer_id, total_amount
  FROM orders
  WHERE status = 2
),
customer_totals AS (
  SELECT customer_id, SUM(total_amount) AS total_spent
  FROM completed_orders
  GROUP BY customer_id
)
SELECT c.id, c.email, t.total_spent
FROM customer_totals AS t
JOIN customers AS c ON c.id = t.customer_id
WHERE t.total_spent >= 100.00;
```

CTE 提升可读性和分层表达，不自动保证更快。优化器可能合并或物化它；复杂查询仍要查看计划和实际执行。

递归 CTE 可处理层级/序列，但必须设计终止条件和深度限制，避免无限或爆炸式结果。

## 15. 窗口函数保留明细粒度

`GROUP BY` 把多行收缩为每组一行；窗口函数在保留明细行的同时计算分组指标。

例如每位客户按时间给订单编号：

```sql
SELECT
  customer_id,
  order_no,
  total_amount,
  created_at,
  ROW_NUMBER() OVER (
    PARTITION BY customer_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
FROM orders;
```

每位客户最近一单：

```sql
WITH ranked AS (
  SELECT
    o.*,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM orders AS o
)
SELECT id, order_no, customer_id, total_amount
FROM ranked
WHERE rn = 1;
```

其他常用函数：

- `RANK()` / `DENSE_RANK()`；
- `LAG()` / `LEAD()`；
- `SUM() OVER (...)`；
- 滑动窗口与累计值。

窗口通常需要分区和排序，可能使用临时结构。大数据量要验证执行计划、内存和磁盘临时表。

## 16. 事务中的多步修改

订单创建往往包含多表写：

```sql
START TRANSACTION;

INSERT INTO orders
  (order_no, customer_id, status, currency, total_amount)
VALUES
  ('O202608140004', 3, 1, 'CNY', 66.00);

-- 还可能插入 order_items、扣减库存等

COMMIT;
```

异常时：

```sql
ROLLBACK;
```

事务边界要覆盖必须原子成功的一组数据库变化，但不能无限扩大：长事务会持锁、保留 Undo、增加冲突并拖慢恢复。

事务不能自动回滚外部 HTTP、短信或 Kafka 已发生动作。跨系统一致性需要 Outbox、幂等和补偿等设计。

## 17. Prepared Statement 与参数

应用不要拼接：

```text
"SELECT * FROM orders WHERE order_no = '" + userInput + "'"
```

应使用驱动参数：

```text
SELECT id, status, total_amount
FROM orders
WHERE order_no = ?
```

参数化主要保护 SQL 结构并改善类型处理。它不自动让每条查询变快，也不能参数化任意表名、列名或排序方向；动态标识符需要白名单映射。

## 18. 先看执行计划

```sql
EXPLAIN
SELECT id, order_no, total_amount
FROM orders
WHERE customer_id = 1
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

初学先观察：

- 访问表顺序；
- 使用的索引；
- 访问类型；
- 预计扫描行；
- 过滤比例；
- 是否额外排序/临时表。

`EXPLAIN ANALYZE` 会实际执行查询并提供真实计时/行数信息。对写语句或昂贵查询使用前必须确认语义和环境，不能在生产随意执行来“看一下”。

详细执行计划将在优化器模块展开。

## 19. LIMIT 不能自动让查询便宜

```sql
SELECT ...
FROM orders
WHERE status = 2
ORDER BY created_at DESC
LIMIT 20;
```

如果没有合适索引，MySQL 可能先扫描/排序大量行，再取 20 行。返回少不等于扫描少。

深分页：

```sql
LIMIT 100000, 20
```

可能需要扫描并丢弃大量前置记录。稳定排序下可使用 Keyset/Seek Pagination：

```sql
WHERE (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

索引必须与过滤和排序模式配合，后续单篇深入。

## 20. SQL 正确性测试集

每条重要查询至少覆盖：

```text
空表
一行
多行
NULL
重复业务值
边界时间
大小写/Unicode
一对多和无匹配 Join
并发修改
大基数与数据倾斜
```

只用三行“漂亮数据”无法发现 Join 放大、NULL、排序不稳定和计划退化。

## 21. 常见错误

| 错误 | 后果 |
| --- | --- |
| 长期使用 `SELECT *` | 契约、流量和索引不可控 |
| 无 `ORDER BY` 依赖返回顺序 | 结果不稳定 |
| `= NULL` | 三值逻辑导致条件不成立 |
| Outer Join 过滤写错位置 | 无匹配行被意外删除 |
| 用 `DISTINCT` 掩盖重复 | 隐藏错误 Join 并增加成本 |
| 关闭严格 SQL Mode | 模糊或错误数据进入系统 |
| 直接拼接参数 | SQL 注入和类型问题 |
| 大事务一次改全表 | 锁、日志、复制和恢复压力 |
| 看到 LIMIT 就认为扫描少 | 可能仍全表扫描和排序 |
| 只看 SQL 不看计划 | 无法证明真实访问路径 |

## 22. 综合实验

1. 为每位客户查询最近 20 个订单；
2. 找出没有订单的客户；
3. 统计已完成订单的客户总金额；
4. 使用 CTE 筛选累计消费大于阈值的客户；
5. 使用窗口函数获得每位客户最近一单；
6. 在事务中修改订单状态并执行回滚；
7. 使用错误的 Outer Join 过滤位置，比较结果差异；
8. 为关键查询执行 `EXPLAIN`，记录索引和预计行数；
9. 生成更多数据，再比较语义正确与性能可接受是否同时成立。

## 23. 第一模块验收

完成前五篇后，你应该能够：

- 搭建并证明 MySQL 8.4 LTS 实验实例身份；
- 使用非 Root 账户安全连接；
- 创建字符集、类型和主键合理的 Schema；
- 写 CRUD、Join、聚合、子查询、CTE 与窗口函数；
- 理解 Session、自动提交和显式事务；
- 从系统 Schema 找到元数据与运行状态；
- 用 `EXPLAIN` 开始验证访问路径；
- 说明一条 SQL 从客户端到 InnoDB 的主要阶段。

下一模块进入 Schema 与应用设计：约束、范式、Online DDL、连接池、超时和重试。

## 24. 官方参考 {/* #官方参考 */}

- [SELECT Statement](https://dev.mysql.com/doc/refman/8.4/en/select.html)
- [Data Manipulation Statements](https://dev.mysql.com/doc/refman/8.4/en/sql-data-manipulation-statements.html)
- [JOIN Clause](https://dev.mysql.com/doc/refman/8.4/en/join.html)
- [Common Table Expressions](https://dev.mysql.com/doc/refman/8.4/en/with.html)
- [Window Functions](https://dev.mysql.com/doc/refman/8.4/en/window-functions.html)
- [EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
