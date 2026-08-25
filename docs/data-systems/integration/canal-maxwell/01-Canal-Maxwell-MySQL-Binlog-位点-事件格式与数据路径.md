---
title: "Canal、Maxwell、MySQL Binlog、位点、事件格式与数据路径"
sidebar_label: "01. Binlog 与事件路径"
sidebar_position: 1
description: "跟踪 MySQL 事务从 Binlog 到 Canal/Maxwell 消息的路径，理解位点、Schema 与删除语义。"
tags: [Canal, Maxwell, Binlog, CDC]
---

# Canal、Maxwell、MySQL Binlog、位点、事件格式与数据路径

## 1. 共同原理

```text
MySQL事务COMMIT
→ ROW格式Binlog
→ Canal/Maxwell以Replica协议注册server_id
→ 读取Rotate/Format/TableMap/Rows/Query Event
→ 结合表元数据解码列
→ 转换为JSON/内部Entry
→ Kafka/RocketMQ/客户端
→ 下游幂等落地
```

`TableMapEvent` 把表 ID 与列布局关联；Rows Event 主要是值，不总带完整列名。因此工具必须维护 Schema 元数据，DDL 处理失败会影响后续行解码。

## 2. 位点

file/position 指向具体 Binlog 文件位置；GTID 表示事务集合，更适合在具有一致事务历史的副本间切换。位点状态和 Schema 元数据必须一起保护。日志保留小于最长停机时间时，工具即使保存位点也无法续读。

## 3. 事件差异

Canal Entry 通常包含 Header、EventType、RowData 的 before/after columns；Maxwell 默认输出更直接的 JSON，例如 database、table、type、ts、data、old。消费者不能把两种格式当作相同契约，尤其要测试：

- UPDATE 中未变化字段是否完整；
- DELETE 的主键和旧值；
- 无主键表如何生成消息 Key；
- DDL 是否独立输出、下游是否消费；
- DECIMAL、BIT、JSON、时间和二进制编码；
- 事务 ID、顺序和重复事件信息。

## 4. Canal 模型

一个 Canal Instance 对应一组 MySQL 源、过滤和位点；Canal Server 可承载多个 Instance。客户端使用 `get`/`getWithoutAck`、`ack`、`rollback` 形成消费确认边界；MQ 模式由 Server 推送到 Kafka/RocketMQ。

## 5. Maxwell 模型

Maxwell 以较少组件完成 Binlog→JSON Producer，并使用自己的元数据库保存 Schema 和 Position。轻量不等于无状态：生产迁移和恢复仍要保护这些表。

## 6. 正确性实验

快照/基线由谁提供要单独明确；执行大事务、主键更新、DDL、删除、进程强杀和主从切换；按主键最终状态、事务水位和消息数对账。消费者默认至少一次并实现幂等。

参考：[Canal Admin Guide](https://github.com/alibaba/canal/wiki/AdminGuide)、[Maxwell Data Format](https://maxwells-daemon.io/dataformat/)。
