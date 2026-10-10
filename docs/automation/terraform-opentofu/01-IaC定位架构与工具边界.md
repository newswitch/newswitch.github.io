---
title: "IaC 定位、架构与工具边界"
sidebar_label: "01. IaC 定位、架构与工具边界"
sidebar_position: 1
description: "从声明式资源、依赖图、Provider、State 和控制权出发，理解 Terraform/OpenTofu 的执行模型及其与 Ansible、Packer、GitOps 的边界。"
tags: [IaC, Terraform, OpenTofu, Ansible, GitOps]
---

# IaC 定位、架构与工具边界

Infrastructure as Code（IaC）不是“把创建云资源的命令写进脚本”，而是用可版本化配置描述资源期望状态，由工具读取现状、计算差异并按依赖关系执行变更。

## 1. IaC 解决的核心问题

手工控制台操作的问题不只是慢，而是难以回答：

- 资源为什么存在，当前配置由谁批准；
- 测试与生产为什么不一致；
- 一次网络、IAM 或节点池变更会影响什么；
- 资源被手改后怎样发现和收敛；
- 故障后能否重建控制面配置。

IaC 把配置、版本、Plan、审批和执行证据串成闭环。但它不会自动保证应用健康、数据库数据安全或业务零停机。

## 2. Terraform/OpenTofu 的执行架构

```text
Configuration + Variables + Provider Schemas
                    │
                    ▼
              Core 构建依赖图
                    │
     Prior State ───┼─── Remote API Read
                    ▼
                  Plan
                    │
              审查 / Policy
                    ▼
                  Apply
                    │ RPC
                    ▼
              Provider Process
                    │ API
                    ▼
           Cloud / SaaS / Kubernetes
                    │
                    ▼
                New State
```

Core 负责解析 HCL、求值、构图和调度；Provider 是独立插件进程，负责理解目标 API 的 Schema 与 Create/Read/Update/Delete 行为。Core 并不知道“修改子网是否影响生产”，它只知道 Provider 返回的差异和依赖。

## 3. State 不是缓存，而是对象绑定

State 最关键的内容是：配置地址和真实对象身份的映射。

```text
module.network.aws_vpc.main
        ↕
vpc-0abc123（远端对象）
```

没有这层映射，工具无法稳定判断是更新既有 VPC，还是创建一个新 VPC。State 还保存已知属性、依赖和 Provider 元数据，因此可能包含密码、连接串与敏感输出。

State 不是业务数据备份，也不是完整云资产数据库。恢复旧 State 不会恢复被删除的数据库或磁盘，反而可能使下一次 Plan 做出危险动作。

## 4. 声明式的真实含义

声明式配置表达“最终希望是什么”，但实现过程仍有副作用：

```text
当前实例类型 = small
期望实例类型 = large
Provider Schema 判断该字段 ForceNew
→ Plan 显示 Replace
→ 创建新实例或先删除旧实例
```

是否能滚动、是否保留 IP、是否需要双份配额，都不由“声明式”自动解决。Plan 是基础设施动作预测，不是业务影响分析。

## 5. 依赖图与并发

属性引用建立隐式边：

```hcl
resource "example_subnet" "app" {
  network_id = example_network.main.id
}
```

Core 可以并行执行没有依赖关系的节点。错误地添加大量 `depends_on` 会扩大 Unknown 值并降低并发；遗漏业务依赖则可能让“API 创建成功”发生在真正前置条件完成前。

依赖图只表达配置中的资源关系，不自动知道数据库复制已追平、负载均衡已摘流或应用已完成预热，这些必须通过编排和验收补充。

## 6. Terraform 与 OpenTofu

两者拥有共同历史和大量相似语法，但已经独立演进。团队必须明确：

- 使用哪一个 CLI 和确切版本；
- Provider/Module 来源与兼容范围；
- State/Plan 格式和功能是否可互换；
- Backend、测试、加密与流水线能力差异；
- 谁负责评估升级和切换。

