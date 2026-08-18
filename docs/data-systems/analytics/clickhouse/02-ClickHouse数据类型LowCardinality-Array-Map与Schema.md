---
title: "数据类型、Nullable、LowCardinality、Array/Map 与 Schema"
sidebar_label: "02. 数据类型、Nullable、LowCardinality、Array/Map 与 Schema"
sidebar_position: 2
description: "按压缩、查询、空值、动态属性和写入演进设计 ClickHouse Schema。"
tags: [ClickHouse, Schema, LowCardinality, Nullable]
---

# 数据类型、Nullable、LowCardinality、Array/Map 与 Schema

ClickHouse Schema 决定压缩、向量化、排序和聚合成本。

## 1. 类型原则 {/* #类型原则 */}

- 选择能覆盖业务范围的最小整数/Decimal；金额不用 Float；
- `Date/DateTime/DateTime64` 明确精度和时区；
- UUID/IP/Enum 使用原生类型但评估演进；
- String 可放任意字节，不等于无成本动态字段；
- `Nullable(T)` 额外维护 null map，聚合/表达式有三值语义；
- 可用明确默认值时比较 Nullable 与业务歧义。

## 2. LowCardinality {/* #lowcardinality */}

为低基数字符串建立字典编码，减少存储和比较；基数很高或持续变化时字典成本可能抵消收益。用 `uniq`、压缩字节和查询 benchmark 决定。

## 3. Array/Map/JSON {/* #arraymapjson */}

Array 适合每行小集合，`arrayJoin` 会展开并放大行数。Map/JSON 适合动态属性，但高频过滤/聚合键应显式列化，避免每次解析和难以裁剪。

## 4. Schema 演进 {/* #schema-演进 */}

ADD COLUMN 带默认表达式时要区分读取时默认与物化写入；ALTER/MATERIALIZE/MUTATION 可能重写大量 Part。采用新列 → 双写/回填 → 校验 → 切查询 → 删除旧列。

## 5. Schema 实验与演进边界 {/* #schema-实验与演进边界 */}

ClickHouse 按月快速发布，实验前记录 `SELECT version()`，生产固定具体版本并阅读跨越版本变更。用真实样本而不是只看逻辑字段设计：

```sql
CREATE TABLE schema_lab
(
  ts DateTime64(3, 'UTC'),
  tenant LowCardinality(String),
  tags Map(LowCardinality(String), String),
  values Array(Float32)
) ENGINE = MergeTree ORDER BY (tenant, ts);

INSERT INTO schema_lab VALUES (now64(3), 'a', map('region','cn'), [1,2,3]);
SELECT database, table, column, type, column_data_compressed_bytes
FROM system.parts_columns WHERE table = 'schema_lab' AND active;
```

比较 `String`/`LowCardinality`、Nullable/默认值和不同 ORDER BY 的压缩、写入与查询，不要按名称套类型。Schema 变更要区分 metadata-only 与需要重写 part 的 mutation，先在副本数据上测完成时间、磁盘临时空间和查询影响，再滚动发布读写兼容代码。

## 6. 验收题 {/* #验收题 */}

- Nullable 为什么影响存储和聚合？
- LowCardinality 何时不适合？
- ArrayJoin 如何放大结果？
- ALTER 为什么可能触发 Mutation？

## 7. 参考资料 {/* #参考资料 */}

- [Data types](https://clickhouse.com/docs/sql-reference/data-types)
- [LowCardinality](https://clickhouse.com/docs/sql-reference/data-types/lowcardinality)
