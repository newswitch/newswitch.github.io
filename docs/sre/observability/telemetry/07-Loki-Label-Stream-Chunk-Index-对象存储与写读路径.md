---
title: "Loki Label、Stream、Chunk、Index、对象存储与写读路径"
sidebar_label: "07. Loki 架构与数据路径"
sidebar_position: 7
description: "解释 Loki 为什么索引标签而非日志全文，并沿 Distributor、Ingester、TSDB、对象存储和 Querier 分析写读路径。"
tags: [Loki, Label, Stream, Chunk, TSDB, 对象存储]
---

# Loki Label、Stream、Chunk、Index、对象存储与写读路径

Loki 的核心取舍是：主要索引标签和时间范围，不为每个正文单词建立倒排索引。它降低了索引成本，但把性能责任交给了标签设计、Chunk 形成方式和查询范围。

## 1. 从日志行到 Stream

一组完全相同的 Label 代表一个 Stream：

```text
{cluster="prod", namespace="orders", service="order-api"}
  ├─ 10:00:00  {"level":"INFO", "trace_id":"..."}
  ├─ 10:00:01  {"level":"ERROR", "trace_id":"..."}
  └─ 10:00:02  ...
```

只要增加一个变化的 Label，就会产生新的 Stream。`request_id`、`trace_id`、用户 ID、Pod UID、原始 URL、错误消息都可能制造高基数和高流失率。

应区分三类数据：

- **索引标签**：集群、环境、命名空间、服务等稳定低基数字段；
- **结构化元数据**：需要随日志保存和精确过滤，但不需要成为 Stream 身份的高基数字段；
- **日志正文**：详细上下文，查询时由 JSON、logfmt 或 pattern 解析。

“某字段经常查”不自动意味着它应成为 Label。先看唯一值数量、生命周期和组合数量。

## 2. 写入路径

典型微服务模式写路径：

```text
Agent / OTel Collector
  → Gateway（认证、租户路由）
  → Distributor（校验、限流、按 Stream Hash）
  → Ingester 副本集（内存 + WAL）
  → 构建并压缩 Chunk
  → TSDB 索引与 Chunk 写入对象存储
```

Distributor 本身通常是无状态的。它使用 Ring 找到负责该 Stream 的 Ingester，并按副本因子写入多个副本。Ingester 先把日志追加到内存中的 Chunk，同时用 WAL 提高进程重启后的恢复能力；Chunk 达到大小、空闲或时间条件后被刷新。

写入返回成功究竟代表“内存收到”“WAL 落盘”还是“对象存储已有”，与版本和配置有关。生产验收必须通过故障实验确认，不能凭图推断持久性。

## 3. Chunk 为什么既不能太碎也不能太大

Chunk 太碎会带来对象数量、索引条目和请求次数放大，常见原因是：

- Stream 基数过高；
- 日志流量低却有大量短命 Label 组合；
- Ingester 频繁重启或过早刷新；
- 时间戳严重乱序。

Chunk 过大则会增加单次下载、解压和查询内存。优化时要先看每个 Stream 的速率和 Chunk 利用率，而不是只调一个固定大小。

## 4. TSDB 索引与对象存储

当前 Loki 文档推荐 TSDB 索引。它用时间分片和 Series/Chunk 元数据帮助 Querier 确定应该读取哪些对象；正文仍主要位于压缩 Chunk 中。旧部署可能使用 BoltDB Shipper，但新功能和后续优化以 TSDB 为主，升级前需核对 schema 配置和迁移边界。

对象存储承担长期数据，应检查：

- Bucket 权限、端点、DNS、TLS、限流和请求延迟；
- 多租户对象前缀与隔离；
- Loki Retention 与 Bucket Lifecycle 的先后关系；
- 版本控制、对象锁对删除和费用的影响；
- 跨区域流量、读放大和恢复时间。

不要让对象生命周期先于 Loki 保留策略删除文件，否则索引仍可能引用已经不存在的 Chunk。

## 5. 查询路径

