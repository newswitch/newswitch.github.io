---
title: "Redis 从零到精通学习路线"
sidebar_label: "00. Redis 从零到精通学习路线"
sidebar_position: 0
description: "以 Redis Open Source 8.x 为主线，从命令与数据结构逐步深入事件循环、内存、持久化、复制、Sentinel、Cluster、性能容量和生产故障排查。"
tags: [Redis, 缓存, 数据结构, 高可用, 学习路线]
---

# Redis 从零到精通学习路线

学习 Redis 不能停留在“会 `GET`/`SET`”和“会搭三主三从”。Redis 的核心问题是：数据为什么能低延迟访问，主线程到底做了什么，内存什么时候膨胀，RDB/AOF 在什么故障下会丢数据，主从切换为什么仍可能丢写，Cluster 的 16384 个 slot 怎样路由，以及缓存故障为什么会反向压垮数据库。

本路线以 **Redis Open Source 8.x** 为主线，具体实验固定当前受支持的稳定补丁版本和镜像 digest。旧版本差异、废弃配置和许可证边界单独标记，命令以实验实例真实 `COMMAND DOCS`、`CONFIG GET` 和官方文档为准。

## 1. 先建立完整数据路径

```text
Application
  → client pool / RESP
  → TCP accept / event loop
  → command lookup / ACL / key lookup
  → data structure operation
  → expire / eviction / memory allocator
  → replication stream
  → AOF buffer / RDB child / disk
  → response
```

一次请求快不代表系统安全：返回响应、复制到副本、写入 AOF、AOF 刷盘和生成 RDB 是不同时间点。

## 2. 篇文章学习清单 {/* #2-15-篇文章学习清单 */}

| 编号 | 文章 | 优先级 | 必须解决的问题 | 收录情况 |
| --- | --- | --- | --- | --- |
| R00 | Redis 从零到精通学习路线 | P0 | 建立数据、持久化和故障地图 | 已收录 |
| R01 | [Redis 解决什么问题与一次命令的完整路径](./01-Redis解决什么问题与一次命令的完整路径.md) | P0 | 缓存、数据库、队列、状态存储的边界 | 已收录 |
| R02 | [RESP、客户端连接、Pipeline、事务与 Lua](./02-RESP客户端连接Pipeline事务与Lua.md) | P0 | 网络往返、原子性和阻塞从哪里产生 | 已收录 |
| R03 | [String、Hash、List、Set、ZSet 与底层编码](./03-Redis核心数据结构与底层编码.md) | P0 | 数据结构选型、复杂度和内存代价 | 已收录 |
| R04 | [Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector](./04-Bitmap-HyperLogLog-Geo-JSON-Search与Vector.md) | P1 | 特殊结构和模块能力的适用边界 | 已收录 |
| R05 | [事件循环、I/O Threads、命令执行与源码主路径](./05-Redis事件循环IO-Threads命令执行与源码主路径.md) | P2 | Redis 为什么快、哪里仍是串行瓶颈 | 已收录 |
| R06 | [jemalloc、对象共享、过期删除与内存淘汰](./06-Redis内存过期与淘汰.md) | P0 | used_memory、RSS、碎片和 OOM 如何解释 | 已收录 |
| R07 | [RDB、AOF、多段 AOF、fork 与 Copy-on-Write](./07-Redis-RDB-AOF-fork与Copy-on-Write.md) | P0 | 持久化时间点、恢复和磁盘风险 | 已收录 |
| R08 | [主从复制、PSYNC、Replication Backlog 与一致性](./08-Redis主从复制PSYNC与一致性.md) | P0 | 全量/部分同步和数据丢失边界 | 已收录 |
| R09 | [Sentinel 监控、主观/客观下线与故障转移](./09-Redis-Sentinel监控与故障转移.md) | P1 | 仲裁、选主、客户端切换和脑裂 | 已收录 |
| R10 | [Redis Cluster、slot、Gossip、迁移与故障转移](./10-Redis-Cluster-slot-Gossip迁移与故障转移.md) | P1 | 分片路由、热点 slot 和多数派 | 已收录 |
| R11 | [APT/RPM、源码、Docker、Sentinel、Cluster 与 K8s 部署](./11-Redis-APT-RPM源码Docker-Sentinel-Cluster与Kubernetes部署.md) | P0 | 多种部署方法及生命周期原理 | 已收录 |
| R12 | [缓存模式、穿透、击穿、雪崩、热 Key 与大 Key](./12-Redis缓存模式穿透击穿雪崩热Key与大Key.md) | P0 | 缓存如何保护而不是拖垮数据库 | 已收录 |
| R13 | [Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比](./13-Redis-Streams-PubSub与可靠队列.md) | P1 | 消费确认、重放、积压和可靠性边界 | 已收录 |
| R14 | [性能、容量、监控、安全、备份、升级与故障 Runbook](./14-Redis性能容量监控安全备份升级与故障Runbook.md) | P1 | 从压测到生产治理的闭环 | 已收录 |

