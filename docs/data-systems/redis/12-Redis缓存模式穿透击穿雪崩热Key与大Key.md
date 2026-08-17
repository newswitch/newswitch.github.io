---
title: "缓存模式、穿透、击穿、雪崩、热 Key 与大 Key"
sidebar_position: 12
tags: [Redis, Cache Aside, 缓存治理, 热Key, 大Key]
description: "用并发时间线和保护闭环设计 Redis 缓存，而不是只追求命中率。"
---

# 缓存模式、穿透、击穿、雪崩、热 Key 与大 Key

缓存目标是降低权威存储压力和延迟。命中率高不代表安全：1% miss 在百万 QPS 下仍是每秒一万次数据库查询。

## Cache-Aside

```text
read: cache hit → return
      miss → DB → cache with TTL → return

write: commit DB → invalidate cache → retry/CDC repair
```

必须处理旧请求晚回填、删除失败、并发写和读副本延迟。使用业务版本/时间戳、防旧值覆盖和可重放变更流。

## 三类灾害

| 问题 | 含义 | 对策 |
| --- | --- | --- |
| 穿透 | 不存在 key 持续打 DB | 参数校验、短 TTL 空值、Bloom、限流 |
| 击穿 | 单热 key 失效瞬间并发回源 | singleflight、逻辑过期、预热、降级 |
| 雪崩 | 大量 key/节点同时失效 | TTL 抖动、分批预热、多级缓存、DB 保护 |

锁只能限制本实例还是全局要明确；持锁者失败、回源超时和锁续期必须设计。不要让等待队列无限增长。

## 热 Key 与大 Key

热 Key 消耗单节点 CPU/带宽，大 Key 放大网络、删除、迁移和 fork。发现依赖客户端采样、命令统计、网络流量、`MEMORY USAGE` 和离线扫描。治理包括拆分、复制读、局部缓存、压缩/分页和异步删除。

## 保护闭环

```text
request budget → cache timeout < DB timeout
→ bounded retry → concurrency limit
→ fallback/stale data → circuit breaker
→ DB connection/QPS guardrail
```

## 验收题

- 命中率 99% 为什么仍会雪崩？
- “先更新 DB 再删缓存”还存在哪些竞态？
- singleflight 失败时怎样避免请求堆积？
- 热 Key 与大 Key 的证据有何不同？

## 参考资料

- [Redis client-side caching](https://redis.io/docs/latest/develop/clients/client-side-caching/)
