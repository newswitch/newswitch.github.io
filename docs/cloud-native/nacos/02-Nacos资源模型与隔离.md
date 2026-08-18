---
title: "Namespace、Group、Service、Cluster、Instance 与 DataId"
sidebar_label: "02. Namespace、Group、Service、Cluster、Instance 与 DataId"
sidebar_position: 2
description: "掌握 Nacos Naming/Config 资源模型、环境租户隔离和命名规范。"
tags: [Nacos, Namespace, Service, DataId]
---

# Namespace、Group、Service、Cluster、Instance 与 DataId

## 1. Naming {/* #naming */}

```text
Namespace → Group → Service → Cluster → Instance
```

Namespace 隔离环境/租户，Group 做逻辑分组，Service 是订阅名，Cluster 表示机房/区域实例集合，Instance 包含 IP、端口、weight、metadata、enabled/healthy 和临时/持久属性。

## 2. Config {/* #config */}

配置通常由 `(Namespace, Group, DataId)` 唯一标识。DataId 命名包含应用、模块、环境/格式，但不要把 Secret 或租户 ID 无界展开成海量配置。

## 3. 隔离边界 {/* #隔离边界 */}

Namespace 是逻辑隔离，不自动提供网络、数据库和管理员强隔离。生产/测试至少独立 Namespace，关键合规租户可独立集群；权限、网络和审计同时配置。

## 4. 命名 {/* #命名 */}

统一大小写、分隔符和所有者：

```text
service: <domain>.<application>
group:   <team-or-purpose>
dataId:  <application>-<module>.<yaml|properties|json>
```

名称更改会被视为新资源，需要双注册/双发布和消费者切换。

## 5. Metadata {/* #metadata */}

只存路由必需小字段，定义类型/允许值。SDK/网关是否读取 weight、cluster、metadata 必须集成测试，控制台显示不等于数据面生效。

## 6. 可执行资源契约实验 {/* #可执行资源契约实验 */}

本文以 Nacos 3.2.x 为基线。用 OpenAPI/SDK 创建测试 Namespace、同名但不同 Group 的 Service/DataId，注册两个 Cluster/Instance，再分别从客户端订阅，证明每个维度如何进入 key 和路由。

```text
测试矩阵：
同 DataId + 不同 Group/Namespace -> 配置不得串读
同 Service + 不同 Cluster       -> 路由按客户端/负载均衡策略验证
禁用/不健康 Instance            -> 订阅缓存和摘除时间可测
租户 A 凭据访问租户 B            -> 必须拒绝
```

重命名不是原地修改：先发布新 key/Service，生产者双写或双注册，消费者灰度切换，观察订阅与错误，再回收旧资源。为 Namespace、Group、DataId、Service、metadata 建所有者、格式、数量和生命周期限制，防止资源爆炸拖慢控制面。

逻辑 Namespace 不替代 RBAC、网络和独立存储。若需要合规强隔离、独立容量或故障域，应使用独立 Nacos 集群并完成跨集群迁移/回滚演练。

## 7. 验收题 {/* #验收题 */}

- Naming 与 Config 的 Key 层级分别是什么？
- Namespace 为什么不是安全隔离全部？
- Service Cluster 与 Nacos Server cluster 有何区别？
- 重命名 DataId 为什么需要迁移？

## 8. 参考资料 {/* #参考资料 */}

- [Nacos user manual](https://nacos.io/en/docs/latest/manual/user/overview/)
