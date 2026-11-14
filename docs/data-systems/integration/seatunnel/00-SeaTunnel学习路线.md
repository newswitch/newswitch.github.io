---
title: "SeaTunnel 学习路线"
sidebar_label: "00. SeaTunnel 学习路线"
sidebar_position: 0
description: "从 Source、Transform、Sink 和 Zeta 引擎出发，学习 SeaTunnel 部署、任务配置、CDC、Checkpoint、吞吐容量和故障恢复。"
tags: [SeaTunnel, 数据集成, CDC, 学习路线]
---

# SeaTunnel 学习路线

SeaTunnel 是数据集成框架：连接器读取数据，转换组件处理行和表结构，执行引擎组织并行任务和恢复。它既能做有界批量复制，也能在连接器支持时持续读取变化事件。是否捕获删除、能否重放、目标是否恰好写入一次，都不能只从“支持流处理”这句话推导出来。

本系列固定 **Apache SeaTunnel 3.0.0** 为文档与源码基线，核对日期为 **2026-11-14**。主要讨论自带的 **Zeta 引擎**；Spark/Flink 运行方式不与 Zeta 的启动参数、驱动位置和恢复配置混用。升级前应重新核对连接器、JDK、驱动、存储插件与引擎的组合。

## 1. 与相邻工具的区别

| 工具 | 核心执行单元 | 先检查的边界 |
| --- | --- | --- |
| [DataX](../datax/00-DataX学习路线.md) | 一次 Reader/Writer 批任务 | 查询区间、并发快照、外部水位和重跑 |
| SeaTunnel | 连接器与执行 DAG | Source 可恢复性、Checkpoint 和 Sink 提交 |
| [NiFi](../nifi/00-NiFi学习路线.md) | FlowFile、Processor 与队列 | 路由、局部事务、外部副作用和队列容量 |
| [Airbyte](../airbyte/00-Airbyte学习路线.md) | Connection、Stream 与同步任务 | Catalog、游标、主键、State 和连接器能力 |
| [Debezium](../debezium/00-Debezium从零到精通学习路线.md) | 数据库日志事件 | Snapshot、日志位置、Schema History 和重建 |

SeaTunnel 不会代替数据库备份，也不会天然让任意两种数据库拥有一个跨系统事务。需要先定义事实源、同步方向、延迟、重复容忍度与目标发布规则。

## 2. 阅读顺序

1. [Source、Transform、Sink 与 Zeta 执行链路](./01-Source-Transform-Sink与Zeta执行链路.md)：跟随一条订单理解 API、数据流和控制流。
2. [部署、运行环境与集群模式](./02-部署运行环境与集群模式.md)：先完成本地最小任务，再理解集群发现与持久状态。
3. [HOCON 任务参数与数据契约](./03-HOCON任务参数与数据契约.md)：区分引擎配置、任务参数与连接器选项。
4. [CDC、Checkpoint 与一致性边界](./04-CDC-Checkpoint与一致性边界.md)：沿着快照、日志、检查点和提交理解恢复。
5. [并发、背压、性能与容量](./05-并发背压性能与容量.md)：用记录数、字节数和阶段耗时定位瓶颈。
6. [监控、故障恢复与升级](./06-监控故障恢复与升级.md)：用证据区分启动失败、运行卡住与恢复失败。

先读 1—3 篇，在无生产数据的环境运行 FakeSource 到 Console；再接入只读测试库与隔离目标表，验证失败重跑；最后才讨论持续 CDC、目标事务与集群故障。

## 3. 最小任务与验证范围

仓库 `examples/data-integration/seatunnel/smoke.conf` 是 JSON 语法的 HOCON 配置，等价内容见[任务参数](./03-HOCON任务参数与数据契约.md)。只使用 FakeSource 和 Console，不需要业务数据库；随机生成的值不能用作业务数据校验基准。

安装 SeaTunnel 与对应插件后，在 Linux 终端运行：

```bash
"$SEATUNNEL_HOME/bin/seatunnel.sh" --config /path/to/smoke.conf -m local
```

应检查进程退出状态、任务终态、输出 schema 和四条记录，而不是只看到启动横幅就认定成功。本系列配套的仓库检查是 MDX、配置及离线语义检查，**不等于实际运行了 SeaTunnel 或验证了 JDBC、CDC 与集群容灾**。

## 4. 学习后的自测边界

应该能够画出 SourceReader 与 Enumerator 的职责，解释并发为什么不能无限增加；判断从检查点恢复时哪些数据可能重放；为金额、时间、删除和 Schema 变化建立明确约定。对于具体连接器，还要阅读该版本文档并做目标环境测试，不能用 Console 的成功推导生产 Sink 的事务保证。

## 5. 练习与答案

**问题一：SeaTunnel 支持 CDC，是否意味着 JDBC 查询能发现硬删除？**

答案：不是。普通查询只看到当前可见行；捕获删除需要读取日志、墓碑或另行比对，并且下游支持表达删除。

**问题二：为何先运行 FakeSource，而不是直接同步生产全库？**

答案：它先排除运行包、插件、配置和基本执行链路问题，不引入生产负载与权限风险；随后仍需验证真实数据类型和提交行为。

**问题三：把执行引擎从 Zeta 换为 Flink，原配置是否无条件有效？**

答案：不能这样假定。引擎入口、依赖、状态存储、连接器支持矩阵和资源管理都需要重新核对。

**问题四：哪些结果能说明已具备生产同步能力？**

答案：除了成功结束，还要证明数据契约、负载、权限、检查点恢复、重复处理、删除、校验和目标发布都满足约定。

参考：[3.0.0 发行版本](https://github.com/apache/seatunnel/releases/tag/v3.0.0)、[架构总览](https://github.com/apache/seatunnel/blob/v3.0.0/docs/en/architecture/overview.md)、[Zeta 快速开始](https://github.com/apache/seatunnel/blob/v3.0.0/docs/en/getting-started/locally/quick-start-seatunnel-engine.md)。
