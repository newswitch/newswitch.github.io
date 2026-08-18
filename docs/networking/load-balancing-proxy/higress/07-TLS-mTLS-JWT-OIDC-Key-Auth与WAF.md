---
title: "TLS、mTLS、JWT/OIDC、Key Auth、WAF 与安全"
sidebar_label: "07. TLS、mTLS、JWT/OIDC、Key Auth、WAF 与安全"
sidebar_position: 7
description: "构建 Higress 边界身份、传输安全、授权、Secret 轮换和 WAF。"
tags: [Higress, TLS, JWT, OIDC, WAF]
---

# TLS、mTLS、JWT/OIDC、Key Auth、WAF 与安全

## 1. 身份链 {/* #身份链 */}

```text
client TLS/mTLS
→ Gateway authentication (JWT/OIDC/API Key)
→ route/tenant authorization
→ optional upstream mTLS/service identity
```

TLS 证明通道/证书身份，JWT/OIDC/API Key 建立应用/用户身份，授权决定能访问的 Route/模型；不可混为一层。

## 2. JWT/OIDC {/* #jwtoidc */}

验证 issuer、audience、signature、exp/nbf 和算法白名单；JWKS 缓存需超时、刷新和失败策略。只解析不验签等于无认证。Header 转发前清除用户伪造身份字段。

## 3. API Key {/* #api-key */}

Key 只存哈希/Secret，按租户最小 Route/模型权限、配额、到期和撤销。不要放 Query 或访问日志。

## 4. mTLS {/* #mtls */}

下游/上游证书 CA、SAN、SNI 和 rotation 分别验证。轮换双信任，长连接需 drain/reconnect 才使用新证书。

## 5. WAF {/* #waf */}

规则防常见攻击，不替代业务对象授权；对 JSON、大 body、gRPC、SSE/LLM Prompt 的可见性不同。灰度规则并观察误报/延迟。

## 6. 身份与安全拒绝矩阵 {/* #身份与安全拒绝矩阵 */}

```text
TLS：可信/过期/错误SAN/未知CA
JWT：合法/过期/错误issuer-audience/未知kid/无token
API Key：合法/撤销/越租户
WAF：正常/已知攻击/编码绕过/大请求
```

对每项记录网关状态码、失败原因、上游是否收到、审计字段和故障模式。JWKS/OIDC 依赖不可达时必须明确 fail-open 或 fail-close；密钥/证书轮换使用新旧重叠窗口并验证缓存刷新。

mTLS 只认证对端证书身份，不自动授予业务权限。授权应绑定可信 principal/claim，并防止客户端伪造转发身份 Header。WAF 先观察和灰度，建立误报回滚；日志隐藏 Token、Cookie、API Key 和个人数据。生产不得通过关闭证书校验修复 TLS。

## 7. 验收题 {/* #验收题 */}

- JWT 的 audience 为什么重要？
- 上游 mTLS 与下游 TLS 是哪两段？
- JWKS 不可用时如何选择 fail policy？
- WAF 为什么无法阻止越权业务 ID？

## 8. 参考资料 {/* #参考资料 */}

- [Higress security](https://higress.cn/en/docs/latest/plugins/)
