---
title: "Loki 单体、Simple Scalable、Microservices 与 Kubernetes 部署"
sidebar_label: "12. Loki 部署模式与生产基线"
sidebar_position: 12
description: "按日志规模和团队能力选择 Loki 部署模式，规划对象存储、缓存、租户、扩缩容与升级。"
tags: [Loki, Simple Scalable, Microservices, Kubernetes, 部署]
---

# Loki 单体、Simple Scalable、Microservices 与 Kubernetes 部署

Loki 使用同一二进制运行不同 Target。单体模式适合实验和较小规模，Simple Scalable 把读、写和后端职责分组，Microservices 模式把组件独立扩展；具体推荐边界随版本演进，应以目标版本文档为准。

## 1. 模式对比

| 模式 | 特点 | 适用 |
| --- | --- | --- |
| Monolithic | 一个进程运行主要组件 | 开发、小规模、低复杂度 |
| Simple Scalable | Read/Write/Backend 分组 | 中等规模、希望独立扩读写 |
| Microservices | Distributor、Ingester、Querier 等独立 | 大规模、多租户、成熟平台团队 |

从单体进入分布式不会自动解决高基数和查询风暴，反而新增 Ring、缓存、对象存储、调度和组件间网络。

## 2. 生产依赖

```text
入口网关/认证
→ Write组件
→ Ingester/WAL/Ring
→ 对象存储与索引
→ Backend/Compactor
→ Read/Query Frontend/Querier/缓存
```

生产对象存储的 Bucket、权限、TLS、加密和生命周期要与 Retention 配合。Compactor 等具有协调要求的组件按官方副本语义部署，不能随意水平扩多份。

## 3. Kubernetes 设计

- 使用官方支持的 Helm Chart/Operator 版本组合；
- Stateful 组件配置稳定身份和持久卷；
- 读写组件跨节点/可用区分散；
- Gateway 做认证、Tenant 注入和请求限制；
- 缓存设置容量、淘汰和故障旁路；
- NetworkPolicy 只开放必要组件路径；
- 配置 Schema/Index 周期变更时保留兼容读取。

## 4. 扩缩容依据

写路径看 bytes/s、lines/s、active streams、ingester memory、WAL 和限流；读路径看 Query Queue、扫描字节、并发、缓存命中和 P99；Backend 看 Compaction、Retention 和对象存储错误。

## 5. 升级与迁移

先阅读 Schema、Index、Storage 和 Chart 兼容说明，备份配置与对象存储，灰度无状态组件，再按状态组件要求滚动。不要同时更换 Loki 大版本、Schema 和对象存储。

## 6. 验收

持续写入日志，依次停止写组件、Ingester、对象存储和读组件，记录写入成功、近期/历史查询及恢复时间；再制造高基数 Stream 和大范围查询，验证限流保护。

参考：[Loki Deployment Modes](https://grafana.com/docs/loki/latest/get-started/deployment-modes/)。
