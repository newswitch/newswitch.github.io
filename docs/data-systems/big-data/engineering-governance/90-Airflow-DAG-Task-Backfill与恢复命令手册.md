---
title: Airflow DAG、Task、Backfill 与恢复命令手册
sidebar_position: 90
description: 掌握 Airflow 环境检查、DAG 导入、任务测试、触发、补数、池、连接和数据库清理，并建立幂等恢复流程。
tags: [Airflow, 命令手册, 调度, Backfill, 故障排查]
---

# Airflow DAG、Task、Backfill 与恢复命令手册

Airflow 调度的是任务，不替任务保证业务幂等。生产恢复必须区分：**DAG 定义、逻辑日期、Dag Run、Task Instance、重试、补数和外部数据副作用**。

本文以 Airflow 3.x 命令组织。Airflow 2.x 的 backfill、DAG 文件参数和部分管理命令位置不同，任何生产命令都先在目标版本执行 `--help`。

## 1. 安全分级与版本基线

- `[R]`：查看配置、DAG、Task、状态和错误。
- `[W]`：测试、触发、暂停/恢复、修改池或变量。
- `[D]`：清理状态、补跑历史区间、删除连接/变量、数据库清理。

```bash
# [R]
airflow version
airflow info
airflow --help
airflow config list
airflow db check
```

记录 Airflow、Python、Executor、Metadata DB、DAG Bundle/目录和 Provider 版本。调度器与 Worker 依赖不一致是常见故障源。

## 2. DAG 发现与导入错误

```bash
# [R]
airflow dags list
airflow dags list-import-errors
airflow dags details <dag-id>
airflow dags show <dag-id>
```

若 Web UI 看不到 DAG，排查顺序：

1. `list-import-errors` 是否有 Python 异常。
2. Scheduler 是否扫描到目标 Bundle/文件。
3. DAG 文件解析是否超时或依赖缺失。
4. DAG ID 是否变化、是否被暂停、开始日期和调度是否合理。
5. Scheduler 心跳和 Metadata DB 是否健康。

不要只重启 Scheduler；先保存导入错误和解析日志。

## 3. Task 列表与本地测试

```bash
# [R]
airflow tasks list <dag-id>
airflow tasks list <dag-id> --tree

# [W] 在隔离上下文测试单个 Task；不会完整模拟生产调度
airflow tasks test <dag-id> <task-id> 2026-08-10

# [W] 测试一个 DAG Run；先查看目标版本参数
airflow dags test --help
airflow dags test <dag-id> 2026-08-10
```

Airflow 3.x 对 DAG 文件参数有调整，旧教程中的 `--subdir` 不应直接照抄；目标版本支持时使用 `-f/--dagfile-path` 一类参数，以 `dags test --help` 为准。

`tasks test` 会真正执行 Operator 代码：如果任务写数据库、发消息、调用 API 或删除文件，它仍可能产生真实副作用。应使用测试环境、测试连接和隔离数据。

## 4. Dag Run 状态与手动触发

```bash
# [R]
airflow dags list-runs --dag-id <dag-id>
airflow tasks states-for-dag-run <dag-id> <logical-date-or-run-id>

# [W] 手动触发，明确 run-id 与配置
airflow dags trigger <dag-id> \
  --run-id manual__2026-08-10_repair_001 \
  --conf '{"business_date":"2026-08-10"}'

# [W] 暂停/恢复新调度
airflow dags pause <dag-id>
airflow dags unpause <dag-id>
```

手动触发前先确认任务到底使用 `logical_date`、`data_interval_start/end`，还是 `dag_run.conf`。把“触发时间”误当“业务日期”会造成错分区。

## 5. Task 状态、重试与清理

```bash
# [R]
airflow tasks state <dag-id> <task-id> <logical-date>

# [D] 清除 Task Instance 会让调度器重新执行它
airflow tasks clear <dag-id> \
  --start-date 2026-08-10 \
  --end-date 2026-08-10 \
  --task-regex '^transform_orders$' \
  --dry-run
```

目标版本若支持 `--dry-run`，必须先预览；否则使用 UI 预览或列出 Task Instance 人工核对。执行实际 clear 前再次查看 `airflow tasks clear --help`，因为确认参数随版本不同。

清理状态不是回滚外部副作用。任务可能已经写入表、对象存储或 API，只是状态没成功提交。重新运行前必须先对账并确认幂等策略。

## 6. Airflow 3.x Backfill

Airflow 3.x 将补数组织为独立的 backfill 命令：

```bash
# [R] 先确认本机语法和 reprocessing 选项
airflow backfill create --help

# [D] 创建历史区间补数
airflow backfill create \
  --dag-id <dag-id> \
  --start-date 2026-08-01 \
  --end-date 2026-08-07 \
  --reprocessing-behavior failed \
  --max-active-runs 2
```

2.x 常见的是 `airflow dags backfill`，不要跨大版本复制命令。若目标部署提供 `airflowctl backfill create-dry-run` 或 UI 预览，先用它核对将创建哪些 Dag Run。

补数前回答：

