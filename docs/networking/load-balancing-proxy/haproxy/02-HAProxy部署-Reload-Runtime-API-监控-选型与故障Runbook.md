---
title: "HAProxy 部署、Reload、Runtime API、监控、选型与故障 Runbook"
sidebar_label: "02. 生产运维与故障 Runbook"
sidebar_position: 2
description: "掌握 HAProxy 高可用部署、无损重载、运行时管理、指标分析和常见代理故障定位。"
tags: [HAProxy, Runtime API, Reload, Troubleshooting]
---

# HAProxy 部署、Reload、Runtime API、监控、选型与故障 Runbook

## 1. 生产部署

至少两个 HAProxy 实例跨故障域，前置 VIP/Keepalived、云 LB、Anycast 或 DNS。进程本身无状态，但证书、Map、配置和 Runtime 状态要统一发布。调整文件描述符、端口范围、连接跟踪、CPU 绑定前先压测真实连接模型。

## 2. 安全 Reload

先执行配置校验，再启动新进程接管 Listener，旧进程继续处理现有连接直到完成或进入 Hard Stop。需要 State File/Server State 保留动态健康与权重，避免每次 Reload 让所有 Server 同时经历 Warm-up。

```bash
haproxy -c -f /etc/haproxy/haproxy.cfg
systemctl reload haproxy
echo 'show info' | socat stdio /run/haproxy/admin.sock
echo 'show stat' | socat stdio /run/haproxy/admin.sock
```

Runtime API 可临时禁用 Server、调整权重、查看会话和错误；临时操作必须同步回声明配置，否则下次 Reload 会丢失。

## 3. 监控

重点看 Frontend Session/Connection Rate、Backend Queue、Server Active/Retry/Response Time、5xx、Connection Error、Denied、TLS Handshake 和 Termination State。日志中的终止标志能区分客户端断开、连接上游失败、超时和 HAProxy 主动拒绝。

## 4. Runbook

- 所有 Backend DOWN：检查 Check 类型、DNS、路由、防火墙、应用 Readiness；
- Queue 增长：检查 Server Maxconn、处理时间和下游容量；
- 502/503：结合终止标志判断无可用 Server、连接失败或非法响应；
- Reload 后异常：比较进程、Listener、State File、证书和最终配置；
- 单侧流量不均：检查长连接、权重、Stickiness 和健康状态；
- CPU 高：分解 TLS、压缩、日志、ACL 和连接率。

## 5. 选型

需要稳定 L4/L7 代理、静态/模板化配置和强运行时运维能力时，HAProxy 简洁可靠；需要动态 API 对象与插件生态时选择 API Gateway；需要复杂静态资源和 Web Server 能力时 Nginx 更熟悉。

参考：[Runtime API](https://www.haproxy.com/documentation/haproxy-runtime-api/)、[HAProxy Management](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/management/)。
