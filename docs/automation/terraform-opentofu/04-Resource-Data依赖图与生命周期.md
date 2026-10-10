---
title: "Resource、Data、依赖图与生命周期"
sidebar_label: "04. Resource、Data 与依赖图"
sidebar_position: 4
description: "从资源地址、Provider Schema、Data Source、依赖图、生命周期和并发执行理解 Terraform/OpenTofu 如何把配置转换为远端操作。"
tags: [Terraform, Resource, Data Source, Dependency Graph, Lifecycle]
---

# Resource、Data、依赖图与生命周期

资源块只是配置入口。真正决定动作的是资源地址、State 绑定、Provider Schema、刷新结果和依赖图。读懂这五层，才能解释为什么一个字段变化会原地更新、替换或传播到下游。

## 1. Resource 的三种身份

```hcl
resource "example_server" "node" {
  for_each = var.nodes
  name     = each.key
  size     = each.value.size
}
```

它同时具有：

- **配置地址**：`example_server.node["node-a"]`；
- **State 绑定**：地址与远端 ID 的映射；
- **远端身份**：云 API 中的实例 ID。

修改显示名称不一定改变地址，修改 `for_each` Key 一定改变地址。若没有 `moved` 声明，Core 往往会把旧地址视为删除、新地址视为创建。

## 2. `count` 与 `for_each`

```hcl
resource "example_server" "node" {
  count = length(var.names)
  name  = var.names[count.index]
}
```

列表中删除第二项会使后续索引整体移动，可能造成多个实例更新或替换。对象集合通常更适合：

```hcl
resource "example_server" "node" {
  for_each = var.nodes
  name     = each.key
}
```

Key 应是稳定业务身份，不能使用 Apply 后才知道的随机 ID，也不要轻易包含可变属性。

## 3. Provider Schema 决定差异语义

Provider 为每个属性声明 Required、Optional、Computed、Sensitive，以及更新或替换行为。常见情况：

- Optional + Computed：用户可设置，也可能由 API 返回默认；
- Computed：Plan 时通常 Unknown，Read 后写入 State；
- 修改需要替换：Plan 显示 Destroy/Create；
- Set/List 选择不当：API 排序变化造成永久 Diff；
- 默认值归一化：配置 `null`，API 返回空字符串。

因此永久 Diff 不一定是 HCL 错误，可能是 API 与 Provider Schema 的归一化问题。

## 4. Data Source 是只读查询，不是免费常量

```hcl
data "example_image" "base" {
  name = var.image_name
}
```

Data Source 不拥有对象生命周期，但会调用外部 API，可能受权限、限流、网络和远端变化影响。结果可能在 Plan 时读取，也可能因输入 Unknown 延迟到 Apply。

不要用“最新镜像”查询直接驱动生产自动升级，除非明确接受每次 Plan 都可能替换实例。更安全的做法是将已验收的不可变镜像 ID 作为版本化输入。

## 5. 隐式依赖

```hcl
resource "example_subnet" "app" {
  network_id = example_network.main.id
}
```

引用建立 `network → subnet` 的图边。Core 会等待上游值可用，再调度下游。Output 和 Module 输入也能传播依赖。

依赖不是按文件顺序建立，也不应通过文件名排序模拟。

## 6. `depends_on` 的使用边界

只有存在真实顺序关系、但没有任何数据引用能表达时才使用：

```hcl
resource "example_service" "app" {
  depends_on = [example_policy_attachment.runtime]
}
```

在整个 Module 上添加 `depends_on` 可能让大量值变成 Unknown，并把原本可并发的图串行化。优先传递具体 Output，让依赖边准确落到需要的对象。

## 7. 生命周期参数

### 7.1 `create_before_destroy`

先创建替代对象再删除旧对象，可降低中断，但需要：双份配额、名称可共存、流量切换和数据同步。数据库或唯一名称资源不能只加这一行就零停机。

### 7.2 `prevent_destroy`

阻止当前配置生成 Destroy，但不是权限控制或备份；删除该规则后仍能销毁。关键数据还需要云侧删除保护、备份和审批。

### 7.3 `ignore_changes`

表示某些字段由外部控制器拥有。它会隐藏该字段漂移，应记录外部 Owner、允许范围和审计方式。不要用它压掉无法理解的永久 Diff。

### 7.4 `replace_triggered_by`

上游变化触发替换，适用于制品版本等显式依赖，但可能造成替换传播。Plan 审查要查看整个爆炸半径。

## 8. Destroy/Create 顺序与传播

Provider 标记某字段只能替换后，Core 会结合依赖图安排顺序。若下游也依赖被替换对象的不可变 ID，替换可能继续传播。

审查时不能只看资源总数：

```text
1 to add, 1 to change, 1 to destroy
```

必须打开每个地址，确认 `-/+`、`+/-` 或等价动作、触发字段和依赖影响。

## 9. Provisioner 为什么是最后手段

`local-exec`、`remote-exec` 难以提供稳定幂等、错误恢复和完整 State 语义。远程命令成功与否也不代表主机达到期望配置。

优先选择：

- 云初始化或镜像预构建；
- Ansible 配置管理；
- Kubernetes/GitOps Controller；
- Provider 原生资源。

必须使用 Provisioner 时，限制用途、敏感输出、超时和失败恢复，并避免把它变成隐藏的主流程。

## 10. 并发与 API 限流

Core 按图并发调度，`-parallelism` 只控制并行操作上限：

```bash
terraform apply -parallelism=5 tfplan
```

降低并发可缓解 API 限流或脆弱服务，但不能修复错误依赖、热点账号配额和 Provider 非幂等。提高并发也可能使创建更慢，因为退避和限流增加。

## 11. 资源超时与异步 API

许多云 API 先返回任务 ID，Provider 轮询直到 Ready。Apply “卡住”可能是在等待远端状态、API 限流或 Provider Poller，不一定是 Core 死锁。

排障时同时查看：Provider 日志、云审计、资源事件、配额和实际状态。不要在不确认远端动作的情况下终止后立刻重跑。

## 12. 练习与答案

**问题：为什么在资源上添加 `depends_on = [module.network]` 后，Plan 出现更多 `(known after apply)`？**

答案：对整个 Module 建立宽依赖，使 Core 保守地延迟更多读取和求值。应通过具体 Output 建立最小依赖，或只依赖真正的前置对象。

**问题：`create_before_destroy` 为什么仍可能停机？**

答案：新旧资源可能因唯一名称/配额无法共存，流量或 DNS 也未自动切换，数据还可能没有复制。它只改变资源动作顺序，不完成业务迁移。

参考资料：

- [Terraform resources](https://developer.hashicorp.com/terraform/language/resources)
- [Terraform resource behavior](https://developer.hashicorp.com/terraform/language/resources/behavior)
- [OpenTofu resource block](https://opentofu.org/docs/language/resources/syntax/)
