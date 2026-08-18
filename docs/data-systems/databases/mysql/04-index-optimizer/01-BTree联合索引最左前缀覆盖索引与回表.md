---
title: "B+Tree、联合索引、最左前缀、覆盖索引与回表"
sidebar_label: "01. B+Tree、联合索引、最左前缀、覆盖索引与回表"
sidebar_position: 1
description: "从访问路径而不是口诀出发，理解 InnoDB B+Tree、联合索引边界、回表、索引下推和生产索引设计方法。"
tags: [MySQL, InnoDB, B+Tree, 联合索引, 覆盖索引]
---

# B+Tree、联合索引、最左前缀、覆盖索引与回表

索引不是“给字段加速”的开关，而是预先维护的一种有序数据结构。一次查询是否高效，取决于索引能否同时减少扫描范围、回表次数、排序工作和读取数据量，也取决于维护这些索引带来的写入成本。

本文使用下面的订单表贯穿全文：

```sql
CREATE TABLE orders (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  customer_id  BIGINT UNSIGNED NOT NULL,
  status       TINYINT UNSIGNED NOT NULL,
  created_at   DATETIME(6) NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  remark       VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_tenant_status_created
      (tenant_id, status, created_at, id)
) ENGINE=InnoDB;
```

## 1. 先把查询转换成访问问题

面对一条 SQL，先回答四个问题：

1. 用哪些条件缩小候选行范围？
2. 要按什么顺序返回？
3. 最终需要读取哪些列？
4. 预计命中多少行、返回多少行？

例如：

```sql
SELECT id, created_at, amount_cents
FROM orders
WHERE tenant_id = 42
  AND status = 1
  AND created_at >= '2026-08-01'
ORDER BY created_at, id
LIMIT 100;
```

理想访问路径不是“使用了索引”这么简单，而是：

```text
在索引中定位 tenant_id=42、status=1 的起点
→ 沿 created_at 范围顺序扫描
→ 天然满足 ORDER BY
→ 读满 100 行立即停止
→ 若返回列都在索引中，则不回表
```

## 2. 为什么是 B+Tree

InnoDB 的聚簇索引和普通二级索引都使用 B+Tree 组织 Page。它不是二叉树，一个非叶子页可以保存许多键和子页指针，因此树的扇出很大、通常不需要很多层。

```text
                    Root Page
             /          |          \
       Branch Page  Branch Page  Branch Page
          /  \           ...          /  \
      Leaf ⇄ Leaf ⇄ Leaf ⇄ Leaf ⇄ Leaf
```

B+Tree 适合数据库访问的原因包括：

- 从根到叶可以完成等值定位；
- 叶子按键顺序组织，适合范围扫描；
- 相邻叶子可以连续遍历，适合排序、前缀和区间查询；
- Page 是缓存和 I/O 单位，较高扇出降低随机页访问层数。

“树高只有几层”不等于查询只做几次 I/O。根和上层页通常已在 Buffer Pool 中，而范围扫描、回表和冷数据才可能带来大量页访问。应关注实际扫描行数、访问页数和缓存命中，而不是背固定树高。

## 3. 聚簇索引与二级索引保存什么

聚簇索引叶子保存完整行：

```text
PRIMARY KEY B+Tree leaf
[id | tenant_id | customer_id | status | created_at | amount | remark]
```

二级索引叶子保存二级键和主键：

```text
idx_tenant_status_created leaf
[tenant_id | status | created_at | id]
```

因此下面的查询如果还要读取 `amount_cents`：

```sql
SELECT id, created_at, amount_cents
FROM orders
WHERE tenant_id = 42
  AND status = 1;
```

可能经历：

```text
扫描二级索引
→ 得到每行主键 id
→ 使用 id 查聚簇索引
→ 取 amount_cents
```

第二次访问叫做回表。回表不是天然很慢，但“大量、离散、冷数据回表”会增加 Buffer Pool 压力和随机 I/O。

## 4. 联合索引其实是字典序

索引 `(tenant_id, status, created_at, id)` 的排序方式类似：

```text
先按 tenant_id
  相同 tenant_id 内按 status
    相同 status 内按 created_at
      相同 created_at 内按 id
```

因此以下前缀具有连续区间：

- `(tenant_id)`；
- `(tenant_id, status)`；
- `(tenant_id, status, created_at)`；
- 完整四列。

而只给 `status` 或只给 `created_at`，并不能直接得到整棵树中的单个连续定位区间。这就是最左前缀的结构来源，不是一条孤立口诀。

```sql
-- 能形成清晰的联合索引访问范围
WHERE tenant_id = 42
WHERE tenant_id = 42 AND status = 1
WHERE tenant_id = 42 AND status = 1
  AND created_at >= '2026-08-01'

-- 通常不能把该联合索引当作普通 status 索引直接定位
WHERE status = 1
```

