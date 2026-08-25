---
title: "RequestAuthentication、AuthorizationPolicy、JWT 与外部授权"
sidebar_label: "09. JWT、授权与外部鉴权"
sidebar_position: 9
description: "从来源身份与 JWT Claim 到 ALLOW/DENY/CUSTOM 策略，建立默认拒绝和可验证授权模型。"
tags: [Istio, AuthorizationPolicy, JWT, RequestAuthentication, ext-authz]
---

# RequestAuthentication、AuthorizationPolicy、JWT 与外部授权

RequestAuthentication 验证 JWT 并提取 Principal/Claim，AuthorizationPolicy 决定请求是否允许。配置 JWT 验证本身不一定拒绝没有 Token 的请求，必须配合授权策略。

## 1. 授权输入

```text
mTLS Source Principal
JWT Request Principal / Claims
Namespace、ServiceAccount
Method、Path、Host、Port
Source IP与其他属性
        ↓
AuthorizationPolicy
        ↓
ALLOW / DENY / CUSTOM / AUDIT
```

L4 Proxy 只能使用连接级属性；HTTP Path/Header/JWT Claim 等 L7 条件要求 Sidecar 或 Ambient Waypoint。

## 2. 评估原则

显式 DENY 优先；CUSTOM 外部授权按能力执行；存在 ALLOW 策略时，请求必须匹配至少一条允许；无相应策略时采用默认行为。精确顺序以目标版本官方文档为准。

建立默认拒绝时先盘点调用矩阵，按 Namespace/Service Account 小范围灰度，并保留 Break-glass 管理路径。

## 3. JWT

核对 Issuer、Audience、JWKS 来源、缓存/轮换、时钟和 Claim 类型。JWKS Endpoint 不可用时的缓存和新 Key 行为要演练。不要把原始 Token 写入访问日志。

## 4. 外部授权

CUSTOM/Envoy ext_authz 可调用 OPA 或专用鉴权服务，适合复杂策略。鉴权服务成为请求同步依赖，需要明确超时、失败开放/关闭、缓存和自身 HA；关键安全路径通常 Fail-closed，但要防止鉴权故障拖垮全站。

## 5. 常见错误

- Selector/targetRefs 未绑定目标工作负载；
- 把 TCP 端口应用按 HTTP Path 授权；
- mTLS 身份与 JWT 用户身份混淆；
- Namespace 短名称或 Trust Domain 不一致；
- DENY 缺少端口导致范围过大；
- Ambient 未部署 Waypoint 却配置 L7 规则。

## 6. 验收矩阵

为每个调用方列出：无 Token、合法 Token、过期、错误 Audience、不同 Claim、合法/非法 Service Account、目标 Path/Method，自动执行并断言状态码。策略变更纳入代码评审和回归测试。

参考：[Istio Authorization](https://istio.io/latest/docs/tasks/security/authorization/)、[JWT Authentication](https://istio.io/latest/docs/tasks/security/authentication/authn-policy/)。
