---
title: "jemalloc、对象共享、过期删除与内存淘汰"
sidebar_position: 6
tags: [Redis, jemalloc, 内存, 过期, 淘汰]
description: "解释 used_memory、RSS、碎片、TTL、淘汰与 OOM 的完整内存路径。"
---

# jemalloc、对象共享、过期删除与内存淘汰

Redis OOM 不能只看 key value 总和。内存还包括对象元数据、allocator 碎片、复制/AOF backlog、客户端缓冲、模块、fork COW 和进程本身。

```text
logical objects → allocator allocations → RSS pages
                                  ├─ fragmentation
                                  ├─ retained pages
                                  └─ COW during fork
```

## 指标

重点关联 `INFO memory`：`used_memory`、`used_memory_dataset`、`used_memory_rss`、fragmentation、allocator、`mem_not_counted_for_evict`，再对照 cgroup/主机 RSS 与 OOM limit。

## TTL

Redis 用惰性过期加主动采样删除。集中 TTL 会形成过期风暴；设置随机抖动可平滑。TTL 丢失常来自覆盖写、迁移或客户端错误，需抽样 `TTL/PTTL` 验证。

## 淘汰

`maxmemory-policy` 决定 noeviction、LRU/LFU、随机或 TTL 近似策略，采样算法不保证理论最优。数据库型数据不应在未知情况下被自动淘汰；缓存型数据也要监控 `evicted_keys` 和命中率。

## 大 Key 删除

同步 `DEL` 释放大量对象可能阻塞；`UNLINK` 将实际释放移交后台，但仍要付出字典删除、后台 CPU 和内存回收成本。批量扫描使用 `SCAN`，不可在生产用无界 `KEYS`。

## 容量原则

```text
container limit
> maxmemory
+ replication/AOF/client buffers
+ allocator/RSS headroom
+ expected COW peak
```

压测要同时运行 RDB/AOF rewrite、复制重同步和真实客户端响应，测峰值而非静态内存。

## 验收题

- `used_memory` 低于 limit 为什么仍会 OOM？
- 过期和淘汰有什么区别？
- `UNLINK` 是否让删除完全免费？
- 为什么 fork 期间写流量会推高 RSS？

## 参考资料

- [Redis memory optimization](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/)
- [Eviction](https://redis.io/docs/latest/develop/reference/eviction/)
