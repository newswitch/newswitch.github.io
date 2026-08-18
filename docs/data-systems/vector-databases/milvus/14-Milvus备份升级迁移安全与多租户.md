---
title: "备份、Snapshot、升级、迁移、安全与多租户"
sidebar_label: "14. 备份、Snapshot、升级、迁移、安全与多租户"
sidebar_position: 14
description: "建立 Milvus 一致备份、恢复、版本升级、Collection 迁移和租户安全。"
tags: [Milvus, Backup, Upgrade, Security, Multi-tenancy]
---

# 备份、Snapshot、升级、迁移、安全与多租户

## 1. 备份 {/* #备份 */}

使用目标版本支持的 Milvus Backup/托管快照，协调 etcd metadata 与对象数据；同时保存 Schema、Index、Alias、Embedding 模型/预处理和应用配置。对象存储版本化并不自动形成一致 Milvus 恢复点。

恢复到隔离集群，验证 Collection/row count、索引、load、主键抽样、Recall 黄金集和 ACL。

## 2. 升级 {/* #升级 */}

核对 Server、SDK、Chart/Operator、etcd、Woodpecker/消息、对象存储和 Backup 工具兼容。先 staging 回放，再按组件支持顺序滚动；观察 DDL、写入、查询、load/index 和依赖。

回滚要确认 metadata/对象格式兼容；否则使用升级前备份恢复旧集群并切流。

## 3. 迁移 {/* #迁移 */}

导出/批量读取 → 目标建 Schema/Index → 回填 → 增量双写/事件同步 → count/checksum/Recall 校验 → Alias/连接切换。处理 Delete、乱序和模型版本。

## 4. 安全/租户 {/* #安全租户 */}

私网、TLS、认证/RBAC、最小数据库/Collection 权限、Secret 轮换和审计。多租户选择独立数据库/Collection/Partition/共享过滤时同时评估隔离、对象数量、资源组和配额。

## 5. 生产级变更与恢复闭环 {/* #生产级变更与恢复闭环 */}

Milvus 备份必须覆盖当前版本要求的 collection 数据、元数据、对象存储和依赖状态，并使用与 3.0 兼容的备份工具。复制 bucket 文件不一定得到一致快照；3.0 Snapshot 是只读时间点视图，也不等同于异地、不可变的灾备副本。

每次备份都在隔离环境恢复：连接新实例，核对 collection/schema/row count，重建或验证索引，执行黄金查询比较 Recall，并记录 RPO/RTO。升级先读所有跨越版本的 release/upgrade notes，验证服务端、SDK、Chart、备份工具和 index 兼容性，再灰度迁移；不可逆格式变化需要并行旧集群回切方案。

多租户要同时隔离认证授权、collection/database、Resource Group、配额、对象存储凭据、网络和监控查询。执行正向与越权矩阵；共享集群无法满足监管/故障域要求时，应使用独立集群。

## 6. 验收题 {/* #验收题 */}

- 只备份 S3 bucket 为什么不够？
- 升级需验证哪些依赖版本？
- 迁移怎样捕获回填期间的新写？
- 逻辑租户过滤为什么还需资源隔离？

## 7. 参考资料 {/* #参考资料 */}

- [Milvus Backup](https://milvus.io/docs/milvus_backup_overview.md)
- [Upgrade Milvus](https://milvus.io/docs/upgrade_milvus_standalone-operator.md)
