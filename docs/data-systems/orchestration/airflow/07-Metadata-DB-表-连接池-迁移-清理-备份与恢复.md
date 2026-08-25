---
title: "Airflow Metadata DB：表、连接池、迁移、清理、备份与恢复"
sidebar_label: "07. Metadata DB 生产治理"
sidebar_position: 7
description: "理解 Metadata DB 为什么是 Airflow 控制面的事实源，并掌握性能、迁移、清理和灾备。"
tags: [Airflow, Metadata Database, Migration, Backup]
---

# Airflow Metadata DB：表、连接池、迁移、清理、备份与恢复

Metadata DB 保存 DagRun、TaskInstance、调度状态、序列化 DAG、连接元数据和迁移版本。Scheduler、API Server、DAG Processor、Triggerer 和 Worker 都通过它协调。数据库慢时，整个 Airflow 看起来都会“随机变慢”。

## 1. 关键数据类别

| 类别 | 用途 | 风险 |
| --- | --- | --- |
| DagRun/TaskInstance | 状态机与调度依据 | 数据量随运行次数增长 |
| Serialized DAG | Scheduler/UI 使用的解析结果 | 频繁更新增加 DB 压力 |
| XCom | 小型任务通信 | 大对象导致表和 UI 膨胀 |
| Log/Job/Callback 状态 | 心跳、作业与事件 | 心跳延迟影响 Zombie 判断 |
| Alembic Version | Schema 迁移版本 | 升降级必须匹配代码 |

## 2. 连接容量

总连接上限来自各组件副本数乘以进程/并发，再叠加 SQLAlchemy Pool。不能简单把 `pool_size` 都调大。优先使用受支持数据库，设置连接回收、健康检查和超时；在连接数很高时评估 PgBouncer 等代理，但要验证事务/会话模式兼容。

监控连接利用率、事务时延、锁、慢 SQL、表/索引增长、Autovacuum 和磁盘。Scheduler Loop 变慢时要把 DB 指标与调度指标放在同一时间轴。

## 3. 迁移

升级前执行兼容检查并备份，在维护窗口由单个受控 Job 执行 `airflow db migrate`。先在生产数据副本上测迁移时长、锁和回滚方案。应用版本与 DB Schema 必须成对发布，不能只回滚镜像而忽略不可逆 Schema。

## 4. 清理

历史记录、XCom、审计和序列化数据要按合规与排障窗口制定保留策略。使用 Airflow 支持的清理命令，不直接随意删关联表。清理前备份、预估行数，清理后执行数据库维护并验证正在运行的 DagRun 未受影响。

## 5. 备份恢复

备份包含数据库、Airflow 配置、Fernet Key、Web/API Secret、DAG 代码版本、Provider/镜像和远程日志索引。没有同一个 Fernet Key，加密的 Connection 无法解密。

恢复演练：还原到隔离环境；部署完全匹配版本；执行迁移检查；确认 DAG/Task 状态；禁用会产生外部副作用的 DAG；再决定哪些运行重试、标记失败或人工对账。

## 6. RPO/RTO

Metadata DB 的 RPO 决定可能丢失多少调度状态，RTO 决定平台多久恢复。即使 DB 零丢失，外部任务可能已执行但状态未回写，因此恢复后必须对账外部 Job，不能批量盲目重跑。

参考：[Set up a Database Backend](https://airflow.apache.org/docs/apache-airflow/stable/howto/set-up-database.html)、[Database Maintenance](https://airflow.apache.org/docs/apache-airflow/stable/howto/usage-cli.html#purge-history-from-metadata-database)。
