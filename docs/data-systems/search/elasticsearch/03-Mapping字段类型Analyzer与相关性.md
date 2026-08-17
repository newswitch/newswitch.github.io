---
title: "Mapping、字段类型、Analyzer、Tokenizer 与相关性"
sidebar_label: "03. Mapping、字段类型、Analyzer、Tokenizer 与相关性"
sidebar_position: 3
tags: [Elasticsearch, Mapping, Analyzer, BM25]
description: "在写入前设计 Mapping、分析链、多字段和动态字段边界。"
---

# Mapping、字段类型、Analyzer、Tokenizer 与相关性

Mapping 是索引契约。字段首次被动态推断成错误类型后，通常不能原地改成另一类型，需要新索引 Reindex。

## 字段选择

```text
text     全文分析
keyword  精确值/排序/聚合
date     时间语义和格式
numeric  范围/聚合
boolean  状态
object/nested  对象关系（语义不同）
flattened      大量动态键的受控替代
```

普通 object 会把对象数组扁平化，可能产生跨对象错误匹配；nested 把每个子对象作为隐藏文档，查询/存储成本更高。

## 分析链

```text
character filters → tokenizer → token filters
```

Index analyzer 决定写入 term，Search analyzer 处理查询。用 `_analyze` 验证大小写、停用词、同义词、中文分词和边界，不能只看查询结果猜。

## 相关性

BM25 综合 term frequency、inverse document frequency 和字段长度。Boost 不是永久解决数据建模；先确认 analyzer、字段、query 类型和业务标注。多语言和同义词变更通常需要版本化分析链与重建索引。

## Mapping Explosion

将用户任意 JSON key 动态建字段会让 cluster state、Heap 和查询复杂度增长。设置 dynamic 策略、字段总数、模板和未知字段隔离，日志标签优先 flattened/结构化白名单。

## 验收题

- object 与 nested 为什么会产生不同匹配？
- Index/Search Analyzer 不一致何时合理？
- Mapping 为什么难以原地改类型？
- 动态字段怎样影响 master 节点？

## 参考资料

- [Mapping](https://www.elastic.co/docs/manage-data/data-store/mapping)
- [Text analysis](https://www.elastic.co/docs/manage-data/data-store/text-analysis)
