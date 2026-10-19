---
title: "Department Project 权限与资源模型"
sidebar_label: "02. Department Project 权限与资源模型"
sidebar_position: 2
description: "区分 Run:ai 的组织层级、项目权限、节点池配额、物理 GPU 与共享方式。"
tags: [Runai, RBAC, GPU, Department, Project]
---

# Department Project 权限与资源模型

多租户系统必须分别回答谁可以访问、谁有多少预算、预算可以在哪种资源上兑现。把三者都称为“项目权限”，会使 Pending 问题无法定位。

## 1. 组织和资源是两条轴

Department 与 Project 表达组织与工作负载归属，Node Pool 表达资源集合。调度队列与项目或部门和节点池的组合相关。一个项目在池 A 的资格，不意味着在池 B 自动获得相同预算。

用户能查看项目不等于能提交或修改配额；提交权限也不保证任务可放置。Kubernetes Namespace 和 RBAC 提供底层边界，但与产品的组织权限需要一致配置，不能根据名称相同就认定授权相同。

## 2. 一个请求的三个检查

```text
身份授权：这个用户能否在项目中执行该操作
预算资格：项目和部门是否有可用份额或可借资源
节点可行性：GPU、CPU、内存、型号、拓扑、存储能否同时满足
```

例如项目预算有 4 GPU，用户有提交权限，任务要求单节点 4 GPU，而池中只有两个各空闲 2 GPU 的节点。它仍不能放置。增加用户权限或账户配额不能修复资源形状。

## 3. 配额不是显存隔离

组织级配额表达调度预算，MIG、软件共享或整卡独占表达设备使用方式。项目有 0.5 GPU 的某种共享请求，不应自动解释为获得半张 GPU 的全部带宽、独立故障域或精确一半算力。要核对目标版本分数资源的计量、显存限制与运行机制。

通用隔离原理见[MIG 与共享](../../sharing/09-MIG%20原理与%20Kubernetes%20配置.md)。产品资源计量、Kubernetes 导出资源和监控统计必须采用可追溯映射，否则会把切分实例数量误计成物理卡数量。

## 4. 最小权限与凭据

镜像拉取、数据源访问、集群注册和用户登录使用不同的凭据。某个镜像拉取失败时，不应为了省事给项目管理员集群 Root。先确定请求由哪台节点、哪个服务身份执行，再限定它对目标仓库或对象的权限。

权限调整记录应包括主体、作用域、动作、有效期及实际验证。敏感信息不能出现在提交模板、环境导出或告警标签中；用 Secret 引用也仍需核对谁可以读取该 Secret。

产品级授权进一步读 [Access Rules、角色与作用域](./09-AccessRules角色作用域与权限治理.md)，区分部门授权的未来子节点影响、自定义权限集、集群同步和撤销。提交字段的允许集合则由[工作负载策略](./10-工作负载策略继承模板与资产治理.md)解析，不应与身份权限或组织配额合并成一个判断。

## 5. 掌握检查

用户能看到 20 张 GPU，但任务只能申请 4 张，是否系统出错？不一定，物理库存和项目资格是不同口径。部门有 8 张预算、两个项目各写了 8 张，是否能同时保证 16 张不可抢占资源？不能绕过上级部门及真实容量，必须核对有效策略。

## 6. 参考资料

- [组织与资源管理概览](https://run-ai-docs.nvidia.com/self-hosted/getting-started/overview)
- [队列与资源管理概念](https://run-ai-docs.nvidia.com/self-hosted/platform-management/runai-scheduler/scheduling/concepts-and-principles)
- [部门与项目有效调度](https://run-ai-docs.nvidia.com/self-hosted/platform-management/runai-scheduler/scheduling/how-the-scheduler-works)
