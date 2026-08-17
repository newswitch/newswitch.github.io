---
title: "限流、限连、鉴权、WAF 边界与安全加固"
sidebar_position: 9
tags: [Nginx, Rate Limit, Authentication, WAF, Security]
description: "用限流限连、请求约束、TLS、鉴权和 WAF 分层保护 Nginx 与上游。"
---

# 限流、限连、鉴权、WAF 边界与安全加固

## 限流/限连

`limit_req` 使用共享内存区按 key 令牌/漏桶式控制速率，burst/nodelay 决定排队或拒绝；`limit_conn` 控制并发连接/请求计数。Key 不能为空或可伪造，内存区按 key 数/大小定容。

客户端 IP 只有在受信代理链和 `real_ip` 配置正确时可信。多租户优先用已认证 tenant/API key 的哈希，而非原始 Secret。

## 鉴权

Basic 仅适合 TLS 下简单场景；`auth_request` 可调用外部认证，需超时、缓存、失败策略和 Header 清理。JWT/OIDC 能力取决于 Nginx 版本/模块/产品。

## WAF 边界

WAF/规则能阻断已知模式，不理解完整业务授权和数据逻辑。规则发布需测试、观察误报、灰度和快速回滚；请求体大小/编码/压缩和流式协议可能绕过或不适配。

## 基线

TLS 1.2+、强 cipher/证书轮换、限制 method/body/header、隐藏不必要版本、最小 worker UID、只读配置、管理端口隔离、日志脱敏和依赖补丁。

## 验收题

- burst/nodelay 如何改变限流体验？
- X-Forwarded-For 何时可信？
- auth_request 故障时 fail-open/close 怎么选？
- WAF 为什么不能替代业务授权？

## 参考资料

- [Limit req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Auth request](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)
