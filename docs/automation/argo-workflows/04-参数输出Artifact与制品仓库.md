---
title: "Argo Workflows 参数、输出、Artifact 与制品仓库"
sidebar_label: "04. 参数、输出与 Artifact"
sidebar_position: 4
description: "区分参数与 Artifact，安全配置对象存储、校验制品完整性并管理生命周期。"
tags: [Argo Workflows, Parameter, Artifact, S3, 制品仓库]
---

# Argo Workflows 参数、输出、Artifact 与制品仓库

## 1. 选择数据通道

| 数据 | 推荐通道 | 原因 |
| --- | --- | --- |
| ID、路径、Digest、指标 | Parameter | 小、可序列化、用于控制流 |
| 模型、数据集分片、报告 | Artifact | 大对象由外部存储承载 |
| 同节点临时数据 | EmptyDir | 生命周期随 Pod |
| 多节点共享文件系统 | PVC | 需要并发和拓扑设计 |

不要把大 JSON、日志或二进制塞进 Workflow Status，会放大 etcd 和 Controller 压力。

## 2. Artifact 路径

```text
任务写本地声明路径
→ Executor 上传到 Artifact Repository
→ Workflow Status 保存引用/Key
→ 下游 Executor 下载
→ 任务读取本地输入路径
```

Pod 成功但上传失败时，Workflow 仍可能进入 Error。必须分别查看主容器和 Executor 日志。

## 3. 完整性与幂等

Artifact Key 应包含不可变运行 ID、数据集版本或内容 Digest，避免重试覆盖其他运行。输出完成后写 Manifest：对象列表、大小、校验和、生产者、输入版本和 Schema。下游先校验再消费。

## 4. 对象存储安全

- Workflow 使用短期 Workload Identity，避免长期 Access Key。
- 生产者只写本次前缀，消费者只读必要前缀。
- TLS、服务端加密、Bucket Policy 和审计开启。
- 不在 Workflow YAML、参数、UI 或日志中传 Secret。
- 多租户使用独立 Bucket/前缀和 KMS 边界。

## 5. 生命周期

Workflow TTL 只删除 Kubernetes 对象，不必然删除 Artifact。为临时数据、模型候选、正式模型和审计报告设置不同生命周期；删除前保护仍被部署/引用的 Digest。

## 6. 排障

`Artifact not found` 先检查实际 Key、Bucket、Endpoint、身份、区域和上传节点状态。大对象慢则检查并发、分片、网络、对象存储限流、压缩 CPU 和重复下载，不能只提高 Workflow 超时。
