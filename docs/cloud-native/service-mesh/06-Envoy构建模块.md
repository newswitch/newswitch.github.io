---
title: "Envoy 的构建模块"
sidebar_label: "06. Envoy 的构建模块"
sidebar_position: 6
description: "详细介绍 Envoy 代理的核心构建模块，包括监听器、过滤器链、路由配置和集群等概念，以及它们如何协同工作来处理网络流量。"
tags: [Kubernetes, 服务网格, PartII, 学习路线]
---

# Envoy 的构建模块

> Envoy 的每一个构建模块都是现代服务网格灵活性与可观测性的基石，理解它们才能真正驾驭流量治理的全貌。

本文从静态配置解释对象结构。完整动态配置、性能和故障路径请继续阅读 [Envoy 从零到精通学习路线](../../networking/load-balancing-proxy/envoy/00-Envoy从零到精通学习路线.md)。

## 1. 概述 {/* #概述 */}

在本节中，我们将深入探讨 Envoy 代理的基本构建模块及其工作原理。

Envoy 配置的根节点称为**引导配置**（Bootstrap Configuration）。它包含多个重要字段，允许我们提供静态或动态资源配置，以及高级 Envoy 设置（如实例名称、运行时配置、管理接口等）。

为了便于理解，我们首先专注于静态资源配置。在后续章节中，我们将介绍动态资源的配置方法。

需要注意的是，Envoy 会输出大量统计信息，这些信息的内容取决于启用的组件及其配置。我们将在整个课程中讨论不同的统计信息，并在专门的模块中深入分析。

下图展示了请求在 Envoy 各个构建模块中的流转过程：

![Envoy 构建块](/images/k8s/service-mesh/envoy-building-blocks/envoy-block.webp)

配置引用与真实执行可以先压缩为一张地图：

```text
Listener accepts connection
→ Listener Filter extracts connection metadata
→ Filter Chain match + optional downstream TLS
→ Network Filter / HTTP Connection Manager
→ HTTP decoder filters → VirtualHost/Route
→ Cluster → priority/locality/LB → Endpoint/connection pool
→ upstream
→ response encoder filters (reverse direction)
→ access log/stats/trace
```

Listener、Route、Cluster 是配置对象，连接、HTTP Stream 和 upstream connection 才是运行时工作。不要把一个 Listener 等同于一个请求，也不要把 Cluster 当成单一服务器。

## 2. 监听器（Listener） {/* #监听器listener */}

一切都从**监听器**开始。监听器是 Envoy 暴露的命名网络位置，可以是 IP 地址和端口的组合，也可以是 Unix 域套接字路径。Envoy 通过监听器接收连接和请求。

让我们看一个基本的 Envoy 配置示例：

```yaml
static_resources:
  listeners:
  - name: listener_0
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 10000
    filter_chains: [{}]
```

在这个配置中，我们在 `0.0.0.0:10000` 上定义了一个名为 `listener_0` 的监听器。这意味着 Envoy 正在监听该地址上的传入请求。

每个监听器都有不同的配置选项，但唯一必需的设置是地址。上述配置是有效的，可以用来运行 Envoy，但由于 `filter_chains` 为空，所有连接都会被直接关闭，因此实际上没有用处。

## 3. 过滤器与过滤器链 {/* #过滤器与过滤器链 */}

为了进入下一个构建模块（路由），我们需要创建一个或多个**网络过滤器链**（`filter_chains`），每个链至少包含一个过滤器。

### 3.1 过滤器类型 {/* #过滤器类型 */}

理解 HTTP 代理时常见三类过滤器：

1. **监听器过滤器**：在 Filter Chain 选择前处理新连接并提取元数据，例如 Proxy Protocol、TLS ClientHello/SNI 或原始目的地址
2. **网络过滤器**：在选定 Filter Chain 后处理连接级字节流，例如 HCM、TCP Proxy
3. **HTTP 过滤器**：在 HTTP 连接管理器内部运行，处理 HTTP 级别的操作

网络过滤器通常对数据包的有效载荷进行操作，查看和解析其内容。例如，Postgres 网络过滤器会解析数据包主体，检查数据库操作类型或其返回结果。

每个通过监听器的请求可以流经多个过滤器。我们还可以根据传入请求或连接属性选择不同的过滤器链。

![过滤器链](/images/k8s/service-mesh/envoy-building-blocks/filter-chain.webp)

### 3.2 HTTP 连接管理器 {/* #http-连接管理器 */}

一个特殊的内置网络过滤器叫做 **HTTP 连接管理器**（HTTP Connection Manager，简称 HCM）。HCM 过滤器能够将原始字节转换为 HTTP 级别的消息，并提供以下功能：

