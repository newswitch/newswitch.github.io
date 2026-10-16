---
title: "Planner、统计信息、EXPLAIN ANALYZE 与 Join"
sidebar_label: "11. Planner、统计信息、EXPLAIN ANALYZE 与 Join"
sidebar_position: 11
description: "从基数估算到扫描与 Join 选择，建立 PostgreSQL 慢 SQL 证据链。"
tags: [PostgreSQL, Planner, EXPLAIN, Join]
---

# Planner、统计信息、EXPLAIN ANALYZE 与 Join

Planner 枚举可行路径，以统计估算行数和成本选择计划；Executor 执行。慢 SQL 常从某个节点 `estimated rows` 与 `actual rows` 大幅偏差开始。

## 1. 统计信息 {/* #统计信息 */}

ANALYZE 收集 null fraction、distinct、MCV、histogram 和相关性。列之间相关导致独立性假设失真时，可建立 extended statistics（dependencies/ndistinct/MCV）。统计目标越高，ANALYZE 与 catalog 成本越大。

### 1.1 从分布算出选择率

对于等值条件，若值在 MCV 中，直接使用该值的频率；否则用剩余概率质量除以剩余不同值数，作为近似。假设 null_frac=0.1，两个 MCV 的频率为 0.2、0.1，总共有 102 个非空不同值，则未列入 MCV 的一个值估计选择率为 `(1-0.1-0.2-0.1)/(102-2)=0.006`。一百万行估计 6000 行，而热门值 0.2 对应 20 万行，不能统一套用 `1/ndistinct`。

范围条件先累计满足条件的 MCV 概率，再根据不含 MCV 的直方图估计剩余部分。例如剩余质量 0.6，直方图有 4 个等频桶，阈值覆盖前两桶和第三桶的一半，则剩余贡献为 `0.6·2.5/4=0.375`。桶内插值是假设，不是对实际数据的证明；离散值、数据类型和操作符会影响估计。[PostgreSQL 行数估算例子](https://www.postgresql.org/docs/18/row-estimation-examples.html)

### 1.2 独立性错误怎样变成计划错误

假设一百万行中 `tenant=1` 占 10%，`status='new'` 也占 10%，且两者恰好是同一批行。独立相乘估计 `0.1·0.1·1000000=10000`，真实是 100000。若这批结果作为 Nested Loop 外表，内表索引探测次数也被低估十倍。`dependencies` 描述函数依赖，联合 MCV 描述常见组合，`ndistinct` 描述分组基数；它们不是可互换的旋钮，也不是对任意跨表 Join 相关性都会生效。[Extended statistics](https://www.postgresql.org/docs/18/planner-stats.html)

## 2. Join {/* #join */}

| 算法 | 适合 | 风险 |
| --- | --- | --- |
| Nested Loop | 外表小、内表有索引 | 行数低估后重复扫描巨大 |
| Hash Join | 等值、大输入 | Hash 超内存批次落盘 |
| Merge Join | 满足可 merge 的连接条件、已有序输入 | 排序成本和重复键输出规模 |

### 2.1 扫描成本的临界点 {/* #扫描成本的临界点 */}

以下只是隔离因果的教学模型，单位为 planner cost，不是毫秒。设表有 10000 页、一百万行，顺序页成本 1、逐行 CPU 成本 0.01，则全表扫描成本约 `10000+1000000·0.01=20000`。若索引选出 1000 行，每行恰好落在不同的 heap 页，随机页成本 4，索引自身遍历成本假设为 100，总成本约 `100+1000·4+1000·0.01=4110`。

当匹配行达到 10 万、且散布到几乎全部 heap 页，即便每个 heap 页只收费一次，粗略成本也达到 `100+10000·4+100000·0.01=41100`，顺序扫描更便宜。真实 planner 会考虑缓存、相关性、索引页访问和重复页；Bitmap Heap Scan 可以先收集位置再按 heap 页顺序读取，改变随机 I/O 结构。不要把“命中比例超过某个固定百分比”当通用阈值。[EXPLAIN 中的成本单位](https://www.postgresql.org/docs/18/using-explain.html)

### 2.2 Join 的工作量与输出下界

Nested Loop 粗略成本是 `外表成本 + 外表行数·内表一次探测成本 + 输出成本`。若一次探测成本 5，外表从 100 行误估成实际 10 万行，这项从 500 变成 50 万。Hash Join 把一侧建成哈希表，等值匹配通常接近扫描两侧加输出，但内存不足会分批和写临时文件；数据倾斜还可能让单个桶异常大。

Merge Join 先得到两边按连接键有序的输入，再推进游标；若没有可复用顺序，需支付大约 `N log N + M log M` 的排序代价。对同一个连接键，左边 a 行、右边 b 行必须输出 `a·b` 行：两边各一万条相同键会产生一亿条结果，不能用“Hash/Merge 是线性”忽略输出下界。PostgreSQL 的可用 Merge Join 条件由操作符的 merge-joinability 决定，不是所有 `<` 范围连接都能直接执行 Merge Join。

## 3. EXPLAIN {/* #explain */}

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, VERBOSE)
SELECT ...;
```

`ANALYZE` 真正执行语句，写操作只在可回滚测试事务/环境使用。逐节点看 actual time/loops/rows、Rows Removed、Heap Fetches、Buffers、Sort Method、temp read/write 和 WAL。

## 4. 参数化计划 {/* #参数化计划 */}

Prepared statement 可能在 custom 与 generic plan 间选择。数据倾斜时一个通用计划不适合所有参数，需用 `pg_stat_statements` 和带代表值的计划比较，不能全局禁用缓存。

## 5. 定位流程 {/* #定位流程 */}

```text
top SQL by total time/P99
→ capture exact SQL+bind shape
→ explain with realistic data/cache
→ first large estimate error or spill
→ statistics/schema/query/index fix
→ regression benchmark
```

## 6. 计划偏差的证据链 {/* #计划偏差的证据链 */}

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, SETTINGS, FORMAT TEXT)
SELECT ...;

SELECT attname, n_distinct, null_frac, most_common_vals
FROM pg_stats WHERE schemaname='public' AND tablename='orders';
```

`EXPLAIN ANALYZE` 会真实执行语句；对写语句应在可回滚事务或副本/预发中运行。定位时比较每个节点 estimated rows 与 actual rows，误差从最早出现的位置向上放大。再检查统计信息新鲜度、列相关性、参数值、数据倾斜和类型转换。

可以用 extended statistics 描述列间依赖/多列 distinct，但不能把调高全局统计目标当万能方案。临时关闭 join 方法只用于验证假设，不应作为长期配置。计划稳定性必须用生产参数分布和冷/热缓存分别测试，并把规划时间与执行时间分开观察。

## 7. 验收题 {/* #验收题 */}

- 估算错误为什么会改变 Join 顺序？
- Hash Join 什么时候落盘？
- `EXPLAIN ANALYZE` 的 loops 怎样解读？
- Generic plan 为什么可能拖慢倾斜参数？
- 如何用 MCV、null fraction 和剩余 distinct 手算一个非热门值的选择率？
- 为什么列相关性误差会放大成 Nested Loop 探测次数误差？
- 为什么重复连接键能让输入线性的算法产生平方量级输出？

## 8. 参考资料 {/* #参考资料 */}

- [Using EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html)
- [Planner statistics](https://www.postgresql.org/docs/18/planner-stats.html)
