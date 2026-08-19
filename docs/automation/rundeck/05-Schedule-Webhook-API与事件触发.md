---
title: "Rundeck Schedule、Webhook、API 与事件触发"
sidebar_label: "05. 调度、Webhook 与 API"
sidebar_position: 5
description: "使用定时、Webhook 和 API 安全触发 Job，处理时区、错过调度、签名、重放、限流和幂等。"
tags: [Rundeck, Schedule, Webhook, API, Event Driven]
---

# Rundeck Schedule、Webhook、API 与事件触发

## 1. 定时调度

明确时区、夏令时、错过执行、服务器停机恢复和重叠策略。Cron 只负责触发，不保证外部业务操作恰好一次；Job 仍需业务窗口和幂等键。

## 2. 重叠控制

巡检可禁止并发或取消旧运行；备份、发布和迁移通常禁止重叠但不能粗暴取消未知阶段。使用 Job 并发限制加外部资源锁，锁有超时、Owner 和恢复步骤。

## 3. Webhook 安全

```text
Event Source
→ TLS/Webhook Gateway
→ 签名、时间戳与重放校验
→ Schema/允许列表
→ 映射为固定 Job + 有限 Options
→ Execution ID
```

外部 Payload 不能直接指定命令、任意 Job、Node Filter、Key Path 或高权限身份。

## 4. API Token

为每个调用系统使用独立短期 Token/服务身份，只授权运行指定 Project/Job 和查看自身结果。Token 进入 Vault，不写在 URL、仓库或普通日志。

## 5. 异步状态

API 触发成功只表示创建 Execution。调用方保存 Execution ID，轮询或接收回调直到终态，处理 Succeeded、Failed、Aborted、Timed Out 和 Unknown。

## 6. 幂等与重放

使用事件 ID/业务键记录已处理请求。重复 Webhook 返回同一 Execution 或明确拒绝；网络超时后先查询，不直接再次创建。

## 7. 限流

对来源、Job 和目标设置速率/并发限制。告警风暴不能为每个事件创建一次重启 Job；先聚合、去重、抑制并由安全规则决定是否自动化。
