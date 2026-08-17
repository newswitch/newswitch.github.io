---
title: Spark Submit、SQL、History Server 与排障命令手册
sidebar_label: "90. Spark Submit、SQL、History Server 与排障命令手册"
sidebar_position: 90
description: 覆盖 Spark 作业提交、交互式验证、SQL 执行、事件日志、REST API，以及 YARN/Kubernetes 环境的故障定位。
tags: [Spark, 命令手册, 性能分析, 故障排查]
---

# Spark Submit、SQL、History Server 与排障命令手册

Spark 命令要围绕应用生命周期学习：**准备依赖 → 提交 Driver → 申请 Executor → 执行 Job/Stage/Task → 保存事件日志 → 失败后还原现场**。

## 1. 安全分级与基础检查

- `[R]`：只读查询或本地解释计划。
- `[W]`：提交任务、写表或修改会话。
- `[D]`：终止任务、覆盖数据或大规模重算。

```bash
export SPARK_HOME=/opt/spark

$SPARK_HOME/bin/spark-submit --version
$SPARK_HOME/bin/spark-submit --help
$SPARK_HOME/bin/spark-sql --help
```

先记录 Spark、JDK、Scala/Python、Hadoop 客户端及依赖版本。很多 `ClassNotFoundException` 和序列化错误都来自运行时版本不一致。

## 2. spark-submit 的通用结构

```bash
$SPARK_HOME/bin/spark-submit \
  --master <cluster-manager> \
  --deploy-mode <client|cluster> \
  --name <application-name> \
  --class <main-class> \
  --conf key=value \
  <application.jar> [application-arguments]
```

需要先理解两个位置：

- `client`：Driver 在提交命令所在进程运行，适合交互和调试；终端退出可能影响应用。
- `cluster`：Driver 由集群管理器托管，更适合生产任务。

## 3. Local、YARN 与 Kubernetes 提交示例

```bash
# [W] 本地模式，使用 4 个线程
$SPARK_HOME/bin/spark-submit \
  --master local[4] \
  --class com.example.WordCount \
  app.jar input output

# [W] YARN cluster 模式
$SPARK_HOME/bin/spark-submit \
  --master yarn --deploy-mode cluster \
  --name daily-etl \
  --class com.example.DailyEtl \
  --driver-memory 2g \
  --executor-memory 4g \
  --executor-cores 2 \
  --num-executors 10 \
  app.jar --date 2026-08-10

# [W] Kubernetes cluster 模式
$SPARK_HOME/bin/spark-submit \
  --master k8s://https://kubernetes.default.svc \
  --deploy-mode cluster \
  --name daily-etl \
  --class com.example.DailyEtl \
  --conf spark.kubernetes.container.image=registry.example/spark-app:1.0.0 \
  --conf spark.kubernetes.namespace=data \
  local:///opt/spark/app/app.jar --date 2026-08-10
```

资源参数不是越大越好：

- Executor 太大：GC 暂停更长，失败重算代价更高。
- Executor 太小：调度开销、连接数和 shuffle 文件数上升。
- Core 太多：单 JVM 并发高，内存和 GC 压力可能放大。
- 固定 Executor 数与动态资源分配不要混用成互相矛盾的策略。

密码、Token 和云密钥不要直接写在 `--conf` 命令行中。使用集群的 Secret、Credential Provider 或权限受控配置文件。

## 4. 依赖与配置定位

```bash
# [R] 查看 Spark 读取到的全部 SQL 配置
$SPARK_HOME/bin/spark-sql -e "SET -v"

# [W] 提交时分发 jar、文件或 Python 依赖
$SPARK_HOME/bin/spark-submit \
  --jars /path/connector.jar \
  --files /path/app.conf \
  --py-files dependencies.zip \
  app.py
```

依赖排查顺序：应用包是否包含 → `--jars/--packages` 是否分发 → Driver 和 Executor classpath 是否一致 → 连接器是否与 Spark/Scala 版本兼容。

## 5. 交互式 Shell 与 SQL

```bash
# [W] Scala / Python 交互环境
$SPARK_HOME/bin/spark-shell --master local[4]
$SPARK_HOME/bin/pyspark --master local[4]

# [R/W] SQL 交互环境
$SPARK_HOME/bin/spark-sql

# [R] 执行一条只读 SQL
$SPARK_HOME/bin/spark-sql -e "SHOW DATABASES"

# [R/W] 执行脚本；脚本是否写数据由 SQL 内容决定
$SPARK_HOME/bin/spark-sql -f check_orders.sql
```

常用 SQL 诊断：

```sql
SHOW DATABASES;
SHOW TABLES IN analytics;
DESCRIBE EXTENDED analytics.orders;
SHOW CREATE TABLE analytics.orders;

EXPLAIN FORMATTED
SELECT customer_id, sum(amount)
FROM analytics.orders
GROUP BY customer_id;
```

查看计划时重点寻找：

- `Exchange`：发生 shuffle，关注分区数和网络量。
- `BroadcastHashJoin`：广播侧必须足够小。
- `SortMergeJoin`：通常伴随两侧 shuffle 和排序。
- `FileScan` 的 `PartitionFilters` / `PushedFilters`：判断分区裁剪和谓词下推。
- `AdaptiveSparkPlan`：AQE 是否开启，运行时计划是否完成。

## 6. 事件日志与 History Server

