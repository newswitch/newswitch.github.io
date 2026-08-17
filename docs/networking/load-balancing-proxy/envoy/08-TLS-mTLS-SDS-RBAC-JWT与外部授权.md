---
title: "Envoy TLS、mTLS、SDS、证书轮换、RBAC、JWT 与外部授权"
sidebar_label: "08. Envoy TLS、mTLS、SDS、证书轮换、RBAC、JWT 与外部授权"
sidebar_position: 8
tags: [Envoy, TLS, mTLS, SDS, RBAC, JWT, ext_authz]
description: "从下游与上游两段 TLS 深入 SDS 动态 Secret、身份验证、授权 Filter、轮换与安全排障。"
---

# Envoy TLS、mTLS、SDS、证书轮换、RBAC、JWT 与外部授权

传输加密、服务身份、用户身份和业务授权是四个不同问题。生产配置要能回答“谁验证谁、信任哪一个 CA、身份来自哪里、允许访问什么”。

## 1. 两段 TLS

| 方向 | Envoy 角色 | 关键配置 |
| --- | --- | --- |
| downstream TLS | 服务端 | 服务器证书、私钥、客户端 CA、SNI/ALPN |
| upstream TLS | 客户端 | 信任 CA、SNI、SAN 验证、客户端证书 |

下游证书不能自动保护上游连接。上游验证不能只设置 TLS 而忽略 SAN/主机身份，否则可能只是加密到错误服务。

## 2. mTLS 与身份

mTLS 证明持有证书私钥的一方属于受信 PKI，并通过 SAN/SPIFFE 等获得工作负载身份。它不直接表达“用户可修改某订单”。应用/网关仍需 JWT、API Key、Session 或外部鉴权，并执行 Route/对象级授权。

## 3. SDS 和轮换

SDS 通过 xDS 风格接口向 Envoy动态提供证书、私钥和验证上下文，避免把长期 Secret 写进静态配置。需要监控 Secret ACK/NACK、证书到期、SDS 连接、权限和最后成功版本。

轮换采用新旧信任重叠：先让验证方信任新 CA/证书，再发布新身份，确认连接更新后移除旧信任。现有长连接可能继续使用旧握手结果，必要时有控制地 drain，而非一次强杀所有连接。

## 4. JWT、RBAC 与 ext_authz

典型顺序：

```text
TLS/mTLS identity
→ JWT signature + issuer/audience/time validation
→ identity metadata
→ local RBAC or ext_authz decision
→ route/upstream
```

JWT Filter 验签与提取 Claim，不等于授权。RBAC 适合数据面可快速判断的规则；`ext_authz` 可调用集中策略服务，但该服务的延迟、连接池、超时、缓存和 fail-open/close 会进入每个请求。清除客户端伪造的身份 Header，只由受信 Filter 写入。

## 5. 安全边界

- Admin、xDS、SDS 使用独立管理网络与双向身份；
- 私钥最小权限、只读挂载或 Secret Provider，不出现在 config dump/日志；
- 固定 TLS 最低版本、密码套件/曲线需兼容测试；
- 限制 Header/证书链/JWT 大小，防止解析资源耗尽；
- 授权默认拒绝，对未匹配 Route、缺失身份和策略服务异常有明确策略；
- 记录决策 ID 和规则版本，但不记录 Token/私钥。

## 6. 排障

| 阶段 | 证据 |
| --- | --- |
| Filter Chain | SNI、ALPN、transport protocol 是否命中 |
| 握手 | CA、SAN、用途、时间、协议、cipher |
| SDS | Secret 名称、版本、ACK/NACK、到期 |
| JWT | issuer、audience、signature、exp/nbf |
| 授权 | identity metadata、规则版本、ext_authz 响应/超时 |
| upstream | SNI/SAN 与服务证书、客户端身份 |

## 7. 掌握标准

你应能画出两段 TLS 的证书和信任方向，完成无中断轮换，区分 JWT 验证与授权，并解释鉴权服务失败时的安全和可用性取舍。

## 参考资料

- [Envoy TLS](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl)
- [Secret Discovery Service](https://www.envoyproxy.io/docs/envoy/latest/configuration/security/secret)
