---
title: "Redis Cluster、slot、Gossip、迁移与故障转移"
sidebar_label: "10. Redis Cluster、slot、Gossip、迁移与故障转移"
sidebar_position: 10
description: "理解 16384 slots、MOVED/ASK、Gossip、主从选举、reshard 和热点治理。"
tags: [Redis, Cluster, Slot, Gossip]
---

# Redis Cluster、slot、Gossip、迁移与故障转移

Redis Cluster 将 key 通过 CRC16 映射到 16384 个 slot，再把 slot 分给主节点。Hash Tag `{...}` 让相关 key 落同一 slot，以支持多 key 操作，但过度使用会制造热点。

```text
key → hash slot → cluster slot map → master → optional replica
```

## 1. 客户端路由 {/* #客户端路由 */}

Cluster-aware 客户端缓存 slot map。`MOVED` 表示 slot 已稳定归属另一节点，应更新映射；`ASK` 表示迁移中的临时访问，应先发送 `ASKING`。把 Cluster 放在不理解重定向的普通 TCP 代理后会破坏路由。

## 2. Gossip 与故障 {/* #gossip-与故障 */}

节点通过集群总线交换拓扑和故障信息。某节点被多数主节点判定 fail 后，其副本可发起选举。可用性依赖拥有 slot 的主节点多数派和每个分片的健康副本，不是“六个进程活着”即可。

## 3. Reshard {/* #reshard */}

迁移 slot 时源/目标进入 migrating/importing，key 分批转移并最终更新归属。控制速率，观察 P99、网络、内存和 `ASK`；迁移失败时按工具状态恢复，不能随意手改 nodes 配置。

## 4. 热点 {/* #热点 */}

均匀 slot 数不代表负载均匀。单个热 key 仍只在一个主节点执行。用 keyspace 采样、命令统计、客户端 trace 与节点 CPU/带宽定位；可通过业务拆分、局部缓存、读副本或限流处理。

## 5. Cluster 实验与安全扩缩容 {/* #cluster-实验与安全扩缩容 */}

```bash
redis-cli --cluster check <host>:6379
redis-cli --cluster info <host>:6379
redis-cli -c -h <host> CLUSTER SLOTS
redis-cli -c -h <host> CLUSTER SHARDS
```

使用带 hash tag 和不带 hash tag 的多 Key 命令验证同 slot 约束；再迁移一小段 slot，观察 `MOVED`、`ASK`、客户端拓扑刷新、迁移速率和 P99。生产扩缩前确认目标节点空闲、持久化/复制正常、故障域正确，并设置流量停止线。

Cluster 的 Gossip/故障转移不提供跨 slot 事务，也不替代代理/客户端重试幂等。节点总线端口、announce 地址、NAT 和证书配置错误会导致“客户端端口通但集群不可用”。故障演练要覆盖单主、主从同域故障和网络分区，并对账实际 RPO/RTO。

## 6. 验收题 {/* #验收题 */}

- MOVED 与 ASK 的语义差异是什么？
- Hash Tag 如何同时解决跨 key 和制造热点？
- 为什么 slot 均匀而 CPU 仍可能倾斜？
- Cluster 发生网络分区时多数派怎样影响写可用性？

## 7. 参考资料 {/* #参考资料 */}

- [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Scaling with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
