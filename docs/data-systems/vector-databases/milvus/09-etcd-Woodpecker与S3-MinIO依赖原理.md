---
title: "etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理"
sidebar_label: "09. etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理"
sidebar_position: 9
description: "区分 Milvus 元数据、顺序日志和向量/索引大对象的持久化责任。"
tags: [Milvus, etcd, Woodpecker, S3, MinIO]
---

# etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理

```text
etcd            → collection/schema/segment/coordination metadata
WAL/Woodpecker  → ordered mutations and streaming recovery
S3/MinIO        → binlog, stats, delta log, index artifacts and large objects
```

三者不能互相替代。只备份 etcd 没有向量数据；只复制对象存储缺少一致元数据和日志时间点。

## 1. etcd {/* #etcd */}

需要低延迟 SSD、奇数 quorum、TLS、快照和 compaction/defrag。etcd 慢会影响 DDL/调度，即使 QueryNode 已加载数据的部分查询暂时仍可运行。

## 2. WAL/Woodpecker {/* #walwoodpecker */}

保证变更顺序与恢复窗口。Standalone 可嵌入，Distributed 通常独立服务；旧版本可能使用 Pulsar/Kafka，部署必须按 release。监控 append latency、backlog、retention、consumer progress 和磁盘/对象容量。

## 3. Object Storage {/* #object-storage */}

要求高可用、版本/生命周期策略、带宽、请求限额和凭据轮换。误设生命周期删除仍被 Milvus 引用的对象会造成不可恢复错误。不要手工清理未知前缀。

## 4. 一致备份 {/* #一致备份 */}

使用官方 Backup/恢复工具或支持流程协调 metadata 与对象快照，并记录 Collection timestamp/version。恢复到隔离环境验证 count、索引、加载和黄金查询集。

## 5. 依赖边界与故障实验 {/* #30-依赖边界与故障实验 */}

Milvus 3.0 中 Woodpecker 作为独立流式/WAL 服务，Storage V3 的 manifest、column group 与 delta log 位于对象存储；etcd 仍承担关键元数据。它们的持久性、延迟和故障恢复目标不同，不能使用同一套“有三副本就安全”的假设。

测试环境依次注入：对象存储延迟/403、etcd 不可达、Woodpecker 节点故障。记录写入是否接受、读取是否继续、积压位置、恢复后的重复/丢失检查和告警时间。禁止在生产通过删除 etcd key、对象或 manifest 进行清障。

依赖验收至少覆盖 TLS/凭据轮换、bucket versioning/生命周期、防误删、etcd snapshot restore、Woodpecker 数据目录与备份边界、时钟/DNS 和容量告警。恢复顺序必须来自与当前版本匹配的官方文档，并在隔离环境演练。

## 6. 验收题 {/* #验收题 */}

- etcd 是否保存全部向量？
- WAL 与对象存储分别解决什么恢复阶段？
- 对象生命周期策略为何危险？
- 依赖故障时哪些请求可能继续、哪些失败？

## 7. 参考资料 {/* #参考资料 */}

- [Milvus storage](https://milvus.io/docs/architecture_overview.md)
- [Data infrastructure](https://milvus.io/docs/deploy_s3.md)