优化器是否选择某个索引仍由成本决定。小表、低选择性条件或需要读取大部分行时，全表扫描可能更便宜；不要把“可使用”误解成“一定使用”。

## 5. 范围条件之后的列是否完全失效

常见说法是“联合索引遇到范围就停止”，这句话不够精确。至少要区分四种作用：

1. **构造索引扫描边界**：决定从哪里开始、在哪里结束；
2. **索引条件下推**：在索引记录层过滤，减少回表；
3. **覆盖读取**：即使不能缩小边界，列仍可能直接从索引取得；
4. **提供顺序**：是否能消除额外排序要结合前导列和排序方向判断。

例如索引 `(tenant_id, created_at, status, id)`：

```sql
SELECT id
FROM orders
WHERE tenant_id = 42
  AND created_at >= '2026-08-01'
  AND status = 1;
```

`tenant_id` 和 `created_at` 可以形成扫描区间；`status` 未必继续收紧连续边界，但可能通过 Index Condition Pushdown 在存储引擎读取索引记录时过滤。最终必须用 `EXPLAIN` 和 `EXPLAIN ANALYZE` 验证，而不是只从 SQL 文本推测。

## 6. 选择性不是“高的列永远放前面”

选择性可粗略表示为：

```text
distinct values / total rows
```

但联合索引列顺序不能只按单列选择性排序，还要综合：

- 高频查询的等值条件；
- 范围条件；
- `ORDER BY` / `GROUP BY`；
- 返回列能否覆盖；
- 租户隔离等固定前缀；
- 多条核心 SQL 能否共享索引；
- 数据分布与热点。

对典型 OLTP 查询，可以从下面的思路开始，而不是当作绝对规则：

```text
固定等值前缀
→ 主要范围或排序列
→ 稳定排序键
→ 少量值得覆盖的列
```

如果不同业务 SQL 的过滤和排序完全不同，强行用一个超宽索引覆盖所有需求，往往会伤害写入和缓存效率。

## 7. 覆盖索引与回表代价

若查询所需列全部在某个索引中，执行器可以直接读取索引：

```sql
SELECT id, created_at
FROM orders
WHERE tenant_id = 42
  AND status = 1
ORDER BY created_at, id
LIMIT 100;
```

`idx_tenant_status_created` 已包含所有列，这是一条可能的覆盖访问路径。传统 `EXPLAIN` 的 `Extra` 常出现 `Using index`。

覆盖索引的收益：

- 减少聚簇索引访问；
- 更小的记录可能使每页容纳更多条目；
- 对扫描许多候选、只返回少量列的查询尤其有效。

代价也必须计入：

- 索引空间增大；
- `INSERT`、`DELETE` 和相关列 `UPDATE` 要维护更多树；
- Page 分裂、redo 和复制流量增加；
- 更宽索引挤占 Buffer Pool；
- DDL、备份和恢复时间上升。

不要为了消灭一次低频回表，把大文本或大量展示列塞进索引。

## 8. 常见的索引失效与访问范围扩大

### 8.1 对索引列计算

```sql
-- 不利于直接使用 created_at 的有序性
WHERE DATE(created_at) = '2026-08-01'

-- 改写成半开区间
WHERE created_at >= '2026-08-01 00:00:00'
  AND created_at <  '2026-08-02 00:00:00'
```

确实需要表达式访问时，可以评估生成列或函数索引，但仍需考虑写入成本与语义一致性。

### 8.2 隐式类型或字符集转换

连接列的数据类型、长度、字符集和排序规则不一致，可能引入转换并破坏理想访问路径。建模阶段就应统一关联键定义。

### 8.3 前导通配符

```sql
WHERE remark LIKE '%timeout%'
```

普通 B+Tree 无法从一个确定前缀开始定位。全文检索、倒排索引或专用检索系统通常更合适。

### 8.4 低选择性不等于永远不能建索引

`status` 只有少数值，但 `(tenant_id, status, created_at)` 可能正好满足某个租户中某状态的最近订单查询。判断对象应是整个访问模式，而不是孤立单列。

## 9. 重复索引、冗余索引与不可见索引

已有 `(a, b, c)` 时，单独的 `(a)` 常常是冗余候选，但不能仅凭前缀关系立即删除：

- 短索引更小，某些扫描可能成本更低；
- 唯一性语义可能不同；
- 查询、锁行为和执行计划需要验证；
- 外键约束可能依赖索引。

先查索引定义和使用情况：

```sql
SHOW INDEX FROM orders;

SELECT *
FROM sys.schema_redundant_indexes
WHERE table_schema = DATABASE()
  AND table_name = 'orders';
```

