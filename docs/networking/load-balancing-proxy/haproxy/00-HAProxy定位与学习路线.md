---
title: "HAProxy 定位与学习路线"
sidebar_label: "00. HAProxy 定位与学习路线"
sidebar_position: 0
description: "从 L4/L7 代理和负载均衡理解 HAProxy，并建立与 Nginx、Envoy、API Gateway 的选型边界。"
tags: [HAProxy, Load Balancer, Proxy, Networking]
---

# HAProxy 定位与学习路线

HAProxy 是高性能 TCP/HTTP 代理和负载均衡器，擅长连接转发、健康检查、ACL、TLS、连接队列和运行时操作。它不自带完整的 API 产品、开发者门户或服务网格控制面。

## 1. 学习路径

1. 本文建立定位与选型；
2. [Frontend、Backend、Server、ACL、Health Check 与请求路径](./01-HAProxy-Frontend-Backend-Server-ACL-Health-Check与请求路径.md)理解核心配置；
3. [部署、Reload、Runtime API、监控、选型与故障 Runbook](./02-HAProxy部署-Reload-Runtime-API-监控-选型与故障Runbook.md)完成生产运维。

## 2. 什么时候使用

数据库主从入口、Kubernetes API 前置 LB、四层 TCP、传统 Web 反向代理、需要极低开销的健康检查与流量分配，都是常见场景。若需要大量动态 API 插件、JWT/OIDC 产品化治理，APISIX/Kong/Higress 更贴近；若需要 xDS 和 Mesh 数据面，Envoy 更合适。

## 3. 完成标准

能区分 TCP 与 HTTP Mode；能画出 Listener 到 Server 的路径；能解释 Queue、Timeout、Retry 和健康检查；能安全 Reload、不丢现有连接；能从 Stats/Runtime API 定位某个 Backend 为什么排队或摘除。

参考：[HAProxy Configuration Manual](https://docs.haproxy.org/)、[HAProxy Introduction](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/core-concepts/)。
