---
title: "Reverse Proxy、Upstream、负载均衡、健康与重试"
sidebar_label: "04. Reverse Proxy、Upstream、负载均衡、健康与重试"
sidebar_position: 4
tags: [Nginx, Reverse Proxy, Upstream, Retry]
description: "理解 Nginx Upstream 选择、连接池、超时、失败判断和重试放大。"
---

# Reverse Proxy、Upstream、负载均衡、健康与重试

```text
request → route → upstream group
→ choose peer → connection pool/connect
→ send → wait header/body → retry decision → response
```

## 算法

Round-robin、least_conn、ip_hash/hash 等按不同状态选择。Least connections 不理解请求计算量；Hash 提供粘性但扩缩会迁移大量 key（取决于一致性选项）。

## Keepalive

Upstream keepalive 按 worker 维护，数量不是全局。上游需支持连接复用和正确 HTTP 头；池过小频繁握手，过大占上游 FD/内存。连接数按 worker×replicas 汇总。

## 超时

Connect、send、read timeout 保护不同阶段；read timeout 通常是两次读取间隔，不一定是请求总时长。总预算还包括 LB、网关、SDK 和应用，必须递减且不叠加无限重试。

## 健康/失败

开源 Nginx 常以被动失败为主，主动健康能力取决于版本/产品/模块。应用 `/health` 必须反映能否接流，不应执行昂贵依赖检查造成雪崩。

## 重试

只对幂等且尚未向客户端输出的请求在预算内重试。POST/流式响应重试可能重复业务；使用 request/attempt ID 并限制全链路尝试数。

## 验收题

- Upstream keepalive 为什么要乘 worker？
- Read timeout 与总时长有何不同？
- Least_conn 为何不一定均衡 CPU？
- 网关/SDK 重试怎样形成放大？

## 参考资料

- [Upstream module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [Proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
