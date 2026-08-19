---
title: "IaC 定位、架构与工具边界"
sidebar_label: "01. IaC 定位、架构与工具边界"
sidebar_position: 1
description: "理解声明式资源生命周期、Provider、State 和依赖图，并区分 Terraform/OpenTofu、Ansible 与 GitOps。"
tags: [IaC, Terraform, OpenTofu, Ansible, GitOps]
---

# IaC 定位、架构与工具边界

## 1. 解决什么问题

IaC 将云资源、网络、身份和平台组件的期望状态进入 Git，提供 Plan、依赖图、版本和自动执行。它不自动保证业务数据迁移、应用健康和灾难回滚。

## 2. 主要组件

| 组件 | 职责 |
| --- | --- |
| CLI/Core | 解析配置、构图、计算差异、调度 Provider |
| Provider | 调用外部 API 并实现资源 Schema/生命周期 |
| State | 保存资源地址与远端对象映射及已知属性 |
| Backend | 保存 State，并可能提供锁或远程执行能力 |
| Module | 封装可复用配置接口 |

## 3. 边界

| 需求 | 优先技术 |
| --- | --- |
| 创建 VPC、VM、LB、IAM、集群 | Terraform/OpenTofu |
| 配置主机软件和服务 | Ansible |
| 持续收敛 Kubernetes 应用 | Argo CD/Flux |
| 构建不可变机器镜像 | Packer |
| 数据库内部 Schema/数据迁移 | 数据库迁移工具和应用流程 |

可以组合，但不要让多个工具同时拥有同一资源字段。

## 4. 声明式不等于无副作用

Provider 执行 Create/Update/Delete，可能触发重建、停机和数据删除。Plan 展示 Provider 根据当前已知信息推导的动作，不能理解全部业务影响。

## 5. State 是控制面数据

没有 State，Core 无法稳定知道配置地址对应哪个远端对象。State 可能包含密码、连接串和敏感属性，应按生产数据库级别治理。

## 6. 最小闭环

```text
Git 变更
→ fmt/validate/test
→ Plan
→ 人与策略审查
→ Apply
→ 业务验收
→ 保存 State、Plan 摘要和执行证据
```
