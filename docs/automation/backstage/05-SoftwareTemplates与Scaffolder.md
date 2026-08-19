---
title: "Backstage Software Templates 与 Scaffolder"
sidebar_label: "05. Software Templates"
sidebar_position: 5
description: "使用参数 Schema、模板步骤、Action、凭据、输出和审批构建安全可复用的软件自助创建流程。"
tags: [Backstage, Software Templates, Scaffolder, Golden Path, 自助服务]
---

# Backstage Software Templates 与 Scaffolder

## 1. Golden Path

模板将组织最佳实践变成可选择的起点：仓库结构、CI、部署、监控、Owner 和目录登记。它不是永远锁死的脚手架；创建后的升级还需要模板版本、自动 PR 或平台控制器。

## 2. 执行路径

```text
用户选择模板
→ 表单按 JSON Schema 收集参数
→ 权限/策略校验
→ Scaffolder 创建 Workspace
→ Action 拉取模板、渲染、发布仓库、登记 Catalog
→ 输出链接与执行证据
```

## 3. 输入设计

使用枚举、格式、长度和依赖校验。Owner、Repository、Environment、Runner 和云账户不能由自由字符串控制。敏感参数不放普通表单；优先让后端使用用户授权或短期工作负载身份。

## 4. Action 安全

内置或自定义 Action 都能产生外部副作用。自定义 Action 应：

- 输入类型化并做允许列表；
- 文件路径限制在 Workspace，防目录穿越；
- HTTP 有域名限制、超时和有限重试；
- 外部创建使用幂等键并能查询结果；
- 输出脱敏且不返回长期 Token；
- 支持 Dry Run/测试替身；
- 记录操作者、模板版本和外部资源 ID。

## 5. 权限和审批

“能使用模板”不等于“能创建生产资源”。低风险仓库创建可自动；生产数据库、GPU 配额和公网入口应生成受控 IaC PR 或进入审批工作流，而不是由门户后端直接获得全局管理员权限。

## 6. 模板测试

验证参数边界、渲染结果、CI 语法、Policy、首次构建、Catalog 注册、重复执行和部分失败清理。Golden Test 对比关键文件结构，但允许非语义格式变化。

## 7. 版本与运营

模板有 Owner、版本、兼容矩阵和弃用时间。统计成功率、失败步骤、创建耗时、用户放弃率和创建后首次生产交付时间，优先修复高频阻塞。
