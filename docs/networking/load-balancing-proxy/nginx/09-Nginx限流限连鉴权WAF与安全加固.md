---
title: "限流、限连、鉴权、WAF 边界与安全加固"
sidebar_label: "09. 限流、限连、鉴权、WAF 边界与安全加固"
sidebar_position: 9
description: "用限流限连、请求约束、TLS、鉴权和 WAF 分层保护 Nginx 与上游。"
tags: [Nginx, Rate Limit, Authentication, WAF, Security]
---

# 限流、限连、鉴权、WAF 边界与安全加固

## 1. 限流/限连 {/* #限流限连 */}

`limit_req` 使用共享内存区按 key 令牌/漏桶式控制速率，burst/nodelay 决定排队或拒绝；`limit_conn` 控制并发连接/请求计数。Key 不能为空或可伪造，内存区按 key 数/大小定容。

客户端 IP 只有在受信代理链和 `real_ip` 配置正确时可信。多租户优先用已认证 tenant/API key 的哈希，而非原始 Secret。

## 2. 鉴权 {/* #鉴权 */}

Basic 仅适合 TLS 下简单场景；`auth_request` 可调用外部认证，需超时、缓存、失败策略和 Header 清理。JWT/OIDC 能力取决于 Nginx 版本/模块/产品。

## 3. WAF 边界 {/* #waf-边界 */}

WAF/规则能阻断已知模式，不理解完整业务授权和数据逻辑。规则发布需测试、观察误报、灰度和快速回滚；请求体大小/编码/压缩和流式协议可能绕过或不适配。

## 4. 基线 {/* #基线 */}

TLS 1.2+、强 cipher/证书轮换、限制 method/body/header、隐藏不必要版本、最小 worker UID、只读配置、管理端口隔离、日志脱敏和依赖补丁。

## 5. 安全控制的拒绝矩阵 {/* #安全控制的拒绝矩阵 */}

```text
匿名/合法/过期身份 × 正常/突发/恶意请求 × 单节点/多节点
期望：状态码、限额、日志、上游是否收到、失败时是 fail-open 还是 fail-close
```

`limit_req` 是单实例共享内存 zone 内的速率控制，`burst`/`nodelay` 决定排队与突发，不会天然形成全局租户配额。`limit_conn` 统计匹配键的并发连接/请求，也不能替代上游容量保护。多实例全局配额需外部一致状态或网关能力。

鉴权子请求、JWT/WAF 模块的可用性取决于发行版和编译模块。TLS 只启用受支持协议/套件，证书自动轮换并验证 OCSP/链/SAN。请求大小、Header、超时、路径规范化和日志脱敏都要测试。WAF 规则先观察/灰度再阻断，保存误报回滚；任何安全失败模式都必须显式决定。

## 6. 验收题 {/* #验收题 */}

- burst/nodelay 如何改变限流体验？
- X-Forwarded-For 何时可信？
- auth_request 故障时 fail-open/close 怎么选？
- WAF 为什么不能替代业务授权？

## 7. 参考资料 {/* #参考资料 */}

- [Limit req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Auth request](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)
