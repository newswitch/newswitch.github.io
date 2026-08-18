---
title: "Nginx 从零到精通学习路线"
sidebar_label: "00. Nginx 从零到精通学习路线"
sidebar_position: 0
description: "从配置与反向代理深入 Master/Worker、事件循环、HTTP 阶段、Upstream、TLS、缓存、性能容量、热升级和源码。"
tags: [Nginx, 反向代理, 负载均衡, 源码, 学习路线]
---

# Nginx 从零到精通学习路线

现有 Nginx 内容已经覆盖 HTTPS、大模型网关日志和部分源码数据结构，但缺少从请求路径到生产运维的中间层。本路线将它们纳入统一顺序，并补齐部署、配置、反向代理、缓存、安全、性能和故障排查。

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

## 2. 篇文章规划 {/* #2-15-篇文章规划 */}

| 编号 | 文章 | 优先级 | 状态 |
| --- | --- | --- | --- |
| G00 | Nginx 从零到精通学习路线 | P0 | 已完成 |
| G01 | [Nginx 解决什么问题与一次请求完整路径](./01-Nginx解决什么问题与一次请求完整路径.md) | P0 | 已完成 |
| G02 | [Package、源码、Docker 与 Kubernetes 多种部署](./02-Nginx-Package源码Docker与Kubernetes部署.md) | P0 | 已完成 |
| G03 | [配置上下文、指令继承、变量、Location 与 Reload](./03-Nginx配置上下文指令继承变量Location与Reload.md) | P0 | 已完成 |
| G04 | [Reverse Proxy、Upstream、负载均衡、健康与重试](./04-Nginx反向代理Upstream负载均衡健康与重试.md) | P0 | 已完成 |
| G05 | [Nginx HTTPS、TLS 握手、证书与性能](./05-一文搞懂-Nginx如何配置HTTPS.md) | P0 | 已完成 |
| G06 | [静态文件、Sendfile、Buffer、Compression 与 Cache](./06-Nginx静态文件Sendfile-Buffer压缩与Cache.md) | P0 | 已完成 |
| G07 | [Master/Worker、Event Loop、Accept、连接与定时器](./07-Nginx-Master-Worker事件循环连接与定时器.md) | P0 | 已完成 |
| G08 | [HTTP Phase、Module、Subrequest、Filter 与变量源码](./08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md) | P2 | 已完成 |
| G09 | [限流、限连、鉴权、WAF 边界与安全加固](./09-Nginx限流限连鉴权WAF与安全加固.md) | P1 | 已完成 |
| G10 | [Nginx 大模型网关日志配置与请求观测](./10-Nginx大模型网关日志配置实践.md) | P1 | 已完成 |
| G11 | [Worker、连接、CPU、内存、带宽与容量压测](./11-Nginx-Worker连接CPU内存带宽与容量压测.md) | P1 | 已完成 |
| G12 | [高可用、Keepalived/LB、热升级、灰度与故障 Runbook](./12-Nginx高可用Keepalived热升级灰度与Runbook.md) | P1 | 已完成 |
| G13 | [Nginx 源码架构与基础数据结构](./13-nginx源码分析-基础数据结构.md) | P2 | 已完成 |
| G14 | [Nginx 内存池与基础数据结构实现](./14-nginx源码解析-基础数据结构（一）.md) | P2 | 已完成 |

当前完成 **15/15**，剩余 **0 篇**。

## 3. 学习阶段

### 3.1 配置和数据路径 {/* #配置和数据路径 */}

完成 G01～G06。要能通过 `nginx -T` 还原最终配置，解释 server/location 选择、请求头改写、upstream 重试和响应 Buffer，而不是只会粘贴 location 片段。

### 3.2 内核与源码 {/* #内核与源码 */}

完成 G07～G08、G13～G14。重点理解一个 Worker 通过事件循环服务大量连接，CPU 密集模块或阻塞调用为何仍会卡住该 Worker。

### 3.3 生产治理 {/* #生产治理 */}

完成 G09～G12。建立并发连接、请求率、响应大小、上下行带宽、TLS CPU、upstream 延迟、Buffer/Cache 和日志量的容量模型。

## 4. P0 验收题

- Master 与 Worker 分别做什么，Reload 时旧连接怎样排空？
- `location` 匹配顺序为什么容易产生安全绕过？
- `proxy_pass` 是否带 URI 时转发路径有什么差异？
- Upstream 返回 500、连接超时、读超时是否都应重试？
- Buffering 为什么既能保护慢客户端，也可能增加磁盘和延迟？
- Keepalive 是客户端连接、Upstream 连接还是两者？
- CPU 低但请求排队，应看 Worker connection、accept、upstream 还是网络？
- Nginx Active 很低但业务 P99 高，怎样分离网关时间与上游时间？

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

后续文章会把配置指令映射到对应请求阶段和源码模块，使“会配置”与“懂执行过程”连接起来。
