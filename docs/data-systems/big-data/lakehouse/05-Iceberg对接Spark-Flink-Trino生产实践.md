---
title: "Iceberg 对接 Spark、Flink、Trino 的生产实践"
sidebar_label: "05. Iceberg 对接 Spark、Flink、Trino 的生产实践"
sidebar_position: 5
description: "设计 Flink 实时写、Spark 维护/批处理、Trino 查询的多引擎兼容、发布与排障链路。"
tags: [Iceberg, Spark, Flink, Trino, 多引擎]
---

# Iceberg 对接 Spark、Flink、Trino 的生产实践

典型湖仓中 Flink 持续写入，Spark 批量加工/维护，Trino 交互查询。同表多引擎的风险不是“能否连上”，而是版本、Catalog、文件系统配置、类型、隔离、delete 支持和提交协议是否一致。

## 1. 统一边界

所有引擎统一：Catalog URI/warehouse、表规范版本、对象存储 endpoint/认证、时区、decimal/timestamp、默认文件格式/codec、分区策略和表属性。配置由平台模板生成，禁止每个作业复制一份漂移配置。

## 2. Flink 实时写

关注 checkpoint 与 snapshot commit 对齐、sink writer 并行度、upsert/changelog 语义、delete files、状态和小文件。Flink 作业升级前验证 connector与 state 兼容；checkpoint成功但表 commit慢会形成反压。

## 3. Spark 批处理与维护

固定 input snapshot 执行 ETL，输出使用原子表提交。Compaction、manifest rewrite、snapshot expiration 等 maintenance按表级锁/冲突策略错峰。查看 final physical plan、scan files/bytes 和输出文件分布。

## 4. Trino 查询

Coordinator 从 Catalog/metadata规划 splits，Worker 直接读对象。关注 metadata cache、planning、predicate/partition pushdown、split 数、delete merge 和对象存储请求。查询开始时应绑定一致 snapshot，语义以 connector版本为准。

## 5. 兼容矩阵

每次升级执行：

| 测试 | 验证 |
|---|---|
| Spark/Flink append | 三引擎 count/schema 可读 |
| update/delete | reader 均正确应用 delete |
| schema rename/add | 新旧 snapshot 和字段 ID |
| partition evolution | 新旧 spec过滤正确 |
| decimal/timestamp | 精度、时区、null |
| concurrent commit | 冲突重试无丢重 |
| time travel | 按 ID 返回固定结果 |

## 6. 权限与凭据

Catalog 权限与对象存储权限必须同时控制。只给 Catalog SELECT 但对象凭据可列整个 warehouse，仍可能绕过治理。短期身份、最小前缀权限、加密、审计与密钥轮换要跨引擎统一。

## 7. 故障排查

- 只某引擎读错：connector版本、类型/delete/缓存；
- 三引擎都看不到新数据：Catalog commit或 writer；
- Planning 慢：manifest/file 数、Catalog/对象请求；
- 查询慢：裁剪、split、对象/网络、delete files；
- Commit 冲突：并发操作范围、maintenance 重叠；
- 403/签名错误：身份、endpoint、时钟与网络代理。

## 8. 发布流程

在影子 Catalog/表跑兼容矩阵 → 回放代表 workload → 比对结果/计划/性能 → 小流量 reader → writer → maintenance → 全量。任何 writer 升级都要保留旧 reader 兼容与回滚 snapshot。

## 9. 掌握验收

- 统一三引擎的 Catalog、类型和存储配置；
- 解释 Flink checkpoint到 Iceberg snapshot 的交接；
- 用 Spark 安全维护且不影响实时 writer；
- 从 Trino planning 下钻到 manifest/file；
- 建立多引擎升级兼容矩阵。

上一篇：[小文件与生命周期](./04-并发提交小文件Compaction与快照生命周期.md)　下一模块：[Trino 架构与谓词下推](../../analytics/olap/01-Trino架构Stage-Split与谓词下推.md)

## 10. 参考资料 {/* #参考资料 */}

- [Iceberg Spark](https://iceberg.apache.org/docs/latest/spark/)
- [Iceberg Flink](https://iceberg.apache.org/docs/latest/flink/)
- [Trino Iceberg Connector](https://trino.io/docs/current/connector/iceberg.html)
