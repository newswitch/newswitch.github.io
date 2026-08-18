---
title: "MLOps 与供应链命令参考库"
sidebar_label: "00. MLOps 与供应链命令参考库"
sidebar_position: 0
description: "从实验和模型注册、数据版本、GitOps发布，到镜像扫描、签名与OCI模型制品，构建可追溯的AI交付链。"
tags: [MLOps, MLflow, DVC, Argo CD, Trivy, Cosign, ORAS]
---

# MLOps 与供应链命令参考库

AI平台的一次发布必须回答：代码、数据、模型、依赖、镜像和配置分别是什么版本；谁批准；部署到哪里；如何验证；出错时回滚哪个不可变对象。任何一个环节只有可变标签或人工目录，都无法形成完整血缘。

## 1. 学习顺序 {/* #学习顺序 */}

1. [MLflow CLI](./01-MLflow命令详解.md)：实验、Run、Artifact、模型与服务。
2. [DVC](./02-DVC命令详解.md)：数据/模型版本、缓存、远端和Pipeline复现。
3. [Argo CD CLI](./03-Argo-CD命令详解.md)：GitOps差异、同步、等待与回滚。
4. [Trivy](./04-Trivy命令详解.md)：镜像、文件系统、配置和Secret扫描。
5. [Cosign 与 ORAS](./05-Cosign与ORAS命令详解.md)：签名、证明、SBOM和OCI模型制品。

## 2. 交付身份链 {/* #交付身份链 */}

```text
Git commit
+ DVC data/model hash
+ MLflow run/model version
+ OCI artifact digest
+ container image digest
+ deployment config commit
→ Argo CD Application revision
→ Kubernetes workload UID
→ running model revision
```

## 3. 安全边界 {/* #安全边界 */}

CLI通常持有模型仓库、对象存储、Git、Registry和集群权限。使用短期工作负载身份和最小权限；Secret不进命令行、配置仓库、MLflow参数和扫描报告。删除Artifact、GC缓存、强制同步、跳过TLS、覆盖Tag或签名都属于高风险变更。

## 4. 验收 {/* #验收 */}

能从线上Pod反查到镜像摘要、配置commit、模型和数据hash；能在部署前执行漏洞/Secret/策略门禁；能验证签名身份和证明；能在GitOps下执行可审计回滚而不制造双重控制源。
