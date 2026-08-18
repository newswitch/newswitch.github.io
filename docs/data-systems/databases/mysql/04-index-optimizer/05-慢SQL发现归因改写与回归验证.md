---
title: "慢 SQL 从发现、归因、改写到回归验证"
sidebar_label: "05. 慢 SQL 从发现、归因、改写到回归验证"
sidebar_position: 5
description: "建立以 SLO 和工作负载为入口的慢 SQL 处理闭环，覆盖采集、计划、等待、改写、压测、灰度与回滚。"
tags: [MySQL, 慢SQL, Performance Schema, SQL优化, 故障排查]
---

# 慢 SQL 从发现、归因、改写到回归验证

一条 SQL 在命令行执行 200 ms，不足以判断它是否是生产问题。真正的影响由调用频率、并发、尾延迟、锁占用、扫描量和业务 SLO 共同决定。

```text
单次 5 s × 每天 1 次
可能低于
单次 20 ms × 每秒 20,000 次
```

慢 SQL 治理要完成“发现 → 量化 → 复现 → 归因 → 修改 → 回归 → 灰度 → 持续观察”的闭环。

## 1. 先定义“慢”

至少从三种视角定义：

### 1.1 用户视角 {/* #用户视角 */}

- API P95/P99 是否超过 SLO；
- 首屏、提交、结算等关键路径是否受影响；
- 是否出现超时和重试放大。

### 1.2 数据库视角 {/* #数据库视角 */}

- 单次延迟和锁时间；
- 扫描行/返回行；
- 临时表、排序和回表；
- 每秒调用次数；
- 总 CPU、I/O 和等待贡献。

### 1.3 风险视角 {/* #风险视角 */}

- 是否持锁很久；
- 是否在事务中调用外部服务；
- 是否造成复制延迟；
- 是否挤占连接池；
- 是否会随数据量线性或超线性恶化。

因此慢查询清单至少需要两种排序：总资源消耗最大的，以及单次尾延迟/业务风险最高的。

## 2. 数据从哪里来

### 2.1 慢查询日志

先查看目标实例配置：

```sql
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'slow_query_log_file';
SHOW VARIABLES LIKE 'long_query_time';
SHOW VARIABLES LIKE 'min_examined_row_limit';
SHOW VARIABLES LIKE 'log_queries_not_using_indexes';
SHOW VARIABLES LIKE 'log_output';
```

慢日志适合保留具体语句和发生时间，但要注意：

- 阈值过高会漏掉高频中等延迟 SQL；
- 无索引日志可能产生大量低价值记录；
- SQL 文本可能含敏感参数；
- 日志写入、采集和存储有成本；
- “超过阈值才记录”不等于工作负载画像。

生产调整前评估开销、脱敏、轮转和保留策略。

### 2.2 Performance Schema Digest

同类 SQL 会被归一化聚合：

```sql
SELECT SCHEMA_NAME,
       DIGEST,
       DIGEST_TEXT,
       COUNT_STAR,
       ROUND(SUM_TIMER_WAIT / 1e12, 3) AS total_s,
       ROUND(AVG_TIMER_WAIT / 1e9, 3) AS avg_ms,
       SUM_ROWS_EXAMINED,
       SUM_ROWS_SENT,
       SUM_CREATED_TMP_DISK_TABLES,
       SUM_SORT_ROWS,
       SUM_NO_INDEX_USED,
       FIRST_SEEN,
       LAST_SEEN,
       QUERY_SAMPLE_TEXT
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME IS NOT NULL
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 30;
```

计时单位换算和具体列以目标版本为准。Digest 适合回答：

- 哪一类 SQL 总耗时最高；
- 调用量是否突增；
- 每次平均扫描多少行；
- 扫描/返回比是否异常；
- 是否频繁使用磁盘临时表；
- 最近出现的代表性样本是什么。

摘要表有容量限制，`DIGEST_TEXT` 和样本也可能截断。将它作为观测来源之一，不要假设覆盖了全部历史。

