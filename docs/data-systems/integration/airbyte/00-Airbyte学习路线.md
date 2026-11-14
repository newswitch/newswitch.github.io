---
title: "Airbyte 学习路线"
sidebar_label: "00. Airbyte 学习路线"
sidebar_position: 0
description: "从 Connector、Connection、Catalog、Stream 和 State 出发，系统学习 Airbyte 自托管部署、同步模式、CDC、数据校验与生产排障。"
tags: [Airbyte, 数据集成, ELT, 学习路线]
---

# Airbyte 学习路线

Airbyte 把数据源、目标和同步计划组织成 Connection，让连接器负责读取外部系统与加载数据。学习它不能只停在 UI 中点一次同步，还要解释哪些表被选择、什么字段用于增量、何时保存进度，以及失败重试会给目标留下什么。

本系列依据 **2026-11-14 核对的官方 Platform 文档**，部署命令参考 **abctl v0.30.4**。Airbyte Platform、Helm Chart、abctl、协议和 Connector 镜像分别版本化；不能从某个 GitHub 仓库的 latest release 标签推断所有组件的当前版本。实际安装前记录选定 Chart、渲染后的平台镜像与每个连接器版本。

## 1. 三种对象先分清

| 对象 | 含义 | 不等同于 |
| --- | --- | --- |
| Connector | 实现协议的源或目标程序 | 具体数据库本身 |
| Source/Destination 实例 | 一份有端点、认证等设置的配置 | 业务数据与全部同步进度 |
| Connection | 选择的 Stream、模式、计划等 | 一次执行或一张表 |

例如同一个 PostgreSQL Connector 可以配置多个独立数据库实例；同一个 Source 又可以参与多条 Connection。修改共享实例的凭据或连接器版本，影响范围可能大于一条同步。

## 2. 阅读顺序

1. [Connector 协议与 Workload 执行链路](./01-Connector协议与Workload执行链路.md)：区分控制面、任务与两种数据通路。
2. [abctl 与 Helm 部署边界](./02-abctl与Helm部署边界.md)：先理解本地 kind 与已有 Kubernetes 的不同安装路径。
3. [Catalog、同步模式与主键游标](./03-Catalog同步模式与主键游标.md)：解释全量、增量、追加、去重和删除。
4. [State 确认、CDC 与失败恢复](./04-State确认CDC与失败恢复.md)：沿源进度、目标确认和持久化理解重放。
5. [Schema 演进、类型与数据校验](./05-Schema演进类型与数据校验.md)：避免“同步成功但数据被改坏”。
6. [资源调度、监控、升级与排障](./06-资源调度监控升级与排障.md)：从 Job/Attempt/Workload 关联到 Kubernetes 和业务目标。

## 3. 学习与选型的边界

Airbyte 常用于业务数据库、API/SaaS 数据进入分析存储；不同连接器的能力、成熟度和许可需要分别核对。社区版、自托管付费版与 Cloud 的功能、鉴权和资源配置不应混为一谈。

与 [DataX](../datax/00-DataX学习路线.md)比较批任务与平台化同步，与 [SeaTunnel](../seatunnel/00-SeaTunnel学习路线.md)比较执行图和状态机制，与 [NiFi](../nifi/00-NiFi学习路线.md)比较细粒度路由与队列。选择由接入协议、恢复语义、运维成本和数据契约决定，而不是只数插件数量。

## 4. 配套示例怎样使用

`examples/data-integration/airbyte/source-messages.jsonl` 是解释传统 STDIO 协议的合成记录与 State；不是部署配置、真实连接器状态，也不能拿来覆盖平台保存的生产 State。配套离线测试只演示确认与重放的逻辑，不启动 Airbyte。

目标环境学习时，先选择一个版本明确且支持所需模式的源/目标组合，在隔离数据集上完成全量、增量、更新、删除与失败重试，再验证 schema 变化。记录源表数、选中流、输出主键集合和目标拒绝记录，而不只记录绿色成功图标。

## 5. 练习与答案

**问题一：abctl 版本是否就是 Airbyte 平台版本？**

答案：不是。abctl 是安装管理工具；Chart、平台镜像、协议和各连接器还各自有版本与兼容关系。

**问题二：同一 Source 被两条 Connection 使用，修改凭据会怎样？**

答案：可能同时影响两条连接。需要先核对共享配置引用和变更范围，而不是只检查当前页面。

**问题三：合成 JSONL 能直接作为生产恢复 State 吗？**

答案：不能。State 具有连接器特定结构与语义，错误覆盖可能跳过数据或破坏恢复。

**问题四：同步成功后，为什么还要核对目标数据？**

答案：成功可能只表示当前执行按协议结束；类型截断、重复、未选中字段、删除未传播和目标拒绝策略仍需独立验证。

参考：[官方协议](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol)、[abctl](https://docs.airbyte.com/platform/deploying-airbyte/abctl)、[abctl v0.30.4](https://github.com/airbytehq/abctl/releases/tag/v0.30.4)。
