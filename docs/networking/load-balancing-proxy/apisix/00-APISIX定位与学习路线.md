---
title: "Apache APISIX 定位与学习路线"
sidebar_label: "00. APISIX 定位与学习路线"
sidebar_position: 0
description: "从 API Gateway 数据面和控制面理解 APISIX，并建立与 Nginx、Kong、Higress、Envoy 的选型框架。"
tags: [APISIX, API Gateway, Nginx, etcd]
---

# Apache APISIX 定位与学习路线

Apache APISIX 是动态、插件化的 API Gateway。Nginx/OpenResty 承载请求数据面，Lua 插件完成认证、限流、改写和可观测性，etcd 保存 Route、Service、Upstream、Consumer 等配置，Admin API/Ingress Controller 管理控制面。

## 1. 学习路径

1. 本文建立定位和选型框架；
2. [Nginx、Lua、etcd、Route、Service、Upstream 与请求路径](./01-APISIX-Nginx-Lua-etcd-Route-Service-Upstream与请求路径.md)理解原理；
3. [部署、Admin API、插件、认证、可观测性与 Kubernetes](./02-APISIX部署-Admin-API-插件-认证-可观测性与Kubernetes.md)完成实践；
4. [性能容量、升级、选型与故障 Runbook](./03-APISIX性能容量-升级-选型与故障Runbook.md)掌握生产边界。

## 2. 技术边界

| 技术 | 更接近的定位 |
| --- | --- |
| Nginx | 通用 Web Server、反向代理和 L4/L7 负载均衡 |
| APISIX/Kong | API Gateway，强调动态配置和插件生态 |
| Higress | 云原生 API Gateway，强调 Envoy/Istio 与 AI 场景生态 |
| Envoy | 高性能数据面代理，通常需要独立控制面 |
| Istio | 服务间通信的 Mesh 控制面，覆盖 East-West 流量 |

APISIX 可作为 North-South 网关，也能代理内部 API；它不代替业务鉴权设计、服务注册中心或完整服务网格。

## 3. 完成标准

能从 Host/Path 匹配跟到 Upstream；能区分 Route、Service、Upstream、Consumer 和 Plugin Config；能解释 etcd 暂时不可用时已加载配置与新配置的不同影响；能计算网关吞吐、连接、TLS 和插件成本；能与 Nginx/Higress/Kong 做需求驱动选型。

参考：[APISIX Architecture](https://apisix.apache.org/docs/apisix/architecture-design/apisix/)、[APISIX Terminology](https://apisix.apache.org/docs/apisix/terminology/route/)。
