---
title: "Authentication、Token、TLS、RBAC、Namespace 与内网隔离"
sidebar_label: "09. Authentication、Token、TLS、RBAC、Namespace 与内网隔离"
sidebar_position: 9
tags: [Nacos, Authentication, TLS, RBAC, Security]
description: "保护 Nacos Client/Admin/Console、配置与服务注册，建立最小权限和密钥轮换。"
---

# Authentication、Token、TLS、RBAC、Namespace 与内网隔离

Nacos 是内网组件，不面向公网。网络分区：SDK 客户端入口、Server 节点互联、数据库、Console/Admin 管理面分别设置 ACL/安全组。

## 认证

生产首次启动前启用 Client、Admin、Console 对应认证，生成非默认长随机 Token/Identity Key/Value；不同 3.x 参数以目标版本为准。默认账户/密钥不得保留。

## 授权

按 Namespace/Group/DataId/Service 能力创建应用、发布平台、只读运维、管理员身份。Namespace 逻辑隔离要配合 RBAC 和网络；应用不能调用 Admin API。

## TLS

保护 Client HTTP/gRPC、Server 间 gRPC/JRaft、Console/LB 和数据库链路（按版本支持/代理设计）。证书 SAN 覆盖 VIP/DNS，轮换双信任并验证长连接重建。

## Secret/审计

Nacos 自身数据库凭据、Token 和用户配置 Secret 放外部 Secret Manager；配置发布、删除、权限、登录失败和导入导出审计。日志禁止输出配置全文和 access token。

## 验收题

- 内网部署为何仍需认证？
- Client API 与 Admin API 身份为何分离？
- Namespace 为什么不能替代 RBAC？
- gRPC 长连接对证书轮换有什么影响？

## 参考资料

- [Nacos authentication](https://nacos.io/en/docs/latest/manual/admin/auth/)
- [Deployment best practices](https://nacos.io/en/docs/latest/manual/admin/deployment/deployment-best-practices/)
