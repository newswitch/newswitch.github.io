---
title: "Kafka Connect Worker、Connector、Task、REST API 与生命周期"
sidebar_label: "02. Kafka Connect 运行时与生命周期"
sidebar_position: 2
description: "解释 Debezium 在 Kafka Connect 中的 Worker、Connector、Task、内部 Topic、重平衡和 REST 管理路径。"
tags: [Debezium, Kafka Connect, Worker, Connector, Task, REST API]
---

# Kafka Connect Worker、Connector、Task、REST API 与生命周期

Debezium Connector 是插件，Kafka Connect 是负责加载插件、管理配置、分配 Task、提交 Offset 和暴露 REST API 的运行时。看到 Worker 进程健康不等于 Connector 或 Task 正常。

## 1. 对象关系

```text
Kafka Connect Cluster
├─ Worker A
│  ├─ Connector实例（管理配置和Task）
│  └─ Task实例（执行实际CDC）
├─ Worker B
└─ Kafka内部Topics
   ├─ config.storage.topic
   ├─ offset.storage.topic
   └─ status.storage.topic
```

分布式 Worker 使用相同 `group.id` 和内部 Topic 组成 Connect 集群。Connector 配置保存在 Config Topic，Source Offset 保存在 Offset Topic，运行状态保存在 Status Topic。

这些内部 Topic 的副本、压缩策略、ACL 和可用性属于 CDC 控制面，不能按普通业务 Topic 随意删除。

## 2. Worker、Connector 与 Task

| 对象 | 职责 |
| --- | --- |
| Worker | JVM 进程、插件加载、REST、转换器、Task 承载 |
| Connector | 验证配置、发现工作单元、管理 Task 配置 |
| Task | 连接数据库、Snapshot/Streaming、生成 SourceRecord |

`tasks.max` 是上限，不保证一定产生对应数量 Task。许多关系型 Debezium Connector 的一个数据库日志流主要由单 Task 读取，盲目提高 `tasks.max` 不会水平提升吞吐；以具体连接器文档为准。

## 3. SourceRecord 到 Kafka

```text
Debezium Task.poll()
→ 内部Change Event Queue
→ SourceRecord(key, value, sourcePartition, sourceOffset)
→ SMT可选转换
→ Converter序列化JSON/Avro/Protobuf
→ Kafka Producer写Topic
→ Connect按批次提交Source Offset
```

SMT 适合轻量路由和 Envelope 调整，不适合复杂业务计算。错误 SMT 或 Converter 会让源读取正常但事件无法写入 Kafka。

## 4. REST 生命周期

```bash
curl --fail http://connect:8083/connectors
curl --fail http://connect:8083/connectors/inventory-connector/status
curl --fail http://connect:8083/connectors/inventory-connector/config
```

常用生命周期操作包括创建、更新配置、暂停、恢复、重启 Connector/Task 和删除。生产 API 必须经过认证授权和 TLS；删除 Connector 可能影响配置与运行状态，但不会自动删除业务 Topic，Offset 状态的处理要按版本 API 明确执行。

## 5. 状态判断

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| RUNNING | 对象线程运行 | 仍需检查 Lag、Queue 和事件 |
| PAUSED | 人工暂停 | 核对变更和源日志保留 |
| FAILED | Connector/Task 异常 | 读取 Trace，修复根因后有界重启 |
| UNASSIGNED | 正在重平衡或没有可用 Worker | 查 Worker 集群和内部 Topic |

Task FAILED 时 Connector 可能仍显示 RUNNING，因此必须展开 `tasks[]`。反复 Restart 不会解决权限、Schema History、Binlog 已清理或坏事件。

## 6. Worker Rebalance

Worker 加入、退出或 Connector 变化会重新分配 Connector/Task。Rebalance 期间 CDC 暂停并可能从已提交 Offset 重放少量事件。频繁滚动 Worker 会造成 Lag 和重复，应使用滚动窗口、PDB 和稳定内部 Topic。

## 7. 插件和版本

插件通过 `plugin.path` 加载。Worker 镜像必须固定 Kafka Connect、Debezium Connector、JDBC 驱动、Converter 和 SMT 版本。类冲突、驱动缺失和同一集群 Worker 插件不一致，会造成 Task 只能在部分 Worker 启动。

升级前使用 `/connector-plugins` 核对每个 Worker 真实插件，并在预发布读取现有 Offset/Schema History 验证兼容。

## 8. 生产部署基线

- 至少多个 Worker 跨故障域，但理解单 Connector Task 的并行边界；
- 内部 Topic 使用合适副本、Compaction 和最小权限；
- REST API 不暴露公网；
- JVM Heap、GC、Change Event Queue 和 Kafka Producer 有容量监控；
- 数据库账号只具备 CDC 所需权限；
- Worker 优雅停止，避免持续 Rebalance；
- 配置与 Secret 分离，敏感字段不进入日志。

## 9. 故障实验

启动两个 Worker 和一个 Connector，停止承载 Task 的 Worker，观察 Rebalance、恢复位置和重复；再破坏 Converter 配置，区分 Source 读取与 Kafka Produce 错误；最后让内部 Status/Offset Topic 不可用，观察控制面影响。

参考：[Kafka Connect User Guide](https://kafka.apache.org/documentation/#connect)、[Debezium Architecture](https://debezium.io/documentation/reference/stable/architecture.html)。
