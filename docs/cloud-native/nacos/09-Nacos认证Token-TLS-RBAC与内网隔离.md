---
title: "Authentication、Token、TLS、RBAC、Namespace 与内网隔离"
sidebar_label: "09. Authentication、Token、TLS、RBAC、Namespace 与内网隔离"
sidebar_position: 9
description: "保护 Nacos Client/Admin/Console、配置与服务注册，建立最小权限和密钥轮换。"
tags: [Nacos, Authentication, TLS, RBAC, Security]
---

# Authentication、Token、TLS、RBAC、Namespace 与内网隔离

> 版本基线：Nacos 3.2；最后核验：2026-08-18。认证、OIDC、TLS 和插件参数在不同发行形态中可能不同，不能照抄旧版环境变量。

Nacos 官方把它定位为可信内网中的基础组件，内置默认认证主要防止业务误用，不是抵抗公网恶意攻击的强认证系统。因此安全目标必须是“即使某个应用凭据泄露，也只能访问自己的资源，且攻击者不能直接触达管理面和节点互联面”。

## 1. 先画出五个安全平面 {/* #先画出五个安全平面 */}

| 平面 | 默认端口/目标 | 合法来源 | 必要控制 |
| --- | --- | --- | --- |
| Client HTTP/OpenAPI | 8848 | 业务 SDK、受控网关 | Auth、最小权限、内网 ACL、TLS |
| Client gRPC | 9848 | 业务 SDK | Auth、TCP 转发、内网 ACL、TLS 能力核验 |
| Server gRPC | 9849 | Nacos Server 节点 | 仅节点互通、Server Identity、加密链路 |
| JRaft | 7848 | Nacos Server 节点 | 仅节点互通、故障域与链路保护 |
| Console/管理 | 8080、Admin API | 运维/平台网 | 独立部署、MFA/SSO、管理员 RBAC、审计 |

外部数据库只允许 Nacos Server 访问。Console、Admin API、Actuator、数据库、9849 和 7848 都不能暴露给普通业务 Pod，更不能公开公网。HostNetwork/虚机流量可能不经过普通 Kubernetes NetworkPolicy，还要使用云安全组和宿主防火墙验证。

## 2. 选择认证模式 {/* #选择认证模式 */}

Nacos 3.2 支持默认 Nacos Auth、LDAP、OIDC/OAuth2 和自定义 Auth Plugin。默认模式适合可信内网的小型 RBAC；企业 SSO、MFA 和集中身份应优先 OIDC/LDAP 或企业插件。

三类开关要分别确认：

```properties
nacos.core.auth.system.type=nacos
nacos.core.auth.enabled=true
nacos.core.auth.admin.enabled=true
nacos.core.auth.console.enabled=true

nacos.core.auth.server.identity.key=${SERVER_IDENTITY_KEY}
nacos.core.auth.server.identity.value=${SERVER_IDENTITY_VALUE}
nacos.core.auth.plugin.nacos.token.secret.key=${BASE64_TOKEN_SECRET}
```

`enabled` 保护 SDK/OpenAPI/gRPC，`admin.enabled` 保护 Admin API，`console.enabled` 保护 Console API。升级集群可能保留旧配置，所以不能只根据 3.2 文档默认值推断运行状态；要核对每个节点最终的 `application.properties`、环境变量和启动参数。

Token Secret 应是至少 32 个原始字符生成的 Base64 强随机值，Server Identity Key/Value 也要唯一且不可使用样例。集群所有 Server 与独立 Console 必须使用一致的 Server Identity 和 Token Secret，否则会出现节点间或 Console 调用认证失败。

Nacos 2.4 起不再附带管理员默认密码。首次启用默认 Auth 后，通过受控 Console 或初始化 API设置高强度密码，返回随机密码时立即写入 Secret Manager。不要把管理员密码、Token Secret 或 Identity Value 放进 Git、镜像层、Shell 历史和工单正文。

:::warning
轮换 Token Secret 会影响已签发 Token；轮换 Server Identity 会影响节点/Console 内部调用。必须先在预发布验证目标版本是否支持重叠或需要滚动重启，并设计客户端重新取 Token 与节点回退方案。
:::

## 3. 授权：Namespace 不是权限系统 {/* #授权namespace-不是权限系统 */}

Namespace 解决资源组织与环境/租户逻辑隔离；RBAC 决定某个身份能否读、写或管理。仅给不同团队分 Namespace、却让所有应用共享管理员账号，仍然没有安全隔离。

建议角色矩阵：

| 身份 | 配置 | 服务注册发现 | 管理面 |
| --- | --- | --- | --- |
| 应用运行身份 | 只读自身 Group/DataId | 注册自身、订阅明确下游 | 禁止 |
| 发布平台 | 指定 Namespace/Group 可发布，不能读无关 Secret | 通常禁止 | 仅配置发布能力 |
| 只读运维 | 元数据/状态只读，敏感内容脱敏 | 诊断只读 | 无变更能力 |
| Nacos 管理员 | 紧急全局权限 | 全局 | 经堡垒机/MFA/工单使用 |

