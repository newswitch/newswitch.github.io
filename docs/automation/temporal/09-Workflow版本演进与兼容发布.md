---
title: "Temporal Workflow 版本演进与兼容发布"
sidebar_label: "09. Workflow 版本演进"
sidebar_position: 9
description: "安全修改长期运行 Workflow，使用 Replay、兼容分支、Worker 路由和分阶段部署避免非确定性。"
tags: [Temporal, Versioning, Determinism, Deployment, Compatibility]
---

# Temporal Workflow 版本演进与兼容发布

## 1. 为什么比普通服务更难

旧 Workflow 的 Event History 可能运行数月。新 Worker 接到其 Task 后会用新代码 Replay 旧 History。改变 Command 顺序、删除已执行分支或更换 Activity Type 都可能导致非确定性。

## 2. 变更分类

| 变更 | 风险 |
| --- | --- |
| 修改日志/不影响 Command 的纯计算 | 较低，仍需 Replay |
| 新增尚未进入的分支 | 需验证历史路径 |
| 改变 Activity/Timer/Child 顺序 | 高风险 |
| 修改输入输出 Schema | 需兼容旧 Payload |
| 移除旧 Workflow/Activity Type | 会影响未完成任务 |

## 3. 兼容策略

根据 SDK/平台版本选择受支持的 Patch/Versioning/Worker Deployment 机制。核心目标是一致的：旧 History 仍由兼容代码处理，新启动 Workflow 使用新逻辑，并能逐步迁移。

不要在文章或公共模板中把某个实验性 API 固定为永久方案；升级时参考当前官方版本。

## 4. 发布流程

```text
新代码
→ 单元/Workflow/Replay 测试
→ 注册新版本 Worker
→ 先处理测试/新 Workflow
→ 观察 Task/非确定性/延迟
→ 分批路由生产
→ 保留旧 Worker 直到旧执行完成或迁移
→ 删除兼容代码前再次清点
```

## 5. Schema 演进

输入使用可扩展对象和版本字段，新增字段有默认值，旧 Worker 能忽略未知字段。Activity 结果变化要兼容已记录在 History 的旧格式。

## 6. 回滚

若新 Worker 已产生新 History Event，简单回滚旧代码可能同样不兼容。回滚方案必须考虑已经执行到新分支的 Workflow，必要时保留双版本或使用修复 Workflow。

## 7. 清理

通过可见性查询、指标和业务台账确认没有旧版本执行/任务，再移除旧 Worker、Activity 和兼容分支。保留发布版本到 Build/Commit/Worker 的映射。
