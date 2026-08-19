---
title: "Argo WorkflowTemplate、Cron 与复用治理"
sidebar_label: "06. 模板、Cron 与治理"
sidebar_position: 6
description: "用 WorkflowTemplate、ClusterWorkflowTemplate、CronWorkflow、模板版本和策略构建平台化工作流。"
tags: [Argo Workflows, WorkflowTemplate, CronWorkflow, 治理, 平台工程]
---

# Argo WorkflowTemplate、Cron 与复用治理

## 1. 三种复用对象

| 对象 | 范围 | 适用场景 |
| --- | --- | --- |
| WorkflowTemplate | Namespace | 团队内部模板 |
| ClusterWorkflowTemplate | 集群 | 平台共享能力，权限更敏感 |
| CronWorkflow | 定时创建 Workflow | 周期任务和数据处理 |

模板是 API 合约，不是复制粘贴片段。输入类型、默认值、输出、错误语义、资源上限和版本兼容都要稳定。

## 2. 分层设计

```text
平台原子模板：安全容器、Artifact、通知、通用训练/扫描
→ 团队流程模板：组合业务 DAG
→ Workflow：只提供版本化参数和运行上下文
```

平台模板不应获得所有租户 Secret；调用方身份和目标资源仍需最小权限。

## 3. 版本管理

模板 YAML 进入 Git，使用语义版本或不可变提交引用。先在测试 Namespace 运行契约测试，再逐步升级调用方。直接修改共享模板可能让重提的历史 Workflow 行为变化。

保存渲染后的最终 Spec、模板版本和镜像 Digest，以便重现运行。

## 4. CronWorkflow

周期任务必须考虑：时区、夏令时、错过调度、并发策略、截止时间、暂停和重复执行。任务自身仍要按业务窗口幂等；Cron 控制器“只创建一次”不能证明外部操作只发生一次。

## 5. 治理门禁

- 镜像只来自受信 Harbor 并按 Digest；
- CPU/内存/GPU 请求与上限合法；
- 禁止特权、HostPath、HostNetwork 和任意 ServiceAccount；
- 并行度、重试、TTL 和 Artifact 生命周期有上限；
- Secret 从 Vault/Workload Identity 获取；
- 模板发布有 Owner、变更记录和弃用窗口。
