---
title: "SQL、CTE、Window、JSONB、Array 与全文检索"
sidebar_label: "05. SQL、CTE、Window、JSONB、Array 与全文检索"
sidebar_position: 5
description: "系统掌握 PostgreSQL 高级 SQL，并用执行计划约束表达力带来的成本。"
tags: [PostgreSQL, SQL, CTE, Window, JSONB]
---

# SQL、CTE、Window、JSONB、Array 与全文检索

> 版本基线：PostgreSQL 18.x。高级 SQL 的目标不是把所有功能写进一条语句，而是用最清晰的数据模型表达需求，并用执行计划证明成本可接受。

下面以订单表贯穿示例：

```sql
CREATE TABLE orders (
    order_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id  bigint NOT NULL,
    amount      numeric(14, 2) NOT NULL CHECK (amount >= 0),
    status      text NOT NULL CHECK (status IN ('created', 'paid', 'cancelled')),
    tags        text[] NOT NULL DEFAULT '{}',
    attrs       jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_account_time_idx
    ON orders (account_id, created_at DESC);
CREATE INDEX orders_attrs_gin_idx
    ON orders USING gin (attrs);
CREATE INDEX orders_tags_gin_idx
    ON orders USING gin (tags);
```

示例表用于学习，不表示 JSONB、Array 和三个索引适合所有生产订单表。索引必须由查询与写入成本共同决定。

## 1. 查询逻辑顺序：解释“为什么别名在这里不可见” {/* #查询逻辑顺序解释为什么别名在这里不可见 */}

概念顺序是 FROM/JOIN → WHERE → GROUP → HAVING → Window → SELECT → ORDER/LIMIT。理解它能解释别名可见范围和聚合后窗口计算。

```sql
SELECT account_id,
       sum(amount) AS paid_amount
FROM orders
WHERE status = 'paid'
GROUP BY account_id
HAVING sum(amount) > 10000
ORDER BY paid_amount DESC;
```

`WHERE` 在聚合前过滤行，不能使用聚合结果；`HAVING` 过滤分组；`ORDER BY` 可以看到 SELECT 别名。SQL 是声明式语言，这个顺序是理解语义的概念模型，不等于执行器必须机械按此顺序扫描——Planner 会在保持语义的前提下重写和调整计划。

### 1.1 NULL 与三值逻辑 {/* #null-与三值逻辑 */}

`col = NULL` 永远不能正确判断空值，应使用 `IS NULL`；`NOT IN` 的子查询只要包含 NULL，结果可能变成 UNKNOWN。反连接通常更清晰：

```sql
SELECT a.account_id
FROM accounts AS a
WHERE NOT EXISTS (
    SELECT 1
    FROM orders AS o
    WHERE o.account_id = a.account_id
);
```

高级语法之前先掌握 NULL、JOIN 基数和重复行，否则窗口和 JSON 查询会把错误放大。

## 2. CTE：可读性、递归与优化边界 {/* #cte可读性递归与优化边界 */}

普通 CTE 把复杂逻辑拆成有名字的步骤：

```sql
WITH paid_by_account AS (
    SELECT account_id, sum(amount) AS total
    FROM orders
    WHERE status = 'paid'
      AND created_at >= current_date - interval '30 days'
    GROUP BY account_id
)
SELECT account_id, total
FROM paid_by_account
WHERE total >= 10000
ORDER BY total DESC;
```

PostgreSQL 18 对非递归、无副作用的 CTE，单次引用时通常可以内联；多次引用时通常物化。`MATERIALIZED` 强制独立计算，`NOT MATERIALIZED` 允许与上层联合优化：

```sql
WITH recent AS NOT MATERIALIZED (
    SELECT *
    FROM orders
    WHERE created_at >= current_date - interval '7 days'
)
SELECT *
FROM recent
WHERE account_id = 42;
```

`NOT MATERIALIZED` 可能让谓词下推和索引生效，也可能重复执行昂贵表达式；`MATERIALIZED` 避免重复计算，却可能生成很大的临时结果。两者都必须比较 `EXPLAIN (ANALYZE, BUFFERS)`，不能当作固定调优口诀。

