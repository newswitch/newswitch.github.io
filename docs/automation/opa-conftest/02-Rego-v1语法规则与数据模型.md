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

## 8. Complete Rule 与 Multi-value Rule

Complete Rule 产生一个确定文档：

```rego
default allow := false

allow if {
  input.subject.role == "admin"
}
```

Multi-value Rule 用 `contains` 产生集合元素：

```rego
deny contains {"id": "IMG-001", "name": c.name} if {
  c := input.spec.containers[_]
  not contains(c.image, "@sha256:")
}
```

OPA 1.x 默认使用 Rego v1 语法；在需要同时兼容较旧 OPA 的源码中保留 `import rego.v1` 可以明确意图。Bundle Manifest 也应声明 `rego_version`，避免运行时用错误语法解释策略。

## 9. `:=`、`==` 与 `=`

- `:=`：为当前规则中的局部变量赋值，重复赋值会报错；
- `==`：比较两侧已知值；
- `=`：统一，让求值器寻找能使两侧相等的变量绑定。

```rego
container := input.spec.containers[i]
container.name == "api"
[x, "prod"] = input.path
```

团队代码优先使用 `:=` 和 `==` 表达清晰意图，仅在确实需要模式匹配/统一时使用 `=`。

## 10. `some`、`every` 与集合关系

```rego
some c in input.spec.containers
c.image == "repo/api:v1"
```

这表示存在一个满足条件的容器。若要求全部元素满足，可使用 `every` 或通过 Deny 集合表达违规项。空集合上的“全部满足”可能为真，因此还要单独判断“至少存在一个容器”等业务前提。

集合适合成员测试：

```rego
allowed := {"team-a", "team-b"}

allow if input.team in allowed
```

大允许列表放入 `data` 中的 Object/Set 结构，避免每次线性扫描 Array。

## 11. 函数与公共库

```rego
is_digest(image) if {
  contains(image, "@sha256:")
}

deny contains msg if {
  c := input.spec.containers[_]
  not is_digest(c.image)
  msg := sprintf("%s must use digest", [c.name])
}
```

公共函数只封装稳定语义，不读取与名字无关的大量全局数据。函数出现多个可能输出时要理解 Rego 的关系式语义，避免误以为它像命令式语言那样只执行一次并返回首个结果。

## 12. Metadata 与可解释性

使用 OPA Metadata 给 Package/Rule 标记 Title、Description、Severity、Owner 和 Entrypoint。当前 OPA 决策日志还可记录命中规则合并后的 Labels，便于按规则归因；Conftest 也可从 Metadata 生成策略文档。

元数据不能替代稳定违规 ID。规则重命名或拆分时要维护兼容映射，否则历史报表和例外会失效。

## 13. 常见错误

| 错误 | 后果 |
| --- | --- |
| 把规则书写顺序当执行顺序 | 错误理解求值结果 |
| 多个 Complete Rule 产生冲突值 | 求值冲突或 Undefined |
| 默认 `allow=true` 再补黑名单 | 新字段/新类型容易漏放 |
| 依赖 Object/Set 顺序 | 输出不稳定 |
| Deny 只返回自然语言 | 无法稳定做例外和统计 |

## 14. 练习与答案

**问题：两个 `allow if` 规则，一个成立、一个不成立，结果是什么？**

答案：同名布尔规则表达“任一规则能证明 allow”。一个成立时 `allow=true`；不成立的规则不会覆盖它。显式 Deny 模型要通过最终决策规则组合。

**问题：为什么建议 Deny 返回对象而不是纯字符串？**

答案：对象可携带稳定 ID、Severity、资源和字段路径，便于 CI Annotation、例外、报表和自动修复；自然语言可作为 Message 独立变化。

参考资料：

- [Rego policy language](https://www.openpolicyagent.org/docs/policy-language)
- [Rego v1](https://www.openpolicyagent.org/projects/regal/rules/imports/use-rego-v1)
