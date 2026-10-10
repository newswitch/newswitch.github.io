---
title: "Nginx 从零到精通学习路线"
sidebar_label: "00. Nginx 从零到精通学习路线"
sidebar_position: 0
description: "从配置与 HTTP/Stream 数据路径，深入事件循环、Upstream、TLS、缓存、动态服务发现、Kubernetes、性能容量、扩展模块和源码。"
tags: [Nginx, HTTP, Stream, 反向代理, 负载均衡, Kubernetes, 源码, 学习路线]
---

# Nginx 从零到精通学习路线

本路线从请求路径出发，依次讲解部署、配置解析、HTTP/1.1/2/3、反向代理、负载均衡、缓存、HTTPS、WebSocket/SSE/gRPC、TCP/UDP Stream、安全、动态服务发现、Kubernetes、性能分析、生产运维与故障排查，并把脚本扩展和源码数据结构放回完整请求链路中理解。

版本选择遵循 Nginx 官方 stable/mainline 支持策略，生产固定批准补丁和模块构建清单；不能只记录 `nginx/1.x`。

## 1. 一次请求

```text
Client TCP/TLS
  → listen socket / accept
  → Worker event loop(epoll/kqueue)
  → connection / HTTP parser
  → server_name + location match
  → rewrite/access/content/filter phases
  → upstream selection / connection pool
  → proxy response / filter / log
```

## 2. 课程结构

| 编号 | 文章 | 优先级 |
| --- | --- | --- |
| G00 | Nginx 从零到精通学习路线 | P0 |
| G01 | [Nginx 解决什么问题与一次请求完整路径](./01-Nginx解决什么问题与一次请求完整路径.md) | P0 |
| G02 | [Package、源码、Docker 与 Kubernetes 多种部署](./02-Nginx-Package源码Docker与Kubernetes部署.md) | P0 |
| G03 | [配置上下文、指令继承、变量、Location 与 Reload](./03-Nginx配置上下文指令继承变量Location与Reload.md) | P0 |
| G04 | [Reverse Proxy、Upstream、负载均衡、健康与重试](./04-Nginx反向代理Upstream负载均衡健康与重试.md) | P0 |
| G05 | [Nginx HTTPS、TLS 握手、证书与性能](./05-一文搞懂-Nginx如何配置HTTPS.md) | P0 |
| G06 | [静态文件、Sendfile、Buffer、Compression 与 Cache](./06-Nginx静态文件Sendfile-Buffer压缩与Cache.md) | P0 |
| G07 | [Master/Worker、Event Loop、Accept、连接与定时器](./07-Nginx-Master-Worker事件循环连接与定时器.md) | P0 |
| G08 | [HTTP Phase、Module、Subrequest、Filter 与变量源码](./08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md) | P2 |
| G09 | [限流、限连、鉴权、WAF 边界与安全加固](./09-Nginx限流限连鉴权WAF与安全加固.md) | P1 |
| G10 | [Nginx 大模型网关日志配置与请求观测](./10-Nginx大模型网关日志配置实践.md) | P1 |
| G11 | [Worker、连接、CPU、内存、带宽与容量压测](./11-Nginx-Worker连接CPU内存带宽与容量压测.md) | P1 |
| G12 | [高可用、Keepalived/LB、热升级、灰度与故障 Runbook](./12-Nginx高可用Keepalived热升级灰度与Runbook.md) | P1 |
| G13 | [Nginx 源码架构与基础数据结构](./13-nginx源码分析-基础数据结构.md) | P2 |
| G14 | [Nginx 内存池与基础数据结构实现](./14-nginx源码解析-基础数据结构（一）.md) | P2 |
| G15 | [HTTP/1.1、HTTP/2、HTTP/3 请求解析、连接与流控](./15-Nginx-HTTP1-HTTP2-HTTP3请求解析连接与流控.md) | P0 |
| G16 | [WebSocket、SSE、gRPC、FastCGI 与流式代理](./16-Nginx-WebSocket-SSE-gRPC-FastCGI与流式代理.md) | P0 |
| G17 | [DNS、Resolver、动态 Upstream 与服务发现](./17-Nginx-DNS-Resolver动态Upstream与服务发现.md) | P1 |
| G18 | [Stream、TCP/UDP、TLS Preread 与 PROXY Protocol](./18-Nginx-Stream-TCP-UDP-TLS-Preread与PROXY-Protocol.md) | P1 |
| G19 | [日志、指标、Tracing、调试与故障排查](./19-Nginx日志指标Tracing调试与故障排查.md) | P0 |
| G20 | [Kubernetes Ingress、Gateway API 与生产运维](./20-Nginx-Kubernetes-Ingress-Gateway与生产运维.md) | P1 |
| G21 | [模块、动态模块、njs、Lua/OpenResty 与扩展边界](./21-Nginx模块动态模块njs-Lua-OpenResty与扩展边界.md) | P2 |

