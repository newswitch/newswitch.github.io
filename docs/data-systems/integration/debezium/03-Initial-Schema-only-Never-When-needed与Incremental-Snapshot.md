---
title: "Debezium Snapshot：Initial、Schema-only、Never、When-needed 与 Incremental"
sidebar_label: "03. Snapshot 模式与增量快照"
sidebar_position: 3
description: "理解 Debezium 初始快照如何与日志流衔接，以及不同快照模式、增量快照和生产补表的边界。"
tags: [Debezium, Snapshot, CDC, Incremental Snapshot]
---

# Debezium Snapshot：Initial、Schema-only、Never、When-needed 与 Incremental

CDC 启动时必须回答两个问题：历史存量从哪里来，快照期间发生的新事务会不会丢。Debezium 的快照不是简单的 `SELECT *`，而是先取得一个可恢复的日志位置和一致性视图，再读取表数据，最后从该位置继续流式消费。

## 1. 一次初始快照

```text
读取数据库元数据与日志位置 L0
→ 建立一致性快照/必要的锁
→ 逐表扫描并发出 op=r 事件
→ 记录快照完成状态
→ 从 L0 读取快照期间产生的日志
→ 进入 Streaming
```

因此快照数据和增量日志可能在时间上交错，下游不能依赖“到达时间”判断业务顺序，应使用主键、源事务位置和幂等写入。

## 2. 模式如何选择

| 目标 | 常见模式 | 关键条件 |
| --- | --- | --- |
| 首次接入，既要存量又要增量 | `initial` | 日志保留覆盖快照时长 |
| 只捕获启动后的变化 | `never` / `no_data` | 下游已有可信基线 |
| 只初始化结构 | `schema_only` / `no_data` | 具体名称随连接器版本变化 |
| Offset 指向的日志已不存在时补救 | `when_needed` | 必须评估重复与全量扫描压力 |
| 正常流式期间新增表或补一段数据 | Incremental Snapshot | 连接器支持信号表/信号通道 |

不要只复制博客里的配置名。升级前必须按当前 Debezium 版本的连接器文档核对 `snapshot.mode` 枚举，旧值可能已经弃用或改名。

## 3. 增量快照为什么能在线执行

增量快照把表按主键范围切成 Chunk。每个 Chunk 读取前后建立低/高水位窗口；窗口内从事务日志读到的同一主键变更会覆盖快照缓存中的旧值，然后再发出这一块数据。流式读取不需要长期停机。

实施前确认：

- 表有稳定、可排序且选择性足够的主键；
- Chunk 大小不会把数据库 Buffer Pool、Connector Queue 或 Kafka 打满；
- Signal 表权限和信号格式正确；
- 下游把 `op=r` 当作当前状态，而不是重复创建业务对象；
- 能观察当前表、Chunk、水位、扫描速度和流式 Lag。

## 4. 生产容量边界

最小日志保留时间应大于“最长快照时长 + 故障恢复窗口 + 安全余量”。若全表大小为 `D`、有效扫描吞吐为 `R`，理想时间约为 `D/R`，还要计入锁等待、网络、序列化和 Kafka 背压。

快照期间重点观察数据库 IOPS、Buffer Pool 命中率、复制延迟、长事务，Connector 的 Queue 使用率，以及 Kafka Produce 延迟。不要用一次全库快照同时验证生产集群的所有极限。

## 5. 必做实验

1. 快照扫描大表时持续执行 INSERT、UPDATE、DELETE；
2. 校验每个主键的最终状态和日志位置，没有缺行；
3. 调小日志保留，模拟 L0 被清理，观察恢复失败；
4. 对单表执行 Incremental Snapshot，控制 Chunk 大小；
5. 中断并恢复连接器，验证已完成 Chunk 不被错误跳过。

## 6. 排障顺序

先看状态是 `SNAPSHOT` 还是 `STREAMING`，再看数据库锁与扫描 SQL，然后检查 Queue/Kafka 背压，最后核对 Offset 所指日志是否仍存在。快照很慢不等于数据库慢，也可能是下游阻塞让读取线程无法继续。

参考：[Debezium Snapshots](https://debezium.io/documentation/reference/stable/connectors/mysql.html#mysql-snapshots)、[Incremental Snapshots](https://debezium.io/documentation/reference/stable/configuration/signalling.html)。
