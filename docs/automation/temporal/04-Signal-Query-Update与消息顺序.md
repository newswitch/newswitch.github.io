---
title: "Temporal Signal、Query、Update 与消息顺序"
sidebar_label: "04. Signal、Query 与 Update"
sidebar_position: 4
description: "使用 Signal、Query 和 Update 与运行中的 Workflow 交互，处理验证、顺序、重复、并发和关闭条件。"
tags: [Temporal, Signal, Query, Update, Message Passing]
---

# Temporal Signal、Query、Update 与消息顺序

## 1. 三种交互

| 能力 | 是否修改状态 | 调用方是否获得完成结果 | 适合 |
| --- | --- | --- | --- |
| Signal | 是 | 通常只确认送达服务 | 异步事件、审批、取消意图 |
| Query | 否 | 返回当前视图 | 查询进度、状态摘要 |
| Update | 是 | 有验证与执行结果 | 需要同步确认的状态变更 |

具体 SDK/服务版本支持和语义以官方文档为准。

## 2. 消息 Handler

Handler 修改 Workflow 内的确定性状态，不直接调用外部系统；需要副作用时由主流程或 Handler 安排 Activity。Handler 中的并发和等待使用 SDK 原语。

## 3. 验证

Update Validator 只做确定性、无副作用的快速检查，例如当前阶段是否允许变更、参数是否在范围。复杂外部授权应在入口和 Activity 中再次验证。

## 4. 顺序与重复

跨客户端消息到达顺序和重试需要显式设计。业务事件携带 Event ID/Sequence；Workflow 保存已处理 ID 或期望序列，重复消息返回已有结果，乱序则缓冲、拒绝或等待缺失事件。

## 5. Query 一致性

Query 读取 Workflow 当前重放状态，不等于下游系统已达到相同状态。返回 `desired_stage`、`last_completed_activity`、外部 Operation ID 和更新时间，避免只有一个模糊 `running`。

## 6. 关闭前处理

Workflow 完成或 Continue-As-New 前确认未处理 Handler/消息和正在执行的逻辑。定义晚到 Signal 的策略：拒绝、路由到新 Run 或启动补偿流程。

## 7. 安全

消息 Payload 经过 Schema、大小和身份授权；不把 Token/Secret 放入 History。调用方只可操作其业务范围内的 Workflow ID，防止枚举和跨租户 Signal。