### 2.3 应用追踪

数据库看到一次查询，应用更知道：

- 哪个 API、租户和业务动作触发；
- 连接池等待多久；
- 是否发生重试；
- 同一请求执行多少次相同 SQL；
- ORM 是否产生 N+1 查询；
- 参数对应普通用户还是超级租户。

Trace 中不要直接记录密码、令牌和敏感字段；使用 digest、模板 ID 和脱敏业务维度关联。

## 3. 线上故障先止血还是先优化

### 3.1 判断是否正在扩大

```text
数据库连接是否接近上限？
活动线程和运行队列是否持续上升？
锁等待是否形成队列？
磁盘延迟是否恶化？
应用是否自动重试并放大流量？
副本是否严重延迟？
```

### 3.2 可选止血手段

- 在入口限流或降级非核心查询；
- 关闭无界重试，加入退避和抖动；
- 暂停造成冲击的批任务、报表或 DDL；
- 对特定功能熔断；
- 将可接受的只读流量迁移到健康副本；
- 在确认事务影响后终止极端查询。

`KILL QUERY` 只停止当前语句，`KILL CONNECTION` 会断开连接；涉及写事务时还可能触发长时间回滚。止血前要知道目标线程、事务、锁和业务后果。

不要在故障高峰直接做大表建索引、全表 `ANALYZE` 或无边界 `EXPLAIN ANALYZE`。

## 4. 保存一个完整问题样本

只复制 SQL 模板不够，至少保存：

```text
发生时间和持续区间
MySQL 版本与实例角色
SQL digest 和脱敏参数分布
调用次数、P50/P95/P99、超时率
扫描行、返回行、锁时间
事务隔离级别和 autocommit
SHOW CREATE TABLE / 索引
普通 EXPLAIN 和安全环境的 ANALYZE
同期 CPU、I/O、连接、锁和部署事件
```

参数是计划和延迟的一部分。`tenant_id=1` 可能命中一亿行，`tenant_id=9999` 只有十行；不能用后者复现前者的问题。

## 5. 先区分执行慢还是等待慢

总延迟可以拆成：

```text
connection pool wait
+ parse/optimize
+ lock wait
+ CPU execution
+ storage I/O wait
+ temporary/sort work
+ result transfer
+ application consume
```

### 5.1 锁等待型 {/* #锁等待型 */}

特征：执行计划没有明显大扫描，但语句长时间等待，多个事务排队。检查：

```sql
SELECT * FROM performance_schema.data_lock_waits;
SELECT * FROM performance_schema.data_locks;
SELECT * FROM information_schema.innodb_trx;
```

根因往往在阻塞者：长事务、漏提交、热点行或 DDL 的 MDL，而不在等待 SQL 的索引。

### 5.2 CPU 型 {/* #cpu-型 */}

特征：实例 CPU 和运行队列高，语句扫描、计算、排序或解析量大。关注 digest 总 CPU 贡献、扫描行、复杂表达式和调用频率。

### 5.3 I/O 型 {/* #io-型 */}

特征：磁盘延迟和队列上升、缓存未命中、读取页大增。可能是大扫描、随机回表、缓存污染或后台任务竞争。

### 5.4 网络/结果集型 {/* #网络结果集型 */}

SQL 在服务端很快，但返回百万行或大字段，应用消费慢。修复是限制列和行、流式读取或重新设计接口，不一定需要新索引。

## 6. SQL 根因分类

### 6.1 扫描范围过大

```sql
WHERE DATE(created_at) = ?
WHERE name LIKE '%keyword%'
WHERE CAST(user_id AS CHAR) = ?
```

检查是否能改为可搜索条件、前缀查询、时间半开区间或专用检索方案。

### 6.2 联合索引不匹配

查询的租户、状态、时间和排序组合与现有索引顺序不符，导致扫描大量候选再过滤。

### 6.3 估算失真

