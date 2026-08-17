---
title: "监控、日志、备份、升级、迁移与多集群"
sidebar_label: "11. 监控、日志、备份、升级、迁移与多集群"
sidebar_position: 11
tags: [Nacos, Monitoring, Backup, Upgrade, Multi-cluster]
description: "建立 Nacos 服务/配置控制面的生命周期、灾备和多集群治理。"
---

# 监控、日志、备份、升级、迁移与多集群

## 监控

- Server/member、Distro/Raft、gRPC connection、请求/推送延迟；
- 服务/实例/健康变化、配置数/发布/监听；
- JVM/GC/线程/CPU/网络；
- 外部 DB pool/SQL/延迟/容量；
- 客户端连接、缓存版本和配置有效版本。

日志按 request/connection/service/dataId 关联并脱敏内容。

## 备份

外部数据库做全量+PITR，导出关键配置/Namespace/权限，保存 Nacos 版本、配置、插件、鉴权 Secret（受控）和集群成员。注册临时实例可由应用重建，持久配置必须恢复并验证。

## 升级

核对 Server/Client/JDK/DB Schema/插件/Console/Helm。先影子环境，再逐节点滚动；观察一致性、连接、推送和应用有效版本。Schema 变更前备份，回滚不能只换 JAR。

## 多集群

多机房通常各有本地 Nacos，应用使用本地控制面，配置/服务按明确权威同步。不要假设实验性 multi-cluster 功能已经满足生产；定义冲突、延迟、隔离和切换。

## 验收题

- 只备份数据库还缺什么？
- 临时实例与配置的恢复方式为何不同？
- 多集群谁是配置写权威？
- 升级后如何证明客户端全部收敛？

## 参考资料

- [Nacos admin manual](https://nacos.io/en/docs/latest/manual/admin/overview/)
