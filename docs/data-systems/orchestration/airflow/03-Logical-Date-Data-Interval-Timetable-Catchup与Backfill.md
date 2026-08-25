---
title: "Airflow Logical Date、Data Interval、Timetable、Catchup 与 Backfill"
sidebar_label: "03. 时间语义与补数"
sidebar_position: 3
description: "理解 Airflow 的逻辑时间、数据区间和调度边界，设计不会错一天、重跑可复现的补数流程。"
tags: [Airflow, Logical Date, Data Interval, Backfill]
---

# Airflow Logical Date、Data Interval、Timetable、Catchup 与 Backfill

Airflow 的任务在 2 日凌晨运行，不一定处理 2 日数据。调度时间、Logical Date、Data Interval、实际开始时间和业务分区是五个不同概念。时间语义不清，是漏跑、重复和“错一天”的主要来源。

## 1. 核心时间

| 名称 | 回答的问题 |
| --- | --- |
| Logical Date | 这次 DagRun 代表哪个逻辑周期 |
| Data Interval | 本次应处理的半开区间 `[start, end)` |
| Run After | 区间结束后最早何时创建运行 |
| Start Date | 从哪个边界开始参与调度，不是立即执行时间 |
| Actual Start | Worker 真正开始执行的墙上时间 |

日调度 `0 0 * * *` 的区间通常结束后才可运行，因为只有到次日零点，前一天数据才完整。

## 2. Timetable

Cron 表达固定日历边界；Delta 表达相对间隔；自定义 Timetable 可表达交易日、结算日和特殊业务窗口。选择前先写清时区、夏令时、节假日和迟到数据规则。

DAG 和业务分区统一使用带时区时间。不要在任务内部用 `datetime.now()` 推导分区，否则补跑历史日期时仍会处理“今天”。应从模板上下文使用 `data_interval_start/end`。

## 3. Catchup 与 Backfill

`catchup=True` 允许 Scheduler 为过去尚未创建的区间补建 DagRun；Backfill 是显式对历史区间执行。二者都要求任务幂等，并受并发、Pool 和下游容量约束。

补数前回答：

- 哪些 Data Interval 缺失，是否包含边界；
- 重跑是覆盖分区、Upsert，还是追加；
- 上游历史数据是否仍可读取；
- 补数是否会触发通知、账务或外部副作用；
- 在线任务和补数如何共享 Pool。

## 4. 安全补数流程

1. 列出区间和预期分区，选择小区间试跑；
2. 冻结 DAG 版本与依赖镜像，保存参数；
3. 将补数放入独立 Pool/Queue 限速；
4. 每个分区先写临时结果，校验后原子替换；
5. 对比源/目标行数、聚合、最大事件时间；
6. 记录 DagRun、代码版本和修复清单。

## 5. 必做实验

建立 UTC 与 Asia/Shanghai 两个 DAG，观察日边界；修改 `start_date` 和 `catchup`；手工触发时传入参数；对三个历史区间 Backfill；让其中一个区间失败后只重跑该 Task，验证结果不重复。

参考：[Airflow Dag Run](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html)、[Timetables](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/timetable.html)。
