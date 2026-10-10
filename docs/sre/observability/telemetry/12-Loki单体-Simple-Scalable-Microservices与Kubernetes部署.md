---
title: "Loki 单体、高可用单体、Microservices 与 Kubernetes 部署"
sidebar_label: "12. Loki 生产部署"
sidebar_position: 12
description: "基于当前 Loki 部署模式，说明单体、高可用单体、已弃用的 Simple Scalable、微服务模式以及 Kubernetes 生产配置与迁移。"
tags: [Loki, Kubernetes, TSDB, 对象存储, Helm]
---

# Loki 单体、高可用单体、Microservices 与 Kubernetes 部署

部署 Loki 不能只决定“几个副本”。还要同时决定组件模式、schema、索引类型、对象存储、保留、租户、限流和升级路径。选错模式不会立刻报错，通常会在流量增长或第一次故障时暴露。

## 1. 当前部署模式先讲清楚

### 1.1 Monolithic（单体）

所有 Loki 组件在一个进程中运行，适合开发、小规模和运维能力有限的环境。可以运行一个实例，也可以配合共享对象存储运行多个相同实例形成高可用单体。

优点是组件少、排障路径短；缺点是写入、查询、压缩不能独立扩缩容，单个进程的资源竞争更明显。

### 1.2 Simple Scalable Deployment（SSD）

SSD 曾把 Loki 分为 Read、Write、Backend 三类 Target，是不少旧文章和 Helm 配置的推荐模式。当前官方文档已经将 SSD 标记为弃用，并计划在 Loki 4.0 移除。新部署不应再把它作为长期目标；现有 SSD 应制定迁移方案，而不是继续扩大依赖。

### 1.3 Microservices（微服务）

每类 Loki 组件独立部署和扩缩容：Distributor、Ingester、Query Frontend、Query Scheduler、Querier、Compactor、Index Gateway 等。适合规模大、读写差异明显、需要细粒度故障隔离的生产环境。

代价是组件、Service、Ring、配置和升级顺序明显增加，需要成熟的 Kubernetes 与对象存储运维能力。

## 2. 选择起点

| 场景 | 建议起点 | 说明 |
| --- | --- | --- |
| 本地学习和功能验证 | 单副本单体 | 不承诺高可用 |
| 中小规模、希望降低复杂度 | 多副本高可用单体 | 共享对象存储，验证各后台任务语义 |
| 大规模、多租户、读写需独立扩展 | 微服务模式 | 组件独立扩容和故障隔离 |
| 已有 SSD | 规划迁移 | 不再作为新架构长期扩建 |

不能仅按每天日志 GB 数选型。还应看峰值 MB/s、活跃 Stream、查询并发、最长时间范围、租户数量和运维团队能力。

## 3. 存储与 Schema 是不可回避的基础

生产环境通常使用对象存储保存 Chunk 和 TSDB 索引。当前新部署应优先使用 TSDB 索引，并为 schema 指定明确生效日期：

```yaml
schema_config:
  configs:
    - from: "2026-10-01"
      store: tsdb
      object_store: s3
      schema: v13
      index:
        prefix: loki_index_
        period: 24h
```

示例只表达结构，`schema` 版本和 Helm 字段要按目标 Loki 版本核对。`from` 日期错误可能导致新旧数据读写边界异常；一旦写入生产数据，不应随意回改历史 schema。

对象存储配置至少验证：Bucket、Region/Endpoint、TLS、凭据、路径风格、读写删权限、限流、生命周期和跨区域费用。优先使用云工作负载身份或短期凭据，避免把永久密钥写入 Values。

## 4. Kubernetes 入口与内部流量

推荐由 Gateway 统一提供写入和查询入口：

```text
Alloy / OTel Collector → Loki Gateway → Distributor → Ingester
Grafana / logcli       → Loki Gateway → Query Frontend → Querier
```

Gateway 负责认证、TLS 和路由，但不能只相信客户端提交的 `X-Scope-OrgID`。租户 ID 应由可信认证层根据身份注入。

内部组件通过 Service 与 Ring 发现。需要正确配置 Headless Service、成员发现和 NetworkPolicy；DNS 或 Ring 故障会表现为副本不足、实例离开和查询失败。

## 5. Ingester 的持久性与调度

Ingester 持有近期日志和正在形成的 Chunk，是写路径中最需要保护的状态组件：

- 开启和验证 WAL；
- 使用足够快且可靠的持久磁盘；
- 设置反亲和或拓扑分布，避免副本落在同一节点/可用区；
- 配置 PDB，但不要让 PDB 阻止必要的节点维护；
- 优雅终止并给 Flush/WAL 处理留时间；
- 监控 WAL 重放时间、内存、活跃 Stream、Chunk 刷新和对象存储错误。

