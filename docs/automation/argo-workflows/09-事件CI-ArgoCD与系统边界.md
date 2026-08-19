---
title: "Argo Workflows 事件、CI、Argo CD 与系统边界"
sidebar_label: "09. 事件、CI 与 Argo CD"
sidebar_position: 9
description: "区分并串联 GitLab CI/Jenkins、Argo Events、Argo Workflows 与 Argo CD 的职责。"
tags: [Argo Workflows, Argo Events, Argo CD, GitLab CI, Jenkins]
---

# Argo Workflows 事件、CI、Argo CD 与系统边界

## 1. 四类系统

| 系统 | 主要职责 | 不应默认承担 |
| --- | --- | --- |
| Jenkins/GitLab CI | 源码事件、测试、构建、制品证明 | Kubernetes 内复杂长时 DAG 的全部状态 |
| Argo Events | 接收事件并触发受控对象 | 执行完整业务工作流 |
| Argo Workflows | 运行批处理/DAG 并追踪节点状态 | 持续保证集群配置与 Git 一致 |
| Argo CD | GitOps 持续协调应用期望状态 | 通用数据处理和训练 DAG |

## 2. 推荐交付链

```text
Git 提交
→ GitLab CI/Jenkins 测试与构建
→ Harbor 保存、扫描、签名 Digest
→ 更新 GitOps 仓库
→ Argo CD 同步并持续纠偏
```

若发布前需要大规模数据验证或模型评估，可由 CI 以短期身份提交 Argo Workflow，等待结果摘要和不可变报告，不在 Runner 中长时间占用单个 Job。

## 3. 事件驱动链

Argo Events 可接收 Webhook、对象存储或消息系统事件，通过 Sensor 创建参数化 Workflow。安全控制包括事件签名、重放保护、Schema 验证、频率限制、允许模板列表和最小权限 ServiceAccount。

外部 Payload 不能直接控制镜像、命令、ServiceAccount 或任意模板引用。

## 4. 状态和回调

提交方保存 Workflow UID，而不是只靠名称。查询终态时处理网络超时和重复回调；回调消费者使用事件 ID 幂等。Workflow 成功后输出报告 Digest，CI/审批系统验证后再进入下一阶段。

## 5. 避免循环触发

自动化更新 Git、Git 触发 CI、CI 再启动 Workflow 时，使用路径过滤、机器人提交标记和事件来源字段阻止循环。对每条链定义唯一 Owner、超时和人工停止入口。
