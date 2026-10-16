---
title: "API Server、Scheduler、DAG Processor、Triggerer、Executor 与 Metadata DB"
sidebar_label: "02. Airflow 组件与状态协调"
sidebar_position: 2
description: "拆解 Airflow 3 控制面组件、数据库交互、任务执行和高可用边界。"
tags: [Airflow, API Server, Scheduler, DAG Processor, Triggerer, Metadata DB]
---

# API Server、Scheduler、DAG Processor、Triggerer、Executor 与 Metadata DB

Airflow 是多个进程围绕 Metadata DB 协调的分布式控制系统。API Server、Scheduler、DAG Processor、Triggerer 和 Worker 可以水平扩展，但数据库性能和状态正确性决定整个控制面的上限。

## 1. 组件地图

```text
DAG Bundle ──→ DAG Processor ──serialized DAG──┐
                                               │
User/UI ──→ API Server ────────────────────────┤
                                               ▼
                                         Metadata DB
                                               ▲
Timetable/Dependencies ← Scheduler + Executor ─┤
                                  │            │
                                  ▼            │
                       Worker/Task Pod ─────────┘

Deferrable Task ↔ Triggerer ↔ Metadata DB
```

## 2. DAG Processor

DAG 文件是 Python 代码。Processor 从 DAG Bundle 读取指定版本，在隔离进程中导入、构建 DAG、检查错误并把序列化表示写入数据库。

常见瓶颈：

- 顶层代码访问数据库/网络；
- DAG 数量和文件体积过大；
- Python 依赖导入慢；
- Bundle 同步延迟或版本不一致；
- 解析超时、内存泄漏；
- 动态生成大量 DAG/Task。

最佳实践是让顶层代码只做确定性的 DAG 定义，把远程查询放入 Task 执行阶段。

## 3. Scheduler

Scheduler 持续执行循环：创建需要的 DagRun、检查可调度 TaskInstance、应用 Pool/并发/依赖，把任务交给 Executor，并检测超时/Zombie 等异常。

多个 Scheduler 通过 Metadata DB 锁和事务协调，不需要另一个 ZooKeeper/Raft 集群。高可用依赖数据库支持、正确隔离级别、索引、连接池和低延迟。

Scheduler `Running` 不代表循环健康，要看 Heartbeat、Loop 时间、排队延迟和数据库错误。

## 4. Executor

Executor 运行在 Scheduler 进程的控制范围内，通过统一接口接收 TaskInstance：

```text
Scheduler queue task
→ Executor submit
→ Worker mechanism
→ Event/状态回传
→ Scheduler更新TaskInstance
```

不同 Executor 的故障域不同：Local 受单机资源限制；Celery 增加 Broker/Backend/Worker；Kubernetes 增加 API Server、Scheduler、镜像、PVC 和 Pod 启动延迟。

## 5. Triggerer

传统 Sensor 在等待期间占用 Worker Slot。Deferrable Operator 把等待条件交给 Triggerer 的异步事件循环：

```text
Task运行 → defer并释放Worker
→ Trigger在Triggerer中等待外部事件
→ 事件触发
→ Task重新进入可执行队列完成
```

Triggerer 故障不会立即丢失所有等待状态，状态保存在数据库并可恢复，但会延迟事件检测。Trigger 代码必须异步、非阻塞，不能在事件循环中执行长时间同步 I/O。

## 6. API Server

Airflow 3 API Server 提供 UI 和 REST API，操作用户触发 DAG、读取状态和执行受控管理。它不应直接执行 DAG 作者代码。生产使用认证、RBAC、TLS、审计和 API 限流，不能把管理端口暴露公网。

UI 页面慢可能来自 API Server、数据库查询或反向代理，不代表 Scheduler 一定慢。

## 7. Metadata DB

数据库保存 DAG 序列化、DagRun、TaskInstance、XCom、Connection、Variable、Pool、日志元数据和组件心跳等。它不是业务数据仓库，也不应用 XCom 存大 DataFrame。

关键风险：

- 连接数被 Scheduler/Worker/API 打满；
- TaskInstance/XCom/日志元数据膨胀；
- 慢查询和缺失维护；
- 数据库主故障或复制切换；
- Schema Migration 与旧组件并行运行不兼容；
- 时钟或事务锁造成调度延迟。

## 8. Worker 与日志

Worker 实际导入 Task 所需代码和 Provider，执行命令并更新状态。分布式环境必须确保 DAG Bundle 版本、Python 依赖、镜像和 Connection 一致。远程日志应在任务退出后仍可读取，并与 TaskInstance Try Number 对应。

Worker 消失后，Scheduler 会根据心跳和状态判定失败/Zombie 并按重试策略处理，所以任务仍然必须幂等。

## 9. 高可用边界

| 组件 | 扩展方式 | 关键依赖 |
| --- | --- | --- |
| API Server | 多副本 + LB | Metadata DB、认证 Secret |
| Scheduler | 多副本 | 支持 HA 的 Metadata DB |
| DAG Processor | 多实例/Bundle 分片，按版本能力 | DAG Bundle、DB |
| Triggerer | 多副本 | DB、Trigger 容量 |
| Celery Worker | Worker Pool | Broker、DB、DAG/依赖 |
| Kubernetes Task | 每任务 Pod | Kubernetes API、镜像、存储 |

高可用不能只增加 Pod。Metadata DB、Secret、DAG Bundle、日志后端和 Broker 仍可能是单点。

## 10. 验收实验

分别停止 API Server、一个 Scheduler、DAG Processor、Triggerer 和 Worker，记录已有 Task、新 DagRun、Deferred Task、UI 和日志的行为。随后让数据库注入 500 ms 延迟，观察所有组件 Heartbeat 与 Queue Delay，证明 DB 是共享控制面瓶颈。

参考：[Airflow Architecture Overview](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/overview.html)、[Scheduler](https://airflow.apache.org/docs/apache-airflow/stable/concepts/scheduler.html)。
