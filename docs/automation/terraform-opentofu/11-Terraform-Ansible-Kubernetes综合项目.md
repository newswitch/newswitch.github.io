---
title: "Terraform、Ansible 与 Kubernetes 综合项目"
sidebar_label: "11. Terraform、Ansible 与 Kubernetes 综合项目"
sidebar_position: 11
description: "以测试集群为例，划分 Terraform 资源、Ansible 主机配置和 Kubernetes GitOps 的所有权，建立分阶段交付与恢复。"
tags: [Terraform, OpenTofu, Ansible, Kubernetes, 综合项目]
---

# Terraform、Ansible 与 Kubernetes 综合项目

## 1. 所有权

| 层 | 工具 | 所有内容 |
| --- | --- | --- |
| 云/虚拟化资源 | Terraform/OpenTofu | 网络、VM、LB、IAM、磁盘 |
| 主机配置 | Ansible | OS 基线、运行时、系统服务 |
| 集群应用 | Argo CD/Helm/Kustomize | Kubernetes 声明式资源 |

同一字段只由一个控制面管理。

## 2. 仓库

```text
platform/
├── iac/modules/
├── iac/live/test/
├── ansible/
├── gitops/clusters/test/
└── contracts/
```

层间通过版本化 Output/Inventory 契约传递，不直接解析内部 State。

## 3. 流程

```text
Terraform Plan/Apply
→ 输出节点和集群端点
→ 生成并验证动态 Inventory
→ Ansible 金丝雀配置节点
→ 集群验收
→ GitOps 同步平台组件
→ 端到端 SLO 验证
```

## 4. 门禁

- IaC Replace/Destroy 单独审批。
- Ansible 使用 `serial`、失败阈值和 Check/Diff。
- GitOps 采用健康检查和同步波次。
- 每层使用不同短期身份。
- 上层失败不自动销毁已创建的持久资源。

## 5. 恢复

Terraform 部分失败先重新 Plan；Ansible 失败从安全批次重跑；GitOps 回退到已验证 Commit。数据库和持久卷由独立备份恢复，不依赖 State 或 Git。

## 6. 关联学习

- [Ansible 从零到精通](../ansible/00-Ansible从零到精通学习路线.md)
- [Kubernetes 场景 Terraform 实践](../../cloud-native/kubernetes/operations/application-delivery/01-Terraform.md)
- [Argo CD](../../cloud-native/kubernetes/operations/application-delivery/08-ArgoCD.md)

## 7. 验收

- [ ] 三层所有权无重叠。
- [ ] 每层输入输出 Schema 有版本。
- [ ] 任一生产资源可关联源码、Plan、执行和验收。
- [ ] 中断后可从真实状态继续，不假设事务回滚。
- [ ] 销毁流程保护持久数据和共享依赖。
