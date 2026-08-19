---
title: "Harbor 与 Kubernetes 制品交付综合项目"
sidebar_label: "09. Kubernetes 交付项目"
sidebar_position: 9
description: "构建从源码、隔离构建、Harbor 制品治理到 Kubernetes 按 Digest 准入和发布的生产闭环。"
tags: [Harbor, Kubernetes, GitLab CI, Jenkins, DevSecOps, 综合项目]
---

# Harbor 与 Kubernetes 制品交付综合项目

## 1. 项目目标

为一个 API 服务建立可追溯交付链：任何运行中的容器都能反查源码提交、Pipeline、构建身份、SBOM、扫描、签名和审批记录。

## 2. 端到端流程

```text
Git 受保护分支
→ 隔离 Runner 构建
→ 生成镜像、SBOM、测试报告
→ Push 到 Harbor 候选项目
→ 漏洞与许可证策略
→ 使用受保护身份签名 Digest
→ 复制/晋级到生产项目
→ GitOps 清单更新为 Digest
→ Admission 验证签名与来源
→ Kubernetes 渐进发布
→ 指标验证与自动/人工回滚
```

## 3. 身份与项目

```text
app-ci       只写 team-candidate
promoter     读取 candidate、写 team-prod
cluster-prod 只读 team-prod
```

开发者不直接获得生产 Push 权限；生产项目 Tag 不可变，删除需要审批。各身份的凭据短期化并由 Secret 系统按工作流下发。

## 4. 发布清单

```yaml
containers:
  - name: api
    image: harbor.example.com/team-prod/api@sha256:<verified-digest>
```

Admission 策略校验仓库、签名者、构建工作流和必要证明。部署系统保存 Digest，避免同名 Tag 漂移。

## 5. 可观测与 SLO

监控 Push/Pull 成功率与 P95、Token 延迟、Registry/存储错误、扫描积压、复制延迟、容量耗尽时间。以“构建完成至全部生产站点可拉取已验证 Digest”的耗时衡量制品交付能力。

## 6. 故障演练

- 让签名缺失或来源不可信，验证准入拒绝。
- 中断扫描器，验证候选制品不能错误晋级。
- 让一个 Registry 副本或 Redis 节点故障，验证服务行为。
- 模拟主站点不可用，从备用站点拉取关键 Digest。
- 恢复数据库与对象存储，核对制品和策略一致性。

## 7. 验收结果

项目完成后应交付架构图、权限矩阵、策略代码、容量模型、恢复报告、故障 Runbook 和一次完整发布证据包，而不只是一个可访问的 Harbor 页面。
