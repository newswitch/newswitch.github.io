---
title: "Trace、Span、Context、Baggage、Resource 与 Semantic Conventions"
sidebar_label: "03. Trace 数据模型与语义"
sidebar_position: 3
description: "建立 OpenTelemetry Trace 数据模型，区分请求上下文、传播数据、资源身份和业务属性。"
tags: [OpenTelemetry, Trace, Span, Context, Baggage, Semantic Conventions]
---

# Trace、Span、Context、Baggage、Resource 与 Semantic Conventions

Trace 表示一次端到端事务，Span 表示其中一个有开始和结束的操作。Context 让因果关系跨执行单元传播，Resource 描述是谁产生遥测，Baggage 是随请求传播的业务键值。

## 1. 数据模型

```text
Trace
├─ Span: HTTP server /checkout
│  ├─ Span: SQL SELECT inventory
│  └─ Span: publish order event
└─ Span: consumer process order
```

每个 Span 通常包含 Trace ID、Span ID、Parent、名称、Kind、开始/结束时间、Status、Attributes、Events 和 Links。

| 概念 | 作用 | 示例 |
| --- | --- | --- |
| Resource | 产生者身份，通常一批信号共享 | `service.name`、集群、版本 |
| Span Attribute | 当前操作的查询维度 | HTTP method、RPC system |
| Event | Span 内有时间点的事件 | Exception、重试 |
| Link | 非父子但相关的 Span | 批处理输入、多消息关联 |
| Baggage | 跨进程传播的业务上下文 | 租户等级、实验分组 |

## 2. Context 与传播头

默认通常使用 W3C Trace Context，在 HTTP 头中传播 `traceparent`/`tracestate`。接收方提取父 Context，创建子 Span；发送方把当前 Context 注入请求。Trace ID 不应由每个服务重新生成。

来自公网的传播头是不可信输入，应校验格式、限制 Baggage 数量/大小，必要时在信任边界重新开始 Trace 或清洗字段。

## 3. Resource 与 Attribute 边界

`service.name` 应稳定且可治理；Pod UID 适合实例身份，不应替代服务名。Resource Attribute 会被附加到大量遥测记录，错误的高基数字段会成倍放大成本。

Baggage 会跟随请求传播，可能进入日志或下游服务，绝不能放 Token、密码、身份证号等敏感信息。

## 4. Semantic Conventions

语义约定统一 HTTP、RPC、数据库、消息、对象存储、主机等字段名称、类型和单位，使多语言数据能够关联。使用前确认对应约定的稳定级别和版本；不要同时保留旧、新字段造成双倍基数，迁移应有明确窗口。

## 5. Span 设计

- 名称描述低基数操作，例如 `GET /orders/{id}`；
- URL 中的 ID 放受控 Attribute，而不进入 Span Name；
- Error Status 表示操作失败，不把所有 4xx 一律标错；
- Exception 作为 Event 记录并脱敏；
- 过细 Span 会增加 CPU、网络和存储，过粗则无法定位瓶颈。

## 6. 验收

发起一次跨两个服务、数据库和消息队列的请求，检查 Trace ID 一致、父子关系正确、服务身份稳定、错误 Event 可读且没有敏感 Baggage。再注入伪造头，验证入口清洗策略。

参考：[OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)、[Semantic Conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/)。
