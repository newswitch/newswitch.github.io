---
title: "Argo Workflows 架构、CRD 与执行路径"
sidebar_label: "01. 架构、CRD 与执行路径"
sidebar_position: 1
description: "理解 Workflow、Template、Controller、Server、Executor、Pod、Artifact Repository 和归档数据库的职责。"
tags: [Argo Workflows, CRD, Controller, Executor, Kubernetes]
---

# Argo Workflows 架构、CRD 与执行路径

## 1. 主要组件

| 组件 | 职责 |
| --- | --- |
| Workflow CRD | 保存任务图、参数和运行状态 |
| Workflow Controller | Watch Workflow，计算依赖并创建/管理 Pod |
| Argo Server | UI/API、认证和用户交互入口 |
| Workflow Executor | 协助主容器、输出参数和 Artifact 处理 |
| Artifact Repository | 保存大文件、日志归档等外部制品 |
| Persistence/Archive | 保存历史 Workflow 元数据，减轻 etcd 压力 |

Argo Server 不是执行任务的调度器；Controller 才负责持续协调 Workflow 状态。

## 2. 一次提交经历什么

```text
Client 创建 Workflow 对象
→ API Server 持久化并产生事件
→ Controller Watch 到对象
→ 解析入口 Template 与依赖
→ 为可运行节点创建 Pod
→ Scheduler 选择 Node，kubelet/运行时启动容器
→ Executor 收集输出与 Artifact
→ Controller 更新节点状态并解锁下游
→ 完成、失败或进入退出处理
→ 可选归档和 TTL 清理
```

## 3. 两层状态机

Kubernetes Pod 有 Pending/Running/Succeeded/Failed；Workflow Node 还要表达依赖、跳过、重试和错误。排障时先问“Workflow 为什么没有创建 Pod”，还是“Pod 已创建但 Kubernetes 无法运行”。

## 4. 控制循环

Controller 接收事件后重新计算，而不是把每个事件当一次性命令。Controller 重启后应能从 API 中恢复协调。因此外部副作用不能只依赖内存标志，任务需要幂等键和可查询结果。

## 5. 容量边界

大型 Workflow 可能包含数千节点，使对象体积、Status 更新、API QPS 和 Controller 内存增长。通过拆分 Child Workflow/模板、节点状态压缩或卸载、归档和并行上限控制规模；不能只增加 Controller CPU。
