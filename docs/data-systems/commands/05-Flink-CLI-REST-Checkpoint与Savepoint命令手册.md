---
title: Flink CLI、REST、Checkpoint 与 Savepoint 命令手册
sidebar_position: 5
description: 从作业提交、状态查看和 SQL Client，到 Checkpoint、Savepoint、恢复升级、REST 指标与 Kubernetes Operator 排障。
tags: [Flink, 命令手册, 流计算, Checkpoint, Savepoint]
---

# Flink CLI、REST、Checkpoint 与 Savepoint 命令手册

Flink 运维的核心不是“重启 Job”，而是保护状态一致性。先分清：

- **Checkpoint**：系统周期性触发，用于故障自动恢复。
- **Savepoint**：人为触发、长期保留，用于升级、迁移和受控恢复。
- **Cancel**：立即取消，通常不会自动生成 Savepoint。
- **Stop with Savepoint**：先生成 Savepoint，再以受控方式停止作业。

## 1. 安全分级与环境

- `[R]`：查看状态、计划和指标。
- `[W]`：提交作业、触发 Savepoint。
- `[D]`：取消、停止、恢复、删除 Savepoint，可能影响服务和状态。

```bash
export FLINK_HOME=/opt/flink

$FLINK_HOME/bin/flink --version
$FLINK_HOME/bin/flink --help
$FLINK_HOME/bin/flink run --help
```

命令行参数会随版本和部署模式变化。生产操作前在目标集群版本执行子命令 `--help`。

## 2. 作业查看与提交

```bash
# [R] 查看运行中和已调度作业
$FLINK_HOME/bin/flink list

# [R] 同时查看运行、调度和已结束作业
$FLINK_HOME/bin/flink list -a

# [R] 在提交前查看程序执行计划
$FLINK_HOME/bin/flink info app.jar --input s3://bucket/input

# [W] 后台提交，默认并行度 8
$FLINK_HOME/bin/flink run -d -p 8 \
  -c com.example.StreamJob \
  app.jar --input kafka --output iceberg
```

记录返回的 Job ID。它贯穿日志、REST、指标、Checkpoint 和 Savepoint 操作。

## 3. Cancel、Stop 和 Savepoint

```bash
# [W] 为运行中作业触发 Savepoint
$FLINK_HOME/bin/flink savepoint <job-id> s3://flink/savepoints

# [D] 生成 Savepoint 后停止作业
$FLINK_HOME/bin/flink stop \
  --savepointPath s3://flink/savepoints \
  <job-id>

# [D] 直接取消；是否保留可恢复状态取决于已有 Checkpoint/外部化配置
$FLINK_HOME/bin/flink cancel <job-id>

# [D] 从指定 Savepoint 恢复并提交新作业
$FLINK_HOME/bin/flink run -d \
  -s s3://flink/savepoints/savepoint-xxxx \
  -c com.example.StreamJob app-v2.jar

# [D] 确认不再需要后删除 Savepoint 元数据和状态文件
$FLINK_HOME/bin/flink savepoint -d \
  s3://flink/savepoints/savepoint-xxxx
```

部分版本支持 `--type native|canonical`。Native 通常更快但可移植性较弱；Canonical 更偏向兼容升级。必须结合状态后端和版本文档选择。

恢复前检查：

1. 新程序中的有状态算子是否设置稳定的 `uid`。
2. 状态序列化器是否兼容。
3. 并行度变化是否超过 max parallelism 的约束。
4. Source/Sink 是否支持预期的一致性语义。
5. Savepoint 路径对 JobManager 和 TaskManager 都可读。

不要把“用了 Savepoint”等同于“升级必然成功”。

## 4. Checkpoint 的判断方法

需要同时观察：

- 最近一次完成时间与端到端耗时。
- 连续失败次数与失败原因。
- Alignment 时长和被对齐数据量。
- 状态大小、持久化数据大小与增长速度。
- 各 Subtask 的长尾。

典型现象：

| 现象 | 可能原因 | 下一步 |
|---|---|---|
| Checkpoint 超时 | 反压、状态大、存储慢 | 看算子反压、Subtask 明细、存储延迟 |
| Alignment 很慢 | 上游分区流量不均、反压 | 比较通道与 Subtask，评估非对齐 Checkpoint |
| 状态持续膨胀 | TTL 缺失、key 基数增长 | 查状态描述、业务 key 和清理策略 |
| 多次失败后作业重启 | 存储权限、网络、状态后端 | 先读 Checkpoint 失败原因，不要只增大超时 |

## 5. REST API 只读排查

JobManager REST 地址通常由平台暴露。以下示例仅查询：

```bash
export FLINK_REST=http://flink-jobmanager:8081

# [R] 集群总览和 Job 列表
curl -s "$FLINK_REST/overview"
curl -s "$FLINK_REST/jobs/overview"

# [R] Job 详情、异常与 Checkpoint
curl -s "$FLINK_REST/jobs/<job-id>"
curl -s "$FLINK_REST/jobs/<job-id>/exceptions"
curl -s "$FLINK_REST/jobs/<job-id>/checkpoints"

# [R] 先列出某个 Job 可查询的指标
curl -s "$FLINK_REST/jobs/<job-id>/metrics"

# [R] 再选择指标；名称以实际返回为准
curl -s "$FLINK_REST/jobs/<job-id>/metrics?get=uptime,restartingTime"
```