- 处理访问日志
- 生成请求 ID
- 操作 HTTP 头部
- 管理路由表
- 收集统计数据

就像我们可以为每个监听器定义多个网络过滤器一样，Envoy 也支持在 HCM 过滤器中定义多个 HTTP 级过滤器。这些 HTTP 过滤器在 `http_filters` 字段下定义。

![HCM 过滤器](/images/k8s/service-mesh/envoy-building-blocks/hcm-filter.webp)

**重要提示**：HTTP 过滤器链中的最后一个过滤器必须是路由器过滤器（`envoy.filters.http.router`），它负责执行实际的路由任务。

HTTP 请求按 Decoder Filter 顺序前进，响应通常按 Encoder 方向反向经过 Filter。Filter 可以暂停 Stream 等待异步外调、直接响应或缓冲 Body，因此每个 Filter 都必须有延迟、内存、超时和失败策略。

## 4. 路由配置 {/* #路由配置 */}

路由配置是 Envoy 的第二个核心构建模块。我们在 HCM 过滤器的 `route_config` 字段下定义路由配置。通过路由配置，我们可以根据请求的元数据（URI、Header 等）匹配传入的请求，并决定将流量发送到何处。

### 4.1 虚拟主机 {/* #虚拟主机 */}

路由配置中的顶级元素是**虚拟主机**。每个虚拟主机都有：

- 一个名称（用于统计数据发布，不用于路由）
- 一组被路由到它的域

以下是一个路由配置示例：

```yaml
route_config:
  name: my_route_config
  virtual_hosts:
  - name: tetrate_hosts
    domains: ["tetrate.io"]
    routes:
    # ... 路由规则
  - name: test_hosts
    domains: ["test.tetrate.io", "qa.tetrate.io"]
    routes:
    # ... 路由规则
```

当传入请求的 `Host/Authority` 头匹配相应域名时，对应虚拟主机中的路由规则将被处理。

### 4.2 域名匹配顺序 {/* #域名匹配顺序 */}

如果在数组中指定多个域名，搜索顺序如下：

1. **精确域名**（如 `tetrate.io`）
2. **后缀域名通配符**（如 `*.tetrate.io`）
3. **前缀域名通配符**（如 `tetrate.*`）
4. **匹配任何域的通配符**（`*`）

### 4.3 路由匹配规则 {/* #路由匹配规则 */}

在虚拟主机的 `routes` 字段中，我们指定如何匹配请求以及后续处理方式。支持的匹配类型包括：

| 匹配方式 | 描述 | 示例 |
|----------|------|------|
| `prefix` | 前缀必须与 `:path` 头的开头匹配 | `/hello` 匹配 `/hello`、`/helloworld`、`/hello/v1` |
| `path` | 路径必须与 `:path` 头完全匹配 | `/hello` 只匹配 `/hello`，不匹配 `/helloworld` |
| `safe_regex` | 使用正则表达式匹配 `:path` 头 | `/\d{3}` 匹配三位数字路径 |
| `connect_matcher` | 只匹配 CONNECT 请求 | 用于 HTTP CONNECT 方法 |

### 4.4 直接响应示例 {/* #直接响应示例 */}

以下是一个完整的配置示例，演示如何返回直接响应：

```yaml
static_resources:
  listeners:
  - name: listener_0
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 10000
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: hello_world_service
          http_filters:
          - name: envoy.filters.http.router
          route_config:
            name: my_first_route
            virtual_hosts:
            - name: direct_response_service
              domains: ["*"]
              routes:
              - match:
                  prefix: "/"
                direct_response:
                  status: 200
                  body:
                    inline_string: "Hello from Envoy!"
```

## 5. 集群（Cluster） {/* #集群cluster */}

**集群**是 Envoy 的第三个核心构建模块，它代表一组接受流量的上游相似主机。这可以是服务监听的主机或 IP 地址列表。

### 5.1 基本集群配置 {/* #基本集群配置 */}

例如，假设我们的 hello world 服务运行在 `127.0.0.1:8000`，我们可以创建一个包含单个端点的集群：

```yaml
clusters:
- name: hello_world_service
  connect_timeout: 5s
  type: STRICT_DNS
  load_assignment:
    cluster_name: hello_world_service
    endpoints:
    - lb_endpoints:
      - endpoint:
          address:
            socket_address:
              address: 127.0.0.1
              port_value: 8000
```

### 5.2 集群配置要点 {/* #集群配置要点 */}

- **名称**：在所有集群中必须唯一，用于路由引用和统计数据导出
- **连接超时**：通过 `connect_timeout` 字段设置
- **负载均衡**：支持多种算法（round-robin、Maglev、least-request、random），默认为 round-robin
- **端点权重**：可以为端点设置权重，影响流量分配
- **地域性**：可以配置端点的地理位置信息，用于就近路由

