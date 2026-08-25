---
title: "Apache Doris 定位与学习路线"
sidebar_label: "00. Doris 定位与学习路线"
sidebar_position: 0
description: "理解 Doris 实时分析数据库的定位、学习路径及与 ClickHouse、Trino 的选型边界。"
tags: [Doris, OLAP, MPP, Analytics]
---

# Apache Doris 定位与学习路线

Apache Doris 是面向实时分析的 MPP 数据库。FE 负责 SQL 解析、优化、元数据和调度，BE 负责 Tablet 存储、向量化执行、Compaction 与副本；数据可通过 Stream Load、Broker Load、Routine Load 等方式进入系统。

## 1. 学习路径

1. 本文建立定位和选型；
2. [FE、BE、Tablet、Replica、Load、Query 与数据路径](./01-Doris-FE-BE-Tablet-Replica-Load-Query与数据路径.md)理解架构；
3. [部署、数据模型、容量、选型与故障 Runbook](./02-Doris部署-数据模型-容量-选型与故障Runbook.md)完成生产入门；
4. 深入阅读 [Doris MPP、Tablet、物化视图与查询加速](../olap/03-Doris-MPP-Tablet物化视图与查询加速.md)；
5. 实践 [Doris SQL、Load、Tablet 与诊断命令手册](../olap/91-Doris-SQL-Load-Tablet与诊断命令手册.md)。

## 2. 适用与边界

Doris 适合报表、用户行为、实时数仓、数据服务和高并发聚合。ClickHouse 在宽表日志、极致单表扫描和生态习惯上常有优势；Trino 是联邦查询引擎，本身通常不承担主存储。最终要用真实 Schema、查询、导入和故障模型测试。

## 3. 完成标准

能从 SQL 跟到 Fragment/BE/Tablet；能解释 FE Leader 与元数据多数派、BE 副本与 Tablet 分布；能根据明细、聚合、唯一键选择数据模型；能计算存储、副本、导入和查询容量；能定位查询慢、导入失败、副本不健康和 Compaction 积压。

参考：[Apache Doris Introduction](https://doris.apache.org/docs/gettingStarted/what-is-apache-doris)、[Doris Architecture](https://doris.apache.org/docs/gettingStarted/what-is-apache-doris#architecture)。
