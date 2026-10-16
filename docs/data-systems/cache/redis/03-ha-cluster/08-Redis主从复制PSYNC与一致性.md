---
title: "主从复制、PSYNC、Replication Backlog 与一致性"
sidebar_label: "08. 主从复制、PSYNC、Replication Backlog 与一致性"
sidebar_position: 8
description: "拆解 Redis 全量/部分同步、offset、backlog、读副本和数据丢失窗口。"
tags: [Redis, Replication, PSYNC, Backlog]
---

# 主从复制、PSYNC、Replication Backlog 与一致性

Redis 复制通常异步：主节点执行写命令并向副本传播，客户端成功与副本追平不是同一时刻。

## 1. 建链 {/* #建链 */}

```text
replica connects/authenticates
→ PSYNC replid offset
  ├─ backlog still covers offset → partial resync
  └─ cannot continue → full resync
       → RDB transfer + buffered commands → catch up
```

主节点维护 replication ID、offset 和 backlog。网络中断期间产生的数据若仍在 backlog，可部分同步；否则全量同步会增加 fork、磁盘/网络和副本加载压力。

## 2. 读副本 {/* #读副本 */}

副本读可扩展读取，却可能陈旧。业务必须定义是否允许 read-after-write 不一致、跨请求倒退和故障切换后的旧值。强依赖最新值的请求仍应读主或使用业务版本校验。

## 3. `WAIT` 边界 {/* #wait-边界 */}

`WAIT` 等待指定副本确认已处理复制流，提高成功写被副本接收的概率，但不是 Raft/Paxos 提交，也不能证明副本磁盘 fsync。网络分区和故障转移仍可能丢写。

## 4. 监控与容量 {/* #监控与容量 */}

观察 `master_repl_offset`、副本 offset/lag、link status、backlog size、全量同步次数和输出缓冲。Backlog 估算：

```text
write replication bytes/s × maximum tolerated interruption
```

再留峰值余量。

## 5. 演练 {/* #演练 */}

持续写入序号，短暂阻断副本验证部分同步；超过 backlog 覆盖窗口验证全量同步；主故障后提升副本并对比序号缺口。

## 6. 故障实验：量化而不是宣称“零丢失” {/* #故障实验量化而不是宣称零丢失 */}

```bash
redis-cli INFO replication
redis-cli ROLE
redis-cli WAIT 1 1000
```

持续写入带序号记录，分别注入副本网络延迟、断网超过 backlog 窗口和主节点进程故障。观察 partial/full resync、复制 offset、lag、积压字节和故障后最大确认序号，得到实际 RPO。

Redis 复制默认异步；`WAIT` 只等待副本确认收到写，并不等价于副本 fsync 或跨系统事务。`min-replicas-to-write` 能在副本不足时拒写以缩小风险，但会牺牲可用性。业务仍需幂等和对账。频繁 full sync 应检查 backlog 大小、断链时长、网络、磁盘和副本处理能力，而不是无限增大 backlog。

## 7. 验收题 {/* #验收题 */}

- PSYNC 何时退化为全量同步？
- 副本 lag 为 0 是否证明已落盘？
- `WAIT` 为什么不是强一致事务？
- 如何根据写流量估算 backlog？

## 8. 参考资料 {/* #参考资料 */}

- [Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
