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

## 8. Undefined 怎样传播

```rego
is_prod if input.metadata.labels.environment == "prod"
```

只要中间任一路径不存在，`is_prod` 就没有结果，而不是自动得到 `false`。如果最终 API 直接查询一个 Undefined 文档，调用者甚至可能拿不到预期的布尔字段。

安全决策应提供总是有值的入口：

```rego
default decision := {"allowed": false, "violations": [{"id": "INPUT-INVALID"}]}

decision := {"allowed": count(deny) == 0, "violations": deny} if {
  valid_input
}
```

先验证 Input Schema，再执行业务规则，避免畸形输入绕过。

## 9. `object.get` 只能解决“缺失默认”

```rego
replicas := object.get(input.spec, "replicas", 1)
```

默认值必须与上游 API 的真实默认一致。它不会检查类型：若 `replicas` 是字符串，还需 Schema 或显式类型规则。对安全敏感字段，不存在时往往应该产生 `INPUT-MISSING`，而不是静默给出宽松默认。

## 10. Data 的所有权与新鲜度

允许仓库、团队映射和环境等级等 Base Data 需要：

- Schema 和版本；
- 数据 Owner 与来源；
- 生成时间、有效期和 Revision；
- 空数据/过期数据时的失败策略；
- Policy 与 Data 的兼容版本测试。

实时从 Rego 内发网络请求会破坏可重复性并增加延迟。通常由控制面先生成 Data，再通过 Bundle 原子分发。

## 11. 集合推导与差集

```rego
requested := {c.image | some c in input.spec.containers}
approved := {img | some img in data.platform.approved_images}
unapproved := requested - approved

deny contains msg if {
  count(unapproved) > 0
  msg := {"id": "IMG-002", "images": sort([x | some x in unapproved])}
}
```

Set 适合成员和差集；输出给用户时再转为稳定排序 Array，防止结果顺序抖动造成无意义 Diff。

## 12. `walk` 的使用边界

`walk` 能遍历未知深度的文档，适合探索 Parser 产生的语法树或查找通用字段，但对大 Input 可能代价高，也容易匹配不相关位置。已知 Kubernetes/Terraform Schema 时优先显式路径。

## 13. Schema 漂移

上游 Kubernetes API、Terraform Provider 或自定义 Input 契约升级后，要同时更新：

```text
JSON Schema
→ Parser/适配层
→ Rego 规则
→ Golden Input
→ 缺失与未知字段测试
```

在旧规则不认识新资源类型时，核心安全门禁应拒绝或升级人工评审，不能因 Undefined 自动通过。

## 14. 练习与答案

**问题：`not input.spec.securityContext.privileged` 能安全表达“未开启特权”吗？**

答案：不够清晰。字段缺失时也可能使否定成立，但真实默认语义和嵌套路径可能不同。应先使用 Schema/`object.get` 明确缺失含义，再判断值。

**问题：为什么 Base Data 更新也需要回归测试？**

答案：Policy 逻辑不变时，允许列表或团队映射变化同样会改变决策。数据与代码都是决策输入，都必须可版本、可评审和可回滚。

参考资料：

- [How to optimize memory](https://www.openpolicyagent.org/docs/performance)
- [Schemas](https://www.openpolicyagent.org/docs/policy-language/#schema)
