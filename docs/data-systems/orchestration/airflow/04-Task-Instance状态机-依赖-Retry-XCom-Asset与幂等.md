---
title: "Airflow Task Instance 状态机、依赖、Retry、XCom、Asset 与幂等"
sidebar_label: "04. Task 状态、依赖与幂等"
sidebar_position: 4
description: "理解 Task Instance 从调度到执行的状态变化，并设计可重试、可补数、低耦合的工作流。"
tags: [Airflow, TaskInstance, Retry, XCom, Asset]
---

# Airflow Task Instance 状态机、依赖、Retry、XCom、Asset 与幂等

Task 是 DAG 中的定义，Task Instance 是“某个 Task 在某个 DagRun 中的一次实例”。排查任务为什么没运行，必须看实例状态和依赖，而不是只读 Python 代码。

## 1. 状态路径

```text
none
→ scheduled
→ queued
→ running
→ success
```

异常分支包括 `up_for_retry`、`upstream_failed`、`failed`、`deferred`、`removed`、`restarting` 等。`scheduled` 很久通常在 Scheduler/依赖层，`queued` 很久通常在 Executor/Worker/资源层，`running` 很久才进入任务本身和外部系统。

## 2. 依赖与 Trigger Rule

默认 `all_success` 要求上游都成功。分支 DAG 中的汇聚节点常需 `none_failed_min_one_success` 等规则，否则被跳过的分支会让汇聚任务也跳过。依赖还包括 Pool Slot、DAG/Task 并发、执行日期、重试时间和 Executor 可用性。

## 3. Retry 不是幂等

重试只会再次执行代码。任务应做到同一 Data Interval 多次执行结果一致：

- 数据库用唯一键和 Upsert，避免盲目 Insert；
- 文件先写临时路径，校验后原子 Rename/Publish；
- 外部 API 使用 idempotency key；
- 分区表按逻辑区间覆盖，而不是用当前时间追加；
- 通知、扣款等副作用与数据计算分开治理。

合理设置 `retries`、指数退避、超时和不可重试错误。认证失败、Schema 不兼容通常不应无限重试。

## 4. XCom 边界

XCom 用于小型控制信息，如对象路径、行数、分区和 Job ID，不是传输 DataFrame 或模型文件。大对象放对象存储/数据库，XCom 只存引用。否则 Metadata DB 膨胀、UI 变慢、序列化和安全风险都会增加。

## 5. Asset 驱动

Asset 表达“某份数据已经更新”，下游可在资产更新后调度。它比手工拼跨 DAG Trigger 更接近数据依赖，但仍需定义生产完成标准、迟到更新、重复事件和数据质量门禁。

## 6. 故障检查

查看 Task Instance 当前状态、依赖未满足原因、尝试次数、Hostname/Executor、日志位置和外部 Job ID。清除状态前先确认外部任务是否仍在运行，否则可能启动两个相同作业。

参考：[Tasks](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html)、[XComs](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/xcoms.html)、[Assets](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/assets.html)。