例如 OpenTofu 提供原生 State/Plan 静态加密配置；Terraform 提供的 Ephemeral/Write-only 等能力也随版本和 Provider 支持演进。不能只把 `terraform` 命令替换成 `tofu` 就认为迁移完成。

## 7. 与其他自动化工具的边界

| 需求 | 更合适的所有者 | 原因 |
| --- | --- | --- |
| VPC、VM、LB、IAM、托管集群 | Terraform/OpenTofu | API 资源生命周期与依赖图 |
| 操作系统包、配置文件、服务 | Ansible | 主机配置收敛和批次控制 |
| 构建不可变机器镜像 | Packer | 从基础镜像生成可晋级制品 |
| Kubernetes 应用持续协调 | Argo CD/Flux | Watch 集群并持续收敛 Git 期望 |
| 数据库 Schema 版本演进 | Flyway/Liquibase/应用迁移 | 事务、前后兼容和数据语义 |
| Secret 动态签发与租约 | Vault 等 Secret 平台 | 身份、租约、撤销与审计 |

工具可以串联，但同一字段只能有一个写入所有者。例如 Terraform 创建 VM，Ansible 配置 OS；不要让 Terraform Remote Exec 和 Ansible 同时修改同一个服务文件。

## 8. IaC 与 GitOps 的区别

Terraform/OpenTofu 通常由一次任务读取、Plan、Apply 后退出；GitOps Controller 常驻集群，通过 Watch 持续协调。两者都声明式，但控制循环不同。

可用 Terraform 创建 Kubernetes 集群和 GitOps Controller，再由 GitOps 管理应用。若两者同时管理同一个 Deployment 字段，双方会持续互相覆盖。

## 9. 控制权与爆炸半径

设计每个 State 前先回答：

- 团队、账号、区域与环境边界是什么；
- 这些资源是否有相近生命周期；
- 一个错误 Plan 最多能影响什么；
- 跨 State 依赖如何以稳定契约暴露；
- 哪个流水线拥有 Apply 权限。

巨型 State 依赖复杂、Plan 慢且爆炸半径大；过度拆分又会产生大量跨 State 耦合和发布顺序。拆分目标是所有权和故障域清晰，不是追求固定资源数量。

## 10. 生产闭环

```text
需求与风险评估
→ 修改 Git 配置和测试
→ fmt / validate / security / policy
→ 使用受控身份生成保存 Plan
→ 审查 Add/Change/Replace/Destroy
→ 对同一制品 Apply
→ 云资源与业务验收
→ 保存 State、执行证据和回退条件
→ 定期 Drift 检测
```

Plan 和 Apply 之间远端仍可能变化，因此保存 Plan 不是事务保证。Apply 成功也只说明 Provider 操作成功，仍需检查路由、健康、数据和 SLO。

## 11. 常见错误认识

- **“有代码就可重建一切”**：State、外部数据、证书、密钥和业务备份仍不可缺。
- **“Plan 没有红色就安全”**：原地更新也可能造成中断或权限扩大。
- **“prevent_destroy 等于备份”**：它只是计划保护，可被移除，且不保存数据。
- **“ignore_changes 能解决漂移”**：它只是让出字段所有权，也可能隐藏风险。
- **“IaC 应管理所有对象”**：高频数据面和应用内部状态通常不适合。

## 12. 练习与答案

**问题：Terraform 创建 Kubernetes Deployment 后，Argo CD 也管理它，会发生什么？**

答案：若两者期望不一致，会形成双控制面竞争。应把集群基础设施和 GitOps 引导交给 Terraform，把应用对象交给 Argo CD，并明确交接点。

**问题：删除本地 State 再运行 Apply，为什么可能重复创建资源？**

答案：配置地址失去与远端对象 ID 的绑定。除非 Provider 能通过其他方式判定唯一性，否则 Core 会把资源视为不存在；正确做法是恢复 State 或受控 Import。

参考资料：

- [Terraform Core workflow](https://developer.hashicorp.com/terraform/intro/core-workflow)
- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
- [OpenTofu documentation](https://opentofu.org/docs/)