### 2.1 递归 CTE {/* #递归-cte */}

组织树、依赖图和菜单层级可以用递归 CTE：

```sql
WITH RECURSIVE org AS (
    SELECT id, parent_id, name, 0 AS depth
    FROM departments
    WHERE id = 10

    UNION ALL

    SELECT d.id, d.parent_id, d.name, o.depth + 1
    FROM departments AS d
    JOIN org AS o ON d.parent_id = o.id
)
SELECT * FROM org ORDER BY depth, id;
```

递归项必须最终停止。真实图可能有环，PostgreSQL 支持 `SEARCH` 生成深度/广度排序列，也支持 `CYCLE` 标记路径中的环。不要依赖执行过程“碰巧按广度输出”，最终顺序必须显式 `ORDER BY`。

数据修改 CTE 的子语句共享同一 Snapshot，执行顺序不可预测；只通过 `RETURNING` 结果通信。避免多个子语句修改同一行。

## 3. Window：保留明细行的组内计算 {/* #window保留明细行的组内计算 */}

Window 不合并行，在分区内计算排名、累计、前后值：

```sql
SELECT order_id,
       account_id,
       amount,
       created_at,
       sum(amount) OVER (
           PARTITION BY account_id
           ORDER BY created_at, order_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_amount,
       lag(amount) OVER (
           PARTITION BY account_id
           ORDER BY created_at, order_id
       ) AS previous_amount,
       row_number() OVER (
           PARTITION BY account_id
           ORDER BY amount DESC, order_id
       ) AS amount_rank
FROM orders
WHERE status = 'paid';
```

`PARTITION BY` 决定分组，`ORDER BY` 决定分区内顺序，Frame 决定当前行能看到的范围：

- `ROWS` 按物理行计数；
- `RANGE` 将 ORDER BY 值相同的 Peer 视作同一范围；
- `GROUPS` 按 Peer Group 计数。

有 Window ORDER BY 时默认 Frame 通常截止到当前行的最后一个 Peer，因此 `last_value` 常返回“当前 Peer 的最后值”，不是整个分区最后值。需要全分区时显式写：

```sql
last_value(amount) OVER (
    PARTITION BY account_id
    ORDER BY created_at, order_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
)
```

排序键要稳定，时间相同则补唯一键，否则 `row_number` 和累计结果可能在多次执行间变化。Window Sort/WindowAgg 可能消耗 `work_mem` 并落临时磁盘；一个查询的多个 Sort/Hash 节点可以分别使用内存，不能为了消除一次 Spill 全局盲目放大 `work_mem`。

## 4. JSONB 与 Array {/* #jsonb-与-array */}

### 4.1 JSON 还是 JSONB {/* #json-还是-jsonb */}

`json` 保留输入文本格式，每次操作重新解析；`jsonb` 以分解后的二进制形式保存，支持索引和丰富操作，通常适合查询。JSONB 不保留空白、Key 顺序和重复 Key 的全部原貌。

```sql
-- attrs = {"channel":"app","address":{"city":"Shanghai"}}
SELECT order_id,
       attrs->>'channel' AS channel,
       attrs #>> '{address,city}' AS city
FROM orders
WHERE attrs @> '{"channel":"app"}'::jsonb;
```

`->` 返回 JSON/JSONB，`->>` 返回 text；包含查询 `@>` 可利用合适的 GIN。表达式索引适合稳定热点路径：

```sql
CREATE INDEX orders_channel_idx
    ON orders ((attrs->>'channel'));
```

默认 GIN `jsonb_ops` 支持更广泛操作；`jsonb_path_ops` 更小且对部分包含/JSONPath 查询更专注，但不支持所有 Key-exists 用法。选择前列出真实 Operator，再用执行计划证明。GIN 会增加写放大、VACUUM 与空间成本。

核心主键、金额、状态、外键和高频 Join 字段应结构化并加约束。把所有字段塞进 JSONB 会失去类型约束、外键、统计精度和清晰迁移边界。

### 4.2 Array {/* #array */}

