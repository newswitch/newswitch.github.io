---
title: "ACL、TLS、监控、Dashboard、升级与跨集群迁移"
sidebar_label: "13. ACL、TLS、监控、Dashboard、升级与跨集群迁移"
sidebar_position: 13
description: "建立 RocketMQ 安全身份、可观测、Dashboard 管理、滚动升级和迁移闭环。"
tags: [RocketMQ, ACL, TLS, Monitoring, Migration]
---

# ACL、TLS、监控、Dashboard、升级与跨集群迁移

RocketMQ 的生产治理需要把接入安全、运行观测、变更升级和跨集群恢复连成一条链。Dashboard 能打开不代表已安全，Broker 有副本也不代表可以从误删、错误配置或跨集群事故恢复。

## 1. 先画出所有暴露面

```text
Producer/Consumer
  → Load Balancer / Proxy(gRPC)
  → NameServer / Broker(Remoting)

Operators
  → VPN/SSO Gateway
  → Dashboard / mqadmin / metrics

Broker replicas
  ↔ HA replication
  ↔ Controller quorum
```

每条链路分别定义：发起方身份、目标端口、TLS、认证、授权、网络策略、日志、Secret 轮换和 Owner。不能因为组件位于内网，就允许任意工作负载访问管理面。

## 2. RocketMQ 5.5 安全基线

官方当前安全文档指出：ACL 2.0 自 5.3.0 引入，ACL 1.0 在 5.3.3 移除。因此 5.5.0 生产集群应按 ACL 2.0 设计，不应继续复制旧 ACL 1.0 教程。

最低基线：

- 未配置 ACL 时不能假设存在身份校验；必须启用 ACL 或严格置于可信隔离网络；
- Producer、每个 Consumer Group、运维和监控使用不同身份；
- 应用只授予需要的 Topic 发送/订阅权限；
- 业务应用不使用管理员 AccessKey；
- Secret 进入 Secret Manager/Kubernetes Secret 加密链路，不写 Git、镜像或命令历史；
- Dashboard、Exporter、Admin API 不直接暴露公网；
- Broker/Proxy/NameServer/Controller 主机最小化登录权限并及时升级漏洞补丁。

## 3. TLS 与网络隔离

TLS 解决链路机密性和服务身份，ACL 解决 RocketMQ 请求身份/授权，两者不能互相替代。上线前逐链路验证目标版本的 TLS 支持、证书路径、Client 配置和是否真正拒绝明文。

网络分区建议：

| 区域 | 允许访问 |
| --- | --- |
| 业务命名空间 | 仅 Proxy/Broker 必需接入端口 |
| Broker 节点 | NameServer、Controller、Replica 与受控运维 |
| Controller | 仅 Controller peers 和 Broker 控制链路 |
| 监控 | 只读 metrics endpoint |
| 运维入口 | Dashboard/mqadmin，经 VPN/堡垒机/SSO |

证书轮换要覆盖 LB、Proxy、Broker 和客户端 trust store，并验证长连接是否加载新证书。先支持新旧 CA 重叠，再换服务端/客户端，最后移除旧 CA。

## 4. 身份和权限验证不能只做正向测试

每次安全变更至少验证：

1. 合法 Producer 只能写授权 Topic；
2. 合法 Consumer 只能读授权 Topic/Group；
3. 业务身份不能创建/删除 Topic、重置 Offset；
4. 错误 AK/SK、过期证书、明文连接被拒绝；
5. 从未授权网段即使有凭据也无法直达管理面；
6. 日志不输出完整 Secret 和敏感 body；
7. 轮换旧 Secret 后旧客户端确实失效。

## 5. 四层可观测模型

### 5.1 业务层 {/* #业务层 */}

- 业务事件产生数、唯一消费数、重复/缺口；
- event_id 端到端延迟；
- DLQ、补偿和最终业务状态。

### 5.2 客户端/Proxy 层 {/* #客户端proxy-层 */}