`EXPLAIN ANALYZE` 中 estimated/actual rows 相差数量级。检查统计陈旧、倾斜、列相关性和参数分布。

### 6.4 Join 倍增

遗漏关联条件、一对多链路或先 Join 后去重，产生巨大中间集。

### 6.5 排序和临时表

先生成大量行再排序/聚合，或返回列过宽导致内部临时结果转盘。

### 6.6 重复调用

单次 SQL 已很快，但 ORM N+1、循环逐行查询或重试让调用量爆炸。此时应用批量查询或数据加载模式比数据库微调更有效。

### 6.7 事务边界过大

SQL 本身几十毫秒，却在事务中等待用户输入、RPC 或消息发送，持锁数秒。应缩短事务并明确外部副作用的一致性设计。

## 7. 优化优先级

### 7.1 第一层：减少不必要工作 {/* #第一层减少不必要工作 */}

- 不查不需要的列；
- 不返回无界结果；
- 避免重复 SQL 和 N+1；
- 尽早过滤；
- 使用确定分页；
- 将存在性问题写成存在性语义。

### 7.2 第二层：正确的访问路径 {/* #第二层正确的访问路径 */}

- 设计最小有效联合索引；
- 统一 Join 键类型；
- 减少回表和排序；
- 修复统计信息；
- 对明显倾斜谨慎使用直方图。

### 7.3 第三层：数据模型和架构 {/* #第三层数据模型和架构 */}

- 汇总表或异步预计算；
- 热冷分离、归档或分区；
- 缓存可复用且允许短暂陈旧的结果；
- 将全文搜索交给适合的系统；
- 拆分超级租户或热点键。

### 7.4 第四层：参数和硬件 {/* #第四层参数和硬件 */}

只有证据证明瓶颈在 Buffer Pool、临时空间、I/O 或 CPU 后，才评估参数和资源。调大缓存不能修复错误 Join，增加 CPU 也不能消除锁队列。

## 8. 改写示例

### 8.1 函数条件改范围

```sql
-- 修改前
WHERE DATE(created_at) = '2026-08-14'

-- 修改后
WHERE created_at >= '2026-08-14 00:00:00'
  AND created_at <  '2026-08-15 00:00:00'
```

必须明确数据库会话时区与业务时区，否则“性能修复”可能改变日期边界。

### 8.2 N+1 改批量读取

```text
1 次查询 100 个订单
+ 每个订单 1 次客户查询
= 101 次往返
```

可改为一次 Join、批量 `IN`（控制集合大小）或应用 DataLoader。比较总查询次数、返回重复列和内存，而不是只看单条 SQL。

### 8.3 只判断存在

```sql
SELECT EXISTS (
  SELECT 1
  FROM orders
  WHERE tenant_id = ?
    AND customer_id = ?
    AND status = 'PAID'
);
```

不需要把所有匹配订单返回应用后再判断长度。

## 9. 回归验证不能只跑一次

### 9.1 正确性

对比修改前后结果：

- `NULL`；
- 重复行；
- 排序稳定性；
- 时间边界与时区；
- 字符集和大小写；
- 超级租户、空租户；
- 并发写入下的可见性。

### 9.2 性能矩阵

| 维度 | 至少覆盖 |
|---|---|
| 参数 | 0 行、常见、小热点、超级租户 |
| 缓存 | 热缓存、接近冷缓存 |
| 并发 | 单线程、目标并发、峰值并发 |
| 数据量 | 当前、预计 6/12 个月 |
| 指标 | P50/P95/P99、吞吐、扫描行、CPU、I/O |
| 副作用 | 写入延迟、复制延迟、空间、锁等待 |

### 9.3 计划与负载同时比较

```text
计划更漂亮但 P99 更差 → 不算成功
单条更快但写入下降 30% → 需重新权衡
平均变快但超级租户仍超时 → 未完成
测试快但生产估算完全不同 → 数据分布不代表
```