```sql
SELECT * FROM orders WHERE 'urgent' = ANY(tags);
SELECT * FROM orders WHERE tags @> ARRAY['urgent', 'vip'];
```

Array 适合小而有界、通常整体读写的同质属性，如少量标签。若元素需要独立外键、单独生命周期、频繁局部更新或无限增长，应建关联表。Array 下标默认从 1 开始，但 PostgreSQL 允许非 1 下界，外部程序不要盲目假设。

## 5. 全文检索 {/* #全文检索 */}

全文检索不是 `LIKE '%word%'` 的加速版。文档先经语言 Configuration 分词、归一化、停用词处理得到 `tsvector`；用户查询变成 `tsquery`，两者用 `@@` 匹配。

```sql
ALTER TABLE articles
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body,  '')), 'B')
) STORED;

CREATE INDEX articles_search_gin_idx
    ON articles USING gin (search_vector);

SELECT id,
       ts_rank(search_vector, websearch_to_tsquery('simple', 'postgres vacuum')) AS rank
FROM articles
WHERE search_vector @@ websearch_to_tsquery('simple', 'postgres vacuum')
ORDER BY rank DESC, id;
```

`simple` 只是示例；中文通常需要合适的分词/字典扩展或外部搜索系统。语言、同义词、停用词、权重、排序和高亮都要用业务语料评测。PostgreSQL FTS 适合事务数据旁的检索；复杂相关性、多语言分析、海量聚合和独立扩缩场景再评估 Elasticsearch/OpenSearch。

## 6. 用执行计划约束表达力 {/* #用执行计划约束表达力 */}

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, SUMMARY)
SELECT ...;
```

重点看：Estimated Rows 与 Actual Rows、循环次数、Seq/Index/Bitmap Scan、Filter 移除行、Sort Method 与 Disk、Hash Batch、Shared hit/read/dirtied、GIN Recheck、Planning/Execution Time 和 WAL。

`ANALYZE` 会真实执行语句。对 INSERT/UPDATE/DELETE/MERGE 只在测试环境运行，或在明确事务边界内执行后 `ROLLBACK`；即使回滚也会获取锁、产生 WAL/Dead Tuple 和触发器副作用，不能在生产随意使用。

### 6.1 典型判断 {/* #典型判断 */}

| 现象 | 解释方向 |
| --- | --- |
| CTE Scan 处理大量上层不要的行 | 物化阻止谓词下推，比较 NOT MATERIALIZED/改写 |
| Window Sort 落盘 | 行数/排序键过大或 work_mem 不足，先减少输入与复用排序 |
| JSONB Seq Scan | Operator 与索引不匹配、选择性差或统计不足 |
| GIN 大量 Rows Removed by Index Recheck | 候选过宽，检查表达式与数据分布 |
| Estimated 与 Actual 相差数量级 | ANALYZE、扩展统计、相关性或表达式不可见 |

## 7. 综合练习 {/* #综合练习 */}

用上述订单表完成：近 30 天每账户累计消费与排名；递归查询账户组织树并防环；筛选 JSONB Channel 与 Array Tag；建立一份文章全文索引。为每条 SQL 保存无索引/有索引或物化/非物化计划，并解释为何更快，而不只比较执行时间。

## 8. 验收题 {/* #验收题 */}

- CTE 何时成为物化边界？
- Window 与 GROUP BY 的输出行数有何不同？
- JSONB 为什么不是免设计 Schema？
- 全文检索何时应转向 Elasticsearch？
- `last_value` 为什么经常不是分区最后一行？
- `EXPLAIN ANALYZE` 为什么不能对生产写语句随便执行？

## 9. 参考资料 {/* #参考资料 */}

- [Queries](https://www.postgresql.org/docs/18/queries.html)
- [Window functions](https://www.postgresql.org/docs/18/functions-window.html)
- [JSON](https://www.postgresql.org/docs/18/datatype-json.html)
- [Arrays](https://www.postgresql.org/docs/18/arrays.html)
- [Full Text Search](https://www.postgresql.org/docs/18/textsearch.html)