- Producer 成功、错误码、retry、P99、in-flight；
- Consumer lag age、处理 P99、retry/DLQ、Rebalance；
- Proxy 连接、请求队列、后端错误和 gRPC latency。

### 5.3 Broker/存储层 {/* #broker存储层 */}

- Put/Get QPS 与失败；
- CommitLog append/flush、Page Cache、dispatch behind；
- 磁盘空间、IOPS、吞吐、await；
- Replica lag、SyncStateSet、拒写；
- Timer/Transaction/Retry 等特殊消息积压。

### 5.4 控制面/系统层 {/* #控制面系统层 */}

- NameServer 路由注册；
- Controller leader、quorum、election、epoch；
- JVM Heap/Direct Memory/GC、CPU、网络、FD；
- 版本、配置漂移和证书到期。

## 6. 5.x 原生 Metrics

官方 5.x 文档描述了 Broker 的 OpenTelemetry/Prometheus 指标导出。Prometheus 模式典型配置：

```properties
metricsExporterType=PROM
metricsPromExporterPort=5557
```

随后从受控监控网络抓取：

```bash
curl --fail --silent http://broker-a.example:5557/metrics
```

端口与配置必须以目标版本为准，并通过防火墙限制。Metrics endpoint 可能泄露 Topic、节点和流量元数据，不应公网开放。旧集群可能还使用独立 Exporter，升级时不要把两个来源重复计数。

## 7. 告警应从用户症状到根因

| 级别 | 告警 | 原因 |
| --- | --- | --- |
| Page | 关键 Topic 发送/消费可用率或延迟违反 SLO | 已影响业务 |
| Page | SyncStateSet 低于安全线且继续恶化 | RPO/可写性危险 |
| Page | 磁盘按趋势即将到保护水位 | 可能拒写/提前清理 |
| Ticket | 单副本 lag、GC、路由注册抖动 | 尚有冗余但需修复 |
| Ticket | DLQ 新增、最老 Half/Timer age 异常 | 业务链路故障 |
| Info | 计划内选主、发布和扩容 | 变更关联 |

告警应携带 cluster、topic/group、Broker、开始时间、关键图表和 Runbook 链接。不要用 msgId/event_id 做指标标签。

## 8. Dashboard 的权限边界

Dashboard 可查看 Topic/Group、消息和执行部分运维操作，因此同时具备敏感数据读取和破坏能力。生产要求：

- 只监听内网；
- 前置 SSO/MFA、细粒度授权和会话审计；
- Dashboard 自身访问 RocketMQ 使用独立最小权限身份；
- 搜索消息 body 受数据分级和脱敏约束；
- 创建/删除 Topic、重置 Offset、重发 DLQ 等操作二次审批；
- Dashboard 不是 Prometheus、备份或审计系统的替代品。

## 9. 备份与可重建边界

RocketMQ 生产恢复对象包括：

| 对象 | 价值 | 恢复方式 |
| --- | --- | --- |
| Topic/Group/ACL 配置 | 资源与权限 | 声明式配置/Git/导出 |
| Broker/Proxy/NS/Controller 配置 | 拓扑和行为 | 配置管理系统 |
| Controller 状态/epoch | 自动选主权威状态 | 多副本 + 受支持恢复流程 |
| CommitLog 与派生索引 | 业务消息 | Broker 副本、文件级一致备份或跨集群复制 |
| Consumer Offset | 消费进度 | 元数据备份/迁移工具/业务对账 |
| Dashboard | 非权威界面 | 可重建 |

简单在线复制 Broker 数据目录可能得到不一致快照。消息灾备应优先依赖跨故障域副本、官方/验证过的复制方案、上游 Outbox/源数据和定期恢复演练。备份成功日志不等于可恢复。

## 10. 升级前的版本矩阵

RocketMQ 5.5.0 在 2026 年 4 月发布。升级应固定精确版本并列出：

