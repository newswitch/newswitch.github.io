---
title: "连接、心跳、Session Expiration 与临时节点生命周期"
sidebar_label: "03. 连接、Session 与临时节点"
sidebar_position: 3
description: "区分 TCP Connection 与 ZooKeeper Session，分析断连、重连、会话过期和临时节点删除的完整时间线。"
tags: [ZooKeeper, Session, Connection, Ephemeral ZNode, 心跳]
---

# 连接、心跳、Session Expiration 与临时节点生命周期

ZooKeeper 客户端的 TCP 连接可以断开并切换 Server，而 Session 仍然有效。只有 Ensemble 在协商的 Session Timeout 内没有收到有效心跳，Session 才会过期并删除其临时节点。

## 1. 两个生命周期

```text
Client Session
├─ TCP连接Server A
├─ 断开
├─ 在Timeout内连接Server B：Session继续
└─ 超过Timeout：Session Expired → Ephemeral ZNode删除
```

| 状态 | 客户端含义 | 应用动作 |
| --- | --- | --- |
| SyncConnected | Session 可用 | 正常读写 |
| Disconnected | 当前无连接，Session 未必失效 | 暂停依赖协调结果的危险操作，尝试重连 |
| Expired | 原 Session 永久失效 | 创建新 Session，重建临时节点和 Watch |
| AuthFailed | 认证失败 | 停止盲目重试，修复身份配置 |

断开期间应用不知道自己创建的锁或 Leader 身份是否仍被其他参与者视为有效。涉及外部副作用时必须使用 Fencing Token，不能只靠本地 `isLeader=true`。

## 2. Session 建立与协商

客户端提供期望超时，Server 会按集群 `tickTime` 和允许范围协商实际值。过短会在 GC、CPU 抢占或网络抖动时误过期，过长会延迟故障成员清理。

客户端通过心跳维持会话，并维护最近见到的 zxid，重连时选择数据足够新的 Server。不要让客户端连接字符串只包含一个地址，否则单 Server 故障会被误判为 ZooKeeper 整体不可用。

## 3. 临时节点的业务边界

Ephemeral ZNode 绑定 Session，而不是进程 PID 或 TCP 连接。适合表示活跃成员和选举候选，不适合保存不可丢配置。Session 过期后，删除事件会触发其他客户端的 Watch；旧客户端即使稍后网络恢复，也不能复活原会话。

## 4. 典型故障

| 现象 | 判断 |
| --- | --- |
| 短暂 Disconnected 后恢复 | 可能仅为 Server 切换 |
| 频繁 Expired | 网络抖动、长 GC、Server 延迟或 Timeout 过小 |
| 临时节点仍在但进程已死 | Session 尚未超时 |
| 两个业务实例都认为自己是 Leader | 缺少 Fencing，旧实例断连后仍执行 |
| 重连后 Watch 不工作 | 会话过期后未重建或 Watch 已触发 |

## 5. 实验

1. 创建 Ephemeral ZNode；
2. 阻断 TCP 时间短于 Session Timeout，再恢复；
3. 验证节点仍在且 Session ID 不变；
4. 再阻断超过 Timeout；
5. 验证收到 Expired、临时节点被删除；
6. 创建新 Session 并重新注册节点和 Watch。

实验时记录客户端状态事件、Server 的 Session 指标和 ZNode 变化时间，验证实际故障检测窗口，而不是只阅读配置值。

参考：[ZooKeeper Programmer's Guide](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)。
