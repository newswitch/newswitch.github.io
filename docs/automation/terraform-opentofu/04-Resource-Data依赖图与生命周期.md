---
title: "Resource、Data、依赖图与生命周期"
sidebar_label: "04. Resource、Data 与依赖图"
sidebar_position: 4
description: "理解资源地址、Data Source、隐式/显式依赖、for_each、生命周期和替换传播。"
tags: [Terraform, Resource, Data Source, Dependency Graph, Lifecycle]
---

# Resource、Data、依赖图与生命周期

## 1. Resource 与地址

```hcl
resource "example_server" "node" {
  for_each = var.nodes
  name     = each.key
  size     = each.value.size
}
```

地址类似 `example_server.node["node01"]`。选择稳定业务键比 `count` 索引更适合对象集合，删除中间元素不会让后续地址整体移动。

## 2. Data Source

Data 读取外部现状，不拥有资源生命周期。结果可能在 Plan 或 Apply 才知道，也可能因外部变化导致差异。不要把高频不稳定查询无边界放入巨大图。

## 3. 依赖图

引用另一个资源属性会形成隐式依赖。只有没有数据引用但确有顺序关系时才考虑 `depends_on`；过度显式依赖会降低并发并产生更多 Unknown。

## 4. Lifecycle

常见策略需谨慎：

- `create_before_destroy`：需要配额、唯一名称和双份资源容量。
- `prevent_destroy`：提供保护但不是备份，也可被配置移除。
- `ignore_changes`：明确把字段所有权让给外部系统，可能隐藏真实漂移。
- `replace_triggered_by`：上游变化触发替换，评估爆炸半径。

## 5. ForceNew/替换

某些 Provider 字段变化只能 Replace。Plan 中 `-/+` 或等价符号必须结合数据持久性、IP、依赖、DNS 和停机分析。

## 6. 并发

Core 按图并发执行，但外部 API 配额、Provider 实现和资源锁决定实际吞吐。降低 `parallelism` 可缓解限流，却不能修复错误依赖或非幂等 Provider。

## 7. 验收

每个资源明确 Owner、数据持久性、Delete 影响、替换策略、配额和业务验收。云资源创建成功不代表应用可用。