副本因子只在副本真正分布于独立故障域时有意义。三个 Pod 在同一节点不等于能承受节点故障。

## 6. 写入容量与限流

写路径主要受：原始字节速率、压缩率、Stream 数、单 Stream 热点、Chunk 刷新和对象存储延迟影响。

租户限制应同时覆盖：

- 总写入速率与突发；
- 单 Stream 速率；
- 活跃 Stream 和 Label 数；
- 过旧/未来时间戳；
- 单行大小。

发生 429 时先读取返回原因和 Loki 指标。无限制提高总速率会把压力转成 Ingester OOM、WAL 膨胀或对象存储请求风暴。

## 7. 查询容量与公平性

查询路径关注：Query Frontend 队列时间、Scheduler 公平性、Querier CPU/内存、对象读取、缓存命中与扫描字节。

可采用：

- 按时间切分大查询；
- 限制并发、最长查询时间和返回量；
- 为高频元数据/结果配置合适缓存；
- 按租户公平排队；
- 将异常昂贵的仪表盘查询改为 Recording Rule 或原生指标；
- 通过精确 Label 设计从源头减少扫描。

增加 Querier 不能修复全租户正则扫描，只会把对象存储打得更快。

## 8. Retention 与删除

Retention 不是只配置对象存储 Lifecycle。Loki 的索引、Chunk 与删除请求需要一致管理，通常由 Compactor 参与执行。

应验证：

1. 全局与每租户保留策略；
2. Compactor 的共享存储、工作目录和单实例要求；
3. 删除延迟、标记与实际对象删除；
4. Bucket Versioning/Object Lock 是否保留旧版本；
5. Lifecycle 不早于 Loki 自身保留处理；
6. 合规删除后缓存和备份中的数据边界。

## 9. Helm 部署前检查

不要直接使用默认 Values 上生产。至少显式确认：

```text
目标 Loki/Chart 版本
deployment mode
schema_config 与生效日期
object storage 与凭据方式
replication factor 与故障域
WAL / PVC / StorageClass
requests、limits、PDB、拓扑分布
Gateway TLS、认证、租户注入
写入/查询限制
retention、compactor
ServiceMonitor、告警与日志
```

通过 `helm template` 检查最终对象，并在隔离环境用同一 Values 做安装、升级和回滚演练。

## 10. 从 SSD 迁移的思路

迁移不是简单把 Target 名称换掉。应先盘点 Read/Write/Backend 中实际启用的组件、共享缓存、Ring、对象存储和网关路由，再映射到目标微服务或高可用单体。

安全步骤：

1. 固定当前版本并保存配置、运行指标和查询基线；
2. 阅读目标版本升级与 SSD 迁移说明；
3. 在测试环境使用生产数据分布回放；
4. 先保证旧数据可读，再验证双入口或小比例流量；
5. 观察写入错误、查询一致性、Ring 和对象请求；
6. 保留明确回退窗口，不在同一次变更中同时修改 schema 与部署模式。

## 11. 故障 Runbook

**写入失败**：Gateway 状态码 → Distributor 拒绝原因 → Ring/Ingester 副本 → WAL/磁盘 → 对象存储。

**近期有、历史无**：Chunk 刷新 → schema 时间边界 → TSDB 索引 → 对象存储/Compactor。

**历史有、近期无**：采集端 → Gateway/Distributor → Ingester/Ring → Querier 到 Ingester 路径。

**查询变慢**：Frontend 排队 → 命中 Stream/扫描字节 → Querier → 缓存 → 对象存储延迟。

## 12. 练习与答案

**问题：为什么新环境不建议 SSD？**

答案：官方已将 Simple Scalable 标记为弃用并计划在 Loki 4.0 移除。新部署继续采用会增加未来迁移成本，应在高可用单体与微服务之间按规模选择。

**问题：三副本 Ingester 是否意味着任何一个可用区故障都不丢数据？**

答案：不一定。还取决于副本因子、写入确认、Token 分布、Pod 是否跨区、WAL/PVC 故障域和对象存储。必须通过实际故障演练验证。

参考资料：

- [Loki deployment modes](https://grafana.com/docs/loki/latest/get-started/deployment-modes/)
- [Loki Helm installation](https://grafana.com/docs/loki/latest/setup/install/helm/)
- [Loki storage schema](https://grafana.com/docs/loki/latest/operations/storage/schema/)
