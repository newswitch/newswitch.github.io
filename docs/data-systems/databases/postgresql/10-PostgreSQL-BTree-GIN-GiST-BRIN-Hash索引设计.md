---
title: "B-Tree、GIN、GiST、BRIN、Hash 与索引设计"
sidebar_label: "10. B-Tree、GIN、GiST、BRIN、Hash 与索引设计"
sidebar_position: 10
description: "按访问模式、排序、选择性、写放大和空间选择 PostgreSQL 索引。"
tags: [PostgreSQL, Index, BTree, GIN, GiST, BRIN]
---

# B-Tree、GIN、GiST、BRIN、Hash 与索引设计

| 方法 | 擅长 | 典型场景 |
| --- | --- | --- |
| B-Tree | 等值、范围、排序 | 主键、时间范围、组合条件 |
| GIN | 一个值含多个 token | JSONB、Array、全文 |
| GiST | 可扩展空间/范围 | range、geometry、相似度 |
| BRIN | 物理顺序相关的大表 | 追加时间序列 |
| Hash | 等值 | 特定等值访问 |

## 1. 组合索引 {/* #组合索引 */}

B-Tree 列顺序决定能多有效地缩小扫描范围。按真实 WHERE、JOIN、ORDER BY 设计，等值列与范围/排序列顺序需用计划证明。`INCLUDE` 可覆盖返回列，但扩大索引和写成本。

Partial index 只索引满足稳定 predicate 的行；查询条件必须能被优化器证明蕴含 predicate。Expression index 加速表达式，但函数需满足可索引属性且写入会计算。

### 1.1 B-Tree 为什么能范围扫描

内部页保存边界键和下层页指针，叶页保存有序 key 与指向 heap tuple 的 TID；同层页面还有链接。教学例子中，根页以 40 为分界，左叶页为 `[10,20,30]`，右叶页为 `[40,50,60]`。查 `[25,55)` 先下降到左叶页的 30，再沿叶页链读 40、50，到 60 停止，不必从根重新查每一个值。复杂度应写成树高、命中叶页、heap 访问和输出成本的组合，不只是 `O(log N)`。

叶页装不下新项时会 split，并向父页插入新 downlink；父页也可能 split，最后可能长出新根。并发读写还依赖页面锁、边界与链接协议，不能把修改一个数组的算法当成完整数据库实现。MVCC 下，同一个业务行的多个物理版本可以有不同 TID，找到 key 仍不等于该版本对查询快照可见。[PostgreSQL B-Tree implementation](https://www.postgresql.org/docs/18/btree.html#BTREE-IMPLEMENTATION)

对 `(tenant_id, created_at)`，先固定 tenant 再限制时间，可以形成连续区间；只限制时间时，不同 tenant 的时间段分散。这里是“扫描范围可能变大”，不是“缺最左列就绝对不可用”。PostgreSQL 18 的 skip scan 可在前导列 distinct 较少时通过重复定位利用后续条件；是否值得做仍由成本决定。[Multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)

### 1.2 其他索引到底存了什么

GIN 为多值对象提取 key，key 对应 TID posting list 或 posting tree。数组包含 a、b 的查询可以相交两个 posting 集合；不是每个完整数组都作为一个排序键。常见 key 的长 posting、待合并 pending list 和操作符所需 recheck 都会影响成本。[GIN 结构](https://www.postgresql.org/docs/18/gin.html)

GiST 由操作符类定义压缩、union、consistent 等规则。以空间对象为例，内部 bounding box 不相交可以排除整棵子树，相交却不保证叶对象真正相交，因此需要精确确认。Hash 保存哈希值与行位置，适合等值而不提供原值顺序，碰撞仍需确认等值；不能因为哈希桶相同就认定值相同。[Index types](https://www.postgresql.org/docs/18/indexes-types.html)

BRIN 给一段连续 heap 页保存摘要，例如时间 min/max。假设范围 R1 的时间是 `[1,10]`、R2 是 `[11,20]`，查询时间 15 可排除 R1，但 R2 的所有相关页仍需读取和逐行确认。若每段都混入时间 1 和 20，两段都不能排除：它小，是因为存页范围摘要，不是因为能以很少元数据精确定位每一行。[BRIN 原理](https://www.postgresql.org/docs/18/brin.html)

## 2. 成本 {/* #成本 */}

每个索引增加 INSERT/UPDATE/DELETE、WAL、Vacuum、缓存和备份成本。低选择性列不一定无用，组合/partial 可能有效；高选择性也不保证优化器一定选择索引，若返回大量行顺序扫描可能更便宜。

### 2.1 覆盖列不等于完全不用 heap

`INCLUDE` 只解决“索引里是否有要返回的值”，不解决“该物理行是否对快照可见”。Index Only Scan 检查 visibility map：heap 页 all-visible 时可省去该页的可见性回表，否则仍有 Heap Fetches。频繁更新会清除相关可见性信息，因此相同查询在静态表和写热点表上的收益可能不同。[Index-only scans](https://www.postgresql.org/docs/18/indexes-index-only-scans.html)

覆盖列还增加叶页宽度、降低每页容纳的项数；更新受索引引用的列会影响 HOT 更新资格。查询节省的随机读取，要与新增索引页、WAL 和版本清理一起计算。更详细的扫描与 Join 成本推导见[Planner 章节](./11-PostgreSQL-Planner统计信息EXPLAIN与Join.md#扫描成本的临界点)。

## 3. 安全创建 {/* #安全创建 */}

生产大表用 `CREATE INDEX CONCURRENTLY` 可减少阻塞，但耗时更长、资源更多，失败可能留下 invalid index。检查 `pg_stat_progress_create_index`、有效性并显式清理。

## 4. 用查询与写入共同选择索引 {/* #用查询与写入共同选择索引 */}

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)
SELECT * FROM events WHERE tenant_id = 10 AND created_at >= now() - interval '1 day';

SELECT schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE relname = 'events';
```

对 B-tree、GIN/GiST、BRIN 候选使用相同数据分布和查询集，比较计划、buffers、P99、索引大小与 INSERT/UPDATE WAL 放大。BRIN 依赖物理相关性，GIN 适合多值/全文但更新成本更高；Hash、GiST 也各有操作符类边界。

索引是否“未使用”要跨完整业务周期判断，主键/唯一约束和灾备查询不能只看 `idx_scan` 删除。生产创建大索引优先评估 `CREATE INDEX CONCURRENTLY`，但它耗时更长且失败后可能留下 invalid index；监控 `pg_stat_progress_create_index` 并准备清理。

## 5. 验收题 {/* #验收题 */}

- BRIN 为什么小而不适合随机分布？
- INCLUDE 与把列放入 key 有何区别？
- 高选择性条件为何仍可能顺序扫描？
- 多余索引怎样影响 WAL 与 Vacuum？
- B-Tree 叶页中的 TID 为什么还需要 MVCC 可见性判断？
- BRIN 的 min/max 为什么只能排除页范围，不能直接返回精确行？
- INCLUDE 已覆盖列时，为什么执行计划仍出现 Heap Fetches？

## 6. 参考资料 {/* #参考资料 */}

- [Index types](https://www.postgresql.org/docs/18/indexes-types.html)
- [Multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html)
