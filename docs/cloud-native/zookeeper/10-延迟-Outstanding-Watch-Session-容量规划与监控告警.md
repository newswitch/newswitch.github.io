---
title: "延迟、Outstanding、Watch、Session、容量规划与监控告警"
sidebar_label: "10. 容量、监控与告警"
sidebar_position: 10
description: "从请求、ZNode、Watch、Session、磁盘和网络建立 ZooKeeper 容量模型与生产告警。"
tags: [ZooKeeper, 容量规划, 监控, Outstanding Requests, Watch]
---

# 延迟、Outstanding、Watch、Session、容量规划与监控告警

ZooKeeper 保存小型协调状态，容量风险往往不是单个大文件，而是 ZNode、Watch、Session、请求突发和慢磁盘共同放大。

## 1. 关键资源

```text
内存 ≈ DataTree + ZNode元数据 + Watch + Session + 连接缓冲
写能力 ≈ Leader日志盘 + 多数派网络/磁盘
读能力 ≈ 各Server本地DataTree + 网络
```

必须限制单 ZNode 数据大小、子节点数量、每客户端 Watch/连接和总 Session。把大配置、二进制或不断增长的历史放入 ZooKeeper 会增加 Snapshot、同步和 GC 成本。

## 2. 核心指标

- `zk_avg_latency`、`zk_max_latency`；
- `zk_outstanding_requests`；
- `zk_znode_count`、`zk_approximate_data_size`；
- `zk_watch_count`、`zk_ephemerals_count`；
- `zk_num_alive_connections`；
- Follower 数、已同步 Follower、Pending Sync；
- 文件描述符、JVM Heap/GC、事务日志盘延迟和剩余空间。

指标名称随采集方式和版本可能不同，先用 `mntr` 或 AdminServer 对照实际暴露项。

## 3. SLO 与告警

建议分别定义读/写 P99、Session Expiration 异常率、Leader 选举恢复时间和可用多数派。告警例子：Outstanding 持续增长、已同步 Follower 少于预期、写 P99 超标、磁盘耗尽时间低于恢复窗口、Session Expired 突增。

只对“当前谁是 Leader”做页面展示，不应在正常 Leader 切换时产生告警风暴。真正需要告警的是长时间无 Leader、失去多数派或业务协调失败。

## 4. 排障路径

| 现象 | 证据路径 |
| --- | --- |
| 写慢读正常 | Leader 日志盘、多数派 RTT、Outstanding |
| 所有请求慢 | JVM GC、CPU、网络、连接风暴 |
| Watch 延迟 | 请求积压、客户端事件线程阻塞 |
| Session 频繁过期 | GC、网络抖动、Server 延迟、Timeout |
| 启动/选主慢 | Snapshot/日志、落后副本同步、磁盘 |

## 5. 容量实验

逐级增加 ZNode、连接和 Watch，记录 Heap、GC、Snapshot 时间和重连风暴；随后引入慢日志盘和 Leader 切换。容量上限应留足单节点故障后的余量，而不是以三节点全健康峰值作为生产上限。

参考：[ZooKeeper Administrator's Guide—Monitoring](https://zookeeper.apache.org/doc/current/zookeeperAdmin.html#sc_zkCommands)。
