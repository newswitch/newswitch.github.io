---
title: "Temporal Workflow 确定性、Event History 与 Replay"
sidebar_label: "02. 确定性、History 与 Replay"
sidebar_position: 2
description: "理解 Workflow 状态如何由 Event History Replay 恢复，以及非确定性代码为什么会破坏长期运行。"
tags: [Temporal, Determinism, Event History, Replay, Workflow]
---

# Temporal Workflow 确定性、Event History 与 Replay

## 1. Replay 心智模型

Workflow Worker 不依赖进程内对象永久保存。收到 Workflow Task 时，它从头执行 Workflow 代码，并用 History 中已有 Event 重放先前结果，直到到达新的决策点。

```text
相同 Workflow 代码 + 相同 History
→ 必须产生相同 Command 序列
```

否则出现非确定性错误，Workflow 无法继续。

## 2. Workflow 中不能直接做什么

- 直接调用 HTTP、数据库、文件系统；
- 使用普通墙上时钟或随机源；
- 创建非 SDK 管理的线程/协程；
- 依赖无序集合遍历和全局可变状态；
- 读取每次 Replay 可能变化的环境变量；
- 直接发送通知或写外部系统。

这些动作放入 Activity；时间、随机、并发使用 SDK 的确定性 API。

## 3. Replay 不是重复副作用

已完成 Activity 的结果记录在 History。Replay 时 SDK 返回历史结果，不再次执行 Activity。只有新的调度或重试 Task 才可能调用 Activity Worker。

## 4. History 是事实记录

History 包含 Workflow/Activity 调度、结果、Timer、Signal、Update 等事件。它可能包含输入输出 Payload，因此要限制数据大小并加密敏感内容。

## 5. 代码变更风险

如果旧代码先调度 A 再 B，新代码改为 B 再 A，正在运行的旧 History 由新 Worker Replay 时会不匹配。使用版本兼容机制、Worker 路由或安全的代码变更模式，不能像无状态 HTTP 服务一样任意替换。

## 6. 验证方法

保存生产脱敏 History，用新代码执行 Replay Test；测试分支、Timer、Signal 顺序和已运行多个版本。只有新启动 Workflow 通过单元测试不够。
