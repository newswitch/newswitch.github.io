---
title: "Temporal Timer、Child Workflow、Continue-As-New 与 Schedule"
sidebar_label: "05. 长流程与调度"
sidebar_position: 5
description: "使用持久 Timer、Child Workflow、Continue-As-New 和 Schedule 管理长时间、重复和大历史工作流。"
tags: [Temporal, Timer, Child Workflow, Continue-As-New, Schedule]
---

# Temporal Timer、Child Workflow、Continue-As-New 与 Schedule

## 1. 持久 Timer

Workflow 使用 SDK Timer 等待分钟、天或月；Worker 进程不需持续占用线程，Service 在到期时产生任务。不要用 Activity `sleep` 长期占用 Worker。

## 2. Child Workflow

Child 适合独立生命周期、并行分片、不同重试/可见性或可单独操作的子流程。父子关闭策略必须明确：父结束后 Child 是终止、取消还是继续。

大量细碎 Child 会增加 History 和服务负载；简单副作用仍用 Activity。

## 3. Continue-As-New

长 Workflow 的 Event History 持续增长。Continue-As-New 用新 Run 接续同一业务 Workflow ID/链路，并只携带必要状态：

```text
旧 Run 总结状态
→ Continue-As-New 输入
→ 新 Run 从小 History 开始
```

不要携带大列表和全部历史；业务数据放数据库/对象存储，传引用与版本。

## 4. 消息与切换

Continue-As-New 前处理正在进行的 Signal/Update Handler，并定义切换窗口。新旧 Run 的去重状态、Sequence 和外部幂等键要连续。

## 5. Schedule

Schedule 管理周期启动、暂停、重叠和补偿执行。定义时区、错过窗口、Overlap Policy 和业务幂等。周期触发不保证外部动作恰好一次。

## 6. Workflow ID 策略

例如 `daily-report/<tenant>/<date>` 防止同一业务窗口重复启动。启动冲突策略、完成后重用规则和手工重跑语义要统一，不能随机生成 ID 后失去去重。

## 7. 选择

- 等待时间：Timer；
- 独立子流程：Child；
- 历史过大：Continue-As-New；
- 周期创建：Schedule；
- 外部系统轮询：Activity + Timer/重试，而不是忙循环。
