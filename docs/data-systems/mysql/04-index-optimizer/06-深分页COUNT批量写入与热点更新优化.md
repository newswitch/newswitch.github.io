---
title: "深分页、COUNT、批量写入与热点更新优化"
sidebar_position: 6
tags: [MySQL, 深分页, COUNT, 批量写入, 热点更新]
description: "分析四类随数据和并发增长而恶化的访问模式，给出游标分页、计数分层、受控批处理与热点消减方法。"
---

# 深分页、COUNT、批量写入与热点更新优化

有些 SQL 在十万行时毫无问题，到一亿行或高并发后突然越过延迟边界。深分页、精确计数、大批量事务和热点行更新正是典型例子。它们的共同点是：业务接口看似只做一个小操作，数据库底层却不得不处理大量被丢弃的数据或串行竞争。

---

## 1. 深分页为什么越来越慢

```sql
SELECT id, created_at, title
FROM articles
WHERE tenant_id = 42
  AND status = 1
ORDER BY created_at DESC, id DESC
LIMIT 1000000, 20;
```

接口只返回 20 行，但数据库通常仍要找到并跳过前 1,000,000 行：

```text
定位有序结果
→ 读取 offset + limit 个候选
→ 丢弃 offset 行
→ 返回 20 行
```

如果返回列不在排序索引中，还可能发生大量回表；如果排序不能利用索引，还要先处理和排序全部匹配行。

复杂度不会因为最终只返回 20 行而变成常量。

---

## 2. Keyset Pagination：按上次位置继续

第一次：

```sql
SELECT id, created_at, title
FROM articles
WHERE tenant_id = 42
  AND status = 1
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

假设最后一行为：

```text
created_at = 2026-08-14 10:20:30.000000
id = 90001
```

下一页：

```sql
SELECT id, created_at, title
FROM articles
WHERE tenant_id = 42
  AND status = 1
  AND (
       created_at < '2026-08-14 10:20:30.000000'
       OR (created_at = '2026-08-14 10:20:30.000000' AND id < 90001)
  )
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

也可以在语义和版本验证后使用行构造比较：

```sql
AND (created_at, id) < (?, ?)
```

配套索引：

```sql
KEY idx_article_page
  (tenant_id, status, created_at DESC, id DESC)
```

Keyset 的工作量接近“定位游标 + 读取下一页”，不会随页码线性增加。

---

## 3. 游标分页的工程边界

### 3.1 必须有稳定唯一顺序

只按 `created_at` 排序不够，因为很多行时间相同。加入唯一 `id` 作为 tie-breaker：

```sql
ORDER BY created_at DESC, id DESC
```

### 3.2 游标不能只相信客户端

游标应编码并校验：

```json
{
  "created_at": "2026-08-14T10:20:30.000000+08:00",
  "id": 90001,
  "filter_hash": "...",
  "version": 1
}
```

服务端要确认游标属于相同租户、过滤条件和排序版本，必要时签名，防止用户修改后跨权限读取。

### 3.3 并发写入下的语义

翻页过程中新增或更新排序键，结果可能移动。要先定义产品语义：

- 允许查看不断变化的实时列表；
- 固定一个 `as_of` 上界；
- 使用快照/导出任务获得严格一致视图。

不要承诺普通多次 HTTP 请求天然共享一个数据库事务快照。

### 3.4 不能直接跳第 N 页

Keyset 擅长“上一页/下一页”，不擅长随机跳到第 50,000 页。产品可改为搜索、日期跳转或有限页码；确有随机页需求时评估离线排名、预计算或后面的延迟关联方案。

---

## 4. 延迟关联减少深分页回表

若暂时必须保留 offset，可先只扫描窄索引得到主键，再回表读取最终少量行：

```sql
SELECT a.id, a.created_at, a.title
FROM articles AS a
JOIN (
  SELECT id
  FROM articles
  WHERE tenant_id = 42
    AND status = 1
  ORDER BY created_at DESC, id DESC
  LIMIT 1000000, 20
) AS page_ids
  ON page_ids.id = a.id
ORDER BY a.created_at DESC, a.id DESC;
```

它仍然需要跳过一百万个索引条目，复杂度没有消失；收益只是避免对被丢弃的大量行读取宽列和随机回表。这是兼容性过渡方案，不是无限扩展方案。

---

## 5. COUNT(*) 为什么不是固定时间

```sql
SELECT COUNT(*)
FROM orders
WHERE tenant_id = 42
  AND status = 'PAID';
```

InnoDB 基于 MVCC，不维护对所有事务都通用的精确表行数；不同事务能看到的可见行集合不同。精确 `COUNT(*)` 需要统计当前事务可见且满足条件的记录。

无额外条件的 `COUNT(*)` 可以扫描较小的二级索引；若没有二级索引则扫描聚簇索引。它仍然与需要访问的索引记录数量相关，不是元数据常量。

