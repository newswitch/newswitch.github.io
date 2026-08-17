---
title: "ACL、TLS、监控、Dashboard、升级与跨集群迁移"
sidebar_label: "13. ACL、TLS、监控、Dashboard、升级与跨集群迁移"
sidebar_position: 13
tags: [RocketMQ, ACL, TLS, Monitoring, Migration]
description: "建立 RocketMQ 安全身份、可观测、Dashboard 管理、滚动升级和迁移闭环。"
---

# ACL、TLS、监控、Dashboard、升级与跨集群迁移

## 安全

NameServer、Broker、Proxy、Controller 全部只在受控网络。按目标版本启用 TLS/ACL，Producer/Consumer 使用独立身份和最小 Topic/Group 权限；管理工具/Dashboard 使用更高权限但隔离入口、SSO/MFA 和审计。

## 监控

- 发送/消费 QPS、失败、P99、重试；
- Broker Put/Get、CommitLog/flush、Page Cache、磁盘；
- Replica lag、SyncStateSet、Controller quorum/election；
- Topic/Queue 分布、Consumer lag/age、DLQ；
- Proxy connections/latency、NameServer routes；
- JVM/GC、CPU、网络、文件描述符。

Dashboard 是查看/操作界面，不是监控和权限体系。禁止公网暴露，危险操作纳入审批。

## 升级

核对 NameServer/Broker/Proxy/Controller/SDK/工具兼容，先测试集群，再滚动无状态和副本，保持 SyncStateSet 和路由。升级前验证数据目录格式、配置废弃和回滚。

## 迁移

使用复制/双写/消费重放等受支持方案：创建目标资源 → 历史/实时同步 → count/offset/业务序号校验 → 灰度 Producer/Consumer → 停旧写 → 追平 → 切换。回切需处理目标新增消息。

## 验收题

- Dashboard 为什么不能直接暴露公网？
- 升级需维持哪些副本证据？
- 迁移为何同时迁 Topic、Group/offset 和 ACL？
- TLS 轮换要覆盖哪些组件？

## 参考资料

- [RocketMQ Dashboard](https://rocketmq.apache.org/docs/deploymentOperations/04Dashboard/)
- [RocketMQ operations](https://rocketmq.apache.org/docs/deploymentOperations/01deploy/)
