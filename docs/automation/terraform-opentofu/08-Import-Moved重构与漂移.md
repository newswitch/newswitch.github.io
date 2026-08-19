---
title: "Import、Moved、重构与漂移"
sidebar_label: "08. Import、Moved、重构与漂移"
sidebar_position: 8
description: "安全导入存量资源、迁移资源地址、拆分 Module、检测漂移并处理字段所有权。"
tags: [Terraform, Import, Moved, Refactor, Drift]
---

# Import、Moved、重构与漂移

## 1. Import 只建立映射

导入把配置地址与已有远端 ID 关联，不自动生成正确业务配置，也不证明所有属性受管。流程：

```text
盘点资源和依赖
→ 编写最小配置
→ 在隔离 State 导入/规划
→ 迭代配置直到 Plan 符合预期
→ 评审后接管生产 State
```

导入后首次 Apply 前必须审查 Replace/Delete。

## 2. Moved

资源改名或移入 Module 时，用声明式 Moved 记录地址迁移，使代码审查者和后续运行能理解重构。一次迁移不要同时大改资源属性。

```hcl
moved {
  from = example_server.old
  to   = module.compute.example_server.node
}
```

具体语法和支持范围以所选 CLI 版本为准。

## 3. for_each 迁移

从单资源或 `count` 改成 `for_each` 会改变地址。先设计稳定 Key，列出旧新地址映射，并在测试 State 演练。

## 4. 漂移

来源包括控制台手改、外部控制器、自动扩缩、Provider 默认变化和 API 归一化。发现漂移后选择：

- 用 IaC 恢复期望。
- 将真实变化正式写回配置。
- 明确把某字段所有权交给外部系统。

不要无差别 `ignore_changes` 隐藏问题。

## 5. 拆分 State

拆分降低爆炸半径，也增加依赖和发布协调。跨 State 通过稳定 Output/数据接口连接，不直接读取对方内部 State 文件。

## 6. 验收

- [ ] 旧新地址映射完整。
- [ ] Plan 不包含意外 Destroy/Replace。
- [ ] State 已备份且无并发 Apply。
- [ ] 重构与行为变化分开。
- [ ] 全量 Plan 和业务验收通过。