Cluster 是逻辑上游配置，Endpoint/Host 才是真实地址。Route 匹配成功但 Cluster 不存在、Cluster 没有健康 Host、连接 Endpoint 失败，会产生不同的本地错误和 response flag；排障时必须分开。

### 5.3 可选功能 {/* #可选功能 */}

集群还支持以下高级功能：

- **主动健康检查**（`health_checks`）
- **断路器**（`circuit_breakers`）
- **异常点检测**（`outlier_detection`）
- **协议选项**：处理上游 HTTP 请求的额外协议设置
- **网络过滤器**：应用于所有出站连接的过滤器

## 6. 完整配置示例 {/* #完整配置示例 */}

以下是一个完整的配置示例，展示了如何将所有构建模块组合在一起：

```yaml
static_resources:
  listeners:
  - name: listener_0
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 10000
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: hello_world_service
          http_filters:
          - name: envoy.filters.http.router
          route_config:
            name: my_first_route
            virtual_hosts:
            - name: hello_service
              domains: ["*"]
              routes:
              - match:
                  prefix: "/"
                route:
                  cluster: hello_world_service
  clusters:
  - name: hello_world_service
    connect_timeout: 5s
    type: STRICT_DNS
    load_assignment:
      cluster_name: hello_world_service
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: 127.0.0.1
                port_value: 8000
```

## 7. 实践测试 {/* #实践测试 */}

### 7.1 准备工作 {/* #准备工作 */}

首先安装 func-e CLI 工具：

```bash
curl https://func-e.io/install.sh | sudo bash -s -- -b /usr/local/bin
```

### 7.2 启动测试服务 {/* #启动测试服务 */}

启动一个 hello-world 测试服务：

```bash
docker run -dit -p 8000:3000 gcr.io/tetratelabs/hello-world:1.0.0
```

验证服务是否正常运行：

```bash
curl 127.0.0.1:8000
```

### 7.3 运行 Envoy {/* #运行-envoy */}

将上述完整配置保存为 `envoy-complete.yaml`，然后启动 Envoy：

```bash
func-e run -c envoy-complete.yaml
```

### 7.4 测试请求 {/* #测试请求 */}

向 Envoy 代理发送请求：

```bash
curl -v localhost:10000
```

成功的响应应该包含：

- `x-envoy-upstream-service-time` 头部
- `server: envoy` 头部
- 来自上游服务的 "Hello World" 响应

这表明请求成功通过 Envoy 代理转发到了后端服务。

### 7.5 不只验证 200 {/* #不只验证-200 */}

完成成功请求后，主动制造四类故障：

| 实验 | 预期观察 |
| --- | --- |
| 使用不匹配的 Host/Path | No Route，本地响应且上游无请求 |
| 清空/禁用 Endpoint | Cluster 无健康 Host |
| 配错上游端口或 TLS | upstream connect/handshake failure |
| 让上游慢于 Route timeout | 504/timeout，并检查是否发生重试 |

从受控 Admin 通道检查 `/listeners`、`/config_dump`、`/clusters` 和 `/stats`，再把 Access Log 中 Route、Cluster、upstream Host、response flags/details 与实验对应。Admin 不得对业务网络开放。

## 8. 总结 {/* #总结 */}

Envoy 的核心构建模块包括：

1. **监听器**：定义网络接入点
2. **过滤器链**：处理和转换请求数据
3. **路由配置**：决定请求的处理方式和目标
4. **集群**：定义上游服务端点

这些组件协同工作，为现代微服务架构提供了强大而灵活的代理能力。理解这些基本概念是掌握 Envoy 高级功能的基础。

## 9. 静态对象到动态 xDS {/* #静态对象到动态-xds */}

静态配置中的对象在动态控制面分别由 LDS、RDS、CDS、EDS、SDS 等资源提供。新资源先校验和 warming，再切为 active；依赖缺失可能让资源停在 warming 或 NACK。控制面断开时数据面通常继续使用最后有效配置，但 Endpoint、Route 和证书不会再更新。

下一步依次学习 [请求生命周期](../../networking/load-balancing-proxy/envoy/02-Listener-Filter-HCM-Route-Cluster与请求生命周期.md)、[xDS 配置路径](../../networking/load-balancing-proxy/envoy/05-xDS-Bootstrap-ADS-Delta与ACK-NACK.md) 和 [生产故障 Runbook](../../networking/load-balancing-proxy/envoy/14-源码xDS-NACK-503-504内存与生产故障Runbook.md)。
