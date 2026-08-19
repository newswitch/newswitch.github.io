---
title: "Rego Input、Data、Undefined 与集合推导"
sidebar_label: "03. Input、Data 与 Undefined"
sidebar_position: 3
description: "掌握输入路径、基础数据、缺失字段、默认值、否定、推导式和可重复求值的边界。"
tags: [OPA, Rego, Input, Data, Undefined]
---

# Rego Input、Data、Undefined 与集合推导

## 1. 三种状态不能混淆

字段可能为 `true`、`false` 或不存在。路径不存在时表达式可能成为 Undefined，后续 Rule 不产生结果；它不自动等价于 `false`。

安全策略应显式处理缺失：例如容器没有 `securityContext` 时，根据平台默认和风险决定拒绝或按默认值评估，不能让规则静默跳过。

## 2. 安全取值

```rego
privileged := object.get(input.securityContext, "privileged", false)
```

`object.get` 可为缺失字段提供默认值。默认值必须来自真实 API 语义，而不是为了让测试通过随意设置。

## 3. `input` 与 `data`

```text
input：本次请求、Plan 或配置
data：Bundle 内策略数据、团队目录、允许列表
```

例如 `data.platform.allowed_registries` 保存受信 Registry。基础数据也要有 Schema、Owner、Review、Revision 和测试；数据错误与策略错误同样危险。

## 4. 否定边界

`not expr` 表示无法证明 `expr` 成立，不应简单理解为值取反。否定中的变量需要先有安全绑定，避免因为搜索空间或 Undefined 产生意外结果。

推荐先获取目标对象，再检查属性：

```rego
deny contains msg if {
  container := input.spec.containers[_]
  not container_has_limits(container)
  msg := sprintf("%q has no resource limits", [container.name])
}
```

## 5. 推导式

Array/Set/Object Comprehension 适合从输入生成中间集合。例如提取所有镜像仓库，再与允许集合做差。中间文档命名清楚并复用，避免多个规则重复遍历巨大输入。

## 6. Schema 与类型

为 Input 和 Base Data 建 JSON Schema，在编辑器、测试和 CI 中检查字段与类型。Schema 不能覆盖所有业务语义，但能提前发现拼写错误、数组/对象混用和 API 版本漂移。

## 7. 测试场景

每条规则至少覆盖：正常值、违规值、字段缺失、空数组、空字符串、未知枚举、额外字段和数据版本不匹配。只测试一个合法与一个非法样本不足以证明策略安全。
