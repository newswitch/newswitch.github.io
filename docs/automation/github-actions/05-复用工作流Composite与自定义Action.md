---
title: "GitHub Actions 复用工作流、Composite 与自定义 Action"
sidebar_label: "05. 复用工作流与 Action"
sidebar_position: 5
description: "比较 Reusable Workflow、Composite Action、JavaScript/Docker Action，设计类型化接口、版本和信任边界。"
tags: [GitHub Actions, Reusable Workflow, Composite Action, 自定义 Action, 平台工程]
---

# GitHub Actions 复用工作流、Composite 与自定义 Action

## 1. 选择复用层级

| 形式 | 复用范围 | 适合 |
| --- | --- | --- |
| Reusable Workflow | 一个或多个完整 Job | 组织级构建、扫描、发布流程 |
| Composite Action | 一个 Job 内的一组 Step | 安装、校验、上传等通用步骤 |
| JavaScript Action | 跨平台 API/逻辑封装 | 复杂输入输出和 GitHub API |
| Docker Action | 固定 Linux 容器环境 | 依赖复杂但接受启动成本的工具 |

不要用 Composite Action 模拟完整审批和多 Job DAG，也不要为三行稳定 Shell 创建难维护的自定义 Action。

## 2. 接口设计

复用单元要明确输入类型、必填项、默认值、输出 Schema、所需权限、Secret、超时和错误语义。调用方传入环境名时使用允许列表，不能让输入自由控制 Runner、镜像、命令或云 Role。

Secret 不会因为嵌套调用自动安全传递。每层只接收所需 Secret，并记录权限来源。

## 3. 版本策略

生产调用应固定不可变提交 SHA；平台可同时提供人类可读发布 Tag 用于发现，但升级由自动 PR 更新 SHA，并附变更说明和测试结果。组织内复用工作流同样属于供应链依赖。

## 4. 自定义 Action 安全

- 对所有输入做长度、格式和允许列表校验；
- 调用子进程使用参数数组，不拼接 Shell；
- HTTP 请求有超时、有限重试和域名限制；
- 输出与日志脱敏，禁止回显 Token；
- 依赖锁定并生成 SBOM/来源证明；
- 测试 Linux/Windows/macOS 或明确只支持的平台；
- 处理取消信号和临时文件清理。

## 5. 模板治理

建立中央仓库、CODEOWNERS、受保护分支、发布说明、兼容测试和弃用窗口。统计各版本使用量，先让调用方迁移再删除旧接口。平台模板的目标是提供安全默认值和可观测接口，而不是隐藏全部底层行为。
