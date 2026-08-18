---
title: "Envoy Listener、Filter、HCM、Route、Cluster 与请求生命周期"
sidebar_label: "02. Envoy Listener、Filter、HCM、Route、Cluster 与请求生命周期"
sidebar_position: 2
description: "跟踪一条 HTTP 请求从下游连接进入 Envoy，到选择上游 Endpoint 并返回响应的完整运行时路径。"
tags: [Envoy, Listener, Filter Chain, HCM, Route, Cluster]
---

# Envoy Listener、Filter、HCM、Route、Cluster 与请求生命周期

学习 Envoy 最有效的方法不是背 YAML，而是追踪一条请求。配置字段最终都会进入连接、Stream、路由、连接池或上游选择的某个阶段。

## 1. 两个方向

- **Downstream**：客户端连接 Envoy 的一侧；
- **Upstream**：Envoy 连接后端服务的一侧。

这是两条独立连接。Envoy 可以在下游终止 TLS，再用不同证书和协议连接上游；客户端断开、上游重置和网关本身失败必须分别判断。

## 2. 完整请求路径

```text
socket accept
→ Listener Filters (original dst / proxy protocol / TLS inspector)
→ Filter Chain match (address, SNI, transport protocol, ALPN...)
→ downstream TLS handshake
→ Network Filters
→ HTTP Connection Manager + codec
→ HTTP decoder filters
→ VirtualHost / Route match
→ router filter
→ Cluster Manager
→ host set / priority / locality / LB
→ connection pool / upstream connection
→ upstream response
→ HTTP encoder filters in reverse direction
→ access log / stats / trace
```

Listener 接受连接；Listener Filter 在选 Filter Chain 前提取连接信息；Filter Chain 决定 TLS 上下文和 Network Filter；HCM 把字节解释为 HTTP Stream；Route 决定动作；Cluster 是逻辑上游，Endpoint 才是实际地址。

## 3. 路由顺序

HCM 首先按 `Host/:authority` 选择 Virtual Host，再按路由表顺序匹配 Path、Header、Query 等条件。一个 Route 可以转发、重定向或直接响应。路由表顺序会改变结果，宽泛前缀放在前面可能遮住精确规则。

Route 指向 Cluster 后，Cluster Manager 获得当前健康 Host 集，应用优先级、Locality、权重和负载均衡算法，随后从连接池获得或新建连接。没有 Route、没有健康 Host 和连接失败会产生不同的本地响应/响应标志。

## 4. Filter 的方向和暂停

请求沿 Decoder Filter 顺序前进，响应通常沿 Encoder Filter 反向返回。Filter 可以继续、暂停、直接响应或异步等待外部服务。一个外部鉴权 Filter 的延迟和失败策略会直接进入所有请求的延迟/可用性预算。

读取完整 Body 的 Filter 会触发缓冲，慢客户端和大请求可能放大内存。必须设置 Body、Header、连接、Stream 和 Buffer 限制。

## 5. 用 Admin 验证运行时

从受控管理网络查看 `/listeners`、`/config_dump`、`/clusters`、`/stats`，回答：

1. 目标 Listener 是否 active；
2. Filter Chain 是否包含预期 SNI/TLS/HCM；
3. Route 是否存在且 Host/Path 能命中；
4. Cluster 是否有健康 Endpoint；
5. 请求使用哪个 upstream 地址，是否复用连接；
6. 状态码和 response flags 由哪一层产生。

Admin 接口含内部拓扑和控制能力，不得暴露给业务网络。

## 6. 最小诊断实验

- 修改 Host，让请求出现 No Route，再恢复；
- 清空 Endpoint，观察无健康上游；
- 配错上游端口/TLS，区分连接失败；
- 让上游响应超时，观察总超时与 per-try timeout；
- 增加一个直接响应 Filter/Route，确认上游完全未收到请求；
- 比较 HTTP/1.1 多连接和 HTTP/2 多 Stream 的统计。

## 7. 掌握标准

看到一个 Envoy 配置时，你应能画出 Listener→Filter Chain→HCM→Route→Cluster→Endpoint 的对象引用；看到一个失败请求时，能确定它到达了哪一步，而不是笼统归因于“Envoy 转发失败”。

## 8. 参考资料 {/* #参考资料 */}

- [Life of a Request](https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request.html)
- [Envoy Architecture](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/arch_overview)
