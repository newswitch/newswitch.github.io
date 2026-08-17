---
title: "etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理"
sidebar_label: "09. etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理"
sidebar_position: 9
tags: [Milvus, etcd, Woodpecker, S3, MinIO]
description: "区分 Milvus 元数据、顺序日志和向量/索引大对象的持久化责任。"
---

# etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理

```text
etcd            → collection/schema/segment/coordination metadata
WAL/Woodpecker  → ordered mutations and streaming recovery
S3/MinIO        → binlog, stats, delta log, index artifacts and large objects
```

三者不能互相替代。只备份 etcd 没有向量数据；只复制对象存储缺少一致元数据和日志时间点。

## etcd

需要低延迟 SSD、奇数 quorum、TLS、快照和 compaction/defrag。etcd 慢会影响 DDL/调度，即使 QueryNode 已加载数据的部分查询暂时仍可运行。

## WAL/Woodpecker

保证变更顺序与恢复窗口。Standalone 可嵌入，Distributed 通常独立服务；旧版本可能使用 Pulsar/Kafka，部署必须按 release。监控 append latency、backlog、retention、consumer progress 和磁盘/对象容量。

## Object Storage

要求高可用、版本/生命周期策略、带宽、请求限额和凭据轮换。误设生命周期删除仍被 Milvus 引用的对象会造成不可恢复错误。不要手工清理未知前缀。

## 一致备份

使用官方 Backup/恢复工具或支持流程协调 metadata 与对象快照，并记录 Collection timestamp/version。恢复到隔离环境验证 count、索引、加载和黄金查询集。

## 验收题

- etcd 是否保存全部向量？
- WAL 与对象存储分别解决什么恢复阶段？
- 对象生命周期策略为何危险？
- 依赖故障时哪些请求可能继续、哪些失败？

## 参考资料

- [Milvus storage](https://milvus.io/docs/architecture_overview.md)
- [Data infrastructure](https://milvus.io/docs/deploy_s3.md)
