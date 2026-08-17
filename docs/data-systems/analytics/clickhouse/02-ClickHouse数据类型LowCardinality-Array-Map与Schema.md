---
title: "数据类型、Nullable、LowCardinality、Array/Map 与 Schema"
sidebar_label: "02. 数据类型、Nullable、LowCardinality、Array/Map 与 Schema"
sidebar_position: 2
tags: [ClickHouse, Schema, LowCardinality, Nullable]
description: "按压缩、查询、空值、动态属性和写入演进设计 ClickHouse Schema。"
---

# 数据类型、Nullable、LowCardinality、Array/Map 与 Schema

ClickHouse Schema 决定压缩、向量化、排序和聚合成本。

## 类型原则

- 选择能覆盖业务范围的最小整数/Decimal；金额不用 Float；
- `Date/DateTime/DateTime64` 明确精度和时区；
- UUID/IP/Enum 使用原生类型但评估演进；
- String 可放任意字节，不等于无成本动态字段；
- `Nullable(T)` 额外维护 null map，聚合/表达式有三值语义；
- 可用明确默认值时比较 Nullable 与业务歧义。

## LowCardinality

为低基数字符串建立字典编码，减少存储和比较；基数很高或持续变化时字典成本可能抵消收益。用 `uniq`、压缩字节和查询 benchmark 决定。

## Array/Map/JSON

Array 适合每行小集合，`arrayJoin` 会展开并放大行数。Map/JSON 适合动态属性，但高频过滤/聚合键应显式列化，避免每次解析和难以裁剪。

## Schema 演进

ADD COLUMN 带默认表达式时要区分读取时默认与物化写入；ALTER/MATERIALIZE/MUTATION 可能重写大量 Part。采用新列 → 双写/回填 → 校验 → 切查询 → 删除旧列。

## 验收题

- Nullable 为什么影响存储和聚合？
- LowCardinality 何时不适合？
- ArrayJoin 如何放大结果？
- ALTER 为什么可能触发 Mutation？

## 参考资料

- [Data types](https://clickhouse.com/docs/sql-reference/data-types)
- [LowCardinality](https://clickhouse.com/docs/sql-reference/data-types/lowcardinality)
