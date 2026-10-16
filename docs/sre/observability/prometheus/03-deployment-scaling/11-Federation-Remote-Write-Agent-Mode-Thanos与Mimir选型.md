---
title: "Federation、Remote Write、Agent Mode、Thanos 与 Mimir 选型"
sidebar_label: "11. 全局监控与远程存储选型"
sidebar_position: 11
description: "比较分层 Federation、Remote Write、Agent Mode、Thanos Sidecar 与 Mimir 的写入、查询、去重、对象存储和故障边界。"
tags: [Prometheus, Federation, Remote Write, Agent Mode, Thanos, Mimir]
---

# Federation、Remote Write、Agent Mode、Thanos 与 Mimir 选型

本地 Prometheus 擅长自治抓取、规则和近期查询；跨区域全局查询、长期保留和多租户需要额外架构。选型不能从“哪个项目更流行”开始，而应分别画出写入、查询、告警和恢复路径。

## 1. 先明确五个目标

1. 集群断开中心后是否仍能本地告警；
2. 全局查询要求多快看到最新样本；
3. 历史数据保留多久，是否允许下采样；
4. 是否需要强制租户隔离、配额和查询公平性；
5. 能否运维对象存储、缓存、Ring、Kafka 或其他分布式组件。

```text
采集可用性 ≠ 中心写入可用性
中心写入可用性 ≠ 全局查询可用性
全局查询可用性 ≠ 本地告警可用性
```

## 2. 架构对比

| 方案 | 写入方式 | 本地规则/查询 | 长期存储 | 主要用途 |
| --- | --- | --- | --- | --- |
| Federation | 上层 Prometheus 抓下层 `/federate` | 保留 | 上层本地 TSDB | 少量汇总指标分层 |
| Remote Write | Prometheus 异步推送样本 | 保留 | 由远端实现 | 长期存储、集中查询 |
| Agent Mode | 抓取后仅远程写 | 不提供完整本地 TSDB/规则 | 必须依赖远端 | 边缘轻量采集 |
| Thanos Sidecar | 上传本地持久 Block | 保留 | 对象存储 | 保持每集群 Prometheus 自治 |
| Mimir | Remote Write/OTLP 进入分布式后端 | 取决于采集端 | 对象存储 | 大规模多租户集中平台 |

这些能力可以组合，例如本地双副本 Prometheus 负责告警，同时 Remote Write 到 Mimir；或者 Prometheus 加 Thanos Sidecar 上传 Block。

## 3. Federation：只汇总需要的数据

上层 Prometheus 抓取下层 `/federate`：

```yaml
scrape_configs:
  - job_name: federation
    honor_labels: true
    metrics_path: /federate
    params:
      match[]:
        - '{__name__=~"cluster:.*"}'
        - '{job="prometheus"}'
    static_configs:
      - targets:
          - prometheus-prod-a:9090
          - prometheus-prod-b:9090
```

适合下层先通过 Recording Rule 生成稳定、低基数的集群级 SLI，再由上层抓取。若 Federation 直接拉取全部原始 Series，会产生重复存储、长抓取、超时和中心单点。

`honor_labels` 决定冲突 Label 的处理，必须设计 `cluster/region` 等 External Label，防止不同下层 Series 在上层碰撞。

## 4. Remote Write 数据路径

普通 Prometheus 的 Remote Write 从 WAL 尾部读取样本：

```text
Scrape
→ 本地Head/WAL
├─ 本地查询和规则
└─ WAL Watcher → Queue Shards → Batch/Snappy/Protobuf
                → Remote Endpoint → ACK/Retry
```

```yaml
remote_write:
  - url: https://mimir.example.com/api/v1/push
    remote_timeout: 30s
    headers:
      X-Scope-OrgID: platform
    queue_config:
      min_shards: 2
      max_shards: 50
      capacity: 10000
      max_samples_per_send: 2000
      batch_send_deadline: 5s
      retry_on_http_429: true
```

参数不能照抄：Shard 过少追赶慢，过多会增加内存、连接和远端并发；Batch 太小请求开销高，太大增加尾延迟和失败重发成本。

## 5. Remote Write 故障与数据丢失窗口

远端失败时，样本在内存队列和 WAL 中等待。只要故障时间没有超过可读取 WAL 的保留窗口，并且本地磁盘未满，恢复后可以追赶；超过窗口、实例/PVC 丢失或样本被远端永久拒绝就可能形成空洞。

关注：

```promql
rate(prometheus_remote_storage_samples_in_total[5m])
rate(prometheus_remote_storage_succeeded_samples_total[5m])
rate(prometheus_remote_storage_failed_samples_total[5m])
prometheus_remote_storage_samples_pending
prometheus_remote_storage_shards
```

具体指标名以部署版本 `/metrics` 为准。还要监控最高样本时间与当前时间的差值，直接表达积压年龄。

HTTP 状态语义：

- 5xx/网络错误：通常重试；
- 429：是否重试由配置和后端限流策略决定；
- 400：常见于非法 Label、乱序、租户限制，重复发送通常无效；
- 401/403：身份或 Tenant 错误，必须尽快修复而非无限重试。

## 6. Remote Write 1.0、2.0 与兼容性

协议版本、Metadata、Exemplar 和 Native Histogram 支持会随 Prometheus 与远端后端版本演进。升级发送端前必须确认接收端支持的协议和样本类型，并通过灰度验证接收数、拒绝数和查询结果。