当前路线收录 15 篇文章。是否掌握应以能解释命令执行、持久化和复制时间线，并完成缓存雪崩、主从切换和恢复验证为准。

## 3. 学习阶段

### 3.1 阶段一：会用但不误用 {/* #阶段一会用但不误用 */}

完成 R01～R04。重点不是背完命令，而是能为计数、排行榜、集合关系、会话、限流和向量检索选择正确结构，并计算键、值、过期时间和索引的内存代价。

### 3.2 阶段二：理解单机内核 {/* #阶段二理解单机内核 */}

完成 R05～R07。要能解释：

- Redis 主线程与 I/O 线程分别处理什么；
- 一条慢命令为什么阻塞其他请求；
- fork 时延和 COW 为什么可能导致内存翻倍；
- RDB、AOF everysec 与操作系统刷盘之间的 RPO；
- `used_memory` 不高但 RSS 很高的原因。

### 3.3 阶段三：理解分布式 {/* #阶段三理解分布式 */}

完成 R08～R10。需要分清：

```text
Replication：复制数据，不自动提供客户端发现
Sentinel：监控和故障转移，不负责数据分片
Cluster：数据分片 + 副本 + 故障转移
```

### 3.4 阶段四：生产交付 {/* #阶段四生产交付 */}

完成 R11～R14。每种部署方式必须包含规划、实施、验收、回滚和故障演练；性能文章必须同时覆盖吞吐、P99、内存、网络、磁盘、复制、热 Key 和下游数据库保护。

## 4. P0 验收题

- Redis 返回成功后，数据可能还没有到达哪些持久化阶段？
- `DEL` 一个大 Key 为什么可能造成延迟尖峰，`UNLINK` 改变了什么？
- AOF everysec 是否等于绝对只丢 1 秒数据？
- 主节点故障后，Sentinel 为什么仍可能提升一个落后副本？
- Cluster 客户端收到 MOVED 与 ASK 分别说明什么？
- 缓存命中率很高，为什么数据库仍可能被热点 Key 压垮？
- Redis CPU 不高但 P99 上升，应检查客户端、网络、命令、fork、内存还是磁盘？

## 5. 实验拓扑

```text
单实例：命令、编码、内存、RDB/AOF、慢命令
一主两从：复制中断、backlog、全量同步
三 Sentinel：仲裁、故障转移、旧主重加入
三主三从 Cluster：slot、reshard、热点和节点故障
应用 + MySQL：穿透、击穿、雪崩和一致性实验
```

所有故障操作只在隔离环境执行。实验必须记录 Redis 版本、配置、数据规模、命令延迟分布、内存、fork 时间、持久化和复制状态。

## 6. 与其他模块的连接

- [MySQL 路线](../../databases/mysql/00-MySQL从零到精通学习路线.md)：Cache-Aside、失效、双写和数据库保护；
- Kafka/RocketMQ：Redis Streams 与专业消息队列的可靠性和积压差异；
- [Milvus 路线](../../vector-databases/milvus/00-Milvus从零到精通学习路线.md)：Redis Vector 与专用向量数据库选型；
- Nginx/Higress/Envoy：分布式限流、会话和缓存网关；
- Kubernetes：有状态存储、反亲和、故障域和 Operator 边界。

## 7. 官方资料

- [Redis Open Source 文档](https://redis.io/docs/latest/)
- [Redis 持久化](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [Redis 源码仓库](https://github.com/redis/redis)

官方文档负责参数和版本事实，本系列负责把命令、内存、持久化、复制和生产故障串成一条可验证路径。
