---
title: "Airflow 2 到 3：Provider、Metadata Migration、DAG 兼容、升级与回滚"
sidebar_label: "13. Airflow 2→3 升级与回滚"
sidebar_position: 13
description: "把 Airflow 大版本升级拆成代码、Provider、数据库、部署和任务恢复五个可验证阶段。"
tags: [Airflow, Upgrade, Airflow 3, Migration]
---

# Airflow 2 到 3：Provider、Metadata Migration、DAG 兼容、升级与回滚

Airflow 升级不是替换一个镜像。Core、Provider、Python 依赖、DAG 公共 API、Metadata Schema、Executor 和 Helm Chart 都可能变化。数据库迁移后，旧镜像不一定能直接回滚。

## 1. 升级资产清单

- 当前 Core、Provider、Python、数据库、Executor 与 Chart 版本；
- 所有 DAG 的 Import、弃用 API、自定义 Plugin/Operator；
- Metadata DB 大小、迁移版本和备份恢复时间；
- 外部 API、认证方式、Fernet/Secret 和日志后端；
- 正在运行、Deferred、Backfill 和长期任务。

用官方升级检查与静态扫描清理弃用项。Airflow 3 强调稳定 Public Interface，旧内部模块导入必须迁移到支持路径。

## 2. 分阶段流程

1. 在当前大版本升级到受支持的最新小版本；
2. 固定 Constraints，升级并测试 Provider；
3. 用生产 DB 脱敏副本测 Migration 时长和锁；
4. 在预生产回放典型 DAG：时间语义、XCom、Sensor、Executor、API；
5. 冻结 DAG 变更，备份 DB 与配置；
6. 暂停调度或按官方流程排空关键任务；
7. 单点执行 DB Migration，再发布所有组件；
8. 运行 Canary DAG，逐批恢复业务 DAG。

## 3. 回滚边界

回滚分三类：应用镜像回滚、DAG/Provider 回滚、数据库恢复。若 DB Schema 不向后兼容，必须恢复升级前数据库备份，这意味着 RPO 窗口内新状态会丢失；外部任务可能已成功，需要人工对账。

预先定义停止条件：Import Error 超阈值、Scheduler Lag 失控、状态无法回写、关键 DAG 行为变化或 DB 性能异常。不要等所有 DAG 都失败才回滚。

## 4. 验收

比较升级前后 DagRun 创建时间、Task 状态转换、Executor 提交、远程日志、Secret、API、Triggerer 和关键 SLA。观察至少覆盖一个高峰和一个历史补数周期，再清理旧镜像与备份。

参考：[Airflow Upgrading](https://airflow.apache.org/docs/apache-airflow/stable/installation/upgrading.html)、[Airflow 3 Public Interface](https://airflow.apache.org/docs/apache-airflow/stable/public-airflow-interface.html)。
