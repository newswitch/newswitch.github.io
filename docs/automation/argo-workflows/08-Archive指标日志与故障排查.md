---
title: "Argo Workflows Archive、指标、日志与故障排查"
sidebar_label: "08. 可观测、归档与排障"
sidebar_position: 8
description: "建立 Workflow Archive、指标、日志、容量与从控制面到 Pod 和 Artifact 的分层故障排查方法。"
tags: [Argo Workflows, Archive, Prometheus, 日志, 故障排查]
---

# Argo Workflows Archive、指标、日志与故障排查

## 1. 三类证据

| 证据 | 保存什么 | 生命周期 |
| --- | --- | --- |
| Workflow 对象 | 当前 Spec、Status、节点图 | 受 TTL/集群清理控制 |
| Archive 数据库 | 历史元数据和查询索引 | 独立保留与备份 |
| Pod 日志/Artifact | 执行输出和业务制品 | 日志平台/对象存储策略 |

Archive 不会自动备份 Artifact，Workflow TTL 也不会自动清理所有外部对象。

## 2. 关键指标

- Workflow 提交、成功、失败、Error 和耗时分布；
- 队列等待、Pod Pending、运行时间和重试次数；
- Controller Queue 深度、处理延迟、API 错误和内存；
- 活跃 Workflow/节点数、Workflow 对象大小；
- Artifact 上传下载成功率、吞吐和延迟；
- 按团队/模板/GPU 类型的资源与成本。

业务指标要区分排队、数据准备、计算和落盘，否则“总耗时变慢”无法定位。

## 3. 故障分层

```text
Workflow 未推进
├── Spec/模板/参数校验
├── Controller队列/API权限/容量
├── Pod未创建或调度Pending
├── 镜像、Secret、网络、容器运行失败
├── 主程序业务失败/超时/OOM
├── Executor输出或Artifact失败
└── 下游依赖、锁、退出处理失败
```

## 4. 排查步骤

1. 记录 Workflow UID、Namespace、模板版本和时间。
2. 查看 Workflow Node 状态、Message 和 Events。
3. 确认是否生成 Pod，再查看 Pod Events 与各容器状态。
4. 分别读取主容器、Wait/Executor 和 Init 日志。
5. 检查 ServiceAccount/RBAC、对象存储、Secret 和网络。
6. 对比同模板最近成功运行的输入、镜像 Digest 和节点。

## 5. 容量与保留

估算每日 Workflow/节点/日志/Artifact 数量、平均大小和保留期。对高基数标签、超大 Status、海量小 Workflow 和长时间日志建立限制。归档数据库慢可能反向影响查询甚至控制面，应独立监控连接池和索引。

## 6. Runbook 输出

每类告警给出影响、快速判断、证据命令、止损、恢复验证和升级联系人。不要让“重新提交 Workflow”成为默认操作，它可能重复外部副作用。
