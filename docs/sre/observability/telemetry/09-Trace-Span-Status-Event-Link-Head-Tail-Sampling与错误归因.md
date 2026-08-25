---
title: "Trace、Span、Status、Event、Link、Head/Tail Sampling 与错误归因"
sidebar_label: "09. Trace 语义、采样与错误归因"
sidebar_position: 9
description: "区分调用失败和业务结果，设计 Head/Tail Sampling 并用关键路径定位真正根因 Span。"
tags: [OpenTelemetry, Trace, Sampling, Tail Sampling, Error Attribution]
---

# Trace、Span、Status、Event、Link、Head/Tail Sampling 与错误归因

一条 Trace 中出现多个 Error 不代表每个都是根因。应先找最早破坏关键路径的 Span，再区分它是上游超时、下游错误、排队还是取消传播。

## 1. Span 状态与事件

Span Status 常见为 Unset、Ok、Error。异常可作为 Event 保存类型、消息和受控堆栈。HTTP、RPC 和数据库状态如何映射 Error 应遵循语义约定，不能把所有非 2xx 都机械标为系统故障。

`Link` 表示非树状因果：批任务由多条消息触发、消费者关联生产 Span、一个 Trace 被拆分时都可能使用 Link。

## 2. Head Sampling

在 Trace 开始时决定采样，开销低、决策快，可按 Parent、概率、入口类型设置。缺点是当时不知道请求最终是否慢或失败。

```text
入口决策 → sampled标志传播 → 所有下游尊重Parent
```

不一致的采样器会产生断裂 Trace。关键链路可全采样，普通成功流量按概率采样。

## 3. Tail Sampling

Collector 缓存一段时间的完整/近完整 Trace，再按结果、延迟、属性选择，适合保留 Error、慢请求和稀有租户。代价是内存、等待时间、跨 Collector 路由和不完整 Trace 风险。

所有同一 Trace ID 的 Span 应路由到同一 Tail Sampling 实例；否则决策只看到局部数据。容量估算：

```text
内存工作集 ≈ traces_per_second × decision_wait × 平均Trace大小 × 安全系数
```

## 4. 错误归因步骤

1. 从入口 Span 看总耗时和最终状态；
2. 找关键路径上最慢 Span，而非所有并行 Span 之和；
3. 找第一个 Error/Timeout；
4. 区分服务处理、网络等待、队列等待和客户端取消；
5. 用日志 Trace ID 验证异常上下文；
6. 用指标确认是单请求还是系统性问题。

## 5. 采样策略验收

构造快速成功、慢成功、业务 4xx、服务 5xx 和下游 Timeout，统计各类保留率；故意让部分 Span 晚到和后端不可用，观察不完整 Trace、Collector 内存和丢弃。策略必须同时满足成本上限与错误保留目标。

参考：[OpenTelemetry Sampling](https://opentelemetry.io/docs/concepts/sampling/)。