```text
Grafana / logcli
  → Query Frontend（切分、缓存、重试、结果合并）
  → Query Scheduler（公平调度与排队）
  → Querier
      ├─ 读取 Ingester 中尚未刷新的近期日志
      └─ 根据索引读取对象存储中的历史 Chunk
  → 过滤、解析、聚合、排序并返回
```

一次查询成本大致取决于：命中的 Stream 数、时间范围、需要读取和解压的 Chunk 字节数，以及解析/正则/聚合的 CPU。页面只返回 100 行，不代表后端只扫描 100 行。

正确的思路是：

```logql
{cluster="prod", namespace="orders", service="order-api"}
  |= "timeout"
  | json
  | status_code >= 500
```

先用精确 Label Selector 缩小 Stream，再用便宜的行过滤减少正文，最后解析并做字段过滤。

## 6. Ring、Compactor 与其他组件

- **Ring**：保存 Token 与实例关系，用于把 Stream 或查询分配到正确实例；它不是日志数据库。
- **Compactor**：压缩 TSDB 索引，并在启用保留/删除时执行后台处理；单实例语义和共享存储要求应按当前版本核对。
- **Index Gateway**：让读取组件共享索引访问能力，降低每个 Querier 的本地索引负担。
- **Query Frontend/Scheduler**：控制查询切分、缓存、队列和租户公平性，不会修复错误的 Label 设计。

Ring 中实例异常、对象存储缓慢和查询队列积压可能表现为同一个“Grafana 很慢”，需要沿路径分层判断。

## 7. 多租户不是只加一个 Header

Loki 常用 `X-Scope-OrgID` 标识租户，但它只是协议字段。生产环境必须由可信网关完成认证并根据身份注入租户，不能允许公网客户端任意指定 Header。

每租户应有独立限流、Stream 数量、查询并发、保留和删除策略。否则一个租户的高基数写入或大范围正则查询会影响其他租户。

## 8. 常见故障如何定位

### 8.1 写入 429

先分辨是每租户吞吐、单 Stream 速率、活跃 Stream 数还是 Distributor 全局保护。盲目提高限制可能把问题推给 Ingester 内存或对象存储。

### 8.2 近期能查，历史查不到

说明 Ingester 查询可能正常，但刷新、索引、对象存储或 Compactor 路径异常。检查 Chunk 刷新失败、对象权限、schema 时间边界和查询组件日志。

### 8.3 历史能查，最近几分钟缺失

检查 Agent/Collector、Distributor 到 Ingester、Ring 健康度及 Querier 是否能查询 Ingester；不要先怀疑对象存储。

### 8.4 查询慢或 OOM

查看扫描字节数、分片数、队列时间、命中 Stream 数和正则耗时。缩短时间范围、增加精确 Selector，并修复基数；只扩 Querier 可能暂时掩盖坏查询。

## 9. 设计与验收

上线前用接近峰值的日志分布验证：

1. 正常和高基数错误流量下的活跃 Stream、Chunk 利用率；
2. Ingester 单实例重启和节点丢失后的 WAL 恢复与副本行为；
3. 对象存储限流、短时不可用时的队列与数据完整性；
4. 最近 15 分钟、24 小时、保留边界查询的延迟与扫描量；
5. 租户限流和恶意宽查询是否被隔离；
6. Retention 到期后索引和对象是否都按预期删除。

## 10. 练习与答案

**问题：为什么 Pod 名看似方便，仍要谨慎作为 Label？**

答案：Pod 重建会持续创建新值和短命 Stream。若排障确实需要，可保留在结构化元数据或受控 Label 中，同时以稳定的 `service`、`namespace` 作为主要 Selector，并监控 Stream churn。

**问题：为什么限制返回行数不能显著降低查询成本？**

答案：后端可能仍需定位、下载、解压并过滤大量 Chunk 后才能找到这些行。真正降低成本要减少时间范围、Stream 数和扫描字节。

参考资料：

- [Loki architecture](https://grafana.com/docs/loki/latest/get-started/architecture/)
- [Loki storage](https://grafana.com/docs/loki/latest/operations/storage/)
- [Loki label best practices](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/)
