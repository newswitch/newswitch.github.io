---
title: "Rego v1 语法、规则与数据模型"
sidebar_label: "02. Rego v1 语法与规则"
sidebar_position: 2
description: "从 Package、Rule、变量、集合、对象和 if/contains 语法理解 Rego 的声明式求值模型。"
tags: [OPA, Rego v1, Policy, 规则, 数据模型]
---

# Rego v1 语法、规则与数据模型

## 1. 声明式思维

Rego 描述“在什么条件下某个文档成立”，不是按顺序修改变量的脚本。Rule 可以生成布尔值、集合、对象或标量，求值器寻找满足条件的绑定。

## 2. 一个完整策略

```rego
package kubernetes.image

import rego.v1

default allow := false

deny contains msg if {
  container := input.spec.containers[_]
  not contains(container.image, "@sha256:")
  msg := sprintf("container %q must use an image digest", [container.name])
}

allow if count(deny) == 0
```

`package` 决定查询路径；`import rego.v1` 使用明确的 v1 规则语法；`default` 定义无规则命中时的结果；`deny` 收集可读原因。

## 3. 基本数据类型

Rego 使用 Null、Boolean、Number、String、Array、Object 和 Set。Set 无顺序且元素唯一，适合权限与违规集合；Array 保留顺序，适合输入列表。不要依赖 Object 遍历顺序产生业务结果。

## 4. 变量与统一

```rego
some i
container := input.spec.containers[i]
```

变量由条件约束求得，不是命令式赋值。`:=` 用于局部变量，`==` 比较值，`=` 表示统一；团队约定应优先使用语义明确的写法并通过 Lint 约束。

## 5. 多条规则

多个同名集合规则可从不同安全维度添加 Deny Reason，便于模块化。布尔规则的合并语义需要明确，避免误以为后一个规则会覆盖前一个。

## 6. 返回结构化决策

生产决策不应只有一个布尔值：

```rego
decision := {
  "allowed": count(deny) == 0,
  "violations": deny,
  "policy_version": data.metadata.revision,
}
```

调用方据此显示原因、记录 Revision 并选择阻断或告警。不要在消息中包含 Secret 或完整用户 Payload。

## 7. 学习验收

为镜像 Digest、资源上限和禁止特权分别编写规则；输入合法时 `allow=true`，每种不合法输入都返回稳定、可定位的原因。
