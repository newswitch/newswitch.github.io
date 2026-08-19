---
title: "Temporal Worker、Task Queue、路由与并发容量"
sidebar_label: "06. Worker、路由与容量"
sidebar_position: 6
description: "设计 Worker 进程、Task Queue、Build 路由、Poller、并发、限流、Backpressure 和多租户容量。"
tags: [Temporal, Worker, Task Queue, Concurrency, Capacity Planning]
---

# Temporal Worker、Task Queue、路由与并发容量

## 1. Worker 是无状态执行容量

Worker 轮询 Task Queue，注册 Workflow/Activity 类型并执行代码。Workflow 持久状态在 Service History 中，但 Worker 仍有缓存、并发、连接池和下游资源限制。

## 2. Task Queue 设计

按信任域、资源类型、延迟和团队划分，而不是每个 Workflow 一个队列。CPU 任务、GPU 任务和高权限发布 Activity 应分开队列/Worker 身份。

Task Queue 名称是路由契约；重命名前要迁移仍在运行的 Workflow。

## 3. 两类任务容量

Workflow Task 主要 Replay/决策，需低延迟；Activity Task 可能长时 I/O/CPU。分别配置 Poller 和并发，防止慢 Activity 挤占 Workflow Task。

## 4. Backpressure

```text
到达率 > Worker 处理率
→ Task Queue Schedule-to-Start 增长
→ Workflow 延迟增长
```

扩 Worker 前检查下游数据库/API/GPU 是否可承受。使用 Worker/Activity 限流、应用级 Semaphore 和下游配额共同保护。

## 5. Worker 部署

- 镜像按 Digest，包含 SDK/代码版本；
- Readiness 仅在完成注册并可轮询后通过；
- 优雅关闭停止新任务，并给 Activity 完成/Heartbeat 时间；
- 网络只允许 Temporal、下游和观测系统；
- 使用短期 mTLS/身份，不在镜像内置 Secret；
- 按故障域多副本并保留容量余量。

## 6. 多租户

Namespace 提供逻辑隔离，Task Queue/Worker/身份进一步限制执行。高噪租户设置单独队列、限流和配额，防止积压影响关键流程。

## 7. 指标

观察 Schedule-to-Start、Task 执行时间、Poller、并发槽、Sticky Cache 命中/驱逐、Worker CPU/内存、Activity 失败和下游限流。队列长度必须结合到达率和处理率。
