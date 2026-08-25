---
title: "HAProxy Frontend、Backend、Server、ACL、Health Check 与请求路径"
sidebar_label: "01. 配置模型与请求路径"
sidebar_position: 1
description: "跟踪连接从 bind、ACL、Backend 选择、队列、负载均衡到健康 Server 的完整路径。"
tags: [HAProxy, Frontend, Backend, ACL]
---

# HAProxy Frontend、Backend、Server、ACL、Health Check 与请求路径

## 1. 配置模型

| 对象 | 作用 |
| --- | --- |
| `global` | 进程、日志、TLS、Runtime Socket |
| `defaults` | 多代理共享的 Mode、Timeout、日志 |
| `frontend` | `bind` 接收连接并选择 Backend |
| `listen` | Frontend 与 Backend 的简化组合 |
| `backend` | LB、队列、健康检查和 Server 集合 |
| `server` | 真实上游及权重、限制和 Check |

## 2. 请求路径

```text
Client → bind(TCP/TLS)
→ frontend ACL读取SNI/Host/Path/Header
→ use_backend/default_backend
→ backend负载均衡
→ 若Server满则进入Queue
→ 连接健康Server
→ 转发响应并记录Termination State
```

TCP Mode 看不到解密后的 HTTP Host/Path；HTTP Mode 可做 L7 ACL 和 Header 操作。TLS Passthrough 通常按 SNI 路由，TLS Termination 则由 HAProxy 解密并管理证书。

## 3. 健康检查

TCP Check 只验证连接；HTTP Check 应检查专用 Readiness 端点和预期状态；Agent Check 可动态调整权重。`rise/fall/inter` 控制恢复、摘除和间隔。检查必须反映“能否接收新业务”，不能依赖会修改数据的接口。

## 4. LB 与会话

Round Robin、Leastconn、Source Hash 等适合不同连接模型。长连接场景看 Active Connection 而不是只看请求数。Cookie 或 Stick Table 可保持会话，但会降低故障迁移和均衡效果，应优先把状态外置。

## 5. Timeout 与队列

至少明确 Connect、Client、Server、HTTP Request、Queue 和 Tunnel Timeout。默认或无限超时会积累死连接；过短会误杀慢请求。Backend Queue 增长说明 Server 并发已到顶或处理变慢，扩 HAProxy 本身可能无效。

参考：[HAProxy Configuration Manual](https://docs.haproxy.org/3.2/configuration.html)、[Health Checks](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/reliability/health-checks/)。
