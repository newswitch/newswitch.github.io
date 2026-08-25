---
title: "结构化日志、时间戳、级别、堆栈、Request ID 与敏感数据"
sidebar_label: "06. 结构化日志工程"
sidebar_position: 6
description: "从日志事件模型、时间和关联字段出发，设计可查询、可脱敏且成本受控的生产日志。"
tags: [结构化日志, Request ID, Trace ID, 脱敏, 日志治理]
---

# 结构化日志、时间戳、级别、堆栈、Request ID 与敏感数据

高质量日志不是打印更多字符串，而是在正确位置记录稳定结构、因果关联和可执行上下文，同时避免敏感数据和无限体积。

## 1. 推荐字段

```json
{
  "timestamp": "2026-08-25T10:20:30.123456Z",
  "severity": "ERROR",
  "service.name": "order-api",
  "service.version": "2026.08.25.1",
  "trace_id": "...",
  "span_id": "...",
  "request_id": "...",
  "event.name": "payment_authorize_failed",
  "error.type": "Timeout",
  "duration_ms": 3021
}
```

时间使用带时区的标准格式并保留足够精度，所有节点同步时钟。Collector 接收时间和事件发生时间要区分，排队可能让二者相差很大。

## 2. 级别语义

- DEBUG：短期诊断，默认生产关闭或采样；
- INFO：关键生命周期和业务里程碑；
- WARN：可恢复异常或接近边界；
- ERROR：当前操作失败，需要分析；
- FATAL：进程无法继续。

同一异常不要在每层重复打印完整堆栈。底层记录或包装错误，上层选择一个具有业务上下文的位置输出。

## 3. 关联 ID

Request ID 便于网关与日志关联，Trace ID 连接分布式调用。两者可以并存，但不能假设相同。入口接受外部 Request ID 时校验长度和字符，防止日志注入；Trace Context 也要按信任边界处理。

## 4. 敏感数据

禁止记录密码、Token、Cookie、Authorization Header、私钥、完整身份证/银行卡、原始 Prompt 或模型敏感输出。脱敏要在日志产生端和 Collector 两层防御，且测试堆栈和异常对象不会间接包含 Secret。

## 5. 体积治理

- 对健康检查、成功请求做采样或聚合；
- 限制单条长度、数组和堆栈深度；
- 大对象只记录校验值、大小和受控引用；
- 多行日志在采集端正确合并；
- 明确保留期和合规删除；
- Label 只放低基数检索字段，详情留在正文。

## 6. 验收

构造正常请求、超时、异常堆栈和恶意 Header，验证 JSON 能解析、Trace 可关联、时间正确、敏感字段被删除、超长消息受限。随后用实际峰值计算每天日志量和存储成本。

参考：[OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)。
