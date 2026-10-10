---
title: "Import、Moved、Removed、重构与漂移"
sidebar_label: "08. Import、Moved 与漂移"
sidebar_position: 8
description: "使用声明式 Import、Moved 和 Removed 接管存量资源、迁移地址、拆分 State，解释配置生成、漂移与字段所有权。"
tags: [Terraform, Import, Moved, Removed, Refactor, Drift]
---

# Import、Moved、Removed、重构与漂移

存量接管和重构最危险的地方不是 HCL 语法，而是改变“配置地址 ↔ 远端对象”的绑定。安全迁移的目标是：地址发生可解释变化，但真实资源不被意外 Replace 或 Destroy。

## 1. Import 只建立绑定

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "company-prod-logs"
}

import {
  to = aws_s3_bucket.logs
  id = "company-prod-logs"
}
```

Import 不会证明配置完整，不会自动决定字段所有权，也不会把真实资源变得符合团队规范。Apply Import 前必须看后续属性 Diff。

CLI `terraform import ADDRESS ID` 可用于特定流程，但配置块更适合代码审查、批量迁移和重复执行。

## 2. 导入前的资产调查

至少确认：

- 远端唯一 ID 与账号/区域；
- 依赖的网络、IAM、密钥和父对象；
- 是否已被另一个 State 或控制器管理；
- 删除保护、数据持久性和备份；
- Provider 版本如何读取默认值；
- 哪些字段未来由 IaC 拥有，哪些留给外部系统。

同一个远端对象不能安全地长期存在于两个 State 中。

## 3. 配置生成不是最终配置

部分 Terraform 版本支持根据 `import` 块生成候选配置：

```bash
terraform plan -generate-config-out=generated.tf
```

生成结果是 Provider Schema 的机械展开，可能包含只读/默认属性、冗余值和不符合团队抽象的字段。应审查、精简、改成变量/引用，并确认目标版本仍将该功能标记为何种稳定级别。

绝不能生成后直接 Apply 到生产。

## 4. 导入工作流

```text
冻结控制台和其他 State 变更
→ 在隔离目录编写最小配置
→ 添加 import 块
→ Plan: import only，检查是否还有 Update/Replace/Destroy
→ 迭代配置和所有权
→ 备份生产 State
→ 评审并 Apply Import
→ 全量 Plan
→ 业务与资产验收
```

如果首次 Plan 同时显示 Import 和 Replace，先理解触发字段，不要用 `ignore_changes` 把全部差异压掉。

## 5. `moved` 声明地址迁移

```hcl
moved {
  from = aws_instance.web
  to   = module.compute.aws_instance.web
}
```

它告诉 Core：旧地址和新地址是同一对象。适用于资源重命名、移入 Module、`count`/`for_each` 地址迁移等受支持场景。

安全原则：

- 重构地址与修改资源属性分两个提交；
- 明确列出旧/新地址映射；
- 在 State 副本和真实 Provider Read 上验证；
- Plan 应显示 Move，而不是 Destroy/Create；
- 保留迁移声明足够长，支持跨版本升级。

## 6. 从 `count` 迁移到 `for_each`

旧地址：

```text
example_server.node[0]
example_server.node[1]
```

新地址：

```text
example_server.node["api-a"]
example_server.node["api-b"]
```

必须基于真实对象制定一一映射，而不是假设当前列表顺序。若列表曾经改变，State 索引与想象可能不一致。

## 7. `removed` 与停止管理

声明式 `removed` 可让对象从 State 中移除而不销毁远端资源：

```hcl
removed {
  from = aws_s3_bucket.logs

  lifecycle {
    destroy = false
  }
}
```

这表示 IaC 放弃管理，不等于资源安全交接完成。应记录新的 Owner、配置来源、监控、备份和未来删除责任。若配置仍保留对应 `resource`，下一次又会尝试创建。

语法和支持范围随 CLI 版本变化，使用前核对所选 Terraform/OpenTofu 版本。

## 8. 拆分或合并 State

拆分能降低权限和爆炸半径，却会把图内依赖变成跨发布契约。典型流程：

```text
冻结两个 State
→ 备份源和目标
→ 在隔离副本验证地址迁移
→ 从源移出/在目标导入或使用受支持迁移方式
→ 两边分别全量 Plan
→ 验证无重复绑定
→ 恢复单一写入口
```

直接用 Shell 管道在生产 State 之间搬运地址风险很高。优先选择可审查的 Import/Removed 过程，并针对每个 Backend 演练。

## 9. 漂移的来源

- 控制台或 CLI 手工修改；
- 自动扩缩/安全控制器改变字段；
- Provider 升级改变默认或归一化；
- 远端平台自行轮换证书、密码或版本；
- 对象被人工删除；
- API 最终一致/读取顺序产生暂时 Diff；
- 两个 State 争抢同一对象。

漂移不等于错误。关键是明确字段所有权和允许变化范围。

## 10. 漂移处理决策

```text
远端变化是否获批且应保留？
├─ 是：把变化写回配置，评审后收敛
└─ 否：IaC 恢复期望，先评估业务影响

该字段是否由外部 Controller 合法拥有？
├─ 是：最小范围 ignore_changes，并记录 Owner
└─ 否：修复越权入口或双控制面
```

不要把 `ignore_changes = all` 当消除噪声工具。它会使 IaC 对真实配置失明。

## 11. Drift 检测

定时以只读或受限身份运行 Plan，并区分退出状态：无变化、存在差异、执行错误。结果应包含 State、账号、Provider 版本和时间，避免把凭据失效误报成资源消失。

检测任务不应自动 Apply 所有差异。生产漂移可能是紧急变更、攻击或外部控制器行为，需要先归因。

## 12. 故障恢复

出现意外 Replace 时：停止 Apply → 保存 Plan/State → 验证 CLI/Provider/账号 → 找触发属性 → 判断地址迁移还是远端漂移 → 在副本验证 Moved/Import → 重新生成全量 Plan。

若错误 Apply 已经删除对象，State 修复不能恢复数据，必须进入资源和业务备份恢复流程。

## 13. 练习与答案

**问题：Import 成功后为什么 Plan 仍显示大量 Update？**

答案：Import 只建立对象绑定。配置、省略值、Provider 默认、远端实际设置和字段所有权仍可能不同，需要逐项解释并决定期望。

**问题：`state mv` 与 `moved` 有什么主要差异？**

答案：`state mv` 是一次即时 State 操作，迁移意图不留在配置中；`moved` 可进入代码审查并在不同环境/升级路径重复应用。优先声明式方式。

参考资料：

- [Terraform import blocks](https://developer.hashicorp.com/terraform/language/import)
- [Terraform generated import configuration](https://developer.hashicorp.com/terraform/language/import/generating-configuration)
- [Terraform moved block](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Terraform removed block](https://developer.hashicorp.com/terraform/language/block/removed)
