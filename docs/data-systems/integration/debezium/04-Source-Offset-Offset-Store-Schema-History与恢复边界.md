---
title: "Debezium Source Offset、Offset Store、Schema History 与恢复边界"
sidebar_label: "04. Offset 与 Schema History"
sidebar_position: 4
description: "区分数据库日志位置、Source Offset、Offset Store 和 Schema History，建立可验证的恢复模型。"
tags: [Debezium, Offset, Schema History, Recovery]
---

# Debezium Source Offset、Offset Store、Schema History 与恢复边界

Debezium 能恢复，不只因为“记住消费到哪里”。它还要知道那个位置上数据库表的结构。Source Offset 与 Schema History 必须作为一组生产状态保护。

## 1. 四个容易混淆的概念

| 状态 | 回答的问题 | 示例 |
| --- | --- | --- |
| 数据库日志位置 | 数据库事务发生在哪里 | MySQL file/pos、GTID；PostgreSQL LSN |
| Source Offset | 连接器确认处理到哪个来源位置 | 分区标识、日志位置、快照状态 |
| Offset Store | Source Offset 保存在哪里 | Kafka compacted topic、文件、Redis/JDBC 等 |
| Schema History | 在某个日志位置上表结构是什么 | DDL 历史与解析所需元数据 |

Kafka 消费者组 Offset 是下游读到哪个 Kafka Record，不能替代 Debezium Source Offset。

## 2. 恢复链路

```text
Connector启动
→ 根据逻辑名称找到Source Partition
→ 从Offset Store读取Source Offset
→ 回放Schema History到对应位置
→ 检查源日志仍可访问
→ 继续解析下一条事务日志
```

任一环节不一致都会出问题：改了逻辑名称可能像“全新连接器”；Offset 在但 Binlog 已清理无法续读；Offset 存在但 History Topic 丢失，连接器不知道旧 DDL 后的行格式。

## 3. 为什么不能直接删 Offset

删除 Offset 相当于主动丢弃恢复坐标。接下来选择重新快照、从当前日志开始还是手工指定位置，会决定丢数据或重复数据的边界。生产变更前必须记录：

- Connector 名称、Server/Topic Prefix 和 Source Partition；
- 当前 Offset 原文以及对应 Binlog/GTID/LSN；
- Schema History Topic 的配置、保留策略与副本；
- 源数据库最早仍可用日志位置；
- 下游允许的重放范围与幂等键。

## 4. 存储要求

Kafka Connect 的 Config、Offset、Status Topic 应使用可靠副本和 compact 策略；Schema History Topic 通常也依赖 compaction，不能被普通时间保留提前清空。禁止多个不相关环境共用同名内部 Topic。

备份不能只导出 YAML。至少应保存 Connector 配置、Offset 可读快照、History Topic、数据库日志保留信息和版本清单，并通过隔离环境演练恢复。

## 5. Offset 与提交语义

Source Record 进入框架后，Offset 会周期性提交。因此进程在“事件已经写入 Kafka、Offset 尚未提交”时崩溃，恢复后会重放事件。这是至少一次链路的正常结果。消费者用业务主键、来源位置或事件 ID 做幂等，不能假定绝不重复。

## 6. 故障决策

1. 先停止自动重启，保全当前配置和状态；
2. 判断问题是 Offset 丢失、History 丢失，还是源日志过期；
3. 计算可以从哪里恢复以及会重放/缺失多少；
4. 优先在副本环境验证恢复方案；
5. 恢复后按主键范围和日志水位做对账。

“任务 Running”不是恢复成功；必须证明来源位置推进、History 可解析、目标数据收敛。

参考：[Debezium Storage](https://debezium.io/documentation/reference/stable/configuration/storage.html)、[Kafka Connect Distributed Configuration](https://kafka.apache.org/documentation/#connectconfigs)。
