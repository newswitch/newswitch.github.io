---
title: "Nginx 限流、限连、鉴权、请求安全与 WAF 边界"
sidebar_label: "09. 限流、鉴权与安全加固"
sidebar_position: 9
description: "掌握限流漏桶、连接限制、真实客户端地址、鉴权子请求、Header 信任、请求走私、文件访问和 WAF 边界。"
tags: [Nginx, 限流, 鉴权, WAF, 安全, Request Smuggling]
---

# Nginx 限流、限连、鉴权、请求安全与 WAF 边界

入口安全不是堆叠一组 `deny` 指令。必须先确定客户端真实身份、请求解析边界和后端语义，再实施限流、认证、授权和内容检查。

## 1. 限流模型

`limit_req` 使用共享内存区按键保存状态，并按近似漏桶模型平滑请求：

```nginx
limit_req_zone $binary_remote_addr zone=per_ip:20m rate=20r/s;

server {
    location /api/ {
        limit_req zone=per_ip burst=40 nodelay;
        limit_req_status 429;
    }
}
```

- `rate`：长期通过速率；
- `burst`：允许暂存/容忍的突发规模；
- 不使用 `nodelay` 时部分突发请求会排队；
- 使用 `nodelay` 时突发额度立即放行，但额度仍按速率恢复。

排队会把拒绝变成延迟，可能使客户端超时并重试，反而放大流量。

## 2. 限制并发连接

```nginx
limit_conn_zone $binary_remote_addr zone=conn_per_ip:20m;

location /download/ {
    limit_conn conn_per_ip 10;
    limit_conn_status 429;
}
```

连接数不等于并发业务请求：HTTP/2 一条连接可承载多个 Stream，反向代理是否计数和请求何时算活动要按模块与协议验证。大模型长请求更适合结合租户并发、Token 预算和后端排队治理。

## 3. 限流 Key

按 `$binary_remote_addr` 简单，但 NAT 后大量用户共享一个出口；攻击者也可分散 IP。可信认证完成后可按租户、API Key ID 或用户 ID 限流：

```text
网络入口限流：IP/网段，保护握手和解析资源
认证后限流：租户/主体，保护业务配额
后端限流：模型、数据库或依赖的实际容量
```

不要直接把原始 Token 放入共享区 Key 或日志。

## 4. 真实客户端地址

只有来自可信代理的转发头才能信任：

```nginx
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

若 Nginx 可被公网绕过直连，攻击者可以自行发送 `X-Forwarded-For`。应通过网络策略限制只允许可信 LB 访问，并验证 Header 清洗规则。

PROXY Protocol 由连接前缀传递地址，不是普通 HTTP Header；监听端和上游 LB 必须同时启用，否则会出现协议解析失败或伪造风险。

## 5. Basic Auth 与外部鉴权

Basic Auth 必须运行在 TLS 上，凭据仍需安全存储和轮换。

`auth_request` 使用子请求把认证交给服务：

```nginx
location = /_auth {
    internal;
    proxy_pass http://auth_backend/verify;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;
}

location /api/ {
    auth_request /_auth;
    auth_request_set $subject $upstream_http_x_subject;
    proxy_set_header X-Authenticated-Subject $subject;
    proxy_pass http://api_backend;
}
```

必须清除客户端自带的 `X-Authenticated-Subject`，只让内部鉴权结果覆盖；还要定义认证服务超时、失败关闭、连接池和容量。

## 6. JWT、OIDC 与模块边界

开源 Nginx、NGINX Plus、njs、Lua/OpenResty 和第三方模块提供的 JWT/OIDC 能力不同。不能在未确认模块和验证语义时复制配置。

至少验证：

- 签名算法是否固定而非由 Token 任意选择；
- Issuer、Audience、有效期和 Not-Before；
- JWKS 获取、缓存、轮换和失败策略；
- 身份如何映射为授权；
- Header 和 Claim 大小上限。

## 7. 方法、路径和文件限制

```nginx
location /admin/ {
    limit_except GET POST {
        deny all;
    }
}

