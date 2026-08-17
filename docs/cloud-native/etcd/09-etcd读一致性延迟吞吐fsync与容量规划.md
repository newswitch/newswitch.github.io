---
title: "线性/串行读、延迟、吞吐、磁盘 fsync 与容量规划"
sidebar_position: 9
tags: [etcd, Performance, fsync, 容量规划]
description: "按请求语义、值大小、Watcher、WAL fsync 和故障恢复规划 etcd。"
---

# 线性/串行读、延迟、吞吐、磁盘 fsync 与容量规划

etcd 写延迟至少包含 Leader 处理、WAL fsync、多数派网络/落盘和 apply。最慢多数派成员的尾延迟会影响提交。

## 请求类型

- Serializable Range 可本地读、可能陈旧；
- Linearizable Range 需 Leader/ReadIndex 确认；
- Put/Txn/Lease 变更通过 Raft；
- Watch 消耗连接、事件序列化和客户端处理。

## 磁盘

低延迟 SSD 与稳定 fsync 比峰值吞吐重要。etcd 与日志/容器镜像共盘会产生抖动。监控 WAL fsync、backend commit histogram、leader changes、pending proposals。

## 容量

控制 Key/Value 大小、总 Key、写速率、Watchers 和历史窗口。Backend quota 不是目标使用率；保留 compaction/defrag、snapshot 和突发余量。大对象放对象存储/数据库。

## Benchmark

`benchmark` 工具按真实 key/value、连接、TLS、线性读/写比例测试，报告 P50/P99 和错误；同时故障 follower/leader、制造磁盘抖动。不要在生产跑破坏性压力。

## 验收题

- 写延迟为何受多数派中较慢成员影响？
- 串行读快在哪里、牺牲什么？
- Watcher 慢如何影响服务？
- 为什么 etcd 不能存大配置包？

## 参考资料

- [etcd performance](https://etcd.io/docs/v3.6/op-guide/performance/)
- [Hardware recommendations](https://etcd.io/docs/v3.6/op-guide/hardware/)
