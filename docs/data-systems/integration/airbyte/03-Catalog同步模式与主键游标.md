---
title: "Airbyte Catalog、同步模式与主键游标"
sidebar_label: "03. Catalog、同步模式与主键游标"
sidebar_position: 3
description: "通过订单更新区分 Full Refresh、Incremental、Append、Overwrite、Deduped、业务主键、游标与 CDC，说明删除和乱序边界。"
tags: [Airbyte, Catalog, 增量同步, 数据契约]
---

# Airbyte Catalog、同步模式与主键游标

源端怎么读与目标怎么保存是两个维度。增量读取不自动去重，目标去重也不会凭空发现源端删除。本篇依据 **2026-11-14 官方文档**解释模式；界面中可选组合与真实行为以所选源/目标连接器版本为准。

## 1. Catalog 从发现到配置

发现结果描述 Stream、字段与能力；配置结果选择 Stream，并指定读取和写入相关设置。表被 discover 到，不代表它已经纳入同步；新增列也可能因字段选择或变更策略没有进入目标。

上线前记录：源端库/schema/table、选中 Stream、namespace 与目标命名方式、主键、游标、模式、计划，以及 schema 变化策略。不同 namespace 下的同名表不能只按短表名比较。

## 2. 四种常见组合

| 源读取与目标保存 | 预期行为 | 需要防范 |
| --- | --- | --- |
| Full Refresh + Append | 每次读全量并继续追加 | 多次运行产生重复通常符合配置 |
| Full Refresh + Overwrite | 以本次全量替换目标结果 | 覆盖范围、失败时可见性、目标保护 |
| Incremental + Append | 增量变化继续追加 | 同键多版本与边界重放 |
| Incremental + Append + Deduped | 按键和游标/版本等规则形成最新结果 | 主键错误、游标精度、删除与实现差异 |

有些连接器还支持其他模式或可恢复全量，不能把这张表当成全平台固定枚举。Overwrite 的实现可能涉及临时表、交换或其他发布步骤，需要检查具体目标，不能假定始终是同一条 TRUNCATE。

## 3. 主键、游标和日志位置的区别

业务主键回答“这是哪笔订单”，例如 `order_id=101`；游标回答“从哪个进度继续找变化”，例如 `updated_at`；CDC 日志位置则描述事务日志读取进度。这三个值承担不同职责。

```text
源记录版本：101 / pending / 10:00
后续更新：  101 / paid    / 10:05

Append：可能保留两个版本
Deduped：按有效规则形成 101 的最新结果
```

把 `updated_at` 当主键，会把同秒多笔订单误认为同一实体；把不随更新变化的 `order_id` 当唯一增量游标，则可能漏掉旧订单的状态变化。复合主键必须包含完整业务身份，不能为了好配置只选其中一列。

## 4. 游标边界为什么困难

时间精度相同、迟到提交、时钟差异和分页排序不稳定，都可能让相邻同步出现重复或遗漏。连接器可能使用重叠窗口、复合状态或特定分页方式处理边界，因此 State 不能简单等于“当前目标最大时间”。

若一笔业务 10:01 更新了时间字段，却到 10:06 才提交，而另一笔已让水位推进到 10:05，朴素 `updated_at > 10:05` 会漏掉前者。解决需要可信的源语义、经过设计的回看窗口/复合排序，或改用支持的日志 CDC，而不是只把同步频率调快。

## 5. 删除与历史要单独设计

普通时间戳查询看不到已从表中消失的行。CDC 能否表达删除，还依赖 Source 发出相应事件、Destination 理解该语义和选定模式。定期全量比对或软删除标志是另外的方案，不应冒充日志 CDC。

Append 的多版本数据不等于完整审计历史；Deduped 的最新表也不保证保留完整历史。目标连接器不同版本的内部表、元数据列和类型处理会变化，不要依赖未承诺的内部表名来构建长期应用。

## 6. 练习与答案

**问题一：全量 Append 连续跑两次，多出一倍数据是否一定 bug？**

答案：不是。该模式本来就追加全量；如果需要替换或按键形成最新结果，应选择支持的模式并验证其发布语义。

**问题二：主键与游标为什么不能随便选同一字段？**

答案：主键标识实体，游标标识变化进度；字段可能只满足其中之一，混用会漏更新或错误合并记录。

**问题三：每分钟增量同步，为什么删除仍残留在目标？**

答案：普通查询看不到已删除行，频率不改变这种能力。需要软删除、对账或兼容的 CDC 删除传播。

**问题四：Deduped 是否自动给出永久可追溯历史？**

答案：不是。应单独设计历史模型与保留策略，不依赖连接器内部表作为无条件稳定的审计接口。

参考：[同步模式](https://docs.airbyte.com/platform/using-airbyte/core-concepts/sync-modes)、[Incremental Append + Deduped](https://docs.airbyte.com/platform/using-airbyte/core-concepts/sync-modes/incremental-append-deduped)、[协议与 Catalog](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol)。
