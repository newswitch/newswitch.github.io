---
title: "Airflow DAG、依赖、补数、重试与幂等调度"
sidebar_label: "02. Airflow DAG、依赖、补数、重试与幂等调度"
sidebar_position: 2
description: "从 Data Interval 和 Task Instance 设计可重跑、可补数、可观测的数据工作流。"
tags: [Airflow, DAG, Backfill, 幂等, 调度]
---

# Airflow DAG、依赖、补数、重试与幂等调度

Airflow 编排“何时运行哪些任务以及依赖”，不替 Spark/Flink 执行大规模数据，也不自动保证任务幂等。DAG Run 对应一次运行，Task Instance 是某任务在某 data interval 的具体实例。

## 1. 时间语义

业务数据日期、data interval、logical date 和实际启动时间要区分。日任务在次日 01:00 运行，处理的通常是前一日区间。SQL/路径应由 interval 参数确定，不能用进程 `now()`，否则补历史时仍读今天。

## 2. DAG 设计

```mermaid
flowchart LR
  A["等待输入资产"] --> B["固定Source Snapshot"]
  B --> C["Transform"] --> D["Data Quality"]
  D --> E["Atomic Publish"] --> F["Notify/Lineage"]
```

任务粒度应有独立重试价值和清晰输入/输出。DAG 拓扑保持稳定，动态配置不应每次解析生成不可预测 ID。大数据文件通过对象存储/表传递，XCom 只传小元数据如 snapshot ID。

## 3. 幂等任务

同一 `(dag_id, task_id, interval, code_version)` 重跑应得到同一逻辑结果。实现：固定输入 snapshot/offset，写 run-specific staging，质量通过后原子发布；目标表按 partition/version overwrite 或主键 Upsert；外部通知用 idempotency key。

不要先删除正式分区再重算；失败窗口会让消费者无数据。先构建新版本再切换。

## 4. Retry

网络抖动可退避重试，认证错误、schema破坏和数据质量失败通常应快速失败。无差别重试会形成请求风暴并延迟告警。设置 execution timeout、总重试窗口和 deadline；任务日志记录 attempt 与错误分类。

## 5. Backfill

补数会同时放大源库、Spark、存储和下游压力。先列出受影响 interval和依赖，固定代码/配置，限制 max active runs/pool，按时间顺序或依赖策略运行。旧区间可能使用旧 schema/业务规则，应明确“按当时代码复现”还是“按新规则重算”。

## 6. Sensor 与资产

轮询 Sensor 长占 worker 会浪费 slot，可使用 reschedule/deferrable机制（按版本能力）。更可靠的是资产/数据条件：输入 snapshot到达、质量通过，而非仅等到某个钟点。

## 7. 资源治理

Pools 限制数据库/API/集群的并发；queue/priority控制紧急任务；DAG和Task并发限制防补数淹没在线。Airflow scheduler健康和任务执行资源分开监控。

## 8. 观测与故障

- schedule delay、queued duration、run duration/deadline；
- task state/attempt、worker heartbeat、executor queue；
- pool使用和阻塞；
- 输入 snapshot、输出版本、质量结果；
- DAG parse/import error、metadata DB延迟；
- 失败通知是否去重。

## 9. 实验

构建 `固定输入→转换→质量→发布` 日 DAG。让转换中途失败并重试，证明正式版本未半发布；补 7 天并限制 pool，观察压力；重复清除同 task，验证结果 checksum和通知不重复。

## 10. 掌握验收

- 区分 data interval 与实际运行时间；
- 设计固定输入和原子发布的幂等 DAG；
- 分类可重试/不可重试错误；
- 为 backfill 设置并发与版本语义；
- 从排队、执行、数据质量三层排障。

上一篇：[Debezium CDC](./01-Debezium-CDC-Binlog快照与Schema-Change.md)　下一篇：[数据质量、契约、元数据与血缘](./03-数据质量数据契约元数据与血缘.md)

## 11. 参考资料 {/* #参考资料 */}

- [Apache Airflow Core Concepts](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/)
- [Airflow DAG Runs and Backfill](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html)
