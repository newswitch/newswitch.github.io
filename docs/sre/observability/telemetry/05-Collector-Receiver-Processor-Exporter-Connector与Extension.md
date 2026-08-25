---
title: "Collector Receiver、Processor、Exporter、Connector 与 Extension"
sidebar_label: "05. Collector 组件与 Pipeline"
sidebar_position: 5
description: "拆解 OpenTelemetry Collector 配置模型、组件职责、Pipeline 顺序和可观测性。"
tags: [OpenTelemetry Collector, Receiver, Processor, Exporter, Connector]
---

# Collector Receiver、Processor、Exporter、Connector 与 Extension

Collector 是无厂商绑定的遥测接收、处理和导出组件，不是长期存储。配置中声明组件并不表示它已运行；组件必须被引用到 `service.pipelines` 或 `service.extensions`。

## 1. 组件职责

| 组件 | 作用 | 示例 |
| --- | --- | --- |
| Receiver | 接收/抓取信号 | OTLP、Prometheus、filelog |
| Processor | 批处理、限内存、补属性、过滤、采样 | batch、memory_limiter、k8sattributes |
| Exporter | 发送到后端/下级 Collector | OTLP、Loki 相关协议、remote write |
| Connector | 一个 Pipeline 的 Exporter、另一个的 Receiver | spanmetrics、servicegraph |
| Extension | 健康、认证、存储等非数据路径能力 | health_check、file_storage |

## 2. 最小配置

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 1024
  batch: {}

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: false

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo]
```

Processor 顺序有语义：Memory Limiter 应尽早保护进程，过滤/脱敏在导出前完成，Batch 通常靠近 Exporter。实际顺序按组件文档和压测确认。

## 3. Distribution 与组件可用性

Core、Contrib 或厂商发行版包含的组件不同。配置上线前用目标镜像执行配置校验和组件清单，不能因为文档存在某 Exporter 就假定镜像内一定编译了它。

## 4. 队列、重试与持久化

Exporter Sending Queue 和 Retry 可吸收短暂后端故障，但内存队列在进程退出时丢失。需要更强恢复时评估持久队列/File Storage Extension，同时考虑磁盘容量、吞吐和重放风暴。Collector 仍不提供业务级不丢保证。

## 5. 自监控

监控接收、发送、失败、拒绝、队列容量、Retry、内存、GC、CPU 和处理延迟。每个 Pipeline 设置明确的容量和 Tenant 边界，后端持续失败时要产生高优先级告警。

## 6. 验收

先输出到调试/测试后端验证字段，再切真实后端。阻断 Exporter 目标，观察队列、重试、内存限制和拒绝；重启 Collector，验证内存队列或持久队列的实际恢复边界。

参考：[Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)、[Internal Telemetry](https://opentelemetry.io/docs/collector/internal-telemetry/)。