`COUNT(*)` 与 `COUNT(1)` 对 InnoDB 没有需要据此优化的本质性能差异。`COUNT(column)` 只统计非 `NULL` 值，语义不同。

---

## 6. 先问业务需要哪一种计数

### 6.1 严格实时精确

财务结算、库存约束等可能确实需要精确值，但要评估查询范围、索引和并发。不要把它放到每次列表翻页都执行。

### 6.2 短暂陈旧的精确聚合

Dashboard 或列表总数可能允许延迟几十秒：

- 异步汇总表；
- CDC/消息驱动更新；
- 定时增量聚合；
- 带 TTL 的缓存。

要定义最大陈旧时间、补偿和重建机制。

### 6.3 近似值

“约 120 万条”可以来自统计、抽样、搜索系统或近似算法。必须明确展示为近似值，不能拿来做资金和配额决策。

### 6.4 不展示总数

很多无限滚动接口只需要：

```json
{
  "items": [],
  "next_cursor": "...",
  "has_more": true
}
```

通过多取一行判断 `has_more`，避免每页附带昂贵精确总数。

---

## 7. 计数器表也可能成为热点

```sql
UPDATE tenant_counters
SET paid_orders = paid_orders + 1
WHERE tenant_id = 42;
```

如果超级租户每秒有大量订单，所有事务竞争同一行锁，计数器从优化变成吞吐瓶颈。

可选设计：

- 按 `tenant_id + shard_id` 拆成多个计数分片，读取时求和；
- 通过消息流异步聚合；
- 周期性从事实表校准；
- 将精确计数移出请求热路径；
- 对幂等和乱序建立事件 ID/版本规则。

任何物化计数都要回答：事务提交失败、消息重复、CDC 中断、回补和重建时如何保证可解释的一致性。

---

## 8. 为什么逐行写入吞吐低

```text
建立/借用连接
→ 网络往返
→ 解析与执行
→ 更新数据和索引
→ 写 redo/binlog
→ commit flush
```

每行一次事务会重复支付往返和提交成本：

```sql
INSERT INTO events (...) VALUES (...);
COMMIT;
-- 重复十万次
```

多值插入能摊薄固定开销：

```sql
INSERT INTO events (tenant_id, event_id, created_at, payload)
VALUES
  (?, ?, ?, ?),
  (?, ?, ?, ?),
  (?, ?, ?, ?);
```

但“一个事务越大越好”同样错误。

---

## 9. 批次大小的约束

批次过小：

- 网络往返多；
- 解析和提交次数多；
- 吞吐低。

批次过大：

- 单事务 redo/undo 和锁集合大；
- 回滚时间长；
- Binary Log 事件与复制应用压力增大；
- 内存和包大小受限；
- 故障重试一次重做大量工作；
- 容易造成延迟尖峰而不是稳定吞吐。

通过压测寻找平台的甜点区，而不是照抄固定“每批 1000 行”。至少逐步比较 100、500、1000、5000 等量级，并同时观察：

```text
rows/s
batch P95/P99
redo bytes/s
binlog bytes/s
replication lag
lock waits
buffer pool dirty pages
disk latency
rollback duration
```

还要检查：

```sql
SHOW VARIABLES LIKE 'max_allowed_packet';
SHOW VARIABLES LIKE 'binlog_format';
SHOW VARIABLES LIKE 'innodb_redo_log_capacity';
```

不要为了通过一次超大请求盲目放大包和内存上限。

---

## 10. 大批量更新和删除

不要用无边界长事务一次改完整张大表：

```sql
UPDATE orders
SET archived = 1
WHERE created_at < '2025-01-01';
```

可以按稳定主键范围分批：

```sql
UPDATE orders
SET archived = 1
WHERE id > ?
  AND id <= ?
  AND created_at < '2025-01-01';
```

或先受控选出一批键，再按键更新。工程要求包括：

- 每批都有确定上界；
- 记录进度，可安全续跑；
- 操作幂等；
- 批间根据复制延迟和数据库负载节流；
- 失败只重试当前批；
- 业务写入与批任务冲突可控；
- 清楚删除后的空间不会自动立刻归还文件系统。

按主键范围通常比 `LIMIT` 但没有确定顺序更可靠。

---

## 11. 热点更新为什么无法靠加机器线性扩展

```sql
UPDATE products
SET stock = stock - 1
WHERE id = 1001
  AND stock > 0;
```

这条原子条件更新能防止超卖，但所有请求仍要竞争同一商品行：

```text
many sessions
→ one record lock
→ serialize
→ lock wait queue
→ timeout/retry
→ more pressure
```

单行的业务串行约束不会因为增加应用实例就消失。高并发重试还可能把排队放大为雪崩。

---

## 12. 热点消减方案与一致性权衡

### 12.1 减少事务持锁时间

- 事务内不做 RPC、日志远程写入或用户交互；
- 先准备参数，再开启事务；
- 保持固定锁顺序；
- 只更新必要行；
- 失败后退避重试完整事务。

