---
title: "缓存模式、穿透、击穿、雪崩、热 Key 与大 Key"
sidebar_label: "12. 缓存模式、穿透、击穿、雪崩、热 Key 与大 Key"
sidebar_position: 12
description: "用并发时间线和保护闭环设计 Redis 缓存，而不是只追求命中率。"
tags: [Redis, Cache Aside, 缓存治理, 热Key, 大Key]
---

# 缓存模式、穿透、击穿、雪崩、热 Key 与大 Key

> 版本基线：适用于 Redis 7.0+ 的常见缓存架构；最后核验：2026-08-18。具体客户端超时、连接池和本地缓存行为由所用 SDK 决定。

缓存是权威数据的派生副本。它的目标不是让命中率报表好看，而是在正确性边界内降低延迟和权威存储压力，并在缓存故障时保护数据库。

命中率 99% 也可能不安全：

```text
request QPS = 1,000,000
miss ratio  = 1%
DB demand   = 10,000 query/s
```

如果数据库安全容量只有 3000 query/s，99% 命中率仍会把数据库压垮。

## 1. 先定义权威来源和一致性目标

设计缓存前回答：

- 权威事实存在哪里；
- 可以陈旧多久；
- 读到旧值的业务后果；
- 更新失败如何修复；
- 缓存整体不可用时允许降级成什么；
- 哪些数据绝不能使用旧副本；
- 单 Key 和全站最大回源并发是多少。

缓存一致性不是只有“强一致/最终一致”两个标签。常见业务目标包括：

| 目标 | 示例 | 设计侧重点 |
| --- | --- | --- |
| 允许秒级陈旧 | 商品详情、配置展示 | TTL、失效通知 |
| 写后读自己 | 用户刚修改的资料 | 版本、会话旁路 |
| 单调读 | 状态不能从新倒退到旧 | 版本比较 |
| 不允许旧授权 | 权限、封禁状态 | 短 TTL、主动失效、权威校验 |
| 计数近似 | 浏览量、热度 | 批量汇聚、可丢失边界 |

## 2. Cache-Aside 的完整时间线

读路径：

```text
GET cache
  ├─ hit  → 校验版本/反序列化 → return
  └─ miss → 获得回源资格
           → query DB
           → SET cache with TTL/version
           → return
```

写路径通常采用：

```text
BEGIN
UPDATE database
COMMIT
DELETE cache
  ├─ success → done
  └─ failure → retry queue / CDC repair / alert
```

选择“更新数据库后删除缓存”，是因为直接更新缓存容易与并发写顺序不一致，并且很多写入后的数据需要重新聚合才能得到缓存值。

## 3. 两个最容易漏掉的竞态

### 3.1 竞态一：旧查询晚回填 {/* #竞态一旧查询晚回填 */}

```text
reader A: cache miss
reader A: SELECT old value，网络暂停
writer B: UPDATE DB new value
writer B: DELETE cache
reader A: SET old value into cache
```

删除缓存并不能阻止更早开始的旧查询晚回来。缓解方式：

- 缓存值带数据库版本，写入前做版本比较；
- 让 CDC/变更事件再次失效或覆盖；
- 对关键对象使用逻辑版本 Key；
- 缩短危险窗口内 TTL；
- 需要更强语义时直接读取权威库。

### 3.2 竞态二：删除失败 {/* #竞态二删除失败 */}

数据库已经提交，但 Redis 删除超时。此时客户端不知道删除是否执行，且旧值可能继续存在。

生产系统应有：

1. 有界即时重试；
2. 可持久化的重试任务；
3. CDC 或 Outbox 驱动的最终修复；
4. 缓存版本和最大 TTL 兜底；
5. 删除失败率与修复积压告警。

不能把“再删一次”写在应用内存队列后就认为可靠，进程重启会丢失任务。

## 4. 其他缓存模式

