---
title: "Terraform/OpenTofu 测试、CI、Policy 与安全"
sidebar_label: "09. 测试、CI、Policy 与安全"
sidebar_position: 9
description: "构建从格式、校验、原生测试、真实集成测试到 Plan Policy、短期身份、制品保护和受控 Apply 的基础设施流水线。"
tags: [Terraform, OpenTofu, CI, Policy as Code, Security]
---

# Terraform/OpenTofu 测试、CI、Policy 与安全

IaC 流水线既是测试系统，也是拥有云权限的部署控制面。安全目标不是“CI 能跑通”，而是让不可信代码无法借 Plan 窃取凭据，让高风险动作经过可解释的门禁，并能追溯实际 Apply。

## 1. 分层测试模型

```text
格式与语法
→ 配置 Validate
→ 静态/安全扫描
→ 原生 Module 测试与 Mock
→ 测试账号真实 Plan/Apply
→ Plan JSON Policy
→ 生产 Plan 审查
→ 受保护 Apply
→ 业务验收与 Drift 检测
```

每层发现的问题不同，不能用一个 `validate` 替代全部。

## 2. 格式和 Validate

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

`fmt` 只统一格式；`validate` 检查语法、类型和 Provider Schema 一致性，不调用所有真实 API，也不证明权限、配额或架构安全。

是否能 `-backend=false` 取决于配置和检查内容，CI 应提供明确的初始化模式。

## 3. 原生测试

Terraform/OpenTofu 都提供测试能力，但语法与版本支持会独立演进。测试文件通常使用 `.tftest.hcl`：

```hcl
run "valid_plan" {
  command = plan

  variables {
    environment = "test"
  }

  assert {
    condition     = output.replica_count >= 2
    error_message = "test environment requires redundancy"
  }
}
```

```bash
terraform test
```

某些 Run 会执行 Apply 并创建真实收费资源，不能把 `test` 当纯单元测试。必须使用隔离账号、预算、TTL 标签和残留清理。

## 4. Mock Provider 的边界

Terraform 的测试框架可 Mock Provider/Resource/Data Source，适合验证条件、组合和 Output，无需真实云凭据。

Mock 返回的 Computed 值不理解真实格式、权限、最终一致和 API 约束，因此以下问题仍需要集成测试：

- IAM 是否真正可用；
- 云配额和区域能力；
- Provider CRUD/Import 行为；
- 销毁和异步状态；
- 网络、DNS 和证书；
- 实际费用与性能。

测试应明确“验证了表达式”还是“验证了真实基础设施”。

## 5. 静态与安全扫描

静态工具可以检查公网暴露、加密、危险 IAM、标签和已知 Provider 配置错误。但它们基于规则和静态值，遇到 Unknown、Module 和自定义策略时可能漏报或误报。

扫描结果按严重性和环境分级；例外必须有 Owner、理由、到期时间和补偿措施，不能通过永久忽略文件消失。

## 6. Plan JSON 与 Policy as Code

```bash
terraform show -json tfplan > tfplan.json
```

Policy 可检查：

- 生产是否出现 Destroy/Replace；
- 网络是否暴露 `0.0.0.0/0`；
- 数据库是否启用加密、备份和删除保护；
- IAM 是否过宽；
- 实例规格、区域和成本上限；
- 必要标签和 Owner。

Plan JSON 仍可能包含 Sensitive 值，策略引擎、日志和制品库必须受保护。

配置扫描、Plan Policy 和云资产策略看到的阶段不同：配置不知道所有 Computed 值，Plan 不保证 Apply 后业务健康，资产检查只能发现已经存在的对象。三层互补。

## 7. 不可信 PR 的威胁模型

攻击者可修改：

- Provider/Module 来源；
- External Data/Local Exec；
- Data Source 查询；
- Backend 或网络地址；
- Output 和日志内容。

因此来自 Fork 或未审批分支的任务只运行无 Secret 的格式/静态检查。生产 Plan 应在代码进入受信分支或经过人工许可后，由隔离 Runner 使用短期只读/计划身份生成。

## 8. Plan 与 Apply 身份分离

```text
PR Runner：无云凭据或极小只读
Plan Runner：短期读取 + 必要规划权限
Apply Runner：受保护环境中的最小写权限
Backend Admin：独立的版本/恢复权限
```

云 API 往往没有纯“Plan 权限”，因为 Read 也可能泄露敏感数据。实际权限需基于 Provider 调用和测试收敛，不能简单授予账号管理员。

OIDC/工作负载身份应绑定仓库、分支、环境和 Job 声明，令牌短期且不可跨环境复用。

## 9. 保存 Plan 的供应链

Apply 只能使用来自同一 Commit、锁文件、变量与目标环境的 Plan。制品应：

- 加密、短期保留、限制下载；
- 记录 Hash、Commit 和环境；
- 防止普通 PR Job 替换；
- 超过有效窗口重新生成；
- Apply 后销毁或按审计要求归档。

不要通过公开 PR 评论粘贴完整 Plan。机器人摘要只展示安全字段和动作数量，原文在受控位置查看。

## 10. 并发与环境门禁

同一 State 只允许一个 Apply。CI 的 concurrency group 应与 State 标识对应，Backend 锁作为第二道保护。

生产环境还需要：

- 分支保护和 CODEOWNERS；
- 高风险 Replace/Destroy 单独批准；
- 维护窗口和冻结；
- Plan 过期策略；
- 紧急变更路径与事后回写；
- Apply 后业务验收。

## 11. 集成测试与清理

真实测试资源必须有唯一前缀、TTL/Owner 标签、预算和独立账号。测试框架即使承诺自动 Destroy，也要有外部残留扫描，因为进程崩溃、权限变化和 Provider Bug 都可能阻止清理。

对于数据库等昂贵资源，可分层：Mock 验证大部分组合，定时而非每 PR 运行完整集成测试，但发布版本前必须执行。

## 12. Secret 与日志

- 不把云密钥、tfvars Secret、Plan/State 上传为公开 Artifact；
- 禁止在常规流水线开启 Provider TRACE；
- 必须调试时使用隔离环境、短时日志、脱敏与销毁；
- Runner 工作目录、缓存和崩溃文件纳入清理；
- 使用 Ephemeral Runner 减少跨任务残留；
- 凭据泄漏后轮换真实 Secret，而非只删日志。

## 13. 流水线失败如何处理

Plan 失败不一定无副作用：Provider/Data Source 已经访问外部系统；测试 Run 可能已创建资源。Apply 失败则按部分执行处理。

流水线必须在失败路径也上传受控日志、释放正常锁、报告残留和触发清理；不得无条件 `force-unlock`。

## 14. 练习与答案

**问题：为什么 Policy 通过仍不能自动批准生产 Apply？**

答案：Policy 只检查已编码规则和可见输入，不理解所有业务影响、数据迁移、维护窗口与未知值。它降低风险，但不能替代变更所有者和业务验收。

**问题：Mock Provider 测试成功说明 Module 可在云上创建资源吗？**

答案：不能。Mock 验证 HCL 逻辑和 Schema 交互，不验证真实凭据、配额、API、最终一致与销毁。还需隔离账号集成测试。

参考资料：

- [Terraform test command](https://developer.hashicorp.com/terraform/cli/commands/test)
- [Terraform provider mocking](https://developer.hashicorp.com/terraform/language/tests/mocking)
- [OpenTofu test command](https://opentofu.org/docs/cli/commands/test/)