这是首先应做的工作，但不能消除不可分割业务对象的固有串行性。

### 12.2 分片计数

把一个逻辑计数拆成 N 行：

```text
(object_id, shard_id, value)
```

写请求散列到不同分片，读取时聚合。适合点赞、浏览量等可加和指标；不适合直接套用到必须强一致扣减的稀缺库存。

### 12.3 排队与合并写

同一 key 的请求按分区进入队列，由有限消费者顺序处理或合并增量。可以控制数据库并发和重试风暴，但会引入：

- 排队延迟；
- 消息幂等；
- 消费者故障恢复；
- 积压容量；
- 查询“已接受但未落库”状态。

### 12.4 预占与分段库存

将库存分配到多个桶或本地配额，降低单行争用。需要解决桶间不均衡、回收、超时释放和最终汇总，业务复杂度显著上升。

### 12.5 乐观并发控制

```sql
UPDATE account
SET balance = ?, version = version + 1
WHERE id = ?
  AND version = ?;
```

适合冲突较低的场景。热点极高时，大量失败重试会浪费 CPU 和 I/O，不一定优于排队。

---

## 13. 如何定位热点行

症状包括：

- 多个事务等待相同记录锁；
- 锁等待时间上升但 CPU 不一定很高；
- 单个租户、商品或计数键占据大部分更新；
- 应用超时后重试进一步增加等待者；
- 吞吐达到平台后并发越高延迟越差。

观察等待关系：

```sql
SELECT * FROM performance_schema.data_lock_waits;
SELECT * FROM performance_schema.data_locks;
SELECT * FROM information_schema.innodb_trx;
```

再将表、索引记录和事务 SQL 映射到脱敏业务 key。Performance Schema 记录格式不应被当作稳定业务 API，排障工具需要适配目标版本。

---

## 14. 四类问题的容量模型

### 深分页

```text
work ≈ offset + limit
```

若还回表：

```text
cost ≈ index entries scanned + clustered lookups
```

### 精确计数

```text
work ≈ visible matching index records scanned
```

### 批量写入

```text
throughput ceiling
≈ min(CPU, redo flush, data I/O, binlog, replica apply, lock capacity)
```

### 热点行

```text
max throughput per key
≈ 1 / average critical-section time
```

这些不是精确公式，而是帮助识别增长维度。容量测试要改变 offset、匹配行数、batch size、并发和热点集中度，观察延迟曲线何时出现拐点。

---

## 15. 验收实验

### 分页

比较第 1、1000、10000 页的 offset 与 keyset 查询，记录扫描行、P95、I/O 和结果稳定性。

### COUNT

比较精确查询、缓存计数、异步汇总和近似统计，明确每种方案的一致性与陈旧边界。

### 批量

逐步增加 batch size 和并发，找到吞吐不再增长但 P99/复制延迟开始恶化的位置，生产上保留安全余量。

### 热点

分别模拟均匀 key、10% 热点和单一超级热点，观察锁等待、吞吐和重试率；验证分片或排队方案在故障恢复时不丢不重。

---

## 16. 生产检查表

```text
[分页]
[ ] 排序是否稳定且包含唯一键
[ ] 是否能使用 keyset
[ ] 游标是否绑定租户和过滤条件
[ ] 并发写入下语义是否明确

[计数]
[ ] 业务真的需要实时精确吗
[ ] 是否从每次翻页热路径移除
[ ] 物化计数如何校准与重建

[批量]
[ ] 批次有上界且可续跑
[ ] 观察 redo/binlog/复制/锁/P99
[ ] 失败和幂等策略明确

[热点]
[ ] 找到真实热点 key 和阻塞链
[ ] 先缩短事务
[ ] 分片/排队方案的一致性边界明确
[ ] 重试有次数上限、退避和抖动
```

---

## 17. 结论

四类问题分别对应四种“隐藏工作”：

```text
深分页：读取后丢弃
COUNT：为快照扫描可见记录
批量写入：过多提交或过大事务
热点更新：并发最终串行到一个 key
```

优化的重点是改变工作量与竞争结构，而不只是调整某个参数：使用游标续读、按一致性要求分层计数、受控批处理，以及把热点从单行临界区中移走。

---

## 参考资料

- [MySQL 8.4 Reference Manual：LIMIT Query Optimization](https://dev.mysql.com/doc/refman/8.4/en/limit-optimization.html)
- [MySQL 8.4 Reference Manual：COUNT Aggregate Function](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html#function_count)
- [MySQL 8.4 Reference Manual：Optimizing INSERT Statements](https://dev.mysql.com/doc/refman/8.4/en/insert-optimization.html)
- [MySQL 8.4 Reference Manual：Optimizing Data Change Statements](https://dev.mysql.com/doc/refman/8.4/en/data-change-optimization.html)
- [MySQL 8.4 Reference Manual：InnoDB Locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html)
