---
title: "Envoy Stats、Access Log、Tracing、Admin、Tap 与请求调试"
sidebar_label: "09. Envoy Stats、Access Log、Tracing、Admin、Tap 与请求调试"
sidebar_position: 9
description: "用低基数指标、结构化访问日志、Trace、Admin 状态和受控 Tap 还原 Envoy 请求与配置事实。"
tags: [Envoy, Observability, Access Log, Tracing, Admin, Tap]
---

# Envoy Stats、Access Log、Tracing、Admin、Tap 与请求调试

Envoy 的可观测性要回答两类问题：运行时装载了什么配置，请求在哪个阶段发生了什么。一个 Dashboard 不能替代配置事实和单请求时间线。

## 1. 四类证据

| 证据 | 适合回答 | 局限 |
| --- | --- | --- |
| Stats | 流量、错误、连接、重试、饱和趋势 | 高基数会占内存 |
| Access Log | 单请求 Route/Cluster/Host/时间/响应标志 | 需采样、脱敏与关联 ID |
| Trace | 跨服务和 Filter/上游耗时 | 采样可能漏个案 |
| Admin/Config Dump | Listener/Route/Cluster/Endpoint/Secret 实际状态 | 含敏感拓扑，必须隔离 |

Tap 可捕获匹配流量供调试，但请求/响应可能含凭据与业务数据，只能在审批、最小匹配、短时和加密保存条件下使用。

## 2. 指标设计

按 Listener、HTTP Connection Manager、Virtual Host/Route、Cluster 和 Host 理解指标命名。核心四类：

- 流量：downstream/upstream requests、connections、bytes；
- 错误：4xx/5xx、reset、timeout、retry、NACK；
- 延迟：总请求、upstream、连接和 TLS；
- 饱和：pending、连接池、circuit breaker overflow、memory、overload action。

Route/Cluster 名由平台控制时可以作标签；用户、URL 参数、Request ID、IP 等高基数值不要进入指标维度。Envoy 统计对象本身会消耗内存。

## 3. 结构化访问日志

最小字段包括时间、内部请求 ID、downstream/upstream 地址、方法、authority/path 模板、protocol、Route、Cluster、upstream Host、状态码、response flags/details、总时长、upstream time、收发字节、重试次数和 trace ID。

Prompt、Authorization、Cookie 和敏感 Body 默认不记录。日志后端阻塞不应反向拖慢代理；验证异步输出、Buffer、丢弃策略和磁盘上限。

## 4. Admin 使用边界

常见只读端点包括 `/ready`、`/stats`、`/clusters`、`/listeners`、`/config_dump`、证书信息。不同版本端点和字段可能变化，先核对固定版本。Admin 还可能暴露修改/关闭等能力，不能直接绑定公网或普通集群网段。

## 5. 一条慢请求的调试顺序

1. 从客户端取得时间、协议、Request/Trace ID 和完整现象；
2. Access Log 确认命中 Route、Cluster、Host、状态码和 flags；
3. 比较总时长与 upstream 时长，检查是否重试；
4. Stats 判断是个例还是流量级饱和；
5. Config Dump 确认当时配置版本和 Endpoint；
6. Trace 深入鉴权/上游；必要时用最小 Tap 或抓包验证协议；
7. 与直连上游对照，并保留最近变更时间线。

## 6. 掌握标准

你应能通过 response flags/details 把 503/504 缩小到 Route、健康 Host、连接、reset 或 timeout，并在不泄露数据、不制造指标高基数的前提下构建可操作的看板和告警。

## 7. 参考资料 {/* #参考资料 */}

- [Envoy Observability](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/observability)
- [Access Log Usage](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage)
