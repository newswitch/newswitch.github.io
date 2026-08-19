---
title: "Terraform/OpenTofu 测试、CI、Policy 与安全"
sidebar_label: "09. 测试、CI、Policy 与安全"
sidebar_position: 9
description: "建立 fmt、validate、测试、Plan 审查、Policy as Code、短期凭据、分支保护和 Apply 隔离。"
tags: [Terraform, OpenTofu, CI, Policy as Code, Security]
---

# Terraform/OpenTofu 测试、CI、Policy 与安全

## 1. 流水线层次

```text
fmt
→ validate
→ 静态/安全检查
→ Module 测试
→ 测试账号 Plan/Apply
→ 生产 Plan
→ 人工与策略审查
→ 受保护 Apply
→ 业务验收
```

## 2. PR 权限边界

来自 Fork 或不可信分支的配置和 Provider 代码不能取得生产凭据。Plan 本身会调用 Data Source 和 Provider 读取 API，也不是纯文本检查。

## 3. Plan 审查

展示新增、更新、替换、删除、敏感变化和目标环境。机器摘要不能替代原始 Plan，原始 Plan 又可能含 Secret，需要受控保存。

## 4. Policy as Code

策略检查：

- 禁止公网暴露和过宽 IAM。
- 生产资源必须加密、备份和标签。
- 限制实例规格、区域和成本。
- Destroy/Replace 需要更高级审批。

策略输入可能是配置、Plan JSON 或云资产；三者看到的信息不同。

## 5. 身份

CI 使用 OIDC/工作负载身份取得短期凭据，Plan 与 Apply 可以分离权限。Apply 身份仅能管理声明范围，不应是账号管理员。

## 6. Secret

- 不提交变量文件和凭据。
- 不在 CLI 参数和日志输出 Secret。
- Backend 和 Plan 制品加密、审计、最小访问。
- Provider Debug 日志按敏感数据处理。

## 7. 测试

Unit/Module 测试验证表达式和资源属性；集成测试在隔离账号真实创建资源；结束时即使测试失败也要可靠清理并报告残留。

## 8. Apply 串行化

同一 State 只有一个受信流水线 Apply。环境级并发、审批和锁统一管理，禁止开发者绕过平台在本地持生产凭据直接 Apply。