## 10. 发布、灰度与回滚

### 10.1 索引变更 {/* #索引变更 */}

- 评估 DDL 算法、锁和额外磁盘空间；
- 观察主库 I/O、redo、复制延迟；
- 先在副本或影子数据验证；
- 若移除索引，先评估不可见索引方案；
- 不要同时删除旧索引并发布强依赖新索引的代码而没有回退路径。

### 10.2 SQL 变更 {/* #sql-变更 */}

- 使用 feature flag 或小流量灰度；
- 同时记录新旧 digest；
- 设定 P95/P99、错误率和数据库负载回滚阈值；
- 避免 ORM 升级顺带改变大量 SQL 却无法单独回退。

### 10.3 统计信息变更 {/* #统计信息变更 */}

- 保存变更前计划；
- 覆盖同表核心查询回归；
- 记录直方图桶数和更新时间；
- 准备删除直方图或恢复策略。

## 11. 一份可直接使用的 Runbook

### 11.1 发现 {/* #发现 */}

```text
[ ] 哪个 API/SLO 受影响
[ ] 哪个 digest 总耗时或尾延迟最高
[ ] 调用量、扫描量还是单次延迟发生变化
```

### 11.2 取证 {/* #取证 */}

```text
[ ] 保存脱敏样本参数
[ ] 保存表结构、索引和统计时间
[ ] 保存普通计划与安全环境真实计划
[ ] 保存锁、CPU、I/O、连接和发布事件
```

### 11.3 归因 {/* #归因 */}

```text
[ ] 执行还是等待
[ ] 扫描范围/回表
[ ] 估算偏差
[ ] Join 倍增
[ ] 排序/临时表
[ ] N+1/重试/事务边界
```

### 11.4 修复 {/* #修复 */}

```text
[ ] 选择改动最小、收益可量化的方案
[ ] 正确性测试
[ ] 代表性负载测试
[ ] 评估写入、锁、复制和空间副作用
```

### 11.5 上线 {/* #上线 */}

```text
[ ] 灰度范围
[ ] Dashboard 和告警
[ ] 回滚阈值与操作
[ ] 观察窗口与负责人
```

### 11.6 复盘 {/* #复盘 */}

```text
[ ] 为什么现有监控没有更早发现
[ ] 数据增长到何时再次越过容量边界
[ ] 能否用 lint、评审或自动回归防复发
```

## 12. 自动化治理建议

建立按天或按小时的 digest 基线，跟踪：

```text
calls per second
avg and max latency
rows examined per call
rows sent per call
temporary disk tables per call
no-index usage
first/last seen
plan fingerprint
```

告警应关注“相对基线变化 + 业务影响”，例如扫描/返回比增长十倍且 QPS 高，而不是对所有 `Using filesort` 报警。

SQL Review 可自动检查：

- 无 `WHERE` 的更新或删除；
- 非确定性分页；
- 前导通配符；
- 类型不一致的 Join；
- 新增索引是否与现有索引高度重复；
- 事务中外部调用；
- 查询没有结果上界。

自动检查只做风险提示，最终仍需结合真实数据分布和业务语义。

## 13. 结论

慢 SQL 优化不是“看到全表扫就加索引”，而是一个证据闭环：

```text
SLO 受损
→ digest 量化
→ 参数与上下文复现
→ 计划 + 等待联合归因
→ 最小修复
→ 正确性和负载回归
→ 灰度与持续观测
```

下一篇将集中处理最容易在线上随数据增长恶化的四类模式：深分页、精确计数、批量写入和热点更新。

## 14. 参考资料 {/* #参考资料 */}

- [MySQL 8.4 Reference Manual：The Slow Query Log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)
- [MySQL 8.4 Reference Manual：Performance Schema Statement Digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html)
- [MySQL 8.4 Reference Manual：Statement Summary Tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-summary-tables.html)
- [MySQL 8.4 Reference Manual：EXPLAIN Statement](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
