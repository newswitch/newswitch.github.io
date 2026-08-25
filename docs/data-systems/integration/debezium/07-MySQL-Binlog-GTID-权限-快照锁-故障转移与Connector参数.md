---
title: "Debezium MySQL：Binlog、GTID、权限、快照锁、故障转移与 Connector 参数"
sidebar_label: "07. MySQL Connector 生产实践"
sidebar_position: 7
description: "从 MySQL 日志前提到故障转移，掌握 Debezium MySQL Connector 的生产配置和验收方法。"
tags: [Debezium, MySQL, Binlog, GTID]
---

# Debezium MySQL：Binlog、GTID、权限、快照锁、故障转移与 Connector 参数

MySQL Connector 的正确性依赖 Binlog 格式、日志保留、Server ID、权限与拓扑。连接器启动成功只证明网络通，不证明切主后还能续读。

## 1. 数据库前提

```ini
[mysqld]
server-id=101
log_bin=mysql-bin
binlog_format=ROW
binlog_row_image=FULL
binlog_expire_logs_seconds=604800
```

`ROW` 提供行级变化；`FULL` 最容易保证更新前字段完整，若改用 `MINIMAL`，消费者必须接受 `before` 缺字段。日志保留要覆盖停机、快照、故障切换和人工处理时间。

常用权限涉及 `SELECT`、`RELOAD`、`SHOW DATABASES`、`REPLICATION SLAVE/CLIENT`，以及连接器版本与快照模式需要的锁权限。遵循最小权限，并在预生产用真实快照流程验证，不能只测连接。

## 2. 关键配置分组

| 分组 | 典型参数 | 设计目的 |
| --- | --- | --- |
| 身份 | `topic.prefix`、`database.server.id` | 保持唯一且长期稳定 |
| 连接 | hostname、port、user、TLS | 安全访问数据库 |
| 范围 | database/table include list | 在源端尽早过滤 |
| 快照 | `snapshot.mode`、locking mode | 决定基线与锁影响 |
| 事件 | converters、decimal/time handling | 固定下游契约 |
| 吞吐 | batch、queue、poll interval | 平衡内存、延迟和背压 |
| 恢复 | GTID、heartbeat | 观测位置并跨低流量表推进 |

## 3. GTID 与故障转移

file/position 通常绑定某个实例；GTID 描述事务集合，更适合在拥有相同事务历史的副本之间续读。但启用 GTID 不代表任意副本都能切换。必须验证：新主包含连接器已确认的全部 GTID、Binlog 未清理、Server UUID/拓扑过滤正确、DNS 或连接地址已切换。

切主操作：冻结 Connector 或确认其状态，记录 Offset/GTID；完成数据库选主；验证事务集合包含关系；更新连接地址；恢复连接器；观察无缺口推进，并按主键/事务水位对账。

## 4. 快照锁影响

不同 MySQL 版本与快照模式使用的锁不同。先用大表和持续 DDL/DML 做压测，观测 Metadata Lock、事务时长和复制延迟。若无锁快照，需要接受并验证其一致性约束，不能只因为“锁少”就直接用于生产。

## 5. 常见故障

- `server_id` 冲突：连接被数据库踢下线；
- Binlog 已清理：Offset 无法继续，只能恢复日志或重建基线；
- DDL 解析失败：检查 History、连接器版本和不支持语法；
- Lag 增长：区分数据库读取、内部 Queue、Kafka Produce 和下游 Lag；
- 切主后重复：对比 GTID 集、Source Offset 与新主日志，而不是盲删 Offset。

## 6. 验收

执行快照中写入、低流量 Heartbeat、Connector 重启、Kafka 短时不可用、主从切换、DDL 和日志临近过期六类实验；全部通过后才算生产可用。

参考：[Debezium MySQL Connector](https://debezium.io/documentation/reference/stable/connectors/mysql.html)、[MySQL Binary Log](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)。
