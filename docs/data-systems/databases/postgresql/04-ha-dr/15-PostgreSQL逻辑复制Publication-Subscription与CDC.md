---
title: "逻辑复制、Publication/Subscription、CDC 与迁移"
sidebar_label: "15. 逻辑复制、Publication/Subscription、CDC 与迁移"
sidebar_position: 15
description: "理解逻辑解码、Publication/Subscription、复制身份、Slot、DDL 和迁移切换。"
tags: [PostgreSQL, Logical Replication, CDC, Migration]
---

# 逻辑复制、Publication/Subscription、CDC 与迁移

逻辑复制从 WAL 解码行级变化，按 Publication 发布表和操作，由 Subscription 初始复制并持续 apply。它适合选择表、跨版本迁移和 CDC，不是完整物理灾备。

```text
WAL → logical decoding slot → publisher stream
→ subscriber apply worker → target tables
```

## 1. 前提 {/* #前提 */}

UPDATE/DELETE 需要 Replica Identity，通常是主键；无合适键可能使用 FULL，增加 WAL 和匹配成本。目标 Schema/DDL 多数需单独管理，Sequence、Large Object、权限和部分对象不会自动同步。

## 2. 一致性边界 {/* #一致性边界 */}

初始表复制与后续 WAL 通过快照/LSN 衔接。订阅端 apply 错误会阻塞，源 Slot 继续保留 WAL。监控 slot confirmed LSN、WAL retained、subscription worker 和表同步状态。

## 3. 冲突 {/* #冲突 */}

内建单向复制不负责多主冲突。目标侧写入可能造成唯一键/缺行冲突；迁移期应定义写权威、双写规则或禁止目标业务写。

## 4. 迁移流程 {/* #迁移流程 */}

```text
schema compatibility → initial copy → continuous catch-up
→ checksum/count/business validation → write freeze or dual-write fence
→ wait zero lag → switch clients → observe → retain rollback window
```

回滚必须处理切换后目标产生的新写，不能仅把 DNS 指回源。

## 5. CDC {/* #cdc */}

Debezium 等消费者使用 Slot；下游 Kafka/搜索需幂等、Schema 演进和 offset 备份。删除废弃 Slot 前确认消费者永久退役。

## 6. 逻辑复制实验与 Schema 边界 {/* #逻辑复制实验与-schema-边界 */}

```sql
SELECT * FROM pg_stat_subscription;
SELECT slot_name, active, confirmed_flush_lsn, restart_lsn
FROM pg_replication_slots WHERE slot_type='logical';
SELECT * FROM pg_publication_tables;
```

创建带主键表，测试 INSERT/UPDATE/DELETE、增加列、修改类型、订阅端写冲突和网络中断。逻辑复制复制行变化，不自动复制所有 DDL、sequence 状态、角色或大对象；目标 Schema 必须提前兼容。无适当 replica identity 的 UPDATE/DELETE 会失败或代价很高。

CDC 消费者必须持久化位点并幂等处理，监控 slot retained WAL、消息延迟、错误与目标对账。slot 停滞会填满源库磁盘，不能只看订阅“还在运行”。切换/迁移前完成初始快照与增量一致点设计，最后用行数、校验和和业务查询对账。

## 7. 验收题 {/* #验收题 */}

- 逻辑复制为何需要 Replica Identity？
- DDL/Sequence 为什么要单独迁移？
- 消费者离线怎样影响源库磁盘？
- 回切为何需要处理目标新增写？

## 8. 参考资料 {/* #参考资料 */}

- [Logical replication](https://www.postgresql.org/docs/18/logical-replication.html)
