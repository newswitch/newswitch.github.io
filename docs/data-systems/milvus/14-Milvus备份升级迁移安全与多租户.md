---
title: "备份、Snapshot、升级、迁移、安全与多租户"
sidebar_position: 14
tags: [Milvus, Backup, Upgrade, Security, Multi-tenancy]
description: "建立 Milvus 一致备份、恢复、版本升级、Collection 迁移和租户安全。"
---

# 备份、Snapshot、升级、迁移、安全与多租户

## 备份

使用目标版本支持的 Milvus Backup/托管快照，协调 etcd metadata 与对象数据；同时保存 Schema、Index、Alias、Embedding 模型/预处理和应用配置。对象存储版本化并不自动形成一致 Milvus 恢复点。

恢复到隔离集群，验证 Collection/row count、索引、load、主键抽样、Recall 黄金集和 ACL。

## 升级

核对 Server、SDK、Chart/Operator、etcd、Woodpecker/消息、对象存储和 Backup 工具兼容。先 staging 回放，再按组件支持顺序滚动；观察 DDL、写入、查询、load/index 和依赖。

回滚要确认 metadata/对象格式兼容；否则使用升级前备份恢复旧集群并切流。

## 迁移

导出/批量读取 → 目标建 Schema/Index → 回填 → 增量双写/事件同步 → count/checksum/Recall 校验 → Alias/连接切换。处理 Delete、乱序和模型版本。

## 安全/租户

私网、TLS、认证/RBAC、最小数据库/Collection 权限、Secret 轮换和审计。多租户选择独立数据库/Collection/Partition/共享过滤时同时评估隔离、对象数量、资源组和配额。

## 验收题

- 只备份 S3 bucket 为什么不够？
- 升级需验证哪些依赖版本？
- 迁移怎样捕获回填期间的新写？
- 逻辑租户过滤为什么还需资源隔离？

## 参考资料

- [Milvus Backup](https://milvus.io/docs/milvus_backup_overview.md)
- [Upgrade Milvus](https://milvus.io/docs/upgrade_milvus_standalone-operator.md)
