---
title: "RESP、客户端连接、Pipeline、事务与 Lua"
sidebar_label: "02. RESP、客户端连接、Pipeline、事务与 Lua"
sidebar_position: 2
tags: [Redis, RESP, Pipeline, Transaction, Lua]
description: "理解 Redis 协议、连接池、Pipeline、MULTI/EXEC 与 Lua 的原子性、延迟和阻塞边界。"
---

# RESP、客户端连接、Pipeline、事务与 Lua

Redis 单条命令很快，应用仍可能慢在 DNS、建连、TLS、连接池等待和多次网络往返。优化前先把一次调用拆开：

```text
pool wait → TCP/TLS → RESP encode → network RTT
→ server queue/execute → RESP decode → application
```

## RESP 与连接

RESP 是长度明确的请求/响应协议，RESP3 增加更丰富类型和服务端 Push。普通连接上的命令与响应按顺序对应；订阅、阻塞命令和大响应应使用独立连接，避免占住通用连接池。

连接池上限不是越大越好：

```text
pool size ≈ each application instance concurrency × Redis wait ratio
total connections = pool size × application replicas
```

总连接还受 Redis 文件描述符、内存、TLS 和负载均衡限制。监控池等待时间、超时、建连率和 Redis `connected_clients`。

## Pipeline

Pipeline 连续发送多条命令再批量读取响应，减少 RTT：

```text
without pipeline: N × RTT
with pipeline:    ~1 × RTT + N commands
```

它不是事务；其他客户端命令可在批次之间执行。批次过大会增加客户端/服务端输入输出缓冲、单连接排队和失败重试范围。用真实 value 大小测批次，限制字节数而不只限制条数。

## MULTI/EXEC

`MULTI` 后命令先入队，`EXEC` 时顺序执行且期间不插入其他客户端命令，但 Redis 不提供关系数据库式回滚：运行期类型错误不会撤销已成功命令。

`WATCH key` 提供乐观并发控制：key 在 `EXEC` 前被修改则事务放弃。冲突重试要有上限、退避和业务幂等。

## Lua 与 Functions

Lua/Redis Functions 可把读—判断—写放到服务端原子执行，消除往返竞态。代价是脚本执行期间可能阻塞命令主路径，因此必须：

- 限制输入规模和循环；
- 不扫描无界集合；
- 使用稳定 key 列表以适配 Cluster；
- 记录脚本摘要、耗时和错误；
- 为超时和发布准备回滚。

脚本原子性不等于磁盘/副本强一致，执行成功仍受 AOF 与复制时间线约束。

## 最小实验与排查

分别测单命令、10/100/1000 条 Pipeline 的吞吐、P99 和客户端内存；用两个连接验证 `WATCH` 冲突；让 Lua 执行受控计算，观察其他请求延迟。只在隔离环境实验。

排查顺序：连接池等待 → RTT/重传 → Pipeline 字节 → `SLOWLOG`/latency → 客户端输出缓冲 → 脚本耗时。

## 验收题

- Pipeline、MULTI/EXEC 和 Lua 的原子性分别是什么？
- 为什么扩大连接池可能让 P99 更差？
- `EXEC` 内一条命令失败为何不回滚前面命令？
- Lua 很短但访问大集合时为什么仍危险？

## 参考资料

- [RESP specification](https://redis.io/docs/latest/develop/reference/protocol-spec/)
- [Pipelining](https://redis.io/docs/latest/develop/using-commands/pipelining/)
- [Transactions](https://redis.io/docs/latest/develop/using-commands/transactions/)
