---
title: 湖仓查询与 OLAP 选型、基准测试和故障排查
sidebar_position: 4
tags: [OLAP, 选型, 基准测试, 故障排查]
description: 根据数据所有权、新鲜度、并发和查询模式选择 Trino、ClickHouse、Doris 或混合架构。
---

# 湖仓查询与 OLAP 选型、基准测试和故障排查

“谁最快”没有脱离 workload 的答案。Trino 擅长联邦/湖上分布式查询；ClickHouse、Doris 等拥有自己的列式存储和服务化能力。很多生产平台同时用湖仓作为权威层、OLAP 作为高并发服务层。

## 1. 需求矩阵

| 维度 | 需要量化 |
|---|---|
| 数据 | 总量、日增、更新/删除、schema变化 |
| 查询 | 扫描比例、Join、聚合、高基数、点查 |
| 服务 | QPS、并发、P50/P95/P99、可用性 |
| 新鲜度 | T+1、分钟、秒级 |
| 写入 | 批量、流式、乱序、幂等 |
| 治理 | 权限、血缘、历史版本、多引擎 |
| 成本 | 存储副本、计算常驻、数据复制、运维 |

## 2. 典型选择

- 湖上探索、跨源查询、低到中并发：Trino + Iceberg；
- 高频固定分析、日志时序、大扫描聚合：ClickHouse 类；
- 实时导入、报表/物化视图和 MPP 服务：Doris 类；
- 权威湖仓 + 热数据/聚合下沉 OLAP：混合架构。

这不是硬规则，必须用真实 SQL验证。

## 3. 双存储一致性

湖仓同步到 OLAP 时定义：source snapshot/offset、目标版本、重复写幂等、迟到/更新、校验和切换。OLAP 是派生服务层时，应能从湖仓重建。不要让两个系统都被称为“唯一真相”。

## 4. 基准设计

数据量和分布必须代表生产，包含热 key、NULL、宽行和小文件。Query set覆盖：高选择过滤、全扫聚合、大/小表 Join、高基数 group、Top-N、并发 dashboard、突发 ad-hoc。

分别测试冷/热缓存、正常/单节点故障、写入/compaction并发。记录吞吐与 P50/P95/P99、扫描字节、CPU/内存/磁盘/网络、失败率、恢复和成本。

禁止只跑一次平均耗时；固定版本/配置、预热规则和正确结果 checksum。

## 5. 通用排障

1. 排队还是执行慢；
2. Planning/Catalog 还是 scan；
3. 是否裁剪和下推；
4. Join/Shuffle/倾斜；
5. CPU、内存/GC、spill、磁盘、网络；
6. 后台 merge/compaction/load争抢；
7. 单节点/单 shard/tablet 热点；
8. 修复后结果与资源校验。

## 6. SLO 与隔离

Ad-hoc 大查询和 dashboard 不应无界共享。使用 resource group/workload group、队列、并发、内存/扫描限制、优先级和超时。为 ingestion/compaction保留资源，否则查询高峰会让数据停止更新。

## 7. 成本

计算：常驻节点 + 弹性执行；存储：湖仓+OLAP副本+临时；网络：同步、查询和恢复；运维：升级、备份和人员。更低查询延迟可能通过预计算和数据复制换来，ROI要按业务价值衡量。

## 8. 掌握验收

- 用需求矩阵而非产品偏好选型；
- 设计湖仓到 OLAP 的可重建派生链路；
- 建立真实分布、并发和故障基准；
- 从排队/规划/执行逐层排障；
- 把资源隔离与数据新鲜度同时纳入 SLO。

上一篇：[Doris MPP 与物化视图](./03-Doris-MPP-Tablet物化视图与查询加速.md)　下一模块：[Debezium CDC](../../big-data/engineering-governance/01-Debezium-CDC-Binlog快照与Schema-Change.md)

## 参考资料

- [Trino Use Cases](https://trino.io/docs/current/overview/use-cases.html)
- [ClickHouse Documentation](https://clickhouse.com/docs/)
- [Apache Doris Documentation](https://doris.apache.org/docs/)