## 3. 学习阶段

### 3.1 配置和数据路径 {/* #配置和数据路径 */}

完成 G01～G06、G15～G18。要能通过 `nginx -T` 还原最终配置，解释 server/location 选择、HTTP 版本差异、请求头改写、Upstream 重试、DNS 更新、流式 Buffer 和 Stream 四层代理，而不是只会粘贴 Location 片段。

### 3.2 内核与源码 {/* #内核与源码 */}

完成 G07～G08、G13～G14、G21。重点理解一个 Worker 通过事件循环服务大量连接，HTTP Phase/Filter 怎样执行，以及 CPU 密集模块或阻塞脚本为何仍会卡住该 Worker。

### 3.3 生产治理 {/* #生产治理 */}

完成 G09～G12、G19～G20。建立并发连接、请求率、响应大小、上下行带宽、TLS CPU、Upstream 延迟、Buffer/Cache、日志量和 Kubernetes 滚动排空的容量模型。

## 4. P0 验收题

- Master 与 Worker 分别做什么，Reload 时旧连接怎样排空？
- `location` 匹配顺序为什么容易产生安全绕过？
- `proxy_pass` 是否带 URI 时转发路径有什么差异？
- Upstream 返回 500、连接超时、读超时是否都应重试？
- Buffering 为什么既能保护慢客户端，也可能增加磁盘和延迟？
- `proxy_cache_bypass` 与 `proxy_no_cache` 分别控制什么？
- HTTP/2 Connection 与 Stream 为什么要分别限额？
- SSE、WebSocket、gRPC 的 Buffer 和超时边界有什么不同？
- DNS 已更新，Nginx 为什么仍可能访问旧 Pod？
- TLS Preread 为什么能按 SNI 路由，却不能按 HTTP Path 路由？
- Keepalive 是客户端连接、Upstream 连接还是两者？
- CPU 低但请求排队，应看 Worker connection、accept、upstream 还是网络？
- Nginx Active 很低但业务 P99 高，怎样分离网关时间与上游时间？
- Ingress 对象存在，为什么数据面可能仍未生成对应路由？
- Lua 使用协程后，哪些调用仍可能阻塞 Worker？

## 5. 与 Higress/Envoy 的边界

```text
Nginx：成熟 Web Server / Reverse Proxy / 静态配置与模块生态
Envoy：面向动态服务发现、xDS、L4/L7 Filter 和可观测性的通用数据面
Higress：基于 Istio/Envoy 的云原生 API/AI 网关产品层
```

选型要看动态配置、协议、Kubernetes/Gateway API、插件、AI 流式、运维模型和团队经验，不只比较单次压测 QPS。

## 6. 官方资料

- [Nginx Documentation](https://nginx.org/en/docs/)
- [Nginx Source](https://github.com/nginx/nginx)

配置指令需要映射到对应的请求阶段和源码模块，才能把“会配置”与“懂执行过程”连接起来。