```text
NameServer
Broker store format/config
Controller
Proxy
gRPC/Remoting SDKs by language
mqadmin
Dashboard
Exporter / OTel Collector
Operator/Helm image
```

特别检查：

- 5.3.3 后 ACL 1.0 已移除；
- 5.5 LiteTopic 需要服务端与 gRPC SDK 兼容；
- 新配置默认值、废弃项和存储格式；
- 旧 SDK 是否仍能访问普通 Topic；
- 回滚版本能否读取升级后的数据/元数据。

## 11. 滚动升级流程

1. 在预生产复制真实 Topic/Group/消息类型与流量；
2. 备份声明式配置并完成恢复演练；
3. 验证客户端兼容、ACL/TLS、Controller 和 Broker 数据；
4. 冻结高风险资源变更，建立基线仪表盘；
5. 从无状态/非主/单副本灰度，具体顺序遵循 release 指南；
6. 每步检查发送/消费、路由、SyncStateSet、lag、P99、DLQ；
7. 保证集群始终满足副本和 Controller 多数派；
8. 达到回退阈值立即停止，不在同一数据目录反复切换不兼容版本；
9. 全量后保留观察窗口，再升级 SDK 和启用新特性。

回退矩阵要区分“二进制回退、配置回退、流量回切、数据恢复”。它们不是一个 `rollback` 命令。

## 12. 跨集群迁移必须迁哪些状态

```text
Topic metadata / type / Queue
Consumer Group / retry policy / offsets
ACL identities and permissions
messages: history + real-time delta
Producer/Consumer endpoints
Dashboard/monitoring/alerts/runbooks
```

只复制消息但不迁 Group offset，可能从头重复消费或从尾部漏消息；只复制 Topic 名但类型/Queue 不同，会破坏 FIFO 和容量。

## 13. 跨集群迁移步骤

1. 在目标集群声明 Topic、类型、Queue、Group、ACL 和保留；
2. 验证目标集群 N-1 容量、RPO/RTO 和消息类型；
3. 使用验证过的复制/双写/Outbox 重放方案同步历史与增量；
4. 比较 Topic/Queue offset、event_id 采样、业务计数和时间窗；
5. 先灰度无副作用 Consumer，验证幂等和 Filter；
6. 灰度 Producer，使用同一 event_id 避免双写无法对账；
7. 迁移 Consumer Group/offset 或选择明确回放点；
8. 停旧写，等待复制追平，再切主要消费；
9. 保留旧集群只读观察窗口；
10. 目标新增消息的回切路径必须在切换前确定。

## 14. 迁移验收

迁移完成不等于进程都连到新地址。必须证明：

- 每个 Topic/Queue 的目标范围完整；
- 所有关键 event_id 无缺口，重复由幂等吸收；
- Group 起点与业务预期一致；
- FIFO 业务版本连续；
- Transaction/Delay/DLQ/LiteTopic 等特殊语义通过；
- ACL/TLS 负向测试通过；
- 原集群关闭后没有隐藏客户端继续写入。

## 15. 验收题

- Dashboard 为什么不能直接暴露公网？
- 升级需维持哪些副本证据？
- 迁移为何同时迁 Topic、Group/offset 和 ACL？
- TLS 轮换要覆盖哪些组件？
- RocketMQ 5.5 为什么不能继续沿用 ACL 1.0 配置？
- 原生 Metrics endpoint 为什么也需要网络保护？
- 二进制回退与数据回退为什么不是一回事？
- 双写迁移怎样用 event_id 证明无缺口？

## 16. 参考资料

- [RocketMQ 安全基线](https://rocketmq.apache.org/docs/security/01security/)
- [RocketMQ Metrics](https://rocketmq.apache.org/docs/observability/01metrics/)
- [RocketMQ Dashboard](https://rocketmq.apache.org/docs/deploymentOperations/04Dashboard/)
- [RocketMQ 5.5.0 发布记录](https://rocketmq.apache.org/release-notes/)
