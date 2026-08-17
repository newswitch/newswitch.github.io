---
title: "Namespace、Group、Service、Cluster、Instance 与 DataId"
sidebar_label: "02. Namespace、Group、Service、Cluster、Instance 与 DataId"
sidebar_position: 2
tags: [Nacos, Namespace, Service, DataId]
description: "掌握 Nacos Naming/Config 资源模型、环境租户隔离和命名规范。"
---

# Namespace、Group、Service、Cluster、Instance 与 DataId

## Naming

```text
Namespace → Group → Service → Cluster → Instance
```

Namespace 隔离环境/租户，Group 做逻辑分组，Service 是订阅名，Cluster 表示机房/区域实例集合，Instance 包含 IP、端口、weight、metadata、enabled/healthy 和临时/持久属性。

## Config

配置通常由 `(Namespace, Group, DataId)` 唯一标识。DataId 命名包含应用、模块、环境/格式，但不要把 Secret 或租户 ID 无界展开成海量配置。

## 隔离边界

Namespace 是逻辑隔离，不自动提供网络、数据库和管理员强隔离。生产/测试至少独立 Namespace，关键合规租户可独立集群；权限、网络和审计同时配置。

## 命名

统一大小写、分隔符和所有者：

```text
service: <domain>.<application>
group:   <team-or-purpose>
dataId:  <application>-<module>.<yaml|properties|json>
```

名称更改会被视为新资源，需要双注册/双发布和消费者切换。

## Metadata

只存路由必需小字段，定义类型/允许值。SDK/网关是否读取 weight、cluster、metadata 必须集成测试，控制台显示不等于数据面生效。

## 验收题

- Naming 与 Config 的 Key 层级分别是什么？
- Namespace 为什么不是安全隔离全部？
- Service Cluster 与 Nacos Server cluster 有何区别？
- 重命名 DataId 为什么需要迁移？

## 参考资料

- [Nacos user manual](https://nacos.io/en/docs/latest/manual/user/overview/)
