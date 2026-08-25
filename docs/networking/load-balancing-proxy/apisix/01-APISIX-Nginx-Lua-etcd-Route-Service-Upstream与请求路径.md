---
title: "APISIX：Nginx、Lua、etcd、Route、Service、Upstream 与请求路径"
sidebar_label: "01. 架构与请求路径"
sidebar_position: 1
description: "跟踪一条请求从监听端口、路由匹配、插件执行、负载均衡到上游返回的完整路径。"
tags: [APISIX, Request Path, Route, Upstream]
---

# APISIX：Nginx、Lua、etcd、Route、Service、Upstream 与请求路径

## 1. 对象职责

| 对象 | 职责 |
| --- | --- |
| Route | 按 URI、Host、Method、Header 等匹配请求 |
| Service | 多条 Route 共享的插件和上游逻辑 |
| Upstream | 节点、服务发现、LB、健康检查与重试 |
| Consumer | 调用方身份和认证凭据 |
| Plugin Config | 可复用插件配置集合 |
| SSL | SNI 证书与 TLS 配置 |

引用链和内联配置同时存在时要理解优先级，避免 Route 中局部配置意外覆盖共享治理。

## 2. 数据面路径

```text
Client建立TCP/TLS
→ Nginx接收HTTP请求
→ radixtree匹配Route
→ 合并Route/Service/Consumer插件配置
→ rewrite/access阶段执行认证、限流、改写
→ Upstream选择节点并建立连接
→ header/body filter与log阶段
→ 返回响应并写指标/日志
```

插件按 Nginx 阶段和优先级执行。认证要在流量进入上游前，响应改写在过滤阶段，异步日志在 log 阶段。插件“已经启用”不代表执行顺序符合预期。

## 3. 控制面路径

Admin API 校验配置后写入 etcd；各 APISIX 节点 Watch 变更并更新本地内存结构，请求不需要每次查询 etcd。因而 etcd 短时不可用时已有路由通常还能服务，但新增/修改和节点冷启动会受影响。

配置发布要验证三个状态：etcd 已持久化、目标网关已观察到版本、真实请求按预期路由。只看 Admin API 200 不足以完成验收。

## 4. 负载均衡与发现

Upstream 可静态配置节点，也可连接 DNS、Consul、Nacos、Kubernetes 等服务发现。LB 算法、主动/被动健康检查、重试和连接池共同影响实际流量。服务发现返回实例不等于健康检查通过。

## 5. 调试方法

为测试请求增加唯一 Request ID，记录匹配 Route ID、Consumer、Upstream Node、重试次数和耗时。404 先查 Route 匹配；401/403 查认证授权插件；502/504 查上游选择、连接、TLS 和超时；延迟高再分解网关排队、插件和上游时间。

参考：[APISIX Architecture](https://apisix.apache.org/docs/apisix/architecture-design/apisix/)、[Admin API](https://apisix.apache.org/docs/apisix/admin-api/)。
