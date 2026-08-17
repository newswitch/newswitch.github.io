---
title: "Key、Revision、MVCC、Range、Txn 与 Compare-And-Swap"
sidebar_position: 2
tags: [etcd, MVCC, Transaction, CAS]
description: "理解 etcd 全局 Revision、Key 元数据、范围读、事务比较与原子更新。"
---

# Key、Revision、MVCC、Range、Txn 与 Compare-And-Swap

etcd v3 保存按字节排序的 Key/Value，每次成功修改推进集群全局 Revision。Key 具有 create_revision、mod_revision、version 和 lease 等元数据。

## MVCC

```text
revision 100: put /config/a=v1
revision 101: put /config/b=v1
revision 102: put /config/a=v2
```

指定 Revision 的 Range 可读取历史一致视图，前提是该 Revision 尚未 Compaction。Revision 不是时间戳，也不是某个 key 的版本号。

## Range/Prefix

Prefix Get 本质是按 Key 范围读；大量 Key/Value 会增加 Leader/Backend/网络压力。使用 limit、keys-only、count-only 和分页，避免把 etcd 当文档/大对象数据库。

## Txn/CAS

Txn 结构：Compare → Success ops / Failure ops，整个事务原子应用：

```text
IF mod_revision(/lock/x) == expected
THEN put new value
ELSE get current
```

可比较 value/version/create/mod revision/lease。CAS 防止丢失更新，但客户端超时后结果不确定，使用幂等值和再次读取确认。

## 约束

Txn 大小、操作数、请求字节和历史受配置限制。复杂业务事务、海量大值应放数据库；etcd 保存小而关键的控制状态。

## 验收题

- 全局 Revision 与 key version 有何不同？
- Compaction 后历史读取会怎样？
- CAS 如何防止并发覆盖？
- Txn 超时为何仍需读取确认？

## 参考资料

- [etcd API guarantees](https://etcd.io/docs/v3.6/learning/api_guarantees/)
- [etcdctl transactions](https://etcd.io/docs/v3.6/tasks/developer/how-to-transactional-write/)