Spark UI 的实时端口通常从 4040 开始，但应用结束后页面会消失。生产环境应开启事件日志并部署 History Server。

```properties
spark.eventLog.enabled=true
spark.eventLog.dir=hdfs:///spark-history
spark.history.fs.logDirectory=hdfs:///spark-history
```

```bash
# [W] 启动 History Server；生产环境通常由 systemd 或平台管理
$SPARK_HOME/sbin/start-history-server.sh

# [R] 检查 HDFS 事件日志目录
hdfs dfs -ls -h hdfs:///spark-history
```

事件日志目录需要正确的写入权限、保留策略和容量监控。没有事件日志时，历史性能问题通常只能依赖残缺的 Driver 日志推断。

## 7. Spark UI REST API

运行中应用可访问 Driver UI；已结束应用通常访问 History Server：

```bash
# [R] 列出应用及 attempt
curl -s http://spark-history:18080/api/v1/applications

# [R] 依次查看 Jobs、Stages、Executors
curl -s http://spark-history:18080/api/v1/applications/<app-id>/jobs
curl -s http://spark-history:18080/api/v1/applications/<app-id>/stages
curl -s http://spark-history:18080/api/v1/applications/<app-id>/executors
```

高可用或多次尝试的应用可能需要在 URL 中带 attempt。先从 applications 返回值确认实际标识，不要猜。

关键判断：

- Executors：输入、shuffle 读写、GC 时间、失败任务和峰值内存。
- Stages：最大/中位 Task 时长、shuffle 倾斜、失败原因。
- Jobs：失败 Stage、SQL 描述和执行时间线。

## 8. YARN 环境排障

```bash
# [R]
yarn application -list -appStates RUNNING
yarn application -status <application-id>
yarn logs -applicationId <application-id>

# [D] 终止应用
yarn application -kill <application-id>
```

YARN cluster 模式下，先从 ApplicationMaster/Driver 日志找根因，再看失败 Executor。`Container killed by YARN for exceeding memory limits` 不等于只需增加堆内存，还要检查 memory overhead、堆外内存、Python worker 和数据膨胀。

## 9. Kubernetes 环境排障

```bash
# [R]
kubectl -n data get pods -l spark-app-selector=<spark-app-id> -o wide
kubectl -n data describe pod <driver-pod>
kubectl -n data logs <driver-pod>
kubectl -n data logs <executor-pod> --previous
kubectl -n data get events --sort-by=.lastTimestamp

# [D] 删除 Driver Pod 通常等于终止应用
kubectl -n data delete pod <driver-pod>
```

常见证据：`Pending` 看调度事件与资源；`ImagePullBackOff` 看镜像和凭据；`OOMKilled` 看容器限制、堆和 overhead；Executor 被驱逐看节点压力和 QoS。

## 10. 三类高频性能问题

### 10.1 数据倾斜

特征是同一 Stage 中少数 Task 远慢于中位数，且其 shuffle read 明显更大。先确认倾斜 key，再选择 AQE skew join、预聚合、拆分热点 key 或重新分区，不要直接无脑增加 Executor。

### 10.2 小文件

特征是文件数量巨大、每个 Task 输入很小、调度时间占比高。检查上游分区设计和写出并发；`coalesce`、合理 `repartition`、表格式 compaction 都可能解决，但要根据是否需要 shuffle 选择。

### 10.3 内存与 Fetch Failure

- Driver OOM：collect/toPandas、广播元数据、过多 Task 或结果回传。
- Executor OOM：单分区过大、缓存、聚合状态、堆外内存不足。
- Fetch Failure：先看提供 shuffle 数据的 Executor 是否丢失，再查节点、磁盘、网络和超时；它常是上游失败的后果。

## 11. 标准排障模板

```text
应用 ID / SQL 执行 ID
  → Driver 是否存活、首个异常是什么
  → Executor 是否正常注册和稳定
  → 失败 Job / Stage / Task
  → 输入、Shuffle、GC、内存和长尾
  → YARN Container 或 Kubernetes Pod 证据
  → 数据分布、依赖和下游系统
```

不要从日志最后一行开始猜。保存完整 Driver 日志，搜索第一个 `Caused by`、失败 Stage 和对应 Executor，再与 UI 时间线对齐。

## 12. 30 分钟实验

1. 用 local 模式运行 Spark 示例程序。
2. 用 `spark-sql` 创建小表，执行聚合和 `EXPLAIN FORMATTED`。
3. 找出计划中的 Scan、Exchange、Join 和 Aggregate。
4. 开启事件日志并完成一次任务，随后在 History Server 中找到它。
5. 调用 REST API，比较两个 Executor 的输入、shuffle 和 GC 时间。
6. 人为制造一个热点 key，观察 Task 长尾，再修改分区或聚合策略。

## 13. 掌握标准

- 能解释 master、deploy mode、Driver 和 Executor 的位置关系。
- 能从物理计划识别扫描、裁剪、Join 和 Shuffle。
- 能通过事件日志还原已结束任务。
- 能把 OOM、长尾和 Fetch Failure 定位到具体 Stage/Task/节点。
- 能在 YARN 与 Kubernetes 环境完成同一套证据链排查。

## 官方参考

- [Submitting Applications](https://spark.apache.org/docs/latest/submitting-applications.html)
- [Monitoring and Instrumentation](https://spark.apache.org/docs/latest/monitoring.html)
- [Spark SQL](https://spark.apache.org/docs/latest/sql-programming-guide.html)

