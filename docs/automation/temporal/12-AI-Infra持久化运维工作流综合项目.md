---
title: "Temporal AI Infra 持久化运维工作流综合项目"
sidebar_label: "12. AI Infra 持久化工作流"
sidebar_position: 12
description: "编排跨天 GPU 集群扩容、审批、IaC、节点验收、工作负载迁移、补偿和审计的持久化工作流。"
tags: [Temporal, AI Infra, GPU, Infrastructure Automation, SRE, 综合项目]
---

# Temporal AI Infra 持久化运维工作流综合项目

## 1. 场景

GPU 集群扩容跨越容量审批、采购/云配额、Terraform、Packer、Ansible、网络与存储验收、Kubernetes 加入和业务迁移，可能持续数天。普通 CI Job 长时间占用 Runner 且失败恢复困难，适合用 Temporal 保存流程状态。

## 2. 工作流

```text
容量请求
→ OPA 策略预检
→ 等待审批 Signal/Update
→ Terraform Plan + 审批
→ Apply 基础资源
→ Packer 镜像/Ansible 配置
→ GPU/网卡/存储验收
→ 加入 Kubernetes 节点池
→ 小批迁移工作负载
→ SLO 观察 Timer
→ 完成或补偿
```

## 3. Activity 边界

每个外部系统调用是 Activity，使用 `workflow-id + stage + resource-id` 幂等键。Terraform 使用锁定 Plan/Run ID；节点创建后查询云资源 Tag；Kubernetes 按节点 UID；通知按事件 ID 去重。

## 4. 等待与交互

审批通过 Update 返回验证结果；外部到货/配额通过 Signal；查询返回当前阶段、资源 ID、最后成功 Activity 和阻塞原因。长等待使用 Timer，不占 Worker 线程。

## 5. 补偿边界

若节点验收失败，可排空/移除集群并销毁新资源；已迁移业务或产生数据后不能盲目销毁。Workflow 记录补偿栈，遇到不可逆阶段转人工审批。

## 6. Worker 与队列

规划、云资源、网络验收、Kubernetes 和通知使用不同 Task Queue/最小身份。GPU 主动压测需要受限节点和全局 Semaphore，防止同时压满生产 Fabric。

## 7. 故障演练

- Activity 创建资源后响应丢失，查询 Tag 避免重复；
- Worker 滚动升级，旧 Workflow Replay 通过；
- 审批重复/晚到，通过 Event ID 和阶段拒绝；
- Temporal 暂时不可达，外部资源不被重复修改；
- 下游 API 429，有限退避且不形成风暴；
- 扩容后 SLO 恶化，停止迁移并进入补偿/人工决策。

## 8. 验收

交付 Workflow 状态图、Activity 幂等契约、权限矩阵、版本兼容测试、容量报告、History/业务审计、补偿和灾备 Runbook。任何中断点恢复后都能解释已发生事实和下一步，而不是从头重跑。
