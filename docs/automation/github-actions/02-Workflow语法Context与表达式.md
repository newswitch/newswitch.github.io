---
title: "GitHub Actions Workflow 语法、Context 与表达式"
sidebar_label: "02. Workflow 语法与 Context"
sidebar_position: 2
description: "掌握触发器、Job DAG、Context、表达式、变量、输出、默认 Shell 和条件执行的求值边界。"
tags: [GitHub Actions, YAML, Context, Expression, Workflow]
---

# GitHub Actions Workflow 语法、Context 与表达式

## 1. 最小结构

```yaml
name: verify
on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<reviewed-commit-sha>
      - run: ./scripts/test.sh
```

生产仓库应显式声明权限和超时。示例中的 Action 固定到经过审查的完整提交，而不是浮动 Tag。

## 2. Context 与环境变量

| 来源 | 用途 | 风险 |
| --- | --- | --- |
| `github` | 事件、Ref、SHA、Actor | 标题、分支名等可由外部输入控制 |
| `inputs` | 手工或复用工作流的类型化输入 | 仍要做允许列表验证 |
| `vars` | 非敏感配置 | 不适合 Secret |
| `secrets` | 受保护敏感值 | Fork/环境/作用域语义不同 |
| `needs` | 上游 Job 输出和结果 | 输出大小与未执行状态 |
| `matrix` | 当前矩阵组合 | 组合爆炸 |
| `runner` | Runner 环境信息 | 不应作为授权依据 |

`${{ }}` 由 Actions 表达式引擎求值；Shell 的 `$VAR` 由 Runner 上的 Shell 求值。把不可信 Context 直接拼进 `run` 会产生命令注入，优先通过环境变量传递并在脚本中安全引用。

## 3. Job DAG 与输出

`needs` 同时表示控制依赖和允许读取的上游输出。默认上游失败会阻断下游；清理 Job 可使用明确的状态函数，但不能吞掉主流程失败。

Step 输出写入平台提供的环境文件，再映射为 Job Output。输出适合短小标量；大型报告使用 Artifact，不塞进表达式和日志。

## 4. 触发过滤

分支、Tag、Path 过滤会影响 Required Check 是否出现。设计必需检查前测试“文档变更”“删除文件”“合并队列”“Fork PR”等场景，避免 PR 永久等待一个未创建的 Check。

## 5. YAML 与表达式陷阱

- 布尔值、空字符串和未定义值不能只凭视觉判断。
- `if` 中的外部字符串先规范化并做允许列表。
- 多行 Shell 使用严格模式并检查管道退出码。
- `working-directory`、Shell 和默认权限在仓库层明确。
- 输出 Secret 即使被掩码，也可能通过编码、分片或制品泄漏。
