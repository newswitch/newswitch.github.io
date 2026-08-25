---
title: "Canal/Maxwell 部署、HA、重建、与 Debezium 选型及故障 Runbook"
sidebar_label: "02. 生产部署、选型与故障 Runbook"
sidebar_position: 2
description: "掌握 Canal 和 Maxwell 的生产部署、状态保护、故障切换、重建和 CDC 工具选型。"
tags: [Canal, Maxwell, Deployment, Troubleshooting]
---

# Canal/Maxwell 部署、HA、重建、与 Debezium 选型及故障 Runbook

## 1. 数据库与安全基线

MySQL 使用唯一 `server_id`、`binlog_format=ROW`，日志保留覆盖故障窗口。为复制账号授予最小复制和元数据读取权限，使用 TLS 和网络白名单。评估 `binlog_row_image` 对旧值完整性和日志量的影响。

## 2. 部署与 HA

Canal 可用 ZooKeeper 协调 Instance 主备，但同一 Instance 同时只有一个活动读取者；Canal Admin 管理配置不替代位点备份。Maxwell 通常以单活动实例运行，HA 依赖外部编排和共享/可恢复元数据库，必须防止两个实例用同一身份同时读取并重复写出。

镜像固定 JDK、工具与 Producer Client 版本；配置、位点、Schema 元数据和 MQ Topic 纳入备份。Kubernetes Probe 应区分进程存活、能连接 MySQL、位点推进和 MQ 可写。

## 3. 容量

观察 MySQL Binlog 生成率、读取 Lag、反序列化 CPU、内部队列、Producer 延迟和消息大小。大事务会造成瞬时内存与延迟，MQ 背压会反向阻塞 Binlog 读取。日志保留安全窗口必须在峰值与停机情况下计算。

## 4. Runbook

| 现象 | 检查 |
| --- | --- |
| 无消息 | MySQL 是否写 Binlog、过滤规则、位点是否推进 |
| 日志已过期 | 当前位点与最早 Binlog/GTID，选择恢复或重建 |
| DDL 后解析失败 | Schema 元数据、DDL 语法、工具版本 |
| 消息重复 | 崩溃与 Ack/Producer 提交边界，下游幂等 |
| 切主失败 | 新主 GTID 集、日志保留、地址和权限 |
| Canal Client 卡住 | Batch 是否 Ack/Rollback、客户端会话 |

重建前保存旧位点和影响范围；优先新 Topic 并行跑基线与增量，追平后对账切换，不要直接删元数据碰运气。

## 5. 与 Debezium 选型

已有 Canal 生态、MySQL 为主并需 Adapter/客户端拉取可选 Canal；只需简洁 Binlog→JSON 可评估 Maxwell；多数据库、Kafka Connect、标准 Envelope、Schema 演进和可观测治理要求高时优先 Debezium。最终用故障恢复演练和团队运维成本验证。

参考：[Canal QuickStart](https://github.com/alibaba/canal/wiki/QuickStart)、[Maxwell Configuration](https://maxwells-daemon.io/config/)。
