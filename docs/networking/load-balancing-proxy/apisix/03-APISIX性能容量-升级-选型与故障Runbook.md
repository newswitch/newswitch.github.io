---
title: "APISIX 性能容量、升级、选型与故障 Runbook"
sidebar_label: "03. 性能、升级与故障 Runbook"
sidebar_position: 3
description: "建立 APISIX 网关容量模型，完成压测、升级和 404、5xx、延迟、配置不生效等故障排查。"
tags: [APISIX, Performance, Capacity, Troubleshooting]
---

# APISIX 性能容量、升级、选型与故障 Runbook

## 1. 容量指标

网关容量至少包含新建连接率、并发连接、HTTP RPS、请求/响应字节、TLS 握手、插件 CPU、上游连接池和日志吞吐。平均 RPS 相同，短连接 TLS、小包高 QPS 与大文件传输的瓶颈完全不同。

压测矩阵逐步加入：纯转发、TLS、认证、限流、外部 OIDC、Access Log、Trace、大 Header/Body、上游慢响应和节点故障。记录 P50/P95/P99、CPU 单核饱和、Event Loop Lag、连接错误与 Upstream 延迟。

## 2. Runbook

| 现象 | 第一检查层 | 关键证据 |
| --- | --- | --- |
| 404 | Route 匹配 | Host、URI、Method、Route ID |
| 401/403 | Consumer/认证授权插件 | 凭据、插件配置、时钟、Scope |
| 429 | 限流 | Key、计数存储、阈值、重试客户端 |
| 502 | 上游连接/协议 | Node、DNS、TLS、Reset、健康状态 |
| 504 | 超时链 | Connect/Read/Send、上游处理时间 |
| 配置不生效 | Admin API→etcd→Watch | Resource Version、节点配置版本 |
| 延迟高 | 分段时间 | 网关排队、插件、上游、日志出口 |

etcd 异常时先保护 Quorum 与数据，检查磁盘/网络/Leader；不要删除 etcd 数据目录。单个插件异常可灰度禁用，但必须保留失败请求和配置证据。

## 3. 升级

固定 APISIX、etcd、Ingress Controller、Lua 插件和 Helm Chart 版本。阅读不兼容变更；备份 etcd；在预生产导入生产配置；先金丝雀一个数据面节点，验证路由、插件、TLS 和指标，再滚动。回滚要考虑新配置是否被旧版本识别。

## 4. 选型问题

评估现有 Nginx/Lua 经验、所需认证与流量插件、控制面 API、Kubernetes/Gateway API、插件扩展语言、性能、社区和运维 etcd 的能力。若只需几个稳定反向代理规则，Nginx/HAProxy 更简单；若需要动态 API 生命周期治理，APISIX 更合适。

参考：[APISIX FAQ](https://apisix.apache.org/docs/apisix/FAQ/)、[APISIX Benchmark](https://apisix.apache.org/docs/apisix/benchmark/)。
