---
title: "源码、注册丢失、配置不生效、选主/数据库异常 Runbook"
sidebar_position: 12
tags: [Nacos, 源码, Runbook]
description: "从 SDK、gRPC、Naming/Config、Distro/JRaft 到数据库定位 Nacos 生产故障。"
---

# 源码、注册丢失、配置不生效、选主/数据库异常 Runbook

## 源码地图

固定 Nacos tag，按模块追踪：Client SDK → addressing/auth → gRPC/HTTP → Naming/Config service → Distro/JRaft → datasource；Console 是独立管理入口。用 request ID、connection ID、service/DataId 和 revision/hash 关联。

## Runbook

```text
register lost → SDK heartbeat/connection → 9848/LB
              → instance type/health → Distro owner/sync
config stale → publish revision → listener/connection
             → local cache → callback/app effective version
no leader/write fail → members/7848 → JRaft term/log → disk/GC/network
DB error → pool/credentials → SQL/HA/latency → Config persistence
```

## 保护动作

配置发布异常先暂停变更；推送风暴限流管理面；数据库故障保护连接池；保留节点/客户端日志、成员、连接和配置 Revision。不要清内置数据/数据库表或重置集群身份。

## 源码调试

用最小三节点和测试 SDK 复现，开启受控 metrics/JFR/async-profiler，搜索日志码和接口；验证相同版本后再推断生产。第三方插件/SDK 冲突先做依赖树。

## 验收题

- 注册丢失为何要同时查 SDK 和 Distro owner？
- 配置发布成功后最末端证据是什么？
- 数据库故障为何可能不立即中断已有发现？
- 如何区分 gRPC 端口与 JRaft 端口故障？

## 参考资料

- [Nacos source](https://github.com/alibaba/nacos)
- [Nacos troubleshooting](https://nacos.io/en/docs/latest/manual/admin/monitor-guide/)
