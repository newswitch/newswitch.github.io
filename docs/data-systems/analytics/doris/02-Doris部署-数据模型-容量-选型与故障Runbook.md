---
title: "Doris 部署、数据模型、容量、选型与故障 Runbook"
sidebar_label: "02. 生产部署、容量与故障 Runbook"
sidebar_position: 2
description: "掌握 Doris 生产拓扑、数据与查询容量、升级安全和常见 FE/BE/Load/Query 故障定位。"
tags: [Doris, Deployment, Capacity, Troubleshooting]
---

# Doris 部署、数据模型、容量、选型与故障 Runbook

## 1. 生产拓扑

部署奇数个可选举 FE 跨故障域，按官方规则配置 Follower/Observer；BE 至少满足表副本数和一个故障域失效后的容量。BE 使用稳定高吞吐磁盘，配置多数据目录时理解磁盘均衡和故障隔离。生产域名、时钟、端口和文件描述符统一治理。

Kubernetes 可使用 Doris Operator，但仍要设计 FE/BE 稳定身份、PV、反亲和、资源和滚动顺序；Operator 只自动化生命周期，不替代副本与数据恢复方案。

## 2. 容量模型

```text
物理存储
≈ 原始数据 × 编码后比例 × 副本数
+ Compaction临时空间
+ 导入临时文件
+ 安全水位
```

查询容量看 Scan Bytes/s、并发、Join/聚合内存、Shuffle 网络和 Spill；导入容量看 Rows/s、批次大小、分区数、Tablet 数与 Compaction。保留至少一个 BE 故障后的磁盘和查询余量。

## 3. Runbook

| 现象 | 定位路径 |
| --- | --- |
| FE 无 Leader | FE 成员、多数派、网络、Meta Dir、时钟 |
| BE Unavailable | 心跳、进程、磁盘、端口、FE 中 Backend 状态 |
| 导入失败 | Load Error URL、过滤行、Schema、事务、磁盘 |
| Query 慢 | Queue→FE Plan→Profile→Scan/Join/Exchange/Spill |
| 副本不健康 | Tablet/Replica/Version/Backend/修复任务 |
| Compaction 积压 | Rowset、小批导入、磁盘 IO、Compaction Score |

磁盘满时不要直接删除 BE 数据目录文件；先限流导入、扩容或迁移 Tablet，并由系统元数据驱动修复。

## 4. 备份、升级与验收

备份 Catalog、建表、权限和关键数据到独立存储；定期恢复演练。升级核对版本路径，先 FE 后/或按官方顺序滚动并保持元数据多数派和数据副本；灰度验证导入、查询、物化视图和兼容客户端。

## 5. 选型基准

使用真实数据量、更新比例、查询模板、并发和 SLA，对 Doris、ClickHouse/Trino 等测试导入新鲜度、P95、故障降级、资源成本和运维复杂度。不要用单条 `SELECT count(*)` 决定生产选型。

参考：[Doris Deploy](https://doris.apache.org/docs/install/deploy-manually/integrated-storage-compute-deploy-manually/)、[Doris Troubleshooting](https://doris.apache.org/docs/faq/)。
