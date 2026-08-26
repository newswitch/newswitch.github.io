---
title: "GPU 多集群控制面、资源目录与故障域"
sidebar_label: "06. 全局资源目录与故障域"
sidebar_position: 6
description: "建立带时效和能力语义的多集群 GPU 资源目录，并区分管理、供电、网络、存储和区域故障域。"
tags: [GPU, 多集群, 资源目录, 故障域]
---

# GPU 多集群控制面、资源目录与故障域

## 1. 资源目录不能只记录卡数

每个集群至少发布：

- GPU/NPU 型号、显存、Profile 和可分配数量；
- 完整节点 Shape、NVLink/NVSwitch 域；
- 网络 Fabric、RDMA 能力和可用带宽等级；
- 存储/Dataset/模型 Cache 能力；
- Queue、Quota、维护和健康状态；
- Region、AZ、机房、机架和控制面故障域；
- Runtime/Driver/框架兼容标签；
- 数据采集时间与 TTL。

“空闲 64 卡”若已经是五分钟前的数据，可能导致多个调度请求同时选择同一集群。

## 2. 期望状态与成员状态

```text
全局平台保存Placement意图
→ 成员Agent/标准API创建工作负载
→ 成员集群独立Reconcile
→ 汇总Observed State
```

控制面应使用 Workload UID 和 Generation 处理重试。网络超时后先查询成员状态，不能直接向另一个集群重复创建。

## 3. Pull 与 Push

Push 模式由 Hub 访问成员 API，权限集中；Pull 模式由成员 Agent 拉取期望状态，适合成员 API 不直接暴露。两者都要解决身份、证书轮换、版本兼容、离线缓存和命令授权。

## 4. 故障域

| 故障 | 可能影响 |
| --- | --- |
| Hub/全局数据库 | 新准入、放置和全局视图 |
| 成员控制面 | 新建/更新，已有 Pod 可能继续运行 |
| 集群出口 | 模型下载、全局状态和外部 API |
| 存储区域 | Dataset、Checkpoint、恢复能力 |
| Fabric/机架 | 多机训练 Collective |
| Region | 全部本地服务和数据副本 |

RTO/RPO 应分别针对控制面、在线推理和训练 Checkpoint 定义。

## 5. Split Brain

Hub 与成员断连时，成员是否允许继续扩缩容、重试任务或接受本地提交必须明确。全局任务用 Lease/Fencing Token 控制唯一 Owner；过期 Agent 不能继续写全局状态。

## 6. 安全

Hub 不应持有每个成员的 Cluster Admin。成员 Agent 权限限制在平台管理的 Namespace/CRD；所有跨集群消息签名并包含目标、Generation、过期时间和幂等 ID。

## 7. 可观测性

监控目录新鲜度、成员心跳、状态传播延迟、放置冲突、API 错误和实际资源偏差。任何基于过期容量做出的放置都应有明确状态，而不是显示为普通 Pending。

参考：[Karmada Architecture](https://karmada.io/docs/next/core-concepts/architecture/)、[Cluster Inventory API](https://multicluster.sigs.k8s.io/concepts/multicluster-services-api/)。
