---
title: "Nginx Worker、连接、CPU、内存、带宽与容量压测"
sidebar_label: "11. 性能、容量与压测"
sidebar_position: 11
description: "建立连接、FD、内存 Buffer、带宽、TLS CPU、上游连接池和排队容量模型，并设计可复现压测。"
tags: [Nginx, 性能, 容量规划, 压测, Worker]
---

# Nginx Worker、连接、CPU、内存、带宽与容量压测

容量规划不能从 `worker_connections × worker_processes` 得出一个“最大并发”。Nginx 是请求链中的一层，连接、FD、内存、CPU、带宽、临时盘和上游容量任何一项都可能先达到边界。

## 1. 先定义流量模型

至少记录：

- 新连接/s、并发连接和连接寿命；
- 请求/s、每连接请求数、HTTP 版本；
- 请求/响应 Header 与 Body 大小分布；
- 流式、上传、下载和普通 API 比例；
- TLS 完整/恢复握手比例；
- 上游延迟、错误和重试比例；
- 缓存命中率；
- P50/P95/P99 与允许错误率。

只报一个 QPS 无法复现容量。

## 2. 连接容量

近似：

```text
Concurrent ≈ Arrival Rate × Average Lifetime
```

这是 Little's Law 的直观形式。例如 5,000 新连接/s、平均存活 20 秒，平均并发约 100,000。长尾连接会让峰值更高。

反向代理的 Socket 数近似：

```text
FD ≈ downstream connections
   + active upstream connections
   + idle upstream pool
   + listening/log/cache/temp files
   + safety margin
```

`worker_connections` 包含上游连接。还需检查 `worker_rlimit_nofile`、systemd `LimitNOFILE`、Cgroup 和内核全局限制。

## 3. Upstream 端口与 NAT

Nginx 连接同一后端四元组时，需要本地临时端口。大量短连接可能耗尽端口并积累 TIME_WAIT：

```bash
sysctl net.ipv4.ip_local_port_range
ss -s
ss -tan state time-wait | wc -l
```

优先修复 Upstream Keepalive 和连接复用，而不是盲目缩短 TCP 状态时间或开启危险复用参数。经过 SNAT 时瓶颈还可能位于 NAT 网关。

## 4. 内存模型

单连接内存不是常数。组成包括：

```text
Connection/Request 对象
+ TLS State
+ Header Buffer
+ Request Body Buffer
+ Proxy Response Buffer
+ HTTP/2 Connection/Stream State
+ Module Context
+ Log/Temporary allocations
```

估算：

```text
Memory ≈ baseline RSS
       + concurrent_connection × average_connection_state
       + active_request × average_request_buffers
       + shared_zones
       + allocator/fragmentation/safety margin
```

不能把 `proxy_buffers` 配置值直接乘所有连接，因为分配具有阶段性；应使用压测过程的 RSS、Cgroup Memory、Slab 和临时盘实测。

## 5. Shared Memory Zone

Upstream Zone、Rate Limit Zone、Connection Limit、TLS Session Cache 和 Proxy Cache Keys Zone 都消耗共享内存。Zone 太小可能出现状态无法记录或容量下降，不等于 Worker RSS 中完全可见。

记录每个 Zone 的 Key 大小、活跃 Key 数和过期时间，尤其避免用高基数未清洗 Header 作为 Key。

## 6. CPU 模型

CPU 消耗来自：

- TLS Handshake 与 Record 加解密；
- Gzip/Brotli；
- 正则 Location/Map/WAF；
- JSON/Lua/njs/第三方模块；
- 日志格式化和磁盘/网络输出；
- Cache Hash、Copy、Checksum；
- Kernel 网络栈、软中断和 Conntrack。

平均 CPU 低但单 Worker 100% 时，延迟仍会升高。按 PID、CPU 和 NUMA 观察：

```bash
pidstat -p ALL 1
mpstat -P ALL 1
perf top -p <worker-pid>
```

## 7. 带宽模型