不能根据 Remote Write HTTP 2xx 就断言所有样本都可查询，还要验证 Tenant、Label、时间范围、接收端写入和读取链路。

## 7. Agent Mode

Agent Mode 复用 Prometheus 的 Pull、服务发现和 Relabel，但针对 Remote Write 优化，禁用完整本地 TSDB 查询、告警和规则能力：

```text
Target → Agent抓取 → 临时WAL → Remote Write Backend
```

适合边缘集群统一向中心发送指标，资源占用和本地状态较轻。代价是中心链路不可用时缺少完整本地查询/告警能力，因此关键生产集群若要求断网自治，普通 Prometheus 往往更合适。

Agent 仍需要持久化 WAL、双副本、Secret、Remote Write 积压监控和升级设计，它不是无状态 Daemon。

## 8. Thanos Sidecar 模式

```text
Prometheus Head/WAL
→ 约2小时本地Block
→ Sidecar上传对象存储

近期查询：Thanos Query → Sidecar StoreAPI → Prometheus
历史查询：Thanos Query → Store Gateway → Object Storage
后台：Compactor合并/下采样/保留
```

关键组件：

| 组件 | 职责 |
| --- | --- |
| Sidecar | 上传 Block、暴露本地 Prometheus StoreAPI |
| Query | 聚合 StoreAPI，执行查询和副本去重 |
| Store Gateway | 从对象存储提供历史 Block |
| Compactor | 压缩、下采样和执行 Retention |
| Ruler | 在全局数据上评估规则，需谨慎处理可用性 |
| Query Frontend | 拆分、缓存、排队和查询治理 |

副本 External Label 必须稳定，例如 `cluster` 相同、`replica` 不同，Query 才能按 Replica Label 去重。去重隐藏重复样本，不等于两个副本数据完全一致。

Compactor 对同一 Bucket 通常应保持单活语义，并需要大量临时磁盘。对象存储权限、生命周期策略、版本控制和人工修改都可能破坏 Block 生命周期。

## 9. Mimir 的两种架构认知

Mimir 提供多租户 Remote Write/OTLP 接收、分布式查询、规则和对象存储。当前需要区分经典架构与以 Kafka 解耦读写的 Ingest Storage 架构。

```text
经典路径：Distributor → Ingester Quorum → Block → Object Storage
新写入路径：Distributor → Kafka持久化 → ACK
读取近期：Kafka → Ingester消费 → Querier读取
读取历史：Querier → Store Gateway → Object Storage
```

Ingest Storage 在 Mimir 3.0 起是稳定且推荐的架构，但引入 Kafka 故障域和容量规划。选型、升级和 Runbook 必须明确自己运行的是哪种架构，不能混用经典 Ingester Quorum 的故障结论。

Mimir 的认证通常由外部反向代理完成，Distributor 根据可信 Tenant Header 执行配额和隔离。允许客户端任意伪造 Tenant Header 会直接破坏隔离。

## 10. 告警放在哪里

两种主要模式：

```text
本地规则：每集群Prometheus评估 → 本地Alertmanager
优点：断网自治、低延迟；缺点：规则分发和全局视角复杂

中心规则：Thanos Ruler/Mimir Ruler读取全局数据
优点：跨集群表达式；缺点：依赖中心查询和存储链路
```

关键 Page 通常优先本地评估，容量报表和跨集群告警可放中心。避免同一规则在两处重复发送，或明确 Label 和路由去重策略。

## 11. 选型决策

| 需求 | 更合适的起点 |
| --- | --- |
| 少量集群级指标汇总 | Federation |
| 本地自治 + 集中长期存储 | Prometheus + Remote Write |
| 边缘只负责采集 | Agent Mode + 远端后端 |
| 保留现有 Prometheus 与 Block 模型 | Thanos Sidecar |
| 强多租户、统一写入和查询平台 | Mimir |
| 不具备分布式存储运维能力 | 托管后端或先保持简单架构 |

项目数量不是成熟度。一个稳定的双副本 Prometheus 可能优于缺少对象存储、缓存、Ring 和 Runbook 的复杂 Thanos/Mimir 集群。

## 12. 故障演练与答案

必须演练：阻断远端 30 分钟后追赶；填满发送端磁盘；让对象存储不可用；停止 Store Gateway/Query Frontend；破坏副本 Label；拒绝一个 Tenant 的写入；验证本地告警是否仍可用。

**问题：Remote Write 失败会让本地 Prometheus 停止抓取吗？**

答案：短时通常不会，两条路径相对独立；但长期积压会占用 WAL、磁盘、CPU 和网络，最终仍可能影响本地采集。

**问题：Thanos Query 去重是否能恢复某副本缺失的数据？**

答案：不能。它只能在已有副本样本之间合并；两个副本都缺失的时间范围无法生成。

## 13. 参考资料

- [Prometheus Federation](https://prometheus.io/docs/prometheus/latest/federation/)
- [Prometheus Remote Write Tuning](https://prometheus.io/docs/practices/remote_write/)
- [Prometheus Agent Mode](https://prometheus.io/docs/prometheus/latest/prometheus_agent/)
- [Thanos Components](https://thanos.io/tip/components/)
- [Grafana Mimir Architecture](https://grafana.com/docs/mimir/latest/get-started/about-grafana-mimir-architecture/)