MySQL 支持不可见索引，可用于验证优化器不再选择它时的影响：

```sql
ALTER TABLE orders
  ALTER INDEX idx_tenant_status_created INVISIBLE;

-- 验证完成后恢复或删除
ALTER TABLE orders
  ALTER INDEX idx_tenant_status_created VISIBLE;
```

不可见不代表没有维护成本，也不能替代完整回归；它仍随写入更新。

## 10. 一套可执行的索引设计流程

### 10.1 第一步：用真实工作负载分组 {/* #第一步用真实工作负载分组 */}

按 SQL digest 汇总调用次数、总耗时、扫描行数和返回行数，不要只优化偶发样例。

### 10.2 第二步：写出访问契约 {/* #第二步写出访问契约 */}

```text
过滤列：tenant_id = ? AND status = ?
范围列：created_at >= ?
排序列：created_at, id
返回列：id, created_at, amount_cents
每次返回：100
调用频率：高
```

### 10.3 第三步：设计最小候选索引 {/* #第三步设计最小候选索引 */}

先满足核心过滤与排序，再评估是否值得加入少量覆盖列。

### 10.4 第四步：比较计划和真实执行 {/* #第四步比较计划和真实执行 */}

```sql
EXPLAIN FORMAT=TREE
SELECT ...;

EXPLAIN ANALYZE
SELECT ...;
```

观察估算与真实行数、循环次数、排序、回表和总延迟。

### 10.5 第五步：在接近生产的数据分布下压测 {/* #第五步在接近生产的数据分布下压测 */}

小数据上“0.00 秒”没有代表性。至少比较：

- 冷缓存与热缓存；
- 常见租户与超大租户；
- 命中 0、少量和大量行；
- 读延迟与写入吞吐；
- 索引增加后的空间和 DDL 时间。

### 10.6 第六步：灰度、观察、可回滚 {/* #第六步灰度观察可回滚 */}

记录建索引前后的计划、P95/P99、扫描/返回比和写入代价，保留明确回滚条件。

## 11. 实验：看见回表与覆盖

先执行只读取索引列的查询：

```sql
EXPLAIN ANALYZE
SELECT id, created_at
FROM orders
WHERE tenant_id = 42
  AND status = 1
  AND created_at >= '2026-08-01'
ORDER BY created_at, id
LIMIT 100;
```

再加入非索引列：

```sql
EXPLAIN ANALYZE
SELECT id, created_at, amount_cents, remark
FROM orders
WHERE tenant_id = 42
  AND status = 1
  AND created_at >= '2026-08-01'
ORDER BY created_at, id
LIMIT 100;
```

对比：

- 计划中的访问方式；
- 实际读取和返回行数；
- 首行与全部结果耗时；
- Buffer Pool 已热和重启实验实例后的差异。

不要为了实验在生产执行会扫描海量数据的 `EXPLAIN ANALYZE`，因为它会真正运行查询。

## 12. 排查速查表

| 现象 | 优先验证 | 常见方向 |
|---|---|---|
| 明明有索引却全表扫 | 选择性、统计信息、类型转换、读取比例 | 更新统计、改写条件、重新设计索引 |
| `rows` 很小但仍慢 | 等待、回表、随机 I/O、返回大字段 | 查实际计划与等待事件 |
| 扫描行远大于返回行 | 联合索引边界、ICP、残余过滤 | 调整列顺序或查询条件 |
| `ORDER BY` 慢 | 索引顺序、方向、过滤前缀 | 让访问顺序与排序契约一致 |
| 写入突然变慢 | 索引数量、键宽、热点页 | 删除无价值索引、分散热点 |
| 加索引后计划仍不稳定 | 数据倾斜、基数误估、参数差异 | 统计信息、直方图、分布测试 |

## 13. 结论

掌握索引的核心不是背“最左匹配”，而是能从 B+Tree 的字典序推导：扫描边界在哪里、要扫描多少索引记录、是否回表、能否提供顺序，以及为了这条读路径要付出多少写放大。

下一篇将用 `EXPLAIN` 和 `EXPLAIN ANALYZE` 把这些推导变成可验证的执行证据。

## 14. 参考资料 {/* #参考资料 */}

- [MySQL 8.4 Reference Manual：How MySQL Uses Indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html)
- [MySQL 8.4 Reference Manual：Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [MySQL 8.4 Reference Manual：InnoDB and MyISAM Index Statistics](https://dev.mysql.com/doc/refman/8.4/en/index-statistics.html)
- [MySQL 8.4 Reference Manual：Optimizing InnoDB Queries](https://dev.mysql.com/doc/refman/8.4/en/optimizing-innodb-queries.html)
