---
title: "Envoy 线程、连接池、Buffer、Overload Manager 与性能"
sidebar_label: "10. Envoy 线程、连接池、Buffer、Overload Manager 与性能"
sidebar_position: 10
description: "理解 Envoy 主线程与 Worker、连接归属、上游连接池、背压、内存和代理自身过载保护。"
tags: [Envoy, Threading, Connection Pool, Buffer, Overload Manager, Performance]
---

# Envoy 线程、连接池、Buffer、Overload Manager 与性能

Envoy 的非阻塞事件模型能处理大量连接，但“异步”不等于没有容量上限。长连接、Buffer、连接池、统计对象、TLS 和 Filter 工作最终都会占用 CPU、内存、文件描述符或带宽。

## 1. 线程模型

主线程负责启动、配置更新和管理任务，Worker 线程运行事件循环并处理数据面连接。一个 downstream 连接通常固定归属于接受它的 Worker，减少跨线程锁；各 Worker 也会维护相关的上游连接池/状态。

因此负载可能不完全均匀：少量超长/昂贵连接固定在某 Worker；线程数过多会增加内存、连接池数量与调度开销，过少则无法用满 CPU。以实际 workload 基准确定并发，而非机械等于宿主机逻辑核数。

## 2. 连接池

连接池按 Cluster、Endpoint、协议和 Worker 等维度形成。HTTP/1.1 通常一个连接同一时刻承载有限请求；HTTP/2 可在连接上复用多个 Stream，但受并发 Stream、流控制和单连接故障域影响。

关注 active/idle connections、pending requests、upstream connect、reset、最大连接寿命、空闲超时和 Circuit Breaker overflow。连接池太小排队，太大则放大上游连接、TLS 握手和内存。

## 3. Buffer、背压与内存

```text
memory ≈ base process
       + connections × per-connection state
       + active streams × per-stream/filter state
       + buffered request/response bytes
       + stats/config/cert/wasm state
```

慢客户端读取大响应时，上游可能比下游快，Buffer 增长直到水位线触发背压或限制。读取完整 Body 的 Filter、压缩、重试可重放体和日志都会增加内存。设置 Header、Body、Stream、Connection Buffer 限制并测试超限行为。

## 4. Overload Manager

Overload Manager 监控代理自身资源压力，并在阈值触发动作，例如停止接收部分连接/请求、缩减超时或回收资源（可用动作依版本与配置而异）。它与保护某个 upstream 的 Cluster Circuit Breaker 不同。

阈值要在压测中验证：过晚会 OOM/FD 耗尽，过早会无谓拒绝。容器内存 limit、cgroup 感知、内核 socket buffer 和进程 RSS/allocator 指标要一起观察。

## 5. 基准测试

基线依次加入 TLS、HTTP/2/gRPC、访问日志、Trace、鉴权、Wasm、大 Body 和慢客户端。每组记录吞吐、P50/P99、CPU/请求、RSS、连接/Stream、网络和丢弃/过载动作。

压测必须包含稳态、突发、长连接、上游变慢和单 Pod 故障。生成器也可能先耗尽 CPU、端口或带宽，核对客户端发出数与 Envoy 接收数。

## 6. “CPU 不高，延迟很高”

优先检查连接池 pending、上游排队、DNS/TLS 建连、重试、Worker 负载偏斜、慢客户端/流控制、外部鉴权和内存回收。平均 CPU 会掩盖单 Worker/单核饱和，必须看线程级 CPU 和事件循环延迟。

## 7. 掌握标准

你应能用 Little's Law 估算并发，用连接/Stream/Buffer 建立内存模型，区分 Circuit Breaker 与 Overload Manager，并通过混合负载找出 SLO 拐点。

## 8. 参考资料 {/* #参考资料 */}

- [Envoy Threading Model](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/intro/threading_model)
- [Overload Manager](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/overload_manager)
