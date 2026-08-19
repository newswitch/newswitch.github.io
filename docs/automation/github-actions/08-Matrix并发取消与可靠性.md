---
title: "GitHub Actions Matrix、并发、取消与可靠性"
sidebar_label: "08. Matrix、并发与可靠性"
sidebar_position: 8
description: "控制 Matrix 组合、Job DAG、并发组、超时、取消、有限重试和外部副作用，避免流水线放大故障。"
tags: [GitHub Actions, Matrix, Concurrency, Retry, 可靠性]
---

# GitHub Actions Matrix、并发、取消与可靠性

## 1. Matrix 是任务生成器

Matrix 适合测试多个 OS、语言版本或部署目标，但维度相乘会迅速放大 Job 数量、排队、API 调用和成本。

```text
3 个 OS × 4 个版本 × 2 个架构 = 24 个 Job
```

使用 `include/exclude` 精确建模，对外部生成的 Matrix 做 Schema 和数量上限，不能让输入创建无限 Job。

## 2. Fail-fast 的取舍

快速验证可在首个失败后取消其他组合；兼容性报告可能需要收集全部结果。允许失败的实验版本应显式标记，不能让真实失败变成整个 Workflow 成功。

## 3. 并发组

| 场景 | 推荐行为 |
| --- | --- |
| 同一 PR 验证 | 新提交取消旧 Run |
| 生产环境发布 | 串行，谨慎取消 |
| 数据库迁移 | 外部锁 + 状态查询，不盲目取消 |
| 定时巡检 | 防重叠并保留一次完整结果 |

并发组表达式先规范化，防止大小写、斜杠和超长分支名造成意外分组。

## 4. 超时与取消

Job 设置总超时，内部命令设置连接、请求和操作超时。Runner 收到取消后，脚本要停止创建新副作用、终止子进程、保存必要证据并释放锁。不要依赖 Workflow 的最终清理 Step 作为唯一资源回收方式。

## 5. 重试分类

- 网络 502/503/429：有限次数、指数退避、抖动和服务端提示；
- 编译/测试确定性失败：不重试掩盖；
- 外部写请求超时：使用幂等键并先查询结果；
- Runner 丢失：新 Job 可能重复前序副作用，步骤需可重入。

Shell 中的一行 `retry 10` 不是可靠性设计。

## 6. 部分失败

聚合 Job 读取 `needs` 中每个组合的结果，生成结构化摘要；区分 Failed、Cancelled、Skipped 和 Infrastructure Error。只有业务规定可接受的组合失败才允许继续，并留下带过期时间的豁免。