location ~ /\. {
    deny all;
}
```

方法限制不是 CSRF 防护，隐藏文件规则也不能替代正确发布目录。必须测试 URI 编码、大小写、尾点/斜杠、内部重定向和后端二次解码，防止代理与应用对路径理解不一致。

## 8. 请求走私与解析差异

Request Smuggling 常利用前后端对 `Content-Length`、`Transfer-Encoding`、重复 Header 或非法语法的解析差异。防护包括：

- 及时升级 Nginx 和后端；
- 避免将原始冲突 Header 未经规范化传递；
- 明确 HTTP/2/3 到 HTTP/1.1 转换边界；
- 限制 Header 数量和大小；
- 记录并拒绝异常请求；
- 用真实前后端组合进行安全测试。

WAF 规则无法替代一致的协议解析。

## 9. Header 信任与响应头

代理应显式设置：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

后端必须只在流量确实来自可信代理时信任这些 Header。

安全响应头如 HSTS、CSP、X-Content-Type-Options 的策略依赖业务。HSTS 配错并包含子域可能造成长时间不可访问；CSP 应从报告模式和资产清单开始，不能复制一个“万能模板”。

## 10. 请求体与资源保护

```nginx
client_max_body_size 20m;
client_header_timeout 10s;
client_body_timeout 30s;
keepalive_timeout 60s;
large_client_header_buffers 4 16k;
```

数值应基于真实业务。设置过小会拒绝合法上传和大 Cookie；过大则扩大内存、磁盘和慢请求攻击面。还需限制临时盘容量、文件数量和并发上传。

## 11. 隐藏版本与最小权限

`server_tokens off` 只能减少部分版本暴露，不是漏洞修复。真正措施：

- 及时升级并记录构建模块；
- Worker 非 root；
- 配置和私钥只读；
- Cache/Temp/Log 分目录最小权限；
- 容器只读根文件系统与受控 Capability；
- 禁止公开 Stub Status、Debug 和管理接口；
- 不加载来源不明动态模块。

## 12. WAF 边界

WAF 能做已知模式、协议和速率防护，但不能理解全部业务授权、修复逻辑漏洞或保证后端安全。应观察：

- 规则版本和变更；
- Block/Monitor 模式；
- 误报和绕过；
- 请求体解码与大小限制；
- 故障时 Fail-Open/Fail-Closed；
- WAF 自身 CPU/延迟。

## 13. 拒绝矩阵

| 控制 | 状态码/动作 | 日志字段 | 调用方行为 |
| --- | --- | --- | --- |
| 速率限制 | 429 | Key 分类、Zone、Request ID | 指数退避，不立即风暴重试 |
| 并发限制 | 429/503 | 当前主体/接口 | 排队或降级 |
| 未认证 | 401 | 认证原因，不记录 Token | 刷新凭据 |
| 未授权 | 403 | 主体与策略 ID | 不重试 |
| 请求过大 | 413 | 长度与接口 | 分片或修正客户端 |
| WAF 拦截 | 403 | Rule ID、动作 | 安全复核 |

## 14. 练习与答案

**问题：** `burst=40 nodelay` 是否允许永久 60 r/s？

不允许。它只吸收短时突发，长期额度仍按配置 Rate 恢复。

**问题：** 配置 `real_ip_header X-Forwarded-For` 后为什么可能被伪造？

若信任范围过宽或攻击者能绕过 LB 直连，客户端可以自行构造该 Header。

**问题：** mTLS 成功能否代替业务授权？

不能。mTLS 提供连接主体，应用仍需判断主体能访问什么资源。

## 15. 参考资料

- [Nginx Limit Request Module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Nginx Limit Connection Module](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)
- [Nginx Auth Request Module](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)
- [Nginx Real IP Module](https://nginx.org/en/docs/http/ngx_http_realip_module.html)
