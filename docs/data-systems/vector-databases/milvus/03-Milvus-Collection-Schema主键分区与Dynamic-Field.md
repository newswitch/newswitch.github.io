---
title: "Collection、Schema、Primary Key、Partition 与 Dynamic Field"
sidebar_label: "03. Collection、Schema、Primary Key、Partition 与 Dynamic Field"
sidebar_position: 3
tags: [Milvus, Collection, Schema, Partition]
description: "设计 Milvus Collection、向量/标量字段、主键、分区和租户边界。"
---

# Collection、Schema、Primary Key、Partition 与 Dynamic Field

Collection 是 Schema、索引和数据生命周期的主要边界。写入前固定：Embedding 版本、维度、metric、主键、标量过滤字段、租户和保留策略。

## 字段

```text
primary key: Int64 or VarChar（手动/自动 ID）
vector: dense/sparse/binary according to model
scalar: tenant, time, type, ACL, version
dynamic field: unmodeled JSON-like fields（谨慎）
```

主键用于 get/delete/upsert 和幂等。若上游已有业务 ID，保存稳定 ID；自动 ID 需另存业务唯一键并处理重复。

## Partition

Partition 可减少特定查询范围和管理数据，但过多分区增加 metadata、加载和调度成本。租户隔离可选独立 Collection、Partition Key 或标量过滤：

| 方式 | 隔离 | 规模风险 |
| --- | --- | --- |
| Collection/tenant | 强 | Collection 爆炸 |
| Partition/tenant | 中 | Partition 爆炸 |
| shared + tenant filter | 逻辑 | 必须强制 ACL filter |

## Dynamic Field

适合低频、演进中的元数据，不等于不用 Schema。高频过滤字段应显式类型化；动态键无界会增加存储、过滤复杂度和治理风险。

## 版本化

模型/维度/metric 或不可兼容 Schema 变化时新建 Collection，离线回填、双读评测、Alias/应用路由切换，再保留回滚窗口。

## 验收题

- 主键如何支持幂等写入？
- 每租户一个 Partition 为什么不可无限扩展？
- Dynamic Field 何时应转为显式字段？
- 模型换维度为何需要新 Collection？

## 参考资料

- [Manage collections](https://milvus.io/docs/manage-collections.md)
- [Schema](https://milvus.io/docs/schema.md)
