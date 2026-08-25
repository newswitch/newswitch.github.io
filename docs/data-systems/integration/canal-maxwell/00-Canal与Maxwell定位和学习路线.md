---
title: "Canal 与 Maxwell 定位和学习路线"
sidebar_label: "00. Canal 与 Maxwell 定位和学习路线"
sidebar_position: 0
description: "理解两种 MySQL Binlog CDC 工具的定位、核心差异及与 Debezium 的选型边界。"
tags: [Canal, Maxwell, MySQL, CDC]
---

# Canal 与 Maxwell 定位和学习路线

Canal 和 Maxwell 都通过伪装成 MySQL Replica 读取 Binlog。Canal 提供 Server/Instance、客户端拉取和多种 MQ Adapter；Maxwell 更轻量，通常直接把行变更输出为 JSON 到 Kafka 等目的地。

## 1. 学习路径

1. 本文建立定位和选型；
2. [MySQL Binlog、位点、事件格式与数据路径](./01-Canal-Maxwell-MySQL-Binlog-位点-事件格式与数据路径.md)理解原理；
3. [部署、HA、重建、与 Debezium 选型及故障 Runbook](./02-部署-HA-重建-与Debezium选型及故障Runbook.md)掌握生产边界。

## 2. 差异速览

| 维度 | Canal | Maxwell | Debezium |
| --- | --- | --- | --- |
| 主要数据库 | MySQL 生态 | MySQL | 多数据库 Connector |
| 输出形态 | Client/MQ/Adapter | JSON Producer | Kafka Connect/Server/Engine |
| 架构复杂度 | 中 | 低 | 中 |
| Schema/生态治理 | 需自行组合 | 较轻 | Envelope、History、Registry 集成成熟 |
| 适合 | 国内 MySQL 同步、定制消费 | 简单 Binlog→JSON | 企业多源 CDC 平台 |

## 3. 完成标准

能解释 Binlog file/position/GTID、ROW Event 和 DDL；能识别 INSERT/UPDATE/DELETE 事件字段；能保护位点和元数据；能处理日志过期、主从切换、重复消息和重建；能根据现有生态而不是流行度选择工具。

参考：[Canal Wiki](https://github.com/alibaba/canal/wiki)、[Maxwell Documentation](https://maxwells-daemon.io/)。