每个应用、环境和自动化任务使用独立身份，便于吊销与审计。权限变化可能受本地认证缓存影响，官方 3.2 文档提示可能存在约 15 秒延迟；验证时要等待缓存窗口，并同时做允许与拒绝测试。

Client SDK 运行身份不能调用全量列表、容量、集群、用户和导入导出接口。管理操作使用独立 Maintainer SDK/Admin API 身份，并限制到管理网络。

## 4. TLS：先确认每一段由谁终止 {/* #tls先确认每一段由谁终止 */}

安全评审应逐段记录：

```text
SDK ── Client HTTP/gRPC ── VIP/LB ── Nacos Server
Console ── Admin API ─────┘
Nacos Server ── 9849/7848 ── Nacos Server
Nacos Server ── JDBC ─────── External DB
```

目标版本/发行版直接支持 TLS 的链路使用官方参数；需要 LB/Gateway 终止 TLS 时，要明确终止点后的可信网络和再次加密策略。9848 是长连接 TCP 流量，不能按普通 HTTP 反向代理配置。证书 SAN 覆盖 Client 实际连接的 VIP/DNS，CA/Leaf/私钥权限和有效期纳入资产管理。

证书轮换采用重叠信任：先让调用双方信任新旧 CA，再逐节点/逐客户端换 Leaf，验证长连接重建、注册 Redo、配置 Listener 和服务订阅，最后移除旧 CA。只验证 8848 查询而不验证 9848 重连，不能证明轮换成功。

## 5. Secret、配置加密与备份 {/* #secret配置加密与备份 */}

数据库密码、管理员凭据、Token Secret、Server Identity、TLS 私钥和配置加密主密钥都放外部 Secret Manager。Nacos 配置加密插件只保护选中的配置内容，不替代 Auth、TLS 和网络隔离；备份还必须包含恢复算法插件、密钥引用和 `encrypted_data_key` Schema。

Secret 轮换需要验证：新实例能启动、老实例能续用或按计划重启、回滚版本能解密、历史和日志不泄露明文。不能只在 Console 看见“密文”就认为整个链路安全。

## 6. 审计与检测 {/* #审计与检测 */}

至少记录：登录/Token 失败、用户/角色/权限、Auth 开关、配置发布/删除/灰度/回滚、服务管理、导入导出、集群与插件配置、证书和 Secret 轮换。审计事件包含操作者、来源、目标资源身份、结果、工单和变更前后 Hash，不记录配置全文、Access Token 或私钥。

告警场景包括：公网或非授权网段连接、管理员账号被应用使用、认证失败激增、Console/Admin API 异常高频、权限突增、Auth 开关变化、同一 Token 从异常来源使用、证书临近过期。

## 7. 上线验收：必须做正反测试 {/* #上线验收必须做正反测试 */}

1. 应用身份能读取自己的配置、注册自身并订阅允许的服务。
2. 同一身份访问其他 Namespace/Group/DataId 或 Admin API 被拒绝。
3. 普通 Pod 无法连接 8080、9849、7848 和数据库。
4. 未认证的 8848/9848 请求失败；Server 节点互联仍健康。
5. 从允许源和拒绝源分别验证网络，而不是只读安全组配置。
6. 重启一个 Server、刷新一个 Token、轮换一张测试证书，Client 能重新连接并恢复意图。
7. 日志和审计系统中没有 Secret/配置全文。

## 8. 常见故障 {/* #常见故障 */}

| 现象 | 重点检查 |
| --- | --- |
| 某节点加入失败或 Console 无法管理 | 各节点/Console 的 Server Identity 与 Token Secret 是否一致 |
| Client 8848 成功、订阅失败 | 9848 TCP、长连接、Auth 和 LB 转发 |
| 刚授权仍 Permission Denied | 资源匹配、身份、约 15 秒缓存延迟 |
| 轮换后大量 Client 掉线 | CA 信任、SAN、Token 失效、连接 Redo |
| Auth 已开启但管理面仍可访问 | `admin.enabled`、`console.enabled` 与网络 ACL 是否分别生效 |

## 9. 验收题 {/* #验收题 */}

- 内网部署为何仍需认证？
- Client API 与 Admin API 身份为何分离？
- Namespace 为什么不能替代 RBAC？
- gRPC 长连接对证书轮换有什么影响？
- 为什么 `auth.enabled=true` 不能证明 Admin 和 Console 已受保护？
- Server Identity 与业务 Client Token 分别解决什么问题？

## 10. 参考资料 {/* #参考资料 */}

- [Nacos authentication](https://nacos.io/en/docs/latest/manual/admin/auth/)
- [Deployment best practices](https://nacos.io/en/docs/latest/manual/admin/deployment/deployment-best-practices/)
