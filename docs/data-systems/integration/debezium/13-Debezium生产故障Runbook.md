---
title: "Debezium 生产故障 Runbook"
sidebar_label: "13. Debezium 生产故障 Runbook"
sidebar_position: 13
description: "按数据库、Connector、Kafka 和消费者分层定位 CDC 停滞、日志过期、Slot 膨胀、Schema 错误与重复事件。"
tags: [Debezium, Runbook, Troubleshooting, CDC]
---

# Debezium 生产故障 Runbook

排障目标不是让状态重新变成 Running，而是证明来源位置连续、事件契约正确、目标数据最终收敛。

## 1. 先确定影响面

记录首次异常时间、Connector/Task、数据库与表、最后成功 Source Position、Kafka Topic/Partition、消费者新鲜度和最近变更。暂停会破坏证据的自动化操作，导出 Connector 状态、配置和关键日志。

## 2. 分层决策树

```text
源库是否持续产生日志？
├─ 否：业务无写入或数据库异常
└─ 是：Connector来源位置是否推进？
   ├─ 否：检查连接、权限、日志/Slot、DDL、Snapshot
   └─ 是：Kafka Topic末端是否推进？
      ├─ 否：检查Queue、Produce、ACL、Broker
      └─ 是：检查消费者Lag、反序列化、Sink和幂等
```

## 3. 常见故障表

| 现象 | 关键证据 | 处置原则 |
| --- | --- | --- |
| Binlog/WAL 已过期 | Offset 与最早可用日志 | 恢复日志或受控重建，不盲重启 |
| PostgreSQL Slot 暴涨 | retained bytes、active、LSN | 恢复消费/扩容/限流，谨慎删 Slot |
| History 恢复失败 | History Topic 与 Source Offset | 保护旧状态，在副本环境修复 |
| Connector Running 不推进 | Heartbeat、Source Position、Queue | 区分无写入与线程卡住 |
| 重复事件 | Source Position、Offset 提交时间 | 下游幂等，确认是否正常重放窗口 |
| DDL 后消费者失败 | Schema ID、Writer/Reader Schema | 兼容迁移，不直接删 Schema |
| Rebalance 循环 | Worker 日志、GC、插件一致性 | 稳定 Worker 资源和版本 |

## 4. 取证命令

```bash
curl -s http://connect:8083/connectors/NAME/status
curl -s http://connect:8083/connectors/NAME/config
curl -s http://connect:8083/connector-plugins
```

结合数据库查询 Binlog/GTID 或 `pg_replication_slots`，再查看 Kafka Topic 最新 Offset、内部 Queue/JMX 和消费者 Lag。命令输出必须带采集时间，敏感字段脱敏。

## 5. 禁止动作

未保存证据前不要删除 Connector、内部 Topic、Offset、History、Replication Slot；不要连续重启掩盖首个错误；不要为了释放磁盘直接清理数据库日志；不要把 Topic 有消息等同于数据正确。

## 6. 恢复验证

写入一条可追踪 Canary，确认它经过数据库提交、Debezium Source Position、Kafka 和目标系统；比较故障窗口内关键表主键集合与聚合；观察至少一个日志保留/任务峰值周期；补写时间线、根因、触发条件、检测缺口与防复发动作。

参考：[Debezium FAQ](https://debezium.io/documentation/faq/)、[Kafka Connect REST API](https://kafka.apache.org/documentation/#connect_rest)。
