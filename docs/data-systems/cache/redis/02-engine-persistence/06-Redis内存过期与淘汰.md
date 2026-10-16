---
title: "jemalloc、对象共享、过期删除与内存淘汰"
sidebar_label: "06. jemalloc、对象共享、过期删除与内存淘汰"
sidebar_position: 6
description: "解释 used_memory、RSS、碎片、TTL、淘汰与 OOM 的完整内存路径。"
tags: [Redis, jemalloc, 内存, 过期, 淘汰]
---

# jemalloc、对象共享、过期删除与内存淘汰

Redis OOM 不能只看 key value 总和。内存还包括对象元数据、allocator 碎片、复制/AOF backlog、客户端缓冲、模块、fork COW 和进程本身。

```text
logical objects → allocator allocations → RSS pages
                                  ├─ fragmentation
                                  ├─ retained pages
                                  └─ COW during fork
```

## 1. 指标 {/* #指标 */}

重点关联 `INFO memory`：`used_memory`、`used_memory_dataset`、`used_memory_rss`、fragmentation、allocator、`mem_not_counted_for_evict`，再对照 cgroup/主机 RSS 与 OOM limit。

## 2. TTL {/* #ttl */}

Redis 用惰性过期加主动采样删除。集中 TTL 会形成过期风暴；设置随机抖动可平滑。TTL 丢失常来自覆盖写、迁移或客户端错误，需抽样 `TTL/PTTL` 验证。

## 3. 淘汰 {/* #淘汰 */}

`maxmemory-policy` 决定 noeviction、LRU/LFU、随机或 TTL 近似策略，采样算法不保证理论最优。数据库型数据不应在未知情况下被自动淘汰；缓存型数据也要监控 `evicted_keys` 和命中率。

## 4. 大 Key 删除 {/* #大-key-删除 */}

同步 `DEL` 释放大量对象可能阻塞；`UNLINK` 将实际释放移交后台，但仍要付出字典删除、后台 CPU 和内存回收成本。批量扫描使用 `SCAN`，不可在生产用无界 `KEYS`。

## 5. 容量原则 {/* #容量原则 */}

```text
container limit
> maxmemory
+ replication/AOF/client buffers
+ allocator/RSS headroom
+ expected COW peak
```

压测要同时运行 RDB/AOF rewrite、复制重同步和真实客户端响应，测峰值而非静态内存。

## 6. 内存实验与排障闭环 {/* #内存实验与排障闭环 */}

```bash
redis-cli INFO memory
redis-cli INFO stats | grep -E 'expired_keys|evicted_keys|keyspace'
redis-cli MEMORY STATS
redis-cli MEMORY DOCTOR
redis-cli --bigkeys
```

建立带 TTL、无 TTL、大 Key 和不同访问频率的数据，逐步逼近隔离实例的 `maxmemory`，观察 expired/evicted、命令错误、P99 与复制延迟。过期是键的生命周期语义，淘汰是内存压力下的策略；`noeviction` 会拒绝产生新内存的写，其他策略可能删除业务仍需要的数据。

容量不能只看 `used_memory`：还要考虑 allocator fragmentation、client/output buffer、复制 backlog、fork Copy-on-Write 和容器限制。调整策略前明确 Redis 是缓存还是事实数据源；事实数据不能依赖淘汰维持可用。大 Key 应从数据模型拆分，定时 `FLUSHALL` 或盲目调大 maxmemory 都不是治理。

## 7. 验收题 {/* #验收题 */}

- `used_memory` 低于 limit 为什么仍会 OOM？
- 过期和淘汰有什么区别？
- `UNLINK` 是否让删除完全免费？
- 为什么 fork 期间写流量会推高 RSS？

## 8. 参考资料 {/* #参考资料 */}

- [Redis memory optimization](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/)
- [Eviction](https://redis.io/docs/latest/develop/reference/eviction/)
