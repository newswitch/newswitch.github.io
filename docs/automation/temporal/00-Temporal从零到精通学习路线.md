---
title: "Temporal 从零到精通学习路线"
sidebar_label: "00. Temporal 学习路线"
sidebar_position: 0
description: "从 Event History、Workflow 与 Activity 开始，掌握重试、Signal、Update、版本演进、Worker、可观测、容量和灾难恢复。"
tags: [Temporal, Durable Execution, Workflow, Activity, Distributed Systems, 学习路线]
---

# Temporal 从零到精通学习路线

Temporal 是持久化执行平台：Temporal Service 保存 Workflow Event History，Worker 运行 Workflow/Activity 代码；进程崩溃后可通过 Replay 恢复进度。它不是把普通函数自动变成事务，可靠性仍依赖确定性 Workflow、幂等 Activity 和明确的业务补偿。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [定位、架构与任务执行路径](./01-定位架构与任务执行路径.md) | 解释 Service、Worker、Task Queue 与 History |
| 2 | [Workflow 确定性、Event History 与 Replay](./02-Workflow确定性EventHistory与Replay.md) | 编写可重放的控制逻辑 |
| 3 | [Activity、超时、重试、Heartbeat 与幂等](./03-Activity超时重试Heartbeat与幂等.md) | 安全执行外部副作用 |
| 4 | [Signal、Query、Update 与消息顺序](./04-Signal-Query-Update与消息顺序.md) | 与运行中的 Workflow 交互 |
| 5 | [Timer、Child、Continue-As-New 与 Schedule](./05-Timer-Child-ContinueAsNew与Schedule.md) | 管理长流程和历史规模 |
| 6 | [Worker、Task Queue、路由与并发容量](./06-Worker-TaskQueue路由与并发容量.md) | 运营执行资源与公平性 |
| 7 | [数据、Payload Codec、身份与安全](./07-数据PayloadCodec身份与安全.md) | 保护历史和业务 Payload |
| 8 | [测试、时间跳跃与故障注入](./08-测试时间跳跃与故障注入.md) | 验证超时、重试和恢复 |
| 9 | [Workflow 版本演进与兼容发布](./09-Workflow版本演进与兼容发布.md) | 升级仍在运行的 Workflow |
| 10 | [可观测、容量、历史与故障排查](./10-可观测容量历史与故障排查.md) | 定位卡住、积压和重放问题 |
| 11 | [部署、高可用、备份与灾难恢复](./11-部署高可用备份与灾难恢复.md) | 选择 Cloud/自建并保护状态 |
| 12 | [AI Infra 持久化运维工作流综合项目](./12-AI-Infra持久化运维工作流综合项目.md) | 编排跨天审批、变更和补偿 |

## 2. 掌握标准

- [ ] 能画出 Client → Service → Task Queue → Worker → History 路径。
- [ ] Workflow 代码不直接执行网络、文件、随机和墙上时钟副作用。
- [ ] 每个 Activity 有合适超时、重试分类和业务幂等键。
- [ ] 长流程控制 History 大小并能 Continue-As-New。
- [ ] Workflow 代码升级不会让历史 Replay 失败。
- [ ] 能从 Pending Task、History、Worker 日志和下游状态定位故障。

## 3. 官方资料

- [Temporal Documentation](https://docs.temporal.io/)
- [Temporal Workflows](https://docs.temporal.io/workflows)