| 模式 | 谁读写缓存 | 优点 | 风险 |
| --- | --- | --- | --- |
| Cache-Aside | 应用显式管理 | 简单、数据库仍是权威 | 竞态和失效修复 |
| Read-Through | 缓存组件负责回源 | 应用逻辑简化 | 组件耦合、回源风暴 |
| Write-Through | 同步写缓存和后端 | 写后读语义清晰 | 写延迟、部分失败 |
| Write-Behind | 先缓存，异步写后端 | 写吞吐高 | 数据丢失、顺序与重放复杂 |
| Client Local Cache | 进程内再缓存 | 极低延迟、降低 Redis 热点 | 多副本失效传播 |

Write-Behind 会让缓存承担事实入口，必须解决持久日志、顺序、幂等、重放和灾难恢复，不能仅靠 Redis 内存和异步线程。

## 5. 缓存穿透

穿透是查询不存在或不应查询的数据，导致每次请求都绕过缓存访问数据库。

保护顺序：

```text
参数/权限校验
→ 请求限流
→ Bloom 或存在性索引
→ cache lookup
→ bounded DB query
→ negative cache
```

空值缓存必须包含：

- 较短 TTL；
- 与普通值不同的类型标记；
- 创建新对象时主动失效；
- 防止攻击者制造无限高基数空 Key 的限额。

Bloom Filter 会有假阳性：它可能让不存在的数据继续访问数据库，但不应把真实存在的数据误判为不存在。重建和扩容期间也要定义双读或版本切换策略。

## 6. 缓存击穿

击穿是单个高热 Key 过期后，大量并发同时回源。

### 6.1 Singleflight {/* #singleflight */}

```text
first miss → one loader → DB
other misses → bounded waiters
loader success → publish result
loader failure → fail/serve stale with policy
```

必须明确 singleflight 的作用域：

- 仅单进程：多个应用副本仍会同时回源；
- 分布式锁：可跨副本限制，但增加锁故障语义；
- 数据库端限流：最后保护线，不能作为唯一方案。

锁方案要处理持锁者崩溃、Lease/TTL、续期、超时、Fencing Token 和等待者上限。获取锁失败时不能无限自旋。

### 6.2 逻辑过期 {/* #逻辑过期 */}

物理 Key 不立即删除，而是在 value 中记录逻辑过期时间：

```text
not expired → return
expired → one request refreshes
          other requests serve bounded stale value
```

它用可控陈旧换稳定性，只适合业务允许旧值的场景。权限、余额和库存扣减等数据不能默认套用。

## 7. 缓存雪崩

雪崩是大量 Key、多个分片或整个缓存层同时失效，回源压力在短时间集中释放。

常见触发：

- 批量写入使用完全相同 TTL；
- Redis Cluster 多节点故障；
- 发布时清空大范围 Key；
- 上游配置错误导致所有请求 miss；
- 网络、DNS、证书或连接池问题；
- 大面积热 Key 同时被淘汰；
- 重启后无预热直接放量。

TTL 抖动示例：

```text
effective_ttl = base_ttl + random(0, jitter)
```

抖动只分散自然过期，不能解决缓存集群整体不可用。完整方案还需要分批预热、多级缓存、并发限制、数据库 Guardrail 和降级数据。

## 8. 热 Key 与大 Key 不是同一个问题

| 问题 | 核心维度 | 主要危害 | 关键证据 |
| --- | --- | --- | --- |
| 热 Key | 单位时间访问量 | 单分片 CPU/网络、倾斜 | 客户端采样、命令统计、分片 QPS |
| 大 Key | 元素数或字节数 | 返回、删除、复制、迁移和持久化 | `MEMORY USAGE`、元素计数、扫描 |

一个 100 字节 Key 可以是热 Key；一个几百 MiB、几乎没人访问的集合仍是大 Key。

热 Key 治理：

- 应用本地缓存并设计失效；
- 只读副本分担读流量，并接受复制延迟；
- 拆分计数器或聚合写入；
- 按业务维度分片；
- 限流、批量请求和请求合并。

大 Key 治理：

