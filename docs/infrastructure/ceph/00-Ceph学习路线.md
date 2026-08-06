---
title: "Ceph 学习路线"
sidebar_position: 0
tags: [Ceph, 学习路线, 存储]
description: 《Ceph 从零基础到生产运维实战》总目录：认识 Ceph → 核心原理 → 规划部署 → 实战 → 运维监控 → 排障 → 优化 → 综合项目。
---

# Ceph 从零基础到生产运维实战

本专栏面向从零基础到生产运维的完整路径，按 **认识 → 原理 → 规划部署 → 存储实战 → 运维监控 → 故障排查 → 生产优化 → 综合项目** 组织。

全系列正文已经完成。建议从第 1 篇顺序学习，并在隔离实验环境完成每篇的课后练习；生产命令必须结合实际 Ceph 版本、硬件和业务目标重新验证。

## 当前进度

| 部分 | 状态 |
| --- | --- |
| Part I · 认识 Ceph | 第 1～2 篇已完成 |
| Part II · 核心原理 | 第 3～6 篇已完成 |
| Part III · 集群规划与部署 | 第 7～10 篇已完成 |
| Part IV · 存储使用实战 | 第 11～15 篇已完成 |
| Part V · 日常运维与监控 | 第 16～17 篇已完成 |
| Part VI · 故障排查 | 第 18～20 篇已完成 |
| Part VII · 生产优化 | 第 21～28 篇已完成 |
| Part VIII · 综合项目 | 第 29 篇已完成 |

## 目录

### Part I · 认识 Ceph

| 章 | 标题 |
| --- | --- |
| 第 1 章 | [为什么需要 Ceph](./PartI-认识Ceph/为什么需要Ceph) |
| 第 2 章 | [理解三种存储类型](./PartI-认识Ceph/理解三种存储类型) |

### Part II · 核心原理

| 章 | 标题 |
| --- | --- |
| 第 3 章 | [Ceph 整体架构](./PartII-核心原理/Ceph整体架构) |
| 第 4 章 | [Ceph 数据组织原理](./PartII-核心原理/Ceph数据组织原理) |
| 第 5 章 | [CRUSH 数据分布原理](./PartII-核心原理/CRUSH数据分布原理) |
| 第 6 章 | [副本、纠删码与一致性](./PartII-核心原理/副本纠删码与一致性) |

### Part III · 集群规划与部署

| 章 | 标题 |
| --- | --- |
| 第 7 章 | [部署前的集群规划](./PartIII-集群规划与部署/部署前的集群规划) |
| 第 8 章 | [Ceph 容量计算](./PartIII-集群规划与部署/Ceph容量计算) |
| 第 9 章 | [使用 Cephadm 部署集群](./PartIII-集群规划与部署/使用Cephadm部署集群) |
| 第 10 章 | [Cephadm 管理机制](./PartIII-集群规划与部署/Cephadm管理机制) |

### Part IV · 存储使用实战

| 章 | 标题 |
| --- | --- |
| 第 11 篇 | [Pool 与 CephX 权限管理](./PartIV-存储使用实战/Pool与CephX权限管理) |
| 第 12 篇 | [CephFS 文件存储实战](./PartIV-存储使用实战/CephFS文件存储实战) |
| 第 13 篇 | [RBD 块存储实战](./PartIV-存储使用实战/RBD块存储实战) |
| 第 14 篇 | [RGW 对象存储实战](./PartIV-存储使用实战/RGW对象存储实战) |
| 第 15 篇 | [Ceph 接入 Kubernetes](./PartIV-存储使用实战/Ceph接入Kubernetes) |

### Part V · 日常运维与监控

| 章 | 标题 |
| --- | --- |
| 第 16 篇 | [Ceph 日常运维](./PartV-日常运维与监控/Ceph日常运维) |
| 第 17 篇 | [Ceph 监控告警](./PartV-日常运维与监控/Ceph监控告警) |

### Part VI · 故障排查

| 章 | 标题 |
| --- | --- |
| 第 18 篇 | [建立 Ceph 故障排查方法](./PartVI-故障排查/建立Ceph故障排查方法) |
| 第 19 篇 | [常见故障实战](./PartVI-故障排查/常见故障实战) |
| 第 20 篇 | [磁盘故障与数据恢复](./PartVI-故障排查/磁盘故障与数据恢复) |

### Part VII · 生产优化

| 章 | 标题 |
| --- | --- |
| 第 21 篇 | [Ceph 性能分析与优化](./PartVII-生产优化/Ceph性能分析与优化) |
| 第 22 篇 | [Cephadm 滚动升级实战](./PartVII-生产优化/Cephadm滚动升级实战) |
| 第 23 篇 | [Ceph 网络设计与故障排查](./PartVII-生产优化/Ceph网络设计与故障排查) |
| 第 24 篇 | [Ceph 备份与灾难恢复](./PartVII-生产优化/备份与灾难恢复) |
| 第 25 篇 | [Ceph 安全加固实战](./PartVII-生产优化/Ceph安全加固) |
| 第 26 篇 | [Ceph 自动化巡检与报告](./PartVII-生产优化/Ceph自动化巡检与报告) |
| 第 27 篇 | [Ceph 生产事故应急与复盘](./PartVII-生产优化/生产事故应急) |
| 第 28 篇 | [大规模 Ceph 集群设计与运维](./PartVII-生产优化/大规模Ceph集群优化) |

### Part VIII · 综合项目

| 章 | 标题 |
| --- | --- |
| 第 29 篇 | [10 台 2TB 服务器完整建设案例](./PartVIII-综合项目/十台2TB服务器完整建设案例) |

## 建议学习方式

1. Part I～II 建立存储接口、RADOS、PG、CRUSH 和一致性认知。
2. Part III 在虚拟机或专用实验服务器上完成规划与 cephadm 部署。
3. Part IV 分别实践 Pool/CephX、CephFS、RBD、RGW 和 Kubernetes CSI。
4. Part V～VI 建立固定巡检顺序，在隔离环境演练告警和故障。
5. Part VII 学习性能、安全、备份、自动化和事故处理。
6. 最后按 Part VIII 重做一次完整项目，并写出自己的验收报告。

## 相关专栏

- [K8s 存储](/docs/cloud-native-ai/k8s/K8s学习-PartI-存储/本章导读)（可与第 15 章对照）
- [K8s 学习路线](/docs/cloud-native-ai/k8s/Kubernetes学习路线)
