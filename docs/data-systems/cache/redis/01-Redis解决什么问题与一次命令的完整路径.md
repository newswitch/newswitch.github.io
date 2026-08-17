---
title: "Redis 解决什么问题与一次命令的完整路径"
sidebar_label: "01. Redis 解决什么问题与一次命令的完整路径"
sidebar_position: 1
tags: [Redis, 缓存, RESP, Event Loop, 数据路径]
description: "从边界、连接、命令执行、内存、过期淘汰、复制与持久化时间点，拆解一条 Redis 命令的完整路径。"
---

# Redis 解决什么问题与一次命令的完整路径

Redis 首先是一个以内存数据结构为核心的服务端系统。它擅长低延迟读写、计数、集合运算、排行榜、会话、限流和短生命周期状态；它也能持久化和复制，但这不意味着默认配置下就具备关系数据库同等的数据约束与故障恢复语义。

本文不先背命令，而是回答三个问题：Redis 应放在系统哪一层，一条命令经过了什么，以及客户端收到成功时数据究竟安全到了哪里。

## 1. Redis 的位置与边界

```text
Client
  → Application
      ├─ Redis：低延迟访问、临时状态、原子数据结构
      ├─ MySQL/PostgreSQL：事务事实与长期权威数据
      └─ Kafka/RocketMQ：可积压、可重放的异步事件
```

常见用法可以按“数据能否重建”判断：

| 场景 | Redis 角色 | 关键风险 |
| --- | --- | --- |
| Cache-Aside | 数据库派生缓存 | 失效、击穿、旧值回填 |
| Session/Token 状态 | 有过期时间的状态存储 | 淘汰、故障切换丢写 |
| 计数/限流/排行榜 | 原子数据结构执行器 | 热 Key、时钟窗口、内存增长 |
| Streams | 轻量消息流 | 消费组积压、修剪、持久化边界 |
| 分布式锁 | Lease 风格协调 | 超时、续租、Fence Token |

若数据不能从其他系统重建，就必须明确 RPO、AOF 策略、副本确认、备份与恢复演练，不能因为 Redis “支持持久化”就把风险留给默认值。

## 2. 从连接到命令执行

以客户端发送 `SET order:42 paid EX 300` 为例：

```text
DNS / service discovery
→ TCP connect
→ TLS（若启用）
→ AUTH / SELECT
→ RESP frame
→ socket receive buffer
→ Redis event loop
→ parse command and arguments
→ ACL + arity + type check
→ dictionary lookup / object update
→ expire metadata
→ replication and AOF propagation
→ RESP reply
→ client receives OK
```

Redis 使用事件驱动方式管理大量连接。I/O Threads 可以分担部分网络读写与协议处理，但命令修改共享数据的核心阶段仍需理解为受控的串行执行路径。于是，一条 O(N) 大命令、Lua 长循环或大 Key 删除不仅让自己慢，还可能占住执行路径，抬高其他请求的尾延迟。

客户端侧同样可能制造延迟：连接池耗尽、频繁建连、DNS 慢、跨可用区、单连接排队以及过大的 Pipeline，都会让服务端 CPU 看起来并不高。

## 3. 内存里发生了什么

`SET` 并不是只放入几字节业务值。至少还可能包含：

- key 与 value 对象、字典桶和指针；
- allocator size class 产生的内部碎片；
- 过期字典中的 TTL 元数据；
- AOF、复制 backlog 和客户端输出缓冲区；
- fork 后写时复制产生的额外物理页。

所以要区分：

```text
used_memory：Redis 统计的已分配内存
used_memory_rss / process RSS：操作系统看到的常驻内存
maxmemory：触发淘汰策略的逻辑上限
host/container limit：最终可能触发 OOM 的硬限制
```

键过期也不是到点就由独立定时器精确删除。Redis 结合访问时惰性删除和周期性主动过期；短时间集中到期可能形成 CPU 波峰。达到 `maxmemory` 后是否淘汰、淘汰哪些键，则由策略和采样决定。

## 4. 返回 `OK` 不等于所有副本已落盘