- 分桶和分页；
- 限制字段/成员数；
- 大 value 压缩或移到对象存储；
- 使用 `UNLINK` 评估异步释放；
- 控制 Cluster 迁移和复制窗口；
- 在副本或低峰做扫描。

## 9. 保护闭环与超时预算

```text
end-to-end deadline
→ cache timeout
→ at most bounded retry
→ per-key singleflight
→ global DB concurrency limit
→ stale/fallback/circuit breaker
→ DB QPS and connection guardrail
```

应满足：

```text
cache timeout + retry budget + DB timeout + response budget
< caller deadline
```

如果缓存超时已经接近上游总超时，再去数据库回源只会制造超时后仍在后台运行的无效查询。

回源上限可从数据库预算反推：

```text
allowed_miss_qps
= min(DB_safe_qps - DB_normal_qps,
      DB_free_connections / avg_query_time)
```

公式用于建立容量思维，真实值必须通过压测和排队模型校正。

## 10. 监控指标

至少建立以下关联：

| 层 | 指标 |
| --- | --- |
| 业务 | 请求 QPS、P99、错误率、降级率 |
| 缓存 | hit/miss、命令延迟、timeout、连接池等待 |
| Key | Top Key、value bytes、元素数、TTL 分布 |
| 回源 | DB QPS、并发、连接池、查询延迟 |
| 保护 | singleflight waiter、限流、熔断、stale served |
| 修复 | 删除失败、CDC lag、重试积压 |

命中率必须按接口、租户和 Key 类型拆分。一个全站平均值会掩盖单接口雪崩。

## 11. 故障实验

### 11.1 实验一：单热 Key 同时过期 {/* #实验一单热-key-同时过期 */}

1. 构造一个允许回源的热点接口；
2. 逐步提高并发；
3. 让目标 Key 过期；
4. 比较无保护、进程内 singleflight、跨实例保护三种结果；
5. 记录 Redis miss、DB 并发、等待者、P99 和错误率。

### 11.2 实验二：批量同 TTL 与随机 TTL {/* #实验二批量同-ttl-与随机-ttl */}

创建相同数量的测试 Key，A 组使用相同 TTL，B 组增加随机抖动。观察过期时序、miss QPS 和数据库压力曲线。只在隔离环境使用测试前缀。

### 11.3 实验三：Redis 延迟而不是完全宕机 {/* #实验三redis-延迟而不是完全宕机 */}

模拟缓存 P99 升高，验证：

- 客户端超时能否快速失败；
- 重试是否放大请求；
- 回源并发是否有上限；
- 数据库达到 Guardrail 后是否降级；
- Redis 恢复后是否发生瞬时预热风暴。

故障注入必须经过审批且可立即回滚，不能在生产直接使用网络延迟或进程终止命令。

## 12. 故障排查 Runbook

```text
1. 判断是 hit 下降还是 Redis 延迟上升
2. 按接口/Key 类型定位 miss 来源
3. 检查 Top Key、TTL 分布和分片倾斜
4. 检查 singleflight/限流/熔断是否生效
5. 保护 DB：限制新回源并发
6. 必要时服务 bounded stale 或业务降级
7. 修复失效传播、删除失败或集群故障
8. 分批恢复流量并观察缓存预热
```

不要在事故中直接执行全量 Key 扫描、`KEYS *`、`FLUSHDB` 或无界预热。

## 13. 验收题

- 命中率 99% 为什么仍可能压垮数据库？
- “先更新 DB 再删缓存”还存在哪两个主要竞态？
- 进程内 singleflight 为什么不能保护整个集群？
- 逻辑过期适合什么数据，不适合什么数据？
- 热 Key 与大 Key 的证据和治理方法有何不同？
- 缓存完全不可用时，数据库最大允许回源并发如何确定？

## 14. 参考资料 {/* #参考资料 */}

- [Redis client-side caching](https://redis.io/docs/latest/develop/clients/client-side-caching/)
- [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis latency monitoring](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency-monitor/)
