---
title: "Plan、Apply、Refresh、Replace 与 Destroy"
sidebar_label: "05. Plan、Apply、Refresh 与 Destroy"
sidebar_position: 5
description: "拆解 Refresh、Plan 和 Apply 的输入与执行路径，理解保存计划、部分失败、Target、Replace、Destroy 和业务验收边界。"
tags: [Terraform, Plan, Apply, Refresh, Destroy]
---

# Plan、Apply、Refresh、Replace 与 Destroy

Plan 不是“未来必然发生什么”，而是基于当前配置、State、Provider 读取结果和权限生成的动作快照。Apply 也不是数据库事务，中途失败时已经完成的远端变更通常不会回滚。

## 1. 一次 Plan 的输入

```text
源码 Commit
+ CLI/Core 版本
+ Provider/Module 版本
+ 变量与环境变量
+ Backend/Workspace/State
+ Provider 身份、区域与权限
+ 远端 API 当前结果
= Plan
```

其中任何一项变化都可能改变结果。Plan 前应输出经过脱敏的环境、账号、区域、Workspace 和 State 标识，防止“正确代码操作错误环境”。

## 2. Refresh 发生在哪里

默认 Plan 会让 Provider Read 已有对象，把远端现状与 State/配置比较。它能发现控制台修改和对象丢失，但也受 API、权限和 Provider Bug 影响。

若凭据指向错误账号，Provider 可能把资源看成不存在；若 API 暂时返回缺失，错误认知会影响 Plan。因此看到大量重建时应先验证身份和读取错误，不要马上 Apply。

跳过 Refresh 只能用于明确的诊断或特殊场景，因为 Plan 可能基于过期 State。

## 3. 读取 Plan 符号和触发原因

需要分别识别：

- Create：新地址或未绑定对象；
- Update in-place：同一远端对象修改；
- Replace：旧对象销毁并创建新对象；
- Destroy：配置移除或销毁计划；
- Read：Data Source/外部读取；
- Import/Forget：对象绑定变化。

不要只看汇总数字。对每个 Replace 找到 `forces replacement` 字段，确认数据、IP、证书、负载均衡和下游依赖。

## 4. 保存 Plan

```bash
terraform plan -out=tfplan
terraform show tfplan
terraform show -json tfplan > tfplan.json
terraform apply tfplan
```

保存 Plan 能让 Apply 使用已经审查的动作，而不是再次自动生成。但它仍不是绝对一致性保证：远端 API 可在等待审批期间变化，Provider Apply 时可能拒绝、报错或产生新的计算值。

二进制 Plan 和 JSON 可能包含 Secret、资源属性和账号结构，应作为敏感、短期制品存储。Apply 必须绑定源码 Commit、锁文件和变量摘要，防止拿错 Plan。

## 5. 自动批准的边界

`-auto-approve` 只省略交互确认，不代表风险已审查。CI 可以在前置审批、Policy 和环境保护全部完成后使用；不应让普通 PR 合并后直接对共享生产环境无条件 Apply。

交互式 `yes` 也不是强审批，它只证明终端前有人按键。

## 6. Partial Apply

假设图中 20 个资源已成功 12 个，第 13 个因配额失败：

```text
远端：前 12 个变更通常已存在
State：成功操作通常已记录
事务回滚：通常不存在
下一步：读取真实状态并重新 Plan
```

正确处理：

1. 停止并发 Apply；
2. 保存任务日志、Plan 和 State 版本；
3. 检查远端是否仍有进行中的异步任务；
4. 解决配额/权限/配置根因；
5. 重新生成全量 Plan；
6. 审查剩余动作后继续。

不要为了“恢复干净”手工删除已成功资源，这可能破坏 State 绑定和外部依赖。

## 7. 显式 Replace

当实例损坏但配置无变化时，可在 Plan 中显式请求替换：

```bash
terraform plan \
  -replace='example_server.node["node-a"]' \
  -out=replace.plan
```

它比修改 State 或旧式 Taint 更容易审查。仍需分析替换顺序、配额、持久磁盘、IP 和流量切换。

## 8. `-target` 不是日常部署选择器

`-target` 会只构建目标及必要依赖的子图，适合异常恢复或官方指导的少数情况。它可能暂时忽略其他配置变化，使整体并非完全收敛。

使用后必须立即运行全量 Plan，并记录为什么需要 Target。若日常只想部署部分系统，应拆分 State/流水线，而不是永久依赖 Target。

## 9. Destroy 的防护

```bash
terraform plan -destroy -out=destroy.plan
terraform show destroy.plan
terraform apply destroy.plan
```

生产 Destroy 应有独立权限、审批和环境门禁。执行前列出：持久数据、共享网络/IAM、备份、删除保护、保留资源和下游消费者。

销毁基础设施不等于销毁所有外部数据，也不保证费用归零：快照、对象版本、IP、日志和 SaaS 订阅可能继续存在。

## 10. `refresh-only` 的风险

Refresh-only 计划用于把外部变化更新到 State/Output，而不修改远端对象。它不是“完全无害”：接受错误 Read 结果会改变后续 Plan 的认知。

使用前确认 Provider 身份、区域、权限和 API 健康；Apply Refresh-only 后再运行正常 Plan，判断是否出现意外动作。

## 11. Apply 完成后的验收

```text
Provider Apply success
→ 全量 Plan 是否为空
→ 云资源状态/事件是否正常
→ 网络与身份路径是否可用
→ 应用健康、SLO 与数据是否正常
→ 变更观察窗口
```

有些 API 最终一致，Apply 结束后仍需等待路由、DNS、证书或控制器收敛。验收失败时应按预定条件回退或修复，而不是只看 CLI 的绿色输出。

## 12. 变更证据

至少保存：

- 源码 Commit 和 Module/Provider 锁；
- CLI 版本、Backend/Workspace、账号/区域；
- 变量来源摘要；
- Plan 二进制的安全位置与人类摘要；
- 审批和 Policy 结果；
- Apply 日志、State 版本和云审计事件；
- 业务验收、观察窗口和回退决定。

## 13. 练习与答案

**问题：保存 Plan 后等待两小时再 Apply，是否绝对不会改变计划外资源？**

答案：不保证。保存 Plan 固定了 Core 计划，但远端对象、配额和 API 仍可变化，Provider 可能失败或处理新的运行时值。应缩短窗口并在 Apply 后验收。

**问题：Apply 失败后为什么不能直接再次执行原保存 Plan？**

答案：部分资源可能已经改变，原 Plan 的先决状态不再成立。应先确认真实状态并生成新 Plan。

参考资料：

- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [OpenTofu plan](https://opentofu.org/docs/cli/commands/plan/)
