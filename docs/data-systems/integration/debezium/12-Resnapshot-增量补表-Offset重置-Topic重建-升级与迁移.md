---
title: "Debezium Resnapshot、增量补表、Offset 重置、Topic 重建、升级与迁移"
sidebar_label: "12. 重建、补表、升级与迁移"
sidebar_position: 12
description: "用可审计流程完成 Debezium 补表、重快照、Offset/Topic 重建和版本迁移。"
tags: [Debezium, Resnapshot, Migration, Recovery]
---

# Debezium Resnapshot、增量补表、Offset 重置、Topic 重建、升级与迁移

重建不是“删掉 Offset 再重启”。它会重新定义存量基线、重复范围和事件顺序，必须先选择恢复目标，再操作状态。

## 1. 先选择目标

| 场景 | 优先方案 | 原因 |
| --- | --- | --- |
| 新增一张大表 | Incremental Snapshot | 不打断其他表 Streaming |
| 少量 Key 缺失 | 定向修复/补数 Topic | 影响范围最小 |
| History 完整、短时停机 | 从 Offset 续跑 | 保持连续位置 |
| 源日志已过期 | 恢复日志备份或重建基线 | 原 Offset 已不可读 |
| 目标 Topic 契约彻底变化 | 新 Topic 并行迁移 | 可验证、易回滚 |

## 2. 变更前证据包

保存 Connector/Worker 版本与配置、Source Offset、Schema History、源端最早/当前日志位置、Topic 分区和 Schema、下游消费组位置、关键表行数与校验结果。没有这些证据，就无法量化丢失和重复。

## 3. 安全重建流程

1. 停止写入不是默认要求，但要记录重建期间的增量边界；
2. 在新 Connector 名称和新 Topic Prefix 上做并行验证；
3. 完成一致快照并追平 Streaming；
4. 按主键分片比较行数、哈希和关键聚合；
5. 暂停下游写入，记录双边水位并切换；
6. 保留旧链路到观察期结束，再按审批清理。

直接复用旧 Topic 可能把 `op=r` 与旧增量混在一起；新 Topic 更便于对账和回滚。

## 4. Offset 重置边界

先确认 Source Partition 的身份字段。仅修改 Offset 而不匹配 Schema History，会在旧日志位置使用错误表结构。任何人工 Offset 操作都必须在支持的 API/工具下完成，保留前后值，并证明目标日志仍存在。

## 5. 升级

检查 Debezium、Kafka Connect、JDK、Converter、数据库和 Operator 兼容矩阵；阅读行为变更与弃用参数；用生产配置副本重放样本；先升级非关键 Connector。回滚条件不仅是进程失败，也包括 Schema 改变、Lag 失控和异常重放。

## 6. 完成标准

来源位置持续推进；重建期间没有不可解释的日志缺口；新旧目标对账达到阈值；消费者处理重复仍幂等；旧状态可在观察期内恢复。只有这五项同时满足才可关闭变更。

参考：[Debezium Signalling](https://debezium.io/documentation/reference/stable/configuration/signalling.html)、[Debezium Releases](https://debezium.io/releases/)。
