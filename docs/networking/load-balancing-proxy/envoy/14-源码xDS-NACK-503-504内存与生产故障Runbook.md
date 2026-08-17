---
title: "Envoy 源码、xDS NACK、503/504、内存与生产故障 Runbook"
sidebar_position: 14
tags: [Envoy, Source Code, Troubleshooting, NACK, 503, 504]
description: "把请求主路径和配置主路径映射到 Envoy 源码，并给出 xDS、路由、上游、内存、崩溃的生产排障顺序。"
---

# Envoy 源码、xDS NACK、503/504、内存与生产故障 Runbook

生产排障先用运行时证据确定故障层，再进入源码。Envoy 有两条主线：主线程上的配置/生命周期和 Worker 上的数据面请求。

## 1. 源码地图

```text
bootstrap / server
→ listener manager / worker
→ network listener and filter chain
→ HTTP connection manager
→ HTTP filter manager / router
→ cluster manager / load balancer / connection pool
→ upstream stream

xDS stream
→ subscription / config provider
→ resource validation
→ listener/cluster/route/secret manager
→ warming / worker update
→ ACK or NACK
```

从配置中的 extension name/type URL 找 Factory；从 response flag/details 找生成本地响应的代码；从统计项前缀找对应 Manager/Filter。固定 Envoy commit、编译特性、Bootstrap 和最小 xDS Snapshot，避免在不同版本源码上猜测。

## 2. 事故固定动作

记录开始时间、影响入口/Route/Cluster、协议、版本、最近配置/证书/镜像变更、请求 ID 与客户端错误。安全保存访问日志、错误日志、`/stats`、`/config_dump`、`/clusters`、证书、进程/容器/内核指标和控制面 ACK/NACK。

不要为了排障公开 Admin；不要在高负载实例无限开启 debug 日志或无界 Tap。

## 3. xDS NACK

按 node→type URL→nonce/version→error detail→资源名称定位。检查未知/弃用字段、类型 URL、重复名称、引用缺失、SDS Secret、扩展不可用和控制面/Envoy 版本兼容。确认数据面当前 active 的最后有效版本，不要把控制面数据库版本当运行时事实。

资源 ACK 后仍不生效，继续检查 warming、作用域、Route 顺序、目标节点和请求是否命中。

## 4. 503/504 响应矩阵

| 证据/标志示例 | 层次 | 检查 |
| --- | --- | --- |
| NR | Route | authority/path/header、路由顺序 |
| UH | Host 集 | EDS/DNS、健康、Locality/优先级 |
| UF | 建连/握手 | IP/端口、NetworkPolicy、TLS/SNI/SAN |
| UC/UR | 上游连接/reset | 应用、连接池、协议、排空 |
| UO | Circuit Breaker | pending/connection/request 阈值 |
| 504/timeout details | Timeout | route/per-try、排队、重试、上游耗时 |

具体 response flags/details 以运行 Envoy 版本为准。先判断状态由 Envoy 本地产生还是上游返回，再看是否有多次尝试。

## 5. 内存持续增长

分解为连接/Stream、Buffer、统计基数、配置资源、Wasm/Filter 状态和 allocator/RSS。查看连接、pending、请求/响应大小、慢客户端、Route/Cluster/Host 数、动态名字统计、配置 churn 和热重启代际。用 heap/profile 工具必须评估生产开销，优先在可复现 Canary 上执行。

CPU 平均不高但单 Worker 可饱和；内存 limit 未触发不代表没有延迟回收或接近 Overload 阈值。

## 6. Crash/OOM

保存退出码、容器事件、内核 OOM、core/minidump（按安全政策）、镜像 digest 和前后配置。确认是 cgroup OOM、进程 abort/assert、扩展崩溃还是外部 SIGKILL。先隔离问题版本/配置，保持容量，再最小复现；不要在线上反复重启抹掉证据。

## 7. 标准 Runbook 顺序

1. 确定影响范围和 SLO，停止高风险发布；
2. 用访问日志定位 Listener/Route/Cluster/Host/flags；
3. 用 Stats 判断连接、重试、溢出、内存与过载；
4. 用 Config Dump/xDS 日志确认真实配置；
5. 直连上游和跨实例对比，定位网络/服务/单 Worker；
6. 选择限流、摘除、回滚配置/镜像或扩容，写清停止条件；
7. 最小复现并进入源码，补测试、告警和自动回滚门禁。

## 8. 掌握标准

你应能在 503/504、NACK、内存增长和 Crash 中先建立证据链，再定位到 Envoy 对象与源码模块，并给出风险可控、可验证、可回退的处置。

## 参考资料

- [Envoy Source](https://github.com/envoyproxy/envoy)
- [Response Flags](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage)
- [Bug Reports](https://www.envoyproxy.io/docs/envoy/latest/faq/overview)
