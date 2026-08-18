---
title: "Ceph 学习路线"
sidebar_label: "00. Ceph 学习路线"
sidebar_position: 0
description: "《Ceph 从零基础到生产运维实战》总目录：认识 Ceph → 核心原理 → 规划部署 → 实战 → 运维监控 → 排障 → 优化 → 综合项目。"
tags: [Ceph, 学习路线, 存储]
---

# Ceph 学习路线

本专栏面向从零基础到生产运维的完整路径，按 **认识 → 原理 → 规划部署 → 存储实战 → 运维监控 → 故障排查 → 生产优化 → 综合项目** 组织。

全系列正文已经完成。建议从第 1 篇顺序学习，并在隔离实验环境完成每篇的课后练习；生产命令必须结合实际 Ceph 版本、硬件和业务目标重新验证。

## 1. 当前进度 {/* #当前进度 */}

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

## 2. 目录 {/* #目录 */}

### 2.1 Part I · 认识 Ceph {/* #part-i--认识-ceph */}

| 章 | 标题 |
| --- | --- |
| 第 1 章 | [为什么需要 Ceph](./01-overview/01-为什么需要Ceph.md) |
| 第 2 章 | [理解三种存储类型](./01-overview/02-理解三种存储类型.md) |

### 2.2 Part II · 核心原理 {/* #part-ii--核心原理 */}

| 章 | 标题 |
| --- | --- |
| 第 3 章 | [Ceph 整体架构](./02-architecture/03-Ceph整体架构.md) |
| 第 4 章 | [Ceph 数据组织原理](./02-architecture/04-Ceph数据组织原理.md) |
| 第 5 章 | [CRUSH 数据分布原理](./02-architecture/05-CRUSH数据分布原理.md) |
| 第 6 章 | [副本、纠删码与一致性](./02-architecture/06-副本纠删码与一致性.md) |

### 2.3 Part III · 集群规划与部署 {/* #part-iii--集群规划与部署 */}

| 章 | 标题 |
| --- | --- |
| 第 7 章 | [部署前的集群规划](./03-deployment/07-部署前的集群规划.md) |
| 第 8 章 | [Ceph 容量计算](./03-deployment/08-Ceph容量计算.md) |
| 第 9 章 | [使用 Cephadm 部署集群](./03-deployment/09-使用Cephadm部署集群.md) |
| 第 10 章 | [Cephadm 管理机制](./03-deployment/10-Cephadm管理机制.md) |

### 2.4 Part IV · 存储使用实战 {/* #part-iv--存储使用实战 */}

| 章 | 标题 |
| --- | --- |
| 第 11 篇 | [Pool 与 CephX 权限管理](./04-client-usage/11-Pool与CephX权限管理.md) |
| 第 12 篇 | [CephFS 文件存储实战](./04-client-usage/12-CephFS文件存储实战.md) |
| 第 13 篇 | [RBD 块存储实战](./04-client-usage/13-RBD块存储实战.md) |
| 第 14 篇 | [RGW 对象存储实战](./04-client-usage/14-RGW对象存储实战.md) |
| 第 15 篇 | [Ceph 接入 Kubernetes](./04-client-usage/15-Ceph接入Kubernetes.md) |

### 2.5 Part V · 日常运维与监控 {/* #part-v--日常运维与监控 */}

| 章 | 标题 |
| --- | --- |
| 第 16 篇 | [Ceph 日常运维](./05-operations/16-Ceph日常运维.md) |
| 第 17 篇 | [Ceph 监控告警](./05-operations/17-Ceph监控告警.md) |

### 2.6 Part VI · 故障排查 {/* #part-vi--故障排查 */}

| 章 | 标题 |
| --- | --- |
| 第 18 篇 | [建立 Ceph 故障排查方法](./06-troubleshooting/18-建立Ceph故障排查方法.md) |
| 第 19 篇 | [常见故障实战](./06-troubleshooting/19-常见故障实战.md) |
| 第 20 篇 | [磁盘故障与数据恢复](./06-troubleshooting/20-磁盘故障与数据恢复.md) |

### 2.7 Part VII · 生产优化 {/* #part-vii--生产优化 */}

| 章 | 标题 |
| --- | --- |
| 第 21 篇 | [Ceph 性能分析与优化](./07-performance/21-Ceph性能分析与优化.md) |
| 第 22 篇 | [Cephadm 滚动升级实战](./07-performance/22-Cephadm滚动升级实战.md) |
| 第 23 篇 | [Ceph 网络设计与故障排查](./07-performance/23-Ceph网络设计与故障排查.md) |
| 第 24 篇 | [Ceph 备份与灾难恢复](./07-performance/24-备份与灾难恢复.md) |
| 第 25 篇 | [Ceph 安全加固实战](./07-performance/25-Ceph安全加固.md) |
| 第 26 篇 | [Ceph 自动化巡检与报告](./07-performance/26-Ceph自动化巡检与报告.md) |
| 第 27 篇 | [Ceph 生产事故应急与复盘](./07-performance/27-生产事故应急.md) |
| 第 28 篇 | [大规模 Ceph 集群设计与运维](./07-performance/28-大规模Ceph集群优化.md) |

### 2.8 Part VIII · 综合项目 {/* #part-viii--综合项目 */}

| 章 | 标题 |
| --- | --- |
| 第 29 篇 | [10 台 2TB 服务器完整建设案例](../../projects/ceph-cluster/29-十台2TB服务器完整建设案例.md) |

## 3. 建议学习方式 {/* #建议学习方式 */}

1. Part I～II 建立存储接口、RADOS、PG、CRUSH 和一致性认知。
2. Part III 在虚拟机或专用实验服务器上完成规划与 cephadm 部署。
3. Part IV 分别实践 Pool/CephX、CephFS、RBD、RGW 和 Kubernetes CSI。
4. Part V～VI 建立固定巡检顺序，在隔离环境演练告警和故障。
5. Part VII 学习性能、安全、备份、自动化和事故处理。
6. 最后按 Part VIII 重做一次完整项目，并写出自己的验收报告。

## 4. 相关专栏 {/* #相关专栏 */}

- [K8s 存储](../kubernetes/volumes/00-本章导读.md)（可与第 15 章对照）
- [K8s 学习路线](../../cloud-native/kubernetes/00-Kubernetes学习路线.md)
