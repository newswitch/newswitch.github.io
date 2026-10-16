---
title: "Airflow RBAC、API 认证、Connection、Variable、Secrets Backend 与多租户"
sidebar_label: "11. 安全、Secret 与多租户"
sidebar_position: 11
description: "保护 Airflow 控制面、凭据和任务运行边界，理解共享平台中的多租户隔离限制。"
tags: [Airflow, RBAC, Secrets Backend, Multi-tenancy]
---

# Airflow RBAC、API 认证、Connection、Variable、Secrets Backend 与多租户

Airflow 可以执行任意 Python 和 Shell 任务，因此“能修改 DAG”接近于“能在 Worker 权限下执行代码”。UI RBAC 不是完整的运行时隔离。

## 1. 威胁面

- API/UI 账号可暂停、触发、清除和读取运行信息；
- DAG 作者可能读取环境变量、文件和 Connection；
- Worker ServiceAccount 可能访问 Kubernetes API；
- 日志、XCom 和模板渲染可能泄露 Secret；
- Provider Hook 能访问数据库、云账号和消息系统。

## 2. 身份与 RBAC

生产应接入企业 OIDC/OAuth/SAML 等统一身份，关闭默认账号，启用 TLS、短会话和审计。按 DAG/团队划分最小角色：查看、运行、编辑连接、平台管理分离。API 使用独立服务身份和短期 Token，不共享管理员密码。

## 3. Connection、Variable 与 Secret

Connection 保存外部系统连接；Variable 适合非敏感运行配置；Secret 应放 Vault、AWS Secrets Manager、Kubernetes Secrets 等 Backend。Fernet 只加密 Metadata DB 中部分字段，不替代 Secret Manager，也不能阻止有权运行代码的人主动读取凭据。

Secret 轮换流程要验证旧任务、重试任务和新任务的读取行为。日志 Masking 是最后防线，任务代码仍不应打印完整 URI、Header 或环境变量。

## 4. 多租户边界

共享 Scheduler/DB 的团队仍共享控制面故障域。高信任团队可用 DAG 级 RBAC、Pool、Queue、Namespace 和不同 Worker ServiceAccount；低信任或强合规租户应拆分 Airflow 部署、数据库和云账号。

Kubernetes Pod 隔离需要 Namespace、NetworkPolicy、Pod Security、ResourceQuota、只读 RootFS 和最小 ServiceAccount 配合。只给不同 Queue 不构成安全隔离。

## 5. 安全验收

测试普通用户能否读取/修改其他 DAG、Connection 和运行日志；DAG 是否能访问不应访问的 Secret；Worker 能否创建高权限 Pod；日志是否掩码；API 是否记录审计；备份中的 Fernet Key 与凭据是否分开保管。

参考：[Airflow Security](https://airflow.apache.org/docs/apache-airflow/stable/security/index.html)、[Secrets Backend](https://airflow.apache.org/docs/apache-airflow/stable/security/secrets/secrets-backend/index.html)。
