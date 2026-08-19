---
title: "Temporal Activity 超时、重试、Heartbeat 与幂等"
sidebar_label: "03. Activity 可靠性与幂等"
sidebar_position: 3
description: "为外部副作用设计 Activity 边界、四类超时、重试分类、Heartbeat、取消和业务幂等。"
tags: [Temporal, Activity, Retry, Timeout, Idempotency]
---

# Temporal Activity 超时、重试、Heartbeat 与幂等

## 1. Activity 是副作用边界

网络请求、数据库操作、文件处理、Kubernetes 变更和通知都放入 Activity。Activity 可能因 Worker 崩溃或完成响应丢失而被再次执行，因此默认按 At-least-once 思考。

## 2. 超时类型

| 超时 | 限制什么 |
| --- | --- |
| Schedule-to-Start | Task 在队列等待 Worker |
| Start-to-Close | 单次 Activity 尝试 |
| Schedule-to-Close | 含重试的完整 Activity 生命周期 |
| Heartbeat | 长任务多久必须报告进度 |

根据真实外部 SLA 设置；一个巨大超时会让容量问题长时间隐藏。

## 3. 重试分类

- 429/短时 5xx/连接失败：有限指数退避和抖动；
- 参数、权限、Schema、业务拒绝：标记不可重试；
- 响应超时但外部结果未知：用幂等键查询；
- 下游长时间故障：让 Workflow 等待/人工处理，不无限重试压垮服务。

## 4. 幂等键

使用 `Workflow ID + Activity 业务目的 + 资源 ID` 生成稳定键，由下游唯一约束或幂等 API 保证。不能只在 Worker 内存保存“执行过”。

## 5. Heartbeat

长任务定期上报进度和可恢复 Checkpoint。取消请求通常在 Heartbeat 时被感知；Heartbeat 过慢会延迟取消，过快会增加服务压力。Checkpoint 必须小且不含大文件/Secret。

## 6. Activity 粒度

过大 Activity 难以从中间恢复；过小则增加 History、调度和网络开销。按独立重试、超时、幂等和可观测边界拆分，而不是每行代码一个 Activity。

## 7. 补偿

跨系统操作无法获得全局 ACID 时，Workflow 记录已完成步骤并执行语义补偿。补偿本身是 Activity，也需要幂等、重试和人工失败处理。补偿不保证恢复所有现实影响。
