---
title: "Agent、DaemonSet、Sidecar、Gateway 与分层 Collector 部署"
sidebar_label: "11. Collector 部署拓扑"
sidebar_position: 11
description: "比较 Collector 贴近工作负载和集中网关两类模式，设计 Kubernetes 分层遥测管道及其故障域、扩缩容与安全边界。"
tags: [OpenTelemetry Collector, Agent, DaemonSet, Sidecar, Gateway]
---

# Agent、DaemonSet、Sidecar、Gateway 与分层 Collector 部署

Collector 放在哪里决定网络跳数、元数据获取、资源隔离、故障域和有状态处理能力。拓扑设计的本质是：哪些工作必须靠近数据源，哪些工作需要全局视角。

## 1. 四种常见接入方式

### 1.1 SDK 直接写后端

```text
Application SDK → Observability Backend
```

组件最少，适合开发环境。但后端地址、证书、鉴权、重试和迁移会散落在应用中；后端故障可能直接影响每个进程。

### 1.2 Sidecar

```text
Pod: Application → localhost Collector
```

隔离性强，可为单个应用定制，生命周期一致；代价是每个 Pod 都有资源开销、配置分发和升级成本。除强隔离或特殊协议外，不应把 Sidecar 当默认答案。

### 1.3 节点 Agent/DaemonSet

```text
Node:
  Application Pods / CRI Logs / Host Metrics
        → DaemonSet Collector
```

适合读取节点日志文件、kubelet/主机指标，并为本节点 SDK 提供就近 OTLP 入口。它能补充 Kubernetes 元数据，但节点故障会影响该节点尚未发出的数据。

### 1.4 集中 Gateway

```text
Applications/Agents → Collector Gateway Deployment → Backends
```

便于统一鉴权、Tail Sampling、路由、脱敏和出口控制。它会成为集中容量点，需要高可用、租户隔离和背压设计。

## 2. 推荐的分层思路

大型 Kubernetes 集群常采用：

```text
日志文件/Host Metrics ─┐
应用 OTLP ─────────────┼→ Node Agent
                       │    ├→ Logs Gateway → Loki
                       │    ├→ Metrics Gateway → Prometheus Remote Write
                       └────└→ Trace Gateway → Tail Sampler → Tempo/Jaeger
```

节点层做必须靠近数据源的事情：文件读取、主机指标、初步批处理和资源补充。Gateway 做需要共享策略或全局状态的事情：租户认证、路由、Tail Sampling、大规模出口重试。

每种信号不必走完全相同路径。日志依赖节点文件，Trace 更适合 SDK OTLP，Prometheus 指标可能仍采用 Pull。

## 3. DaemonSet 的文件采集边界

读取 Kubernetes 容器日志通常需要只读挂载节点路径和保存检查点：

```text
/var/log/pods
/var/log/containers
容器运行时实际日志目录
```

必须验证目标发行版和 Runtime 的真实路径，不能照抄其他集群。采集器需要：

- 处理 CRI 日志拆行与多行合并；
- 在轮转和 Pod 删除时正确跟踪 inode；
- 把读取游标保存在持久目录；
- 限制 HostPath 与权限，避免获得不必要的宿主机访问；
- 节点磁盘压力时明确先丢什么。

若游标只保存在容器可写层，Collector Pod 重建后可能重复读取或跳过日志。

## 4. Kubernetes 元数据处理

`k8sattributes` 等 Processor 可以根据 Pod IP、UID 或连接信息补充 namespace、workload 和 node。但需要正确的关联来源与 RBAC。

常见问题包括：

- 经代理后来源 IP 不再是 Pod IP；
- HostNetwork Pod 与普通 Pod 关联混乱；
- 删除后的 Pod 元数据已过期；
- RBAC 过大或 Watch 压力过高；
- 把所有 Annotation/Label 都复制出来造成基数和泄密。

仅提取有明确用途的稳定字段，并记录 Resource 属性从哪里产生、在哪一层覆盖。

## 5. 有状态 Processor 需要稳定路由

Batch、属性删除等处理可以由任意实例完成；Tail Sampling、跨 Span 聚合等处理需要看到同一 Trace 的完整数据。

```text
第一层 Gateway
→ 按 Trace ID 一致性路由
→ Tail Sampler 分片
→ Backend
```