1. 一个逻辑日期对应什么数据区间？
2. 已成功日期是否重跑，reprocessing behavior 如何选择？
3. 写入是覆盖分区、MERGE、幂等 upsert，还是不可重复 append？
4. 上游原始数据和历史 Schema 是否仍可读取？
5. 最大并发是否会压垮数据库、Kafka、Spark 或存储？
6. 失败后如何停止、对账和恢复？

## 7. Pool 与并发控制

```bash
# [R]
airflow pools list

# [W] 创建或调整池
airflow pools set warehouse_pool 20 "warehouse query slots"

# [D] 删除池前确认没有任务引用
airflow pools delete warehouse_pool
```

并发至少受全局并行度、Executor、DAG `max_active_runs`、`max_active_tasks`、Task 并发和 Pool 共同约束。任务排队时要确认它在等待哪个门槛，而不是盲目扩 Worker。

## 8. Connections 与 Variables

```bash
# [R]
airflow connections list
airflow connections get <conn-id>
airflow variables list
airflow variables get <key>

# [W] 从受控 URI/JSON 或 Secrets Backend 配置
airflow connections add <conn-id> --conn-uri '<connection-uri>'
airflow variables set <key> <value>

# [D]
airflow connections delete <conn-id>
airflow variables delete <key>
```

命令行参数会进入 shell 历史和进程信息。密码、Token、私钥优先放入 Secrets Backend；不要把敏感 Connection URI 或 Variable 写入代码、截图和博客实验输出。

## 9. Metadata DB 运维

```bash
# [R]
airflow db check
airflow db check-migrations

# [R] 查看数据库清理选项
airflow db clean --help

# [R] 目标版本支持时先 dry-run
airflow db clean \
  --clean-before-timestamp '2026-05-01 00:00:00+00:00' \
  --dry-run
```

实际 `db clean` 是 `[D]` 操作。清理前备份 Metadata DB，确认归档表、审计要求和回滚方案。不要在生产中使用 `airflow db reset`；它会破坏元数据库内容。

数据库迁移应由发布流程执行，Scheduler/Web/API/Worker 版本需遵循目标版本升级文档。

## 10. Scheduler、Worker 与日志证据

不同 Executor 的排障入口不同：

```bash
# [R] KubernetesExecutor / KubernetesPodOperator 示例
kubectl -n airflow get pods -o wide
kubectl -n airflow logs <scheduler-pod>
kubectl -n airflow logs <task-pod> --previous
kubectl -n airflow describe pod <task-pod>
kubectl -n airflow get events --sort-by=.lastTimestamp
```

CeleryExecutor 还要查看 Broker、Worker 在线状态和队列；LocalExecutor 重点检查 Scheduler 主机资源和子进程。日志必须能通过 `dag_id / run_id / task_id / map_index / try_number` 关联。

## 11. 三类状态必须分开

| 层次 | 例子 | 失败后怎么验证 |
|---|---|---|
| Airflow 状态 | Dag Run/Task Instance success | Metadata DB、UI/CLI |
| 执行平台状态 | Spark Application、Kubernetes Job | 平台 ID、日志和退出码 |
| 业务数据状态 | 分区、快照、行数、对账指标 | 数据质量与目标系统 |

任务显示 failed，不代表业务数据完全没写；任务显示 success，也不代表数据正确。可靠恢复必须三层对账。

## 12. 标准故障处理顺序

```text
DAG ID / Run ID / Task ID / Try Number
  → DAG 是否正确解析和调度
  → Task Instance 当前状态与依赖
  → Executor 是否真正接收任务
  → 外部作业 ID / Pod / Spark Application
  → 第一条业务异常
  → 外部数据是否已有副作用
  → 选择 retry、clear、trigger 或 backfill
  → 数据质量验收
```

## 13. 30 分钟实验

1. 创建包含 extract、transform、quality 三个任务的实验 DAG。
2. 使用 `dags list`、`tasks list --tree` 检查解析和依赖。
3. 在测试连接上执行 `tasks test`，观察逻辑日期上下文。
4. 手动 trigger 并用 CLI 找到 Run 与 Task 状态。
5. 让 transform 在首次执行后失败，验证外部副作用，再设计幂等重试。
6. 对三天历史数据创建低并发 Backfill，并完成分区级对账。

## 14. 掌握标准

- 能解释逻辑日期、数据区间、Run ID 与真实执行时间。
- 能判断任务重试、clear、手动 trigger 和 backfill 的不同影响。
- 能设计覆盖分区、MERGE 或去重键实现幂等。
- 能识别 Pool、DAG、Executor 和外部系统的并发边界。
- 能把 Airflow 状态、执行平台状态和业务数据状态完成三层对账。

## 官方参考

- [Airflow CLI and Environment Variables Reference](https://airflow.apache.org/docs/apache-airflow/stable/cli-and-env-variables-ref.html)
- [Using the Command Line Interface](https://airflow.apache.org/docs/apache-airflow/stable/howto/usage-cli.html)
- [Backfill](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/backfill.html)
- [Best Practices](https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html)

