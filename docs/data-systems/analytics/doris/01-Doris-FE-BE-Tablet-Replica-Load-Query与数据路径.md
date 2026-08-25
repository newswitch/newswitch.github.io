---
title: "Doris FE、BE、Tablet、Replica、Load、Query 与数据路径"
sidebar_label: "01. 架构、导入与查询路径"
sidebar_position: 1
description: "跟踪数据导入和 SQL 查询在 FE、BE、Tablet、Replica 间的完整执行路径。"
tags: [Doris, FE, BE, Tablet, Query]
---

# Doris FE、BE、Tablet、Replica、Load、Query 与数据路径

## 1. 组件职责

| 组件 | 主要职责 |
| --- | --- |
| FE | MySQL 协议、SQL Parse/Optimize、Catalog、权限、调度 |
| FE Leader/Follower/Observer | 元数据写入、多数派复制与读扩展 |
| BE | Tablet 存储、导入、向量化执行、Shuffle、Compaction |
| Tablet/Replica | 表分区和 Bucket 的物理分片及副本 |

FE 保存元数据但不承载主要用户数据；BE 无法只靠本地目录推断完整 Catalog。两类状态都要备份和监控。

## 2. 导入路径

```text
Client提交Stream/Routine/Broker Load
→ FE创建事务与执行计划
→ 数据按Partition/Bucket分发到BE
→ BE写对应Tablet Replica与临时Rowset
→ 达到副本提交条件
→ FE提交事务使版本可见
→ 后台Compaction合并Rowset
```

导入成功要同时看 Job 状态、过滤行比例、事务可见性和副本健康。大量小批会制造 Rowset 和 Compaction 压力，即使每次导入都很快。

## 3. 查询路径

```text
Client → FE解析/鉴权/优化
→ 选择Partition、Tablet和Replica
→ 拆分Plan Fragment
→ BE并行Scan/Join/Aggregate/Exchange
→ Coordinator汇总
→ 返回结果
```

分区裁剪减少 Tablet 范围；Bucket 与 Colocate 影响 Shuffle；排序键和 Zone Map 帮助减少扫描；物化视图可被优化器透明改写。先用 Profile 证明时间花在 Scan、Exchange、Join、Aggregation 还是 Queue。

## 4. 数据模型

Duplicate Key 保存明细；Aggregate Key 在存储层聚合；Unique Key 表达主键更新，Merge-on-Write 提高查询性能但增加写入工作。模型选择错误会导致结果语义或资源成本问题，不能只看建表成功。

## 5. 副本与版本

Tablet 各 Replica 要保持可用版本。BE 宕机、磁盘坏或长时间 Compaction 可造成缺副本/版本落后。修复前确认 Tablet、Replica、Backend、Version 和最近导入事务，避免把查询失败笼统归因于 FE。

参考：[Doris Architecture](https://doris.apache.org/docs/gettingStarted/what-is-apache-doris#architecture)、[Data Models](https://doris.apache.org/docs/table-design/data-model/overview)。
