---
title: "物理备份、Clone 与大库恢复设计"
sidebar_position: 3
tags: [MySQL, 物理备份, Clone, 大库恢复]
description: "理解 InnoDB 物理备份的一致性、prepare/copy-back、Clone 供应和大库恢复的资源与时间预算。"
---

# 物理备份、Clone 与大库恢复设计

物理备份复制数据页和日志，比逐行逻辑重建更适合大库，但必须由支持在线一致性的工具协调数据文件与 redo。运行中直接复制 datadir 通常不是可靠备份。

## 1. 生命周期

```text
backup/copy
→ capture changed pages and redo
→ finalize metadata/checksum
→ transfer/encrypt/store
→ restore to isolated target
→ prepare/apply redo
→ copy-back or start target
→ validate
```

不同工具的 prepare 顺序、增量链和兼容矩阵不同，严格遵循对应版本文档。

## 2. 工具选择

- MySQL Enterprise Backup：官方商业物理备份；
- 生态物理备份工具：核对 MySQL 8.4 支持与测试；
- 云厂商快照：核对 crash/application consistency；
- Clone Plugin：在线把一个实例克隆到另一个实例，适合供应副本/集群成员。

Clone 依赖 donor 可用和网络，不等于跨账号、不可变、长期保留的备份。

## 3. 一致性与元数据

备份工件应绑定服务器版本、UUID、GTID、开始/结束、工具版本、增量父链、校验和和密钥。恢复时若缺任一增量或密钥，整条链可能不可用。

## 4. 大库资源模型

```text
backup time ≈ bytes read / effective throughput
restore time ≈ download + decrypt + prepare + copy + startup recovery + validation
```

effective throughput 受源盘、目标盘、网络、压缩 CPU、并发业务和限速影响。prepare 也可能 CPU/I/O 密集；恢复目标要预留数据、临时、redo、binlog 和校验空间。

## 5. 从副本备份

优点是降低主库 I/O；风险是副本延迟/漂移、备份时应用停止、binlog 位置不匹配。备份前确认 GTID 和数据健康，备份后让副本追平并检查延迟。

## 6. Clone 边界

部署前核对 donor/recipient 版本、平台、插件、权限、网络、加密和磁盘空间。Clone 会替换 recipient 数据，应只指向已确认的空/可重建目标，并确保没有错误路由到业务。

## 7. 恢复设计

恢复到新实例，禁止应用接入；完成 prepare/权限/配置；以只读方式做物理校验和业务校验；若需 PITR 再从备份记录点应用 Binlog；最后按变更流程切流。

## 8. 演练矩阵

全备恢复、全备+增量链、缺失增量、损坏块、密钥轮换后恢复、跨 AZ 下载、目标资源降级、恢复后建立复制。记录每阶段耗时，才能知道 RTO 的真正组成。

## 参考资料

- [InnoDB Backup](https://dev.mysql.com/doc/refman/8.4/en/innodb-backup.html)
- [Clone Plugin](https://dev.mysql.com/doc/refman/8.4/en/clone-plugin.html)
- [MySQL Enterprise Backup 8.4](https://dev.mysql.com/doc/mysql-enterprise-backup/8.4/en/)
