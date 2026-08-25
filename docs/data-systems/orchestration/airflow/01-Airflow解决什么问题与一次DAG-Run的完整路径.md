---
title: "Airflow 解决什么问题与一次 DAG Run 的完整路径"
sidebar_label: "01. Airflow 与一次 DAG Run"
sidebar_position: 1
description: "从 DAG Bundle、解析、DagRun、TaskInstance、Executor 到 Worker，分析 Airflow 调度与状态路径。"
tags: [Airflow, DAG, DagRun, TaskInstance, Scheduler]
---

# Airflow 解决什么问题与一次 DAG Run 的完整路径

Airflow 用有向无环图描述批处理任务依赖，并把每次计划运行转化为可观测、可重试、可补数的状态机。它负责“什么时候、按什么依赖、在哪里运行”，真正的数据处理仍由 SQL、Spark、Python、容器或外部系统完成。

## 1. 从代码到可调度状态

```text
DAG作者提交代码
→ DAG Bundle分发/版本可见
→ DAG Processor加载Python并构建DAG对象
→ 校验Import Error与依赖环
→ 序列化DAG写Metadata DB
→ API Server/UI展示
→ Scheduler读取序列化DAG
```

Airflow 3 中 DAG Processor 是独立必需组件，Scheduler 不需要直接执行 DAG 作者代码。旧版本或不同部署的组件边界可能不同，排障必须先确认版本。

## 2. 一次 DAG Run 的完整路径

```text
Timetable判断数据区间已结束
→ Scheduler创建DagRun(logical_date/data_interval)
→ 为DAG中的Task创建/评估TaskInstance
→ 检查上游、Trigger Rule、Pool、并发和依赖
→ 状态进入scheduled/queued
→ Executor接收执行请求
→ Local进程/Celery Worker/Kubernetes Pod运行Task
→ Task心跳、日志和结果
→ Metadata DB更新success/failed/up_for_retry等状态
→ Scheduler推进下游并完成DagRun
```

DAG Run 的 Logical Date 表示数据区间语义，不等于任务实际启动时刻。日任务通常在覆盖的数据区间结束后才被创建，看起来像“晚一天”是常见误解。

## 3. 三类状态必须区分

| 状态 | 保存位置 | 示例 |
| --- | --- | --- |
| 编排状态 | Metadata DB | DagRun、TaskInstance、XCom、Pool |
| 任务运行状态 | Worker/Task Pod/外部系统 | 进程、容器、Spark Job |
| 业务数据状态 | 数据库/湖仓/对象存储 | 分区是否完整、事务是否提交 |

TaskInstance `success` 不能自动证明业务数据正确；进程退出 0 可能写出空分区。DAG 必须有数据质量、行数、Checksum 或业务水位验收。

## 4. Executor 的位置

Executor 是 Scheduler 使用的任务执行适配层，而不一定是独立服务：

- LocalExecutor：在 Scheduler 所在环境启动本地任务进程；
- CeleryExecutor：把任务发送到 Broker，由长期 Worker 执行；
- KubernetesExecutor：为 TaskInstance 创建独立 Worker Pod；
- 其他 Provider Executor：提交到对应云或批处理平台。

Executor 决定隔离、弹性和依赖分发，但不负责 DAG 依赖判断。

## 5. Retry 与幂等

Task 超时、Worker 退出、Scheduler 恢复或人工 Clear 都可能再次执行。任务应按数据区间和业务主键幂等：

```text
读取data_interval_start/end
→ 写临时分区/事务
→ 验证完整性
→ 原子发布目标分区
→ 重跑覆盖同一逻辑区间而不重复追加
```

不要使用 `now()` 隐式决定输入范围，否则 Backfill 会读取错误数据。XCom 适合小型控制信息，不适合传大数据集。

## 6. 为什么任务没有运行

```text
DAG不可见
├─ DAG Bundle未同步
├─ Import Error/解析超时
└─ DAG被暂停

DagRun不存在
├─ start_date/timetable/data interval
├─ catchup/max_active_runs
└─ Scheduler未运行或DB慢

Task未排队
├─ 上游/trigger_rule
├─ Pool/并发/优先级
└─ depends_on_past等依赖

Task已排队不运行
├─ Executor/Broker/Worker
├─ Kubernetes调度/PVC/镜像
└─ Queue或资源不足
```

## 7. 关键时间指标

- DAG Parse Duration 与最新序列化时间；
- Scheduler Heartbeat 和 Loop Duration；
- DagRun 创建延迟；
- Task `scheduled → queued → running` 延迟；
- Task 执行时间和 Retry 次数；
- 数据区间结束到业务数据可用的端到端延迟。

任务运行 5 分钟但排队 50 分钟时，优化 Python 代码不是首要方向。

## 8. 验收实验

创建一个三任务 DAG，故意加入 Import Error、Pool=0、上游失败、Retry 和人工 Clear；逐次观察 DAG Processor、Metadata DB、Scheduler、Executor 和 Worker 证据。最后对同一 Data Interval 连续运行两次，证明业务输出幂等。

参考：[Airflow Architecture Overview](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/overview.html)、[DAG Runs](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html)。
