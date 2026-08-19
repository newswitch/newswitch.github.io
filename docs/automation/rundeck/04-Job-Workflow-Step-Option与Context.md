---
title: "Rundeck Job、Workflow、Step、Option 与 Context"
sidebar_label: "04. Job、Workflow 与 Option"
sidebar_position: 4
description: "构建参数化 Job，掌握节点/工作流步骤、策略、Options、Context、输出捕获和 Job Reference。"
tags: [Rundeck, Job, Workflow, Option, Context]
---

# Rundeck Job、Workflow、Step、Option 与 Context

## 1. Job 是稳定接口

Job 定义名称、描述、Options、Node Filter、Workflow、并发、超时、通知和权限。用户调用的是受版本控制的自动化接口，不应每次粘贴任意命令。

## 2. Step 类型

| 类型 | 执行范围 | 示例 |
| --- | --- | --- |
| Node Step | 对每个目标节点执行 | 命令、脚本、Ansible、节点插件 |
| Workflow Step | 整个 Execution 执行一次 | API 调用、审批、聚合、通知 |
| Job Reference | 调用另一个 Job | 复用受控能力 |

区分“每节点一次”和“全局一次”，避免数据库迁移对每台主机重复执行。

## 3. Options

为 Option 定义类型、必填、默认、允许值/正则、多值、Secure 和说明。环境、服务和动作使用枚举；自由文本进入脚本前再验证长度和字符。

Secure Option 只降低显示风险，不应通过普通命令参数传递。尽量在插件/脚本进程环境或临时文件中使用，并确保日志脱敏。

## 4. Context 与输出

Execution、Job、Option、Node 和 Step 产生 Context 变量。引用前确认求值阶段和作用域；节点属性不能在全局 Step 中按想象自动存在。

捕获输出用于后续 Step 时，定义稳定键、大小和敏感性。大型结果存外部对象存储，Context 只传引用和校验和。

## 5. Job Reference

被调用 Job 是独立权限和版本边界。显式传递允许的 Option，不把调用方所有 Context/Secret 透传。避免循环引用，设置最大层级和超时。

## 6. 版本管理

Job 定义导出到 Git，变更经过 Review、测试和审批；生产导入由 CI/API 完成。UI 紧急修改要回写源码并审计，防止运行配置漂移。
