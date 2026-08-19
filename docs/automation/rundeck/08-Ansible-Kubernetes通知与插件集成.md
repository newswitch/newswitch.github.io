---
title: "Rundeck Ansible、Kubernetes、通知与插件集成"
sidebar_label: "08. Ansible、Kubernetes 与插件"
sidebar_position: 8
description: "组合 Ansible、Kubernetes、HTTP API、通知和插件，并保持每个系统的职责、身份和故障边界。"
tags: [Rundeck, Ansible, Kubernetes, Plugin, Integration]
---

# Rundeck Ansible、Kubernetes、通知与插件集成

## 1. Rundeck 与 Ansible

Rundeck 提供用户入口、参数、ACL、调度和审计；Ansible 负责 Inventory、模块幂等、Role 和批量配置收敛。Rundeck Job 调用固定版本 Playbook/Execution Environment，不拼接任意 Extra Vars。

执行结果保留 Ansible Exit Code、统计和 Artifact；凭据由 Vault/Key Storage 下发，不复制进项目仓库。

## 2. Kubernetes

低风险只读诊断可调用受限 ServiceAccount；变更优先更新 GitOps 或创建受控 Workflow，而不是在 Rundeck 里长期持有 Cluster Admin 并直接 `kubectl edit`。

Node 资源可从集群动态发现，但 Pod 短生命周期和标签变化要求记录实际目标 UID。

## 3. HTTP/API Step

固定 Endpoint 允许列表、方法、Schema、超时和身份。响应状态与业务终态分开；异步 API 保存 Operation ID 并轮询。任何输入不能控制任意 URL，防止 SSRF。

## 4. 通知

通知用于开始、成功、失败和 SLA 超时，包含 Execution 链接、Job、环境、目标数和脱敏摘要。不发送 Secret、完整命令或大量日志。通知失败不能覆盖主 Job 终态，但需独立告警。

## 5. 插件治理

- 记录来源、版本、许可证、Owner 和兼容矩阵；
- 在隔离环境评审代码、权限和网络；
- 固定版本并生成供应链清单；
- 升级测试 Job、日志、ACL 和数据迁移；
- 禁用无 Owner/长期未维护插件；
- 插件异常不应拖垮全部执行线程。

## 6. 选择边界

持续状态收敛用 Ansible/Controller，Kubernetes DAG 用 Argo Workflows，长时业务 Saga 用 Temporal；Rundeck 更适合人或事件触发的运维 Runbook 和跨系统受控操作。
