---
title: "Sentinel 监控、主观/客观下线与故障转移"
sidebar_label: "09. Sentinel 监控、主观/客观下线与故障转移"
sidebar_position: 9
description: "理解 Sentinel 发现、SDOWN/ODOWN、quorum、leader、候选副本和客户端切换。"
tags: [Redis, Sentinel, Failover]
---

# Sentinel 监控、主观/客观下线与故障转移

Sentinel 为不分片的 Redis 主从拓扑提供监控、通知、故障转移和客户端发现。三个 Sentinel 进程应跨故障域；quorum 是判定客观下线的票数，真正执行 failover 还需要多数 Sentinel 授权。

## 1. 状态机 {/* #状态机 */}

```text
ping timeout
→ one Sentinel marks SDOWN
→ enough Sentinels agree → ODOWN
→ elect failover leader
→ choose replica
→ promote it
→ reconfigure other replicas
→ publish new master address
```

候选副本受优先级、复制 offset、连接状态和历史等影响。若所有副本都落后，快速切换与数据完整之间存在取舍。

## 2. 客户端 {/* #客户端 */}

应用应通过 logical master name 查询 Sentinel，并实现地址刷新、连接池清理、有限重试和拓扑变化监控。DNS/VIP 固定旧主或 SDK 不支持 Sentinel 会让控制面成功、业务仍失败。

## 3. 网络分区 {/* #网络分区 */}

旧主与 Sentinel 隔离但仍服务旧客户端，可能产生双写；恢复后旧主通常被降为副本，其分区写入可能丢失。通过网络隔离、写入 fencing、最小副本策略和业务幂等降低风险，不能宣称 Sentinel 消灭脑裂。

## 4. 演练证据 {/* #演练证据 */}

记录 SDOWN/ODOWN 时间、quorum、leader、候选副本 offset、切换耗时、客户端错误、旧主角色和写序号缺口。分别演练主进程故障、宿主机故障、部分网络分区和 Sentinel 少数派故障。

## 5. 可重复的 Sentinel 演练 {/* #可重复的-sentinel-演练 */}

至少使用 3 个相互独立故障域中的 Sentinel。先检查每个 Sentinel 对 master、副本和同伴的视图，再停止 master：

```bash
redis-cli -p 26379 SENTINEL MASTER mymaster
redis-cli -p 26379 SENTINEL SENTINELS mymaster
redis-cli -p 26379 SENTINEL REPLICAS mymaster
redis-cli -p 26379 SENTINEL CKQUORUM mymaster
```

记录 SDOWN、ODOWN、leader 选举、promote、reconfigure 和客户端恢复时间，并对账最后确认写。quorum 用于判定 ODOWN，真正授权故障转移还需要 Sentinel 多数派；两者不要混淆。

客户端必须使用 Sentinel-aware 驱动并正确处理连接池、DNS/TLS/ACL 和旧 master 被降级后的重连。网络分区下 Sentinel 优先保证服务恢复，并不能保证无数据丢失；通过业务幂等、`WAIT`/写入约束和故障演练量化边界。

## 6. 验收题 {/* #验收题 */}

- SDOWN、ODOWN、quorum 和 majority 有何区别？
- Sentinel 切换成功为什么仍可能丢写？
- 为什么 Sentinel 必须跨故障域？
- 客户端需做哪些切换动作？

## 7. 参考资料 {/* #参考资料 */}

- [Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