```text
Egress bit/s ≈ RPS × Average Response Bytes × 8 × protocol overhead
Ingress bit/s ≈ RPS × Average Request Bytes × 8 × overhead
```

还要包含 TLS、TCP/IP、以太网封装、重传、日志上报和代理多跳。1 Gbit/s 理论线速不等于业务可用吞吐，小包 PPS、NIC 队列和 CPU 可能先成为瓶颈。

压缩减少 Egress，却增加 CPU；缓存减少 Upstream 流量，却增加本地磁盘与命中管理。

## 8. 临时盘和缓存盘

慢客户端下载、请求上传、Proxy Cache 和日志都可能写磁盘：

```text
Temp Disk Working Set
≈ concurrent_spilled_requests × average_spilled_bytes
```

监控容量、inode、写延迟、IOPS、吞吐、写放大和 Cgroup Ephemeral Storage。根盘填满会同时影响日志、PID、容器和系统服务。

## 9. Listen 与排队

链路中存在多级队列：

```text
NIC/RX → SYN Queue → Accept Queue → Worker Ready Events
→ Rate Limit Delay → Upstream Connect/Pool
→ Backend Queue → Application
```

吞吐接近容量时，首先增长的常是排队延迟而不是错误率。必须同时看：

- `$request_time`；
- `$upstream_connect_time`；
- `$upstream_header_time`；
- `$upstream_response_time`；
- Listen Overflow、SYN Retransmit；
- Run Queue、CPU Steal；
- Upstream 排队指标。

## 10. 压测矩阵

| 场景 | 验证目标 |
| --- | --- |
| Keepalive 单连接 | HTTP 处理与上游吞吐 |
| 大量短连接 | Accept、端口、TLS 握手 |
| HTTP/2 多 Stream | Connection/Stream 与流控 |
| 大 Header/Cookie | Header Buffer 和拒绝边界 |
| 慢上传/慢下载 | Buffer、Temp、连接占用 |
| SSE/LLM 流式 | TTFT、背压、旧 Worker 排空 |
| 缓存 HIT/MISS | 本地盘与回源容量 |
| 上游 1% 超时 | 重试放大与长尾 |
| 单节点故障 | 剩余实例和会话恢复容量 |

## 11. 工具与方法

可根据协议使用 `wrk`、`wrk2`、`h2load`、`hey`、`k6`、`vegeta` 等，但先确认：

- 客户端是否自身达到 CPU/端口极限；
- 是否真的复用连接；
- 是否校验证书；
- 请求体和 Header 是否符合生产；
- Coordinated Omission 是否被处理；
- 负载机与服务端时间是否同步。

每轮只改变一个主要变量，预热后采样，保存配置、版本和环境。

## 12. 容量判定

容量点不是“服务器刚好崩溃”的 QPS。生产容量应满足：

```text
在目标峰值与故障场景下：
P99/TTFT 达标
错误率达标
CPU/内存/FD/磁盘/带宽有余量
重试没有放大
单节点退出后剩余容量仍达标
```

若 N 台实例需容忍 1 台故障，正常运行时不能把总需求均匀压到每台接近 100%。还要预留发布双代 Worker、证书轮换和突发余量。

## 13. 练习与答案

**问题：** Worker CPU 只有 40%，为什么 P99 仍升高？

可能是某个 Worker/单核热点、上游或网络排队、磁盘 Buffer、限流延迟、客户端慢或重试；总 CPU 会掩盖局部瓶颈。

**问题：** 增大 `worker_connections` 为什么不能解决 502？

502 常来自上游连接/协议/提前关闭。增加连接上限可能把更多压力推向已经故障的上游。

**问题：** Cache 命中率高是否一定降低 Nginx 资源？

不一定。它降低回源，但可能增加本地磁盘、内存 Zone、网络发送和 Cache Manager 工作。

## 14. 参考资料

- [Nginx Performance Tuning](https://nginx.org/en/docs/)
- [Nginx Stub Status](https://nginx.org/en/docs/http/ngx_http_stub_status_module.html)
- [Linux ss](https://man7.org/linux/man-pages/man8/ss.8.html)