普通 Kubernetes Service 的随机负载均衡不足以保证这一点。可使用 Collector 的 Load Balancing Exporter 或后端支持的 Trace-aware 路由。扩缩容会改变分片，在过渡期产生不完整 Trace，需要在变更计划中接受和度量。

## 6. 队列与背压是逐跳发生的

```text
SDK Batch Queue
→ Agent Exporter Queue
→ Gateway Receiver/Memory
→ Gateway Exporter Queue
→ Backend Ingest Queue
```

每一层都可能有独立超时、重试和丢弃。队列过多会扩大内存和恢复风暴；队列过少则后端短抖动直接传回应用。

关键指标：接收/发送速率、被拒绝数、队列容量与使用率、重试、导出失败、进程 RSS、GC、CPU 和端到端延迟。Collector 健康检查只能证明进程活着，不能证明数据已经到后端。

## 7. 资源限制与 `memory_limiter`

`memory_limiter` 是主动保护机制，不是 Kubernetes Memory Limit 的替代品。应让它在容器被 OOMKill 之前拒绝或施加背压，并为 Go Runtime、队列和突发保留余量。

```text
容器 Memory Limit
  > memory_limiter 硬限制
  > 正常峰值 RSS
```

若三者几乎相等，采集器可能还没来得及自我保护就被内核杀死。内存估算要包含 Tail Sampling 缓存、Batch、Exporter Queue、多行日志和大请求。

## 8. 安全边界

- 应用到 Agent/Gateway 使用 TLS 或 mTLS，至少限制 NetworkPolicy；
- Collector 不应把未认证客户端提供的 Tenant Header直接转发；
- TLS 私钥、后端 Token 使用 Secret 挂载并支持轮换；
- 删除 Authorization、Cookie、Baggage 敏感项；
- 禁止无保护地暴露 pprof、zPages、调试 Exporter 和配置端点；
- 不同环境、业务租户或合规域可使用独立 Gateway 故障域。

## 9. 扩缩容与滚动升级

无状态 Gateway 可按 CPU、接收速率、队列和延迟扩容，不能只看 CPU。Tail Sampler 则要同时考虑缓存 Trace 数与路由分片。

滚动升级前：

1. 校验新旧 Collector 组件与配置兼容；
2. 设置 PDB、优雅终止和足够的 `terminationGracePeriodSeconds`；
3. 停止接收后尽量 Flush 队列，但不要承诺零丢失；
4. 小比例实例先升级，观察导出错误和属性变化；
5. Tail Sampling 变更需监控完整率和采样比例。

## 10. 拓扑选择表

| 需求 | 更合适的起点 | 原因 |
| --- | --- | --- |
| 读取容器文件日志 | DaemonSet Agent | 数据和轮转状态在节点 |
| 单应用强隔离/特殊协议 | Sidecar | 配置和资源故障域独立 |
| 全局 Tail Sampling | Trace Gateway + 稳定分片 | 需要完整 Trace 视角 |
| 多后端统一出口 | Gateway | 集中认证、路由和重试 |
| 极小测试环境 | SDK 直写或单 Gateway | 降低组件数量 |

## 11. 验收与排障

为每条信号注入带唯一 ID 的测试数据，然后逐跳观察。至少演练：Agent 重启、节点重启、Gateway 滚动、后端 5 分钟不可用、证书轮换、限流和流量突增。

出现丢数据时按顺序检查：

```text
源数据是否产生
→ Agent 是否接收/读取
→ Processor 是否过滤或拒绝
→ Exporter Queue 是否积压/丢弃
→ Gateway 是否接收
→ 后端是否接受并可查询
```

## 12. 练习与答案

**问题：所有应用都使用 Sidecar 是否最可靠？**

答案：不一定。它缩小单应用故障域，但显著增加资源、配置和升级面；后端故障时成千上万个 Sidecar 同时重试也会形成风暴。应基于隔离需求选择。

**问题：Agent 和 Gateway 都配置持久队列是否一定更安全？**

答案：不一定。它提高短时故障容忍，却增加磁盘、恢复次序、重复和积压回放复杂度。应按可接受丢失、故障时长和恢复速率计算，并通过演练验证。

参考资料：

- [OpenTelemetry Collector deployment patterns](https://opentelemetry.io/docs/collector/deployment/)
- [OpenTelemetry Collector scaling](https://opentelemetry.io/docs/collector/scaling/)
- [Kubernetes Attributes Processor](https://opentelemetry.io/docs/platforms/kubernetes/collector/components/#kubernetes-attributes-processor)
