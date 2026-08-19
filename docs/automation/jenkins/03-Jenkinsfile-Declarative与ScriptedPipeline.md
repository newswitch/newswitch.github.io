---
title: "Jenkinsfile、Declarative 与 Scripted Pipeline"
sidebar_label: "03. Jenkinsfile 与 Pipeline"
sidebar_position: 3
description: "掌握 Pipeline 结构、Stage、Step、Post、参数、环境、条件、错误和可恢复边界。"
tags: [Jenkinsfile, Declarative Pipeline, Scripted Pipeline, Groovy]
---

# Jenkinsfile、Declarative 与 Scripted Pipeline

## 1. Declarative 示例

```groovy
pipeline {
  agent none
  options { timestamps(); timeout(time: 30, unit: 'MINUTES') }
  stages {
    stage('Test') {
      agent { label 'linux-small' }
      steps { sh './scripts/test.sh' }
    }
  }
  post { always { junit 'reports/*.xml' } }
}
```

## 2. Declarative 与 Scripted

Declarative 提供结构和校验；Scripted 更灵活也更容易把复杂业务塞进 Groovy。Pipeline 只编排，复杂逻辑放入可测试工具或 Shared Library。

## 3. Agent none

顶层不占用 Agent，Stage 按需申请资源，人工审批不会长期占 Executor。

## 4. 参数与环境

参数视为不可信输入，做枚举和格式校验。环境变量适合少量配置，不把复杂 JSON 和 Secret 无边界传播。

## 5. Post 与状态

`post` 用于测试报告、证据上传和通知。Cleanup 失败不要覆盖原始失败；区分 Unstable、Failed、Aborted。

## 6. Restart/Replay

Pipeline 恢复取决于 Step 可持久化语义、Controller 状态和外部副作用。Replay 会改变运行代码而不一定进入 Git，生产应限制并审计。

## 7. Shell

`sh` 中固定脚本进入仓库，使用安全参数和退出码。不要把用户参数直接插入 Groovy 字符串再交给 Shell。