REST 会返回 JSON。生产中用监控系统长期采集，临时 `curl` 用于复核现场。接口路径和字段可能随版本演进，以对应版本 REST 文档为准。

## 6. 找到反压和慢算子

先从 Job 详情得到 vertex ID，再逐层定位：

```bash
# [R] 查看某个算子/vertex 的 Subtask 明细
curl -s "$FLINK_REST/jobs/<job-id>/vertices/<vertex-id>"

# [R] 查询该 vertex 支持的指标
curl -s "$FLINK_REST/jobs/<job-id>/vertices/<vertex-id>/metrics"
```

重点比较各 Subtask 的：

- `busyTimeMsPerSecond`：算子忙碌程度。
- `backPressuredTimeMsPerSecond`：因下游处理不动而受压。
- `idleTimeMsPerSecond`：没有输入或等待上游。
- records/bytes in/out：吞吐与分区是否倾斜。

判断链：下游算子忙 → 上游反压 → Source 降速 → Kafka Lag 增长。Flink 的“消费慢”可能只是下游存储变慢的外在表现。

## 7. SQL Client

```bash
# [R/W] 进入交互式 SQL Client
$FLINK_HOME/bin/sql-client.sh
```

```sql
SHOW CATALOGS;
SHOW DATABASES;
SHOW TABLES;
DESCRIBE orders;

EXPLAIN
SELECT customer_id, SUM(amount)
FROM orders
GROUP BY customer_id;

SET;
```

执行 `INSERT INTO` 会启动持续运行的流作业；先 `EXPLAIN`，确认 Source、Exchange、Stateful Operator、Sink 以及 changelog 模式。

## 8. Kubernetes 与 Flink Kubernetes Operator

若由 Operator 管理，不应绕过它直接长期修改底层 Deployment。先查自定义资源：

```bash
# [R]
kubectl -n data get flinkdeployments
kubectl -n data describe flinkdeployment <name>
kubectl -n data get flinkdeployment <name> -o yaml
kubectl -n data get pods -l app=<name> -o wide
kubectl -n data logs <jobmanager-pod>
kubectl -n data logs <taskmanager-pod> --previous
kubectl -n data get events --sort-by=.lastTimestamp
```

重点对齐三层状态：FlinkDeployment 期望状态、JobManager 看到的 Job 状态、Pod/Node 的实际状态。Operator 的升级模式可能是 stateless、last-state 或 savepoint，修改前必须确认其语义。

## 9. 日志排查顺序

```text
作业状态与 Job ID
  → 第一次失败时间
  → JobManager 根异常和重启策略
  → 对应 TaskManager / Subtask
  → Checkpoint、反压和状态大小
  → Kafka、对象存储、数据库等外部依赖
  → Kubernetes Pod / Node 事件
```

常见错误：

- `Checkpoint expired before completing`：查长尾、反压和存储，不只改 timeout。
- `Could not materialize checkpoint`：查状态后端权限、容量、网络和 IO。
- `No space left on device`：区分 TaskManager 本地临时盘与远端状态存储。
- `Cannot map checkpoint/savepoint state`：查算子 UID 与状态兼容性。
- `OutOfMemoryError: Direct buffer memory`：网络内存或直接内存，不一定是 Java Heap。

## 10. 安全升级 Runbook

1. 保存当前 Job ID、版本、并行度、配置和最近 Checkpoint 状态。
2. 触发 Savepoint，并验证目标路径存在且可读。
3. 用新包在测试环境从该 Savepoint 恢复。
4. 检查算子 UID、状态恢复、Source Offset、Sink 一致性和指标。
5. 生产执行 `stop --savepointPath`。
6. 从明确的 Savepoint 路径提交新版本。
7. 比较输入/输出、Lag、Checkpoint 和业务对账。
8. 失败时停止新版本，从原 Savepoint 启动旧包。

## 11. 30 分钟实验

1. 提交一个带状态的 WordCount 作业并记录 Job ID。
2. 使用 CLI 和 REST 同时找到它。
3. 查看 vertex、Subtask 和 Checkpoint 详情。
4. 触发 Savepoint，然后用 `stop` 停止。
5. 从 Savepoint 以不同并行度恢复。
6. 解释恢复后的状态为何没有丢失，并验证输出是否重复。

## 12. 掌握标准

- 能解释 Checkpoint、Savepoint、Cancel 和 Stop 的边界。
- 能从 REST 指标定位反压源头和热点 Subtask。
- 能设计带验证与回滚的有状态升级流程。
- 能把 Kafka Lag、Flink 反压、Checkpoint 和 Sink 延迟串成一条链。
- 能在 Operator 环境区分声明状态、Job 状态和 Pod 状态。

## 官方参考

- [Flink Command-Line Interface](https://nightlies.apache.org/flink/flink-docs-stable/docs/deployment/cli/)
- [Flink REST API](https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/rest_api/)
- [Flink Checkpoints](https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/state/checkpoints/)
- [Flink Savepoints](https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/state/savepoints/)