命令执行后会产生多条相互独立的时间线：

```text
T1 主节点内存已修改
T2 主节点已生成响应
T3 命令进入 AOF 缓冲区
T4 数据写入内核 Page Cache
T5 fsync 完成，稳定介质可恢复
T6 副本收到复制流
T7 副本执行完成
T8 RDB 快照在未来某时刻包含该数据
```

普通 `SET` 的 `OK` 通常不能证明已经到达 T5、T6、T7 或 T8。`appendfsync everysec` 是性能与数据丢失窗口的折中，也不能理解成任何故障下绝对最多丢一秒。`WAIT` 可以等待指定数量副本确认已处理复制流，但它不是跨节点强一致提交协议，也不替代磁盘持久化与故障域设计。

这也是主节点刚写成功便宕机、随后提升落后副本时仍可能丢写的根本原因。

## 5. 读路径与缓存一致性

Cache-Aside 的典型读路径是：

```text
GET cache key
  ├─ hit  → deserialize → return
  └─ miss → query database → SET with TTL → return
```

这里至少有四类风险：

1. 热点键同时失效，大量请求穿透到数据库；
2. 查询数据库后，旧请求晚于新请求回填旧值；
3. 空结果未缓存，恶意或异常 key 持续穿透；
4. 序列化、网络和客户端排队占据主要时延，Redis 本身并不慢。

写路径常采用“先提交数据库，再删除缓存”，并通过重试、订阅数据库变更或 Outbox/CDC 修复删除失败。不存在不分析并发时间线就天然正确的固定双写顺序。

## 6. 第一轮观测与定位

| 证据 | 先回答什么 |
| --- | --- |
| 客户端连接池等待与请求分位数 | 延迟发生在发出请求之前还是之后 |
| `INFO commandstats` / latency | 哪类命令耗时或调用量异常 |
| `SLOWLOG GET` | 是否存在长命令；注意它主要记录服务端执行时间 |
| `INFO memory` | 逻辑内存、RSS、碎片、淘汰是否异常 |
| `INFO persistence` | fork、AOF rewrite、RDB、错误状态 |
| `INFO replication` | 角色、offset、lag、backlog 与链路状态 |
| `CLIENT LIST` | 阻塞客户端与输入/输出缓冲区 |

定位顺序应从端到端延迟开始，再分解客户端、网络、事件循环、命令、内存、持久化和复制。只看 `redis-cli --latency` 或平均 CPU，容易错过业务连接池和 P99。

## 7. 最小实验

在隔离环境准备一个测试实例，记录版本与配置，然后完成：

```bash
redis-cli INFO server
redis-cli CONFIG GET appendonly appendfsync maxmemory maxmemory-policy
redis-cli SET lab:counter 0 EX 300
redis-cli INCR lab:counter
redis-cli TTL lab:counter
redis-cli INFO memory
redis-cli INFO persistence
redis-cli INFO replication
```

接着用一个大于正常值的测试键观察 `MEMORY USAGE`，分别比较 `DEL` 与 `UNLINK`，再启用客户端耗时记录，确认“客户端总耗时”和“服务端命令执行耗时”并不等价。不要在生产环境制造大 Key 或执行阻塞命令。

## 8. 验收问题

- 为什么 Redis 平均响应 1 ms，应用 P99 仍可能是 100 ms？
- `OK` 返回时，AOF、磁盘和副本分别可能处于什么阶段？
- `used_memory` 没到容器限制，进程为什么仍可能被 OOM Kill？
- 缓存命中率 99%，剩下 1% 为什么仍可能压垮数据库？
- 哪些证据能区分热 Key、大 Key、慢命令、fork 和客户端连接池问题？

能沿这条路径回答问题后，再学习 RESP、Pipeline、数据结构和持久化参数才不会变成孤立记忆。

## 9. 参考资料

- [Redis Open Source 文档](https://redis.io/docs/latest/)
- [Redis 客户端与协议](https://redis.io/docs/latest/develop/reference/protocol-spec/)
- [Redis 持久化](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis 延迟问题排查](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/)
