---
title: "Mapping、字段类型、Analyzer、Tokenizer 与相关性"
sidebar_label: "03. Mapping、字段类型、Analyzer、Tokenizer 与相关性"
sidebar_position: 3
description: "在写入前设计 Mapping、分析链、多字段和动态字段边界。"
tags: [Elasticsearch, Mapping, Analyzer, BM25]
---

# Mapping、字段类型、Analyzer、Tokenizer 与相关性

Mapping 是索引契约。字段首次被动态推断成错误类型后，通常不能原地改成另一类型，需要新索引 Reindex。

## 1. 字段选择 {/* #字段选择 */}

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

## 2. 分析链 {/* #分析链 */}

```text
character filters → tokenizer → token filters
```

Index analyzer 决定写入 term，Search analyzer 处理查询。用 `_analyze` 验证大小写、停用词、同义词、中文分词和边界，不能只看查询结果猜。

## 3. 相关性 {/* #相关性 */}

BM25 综合 term frequency、inverse document frequency 和字段长度。Boost 不是永久解决数据建模；先确认 analyzer、字段、query 类型和业务标注。多语言和同义词变更通常需要版本化分析链与重建索引。

## 4. Mapping Explosion {/* #mapping-explosion */}

将用户任意 JSON key 动态建字段会让 cluster state、Heap 和查询复杂度增长。设置 dynamic 策略、字段总数、模板和未知字段隔离，日志标签优先 flattened/结构化白名单。

## 5. 可执行实验：在写入前冻结字段契约 {/* #可执行实验在写入前冻结字段契约 */}

```http
PUT _index_template/logs_lab
{"index_patterns":["logs-lab-*"],"template":{"mappings":{"dynamic":"strict","properties":{"@timestamp":{"type":"date"},"service":{"type":"keyword"},"message":{"type":"text","analyzer":"standard"},"status":{"type":"integer"}}}}}

POST _index_template/_simulate_index/logs-lab-000001
POST logs-lab-000001/_doc
{"@timestamp":"2026-08-18T10:00:00Z","service":"gateway","message":"TLS handshake failed","status":502}
```

先用 simulate 证明最终 mapping，再写一条正确数据和一条包含未知字段的数据；`dynamic: strict` 应让后者失败。生产上线前还要用 `_analyze` 保存中英文、大小写、同义词等黄金样例及预期 token。

字段类型通常不能原地改变。迁移流程应为新建带版本号的 template/index → `_reindex` → 对账文档数、失败项和查询结果 → 原子切换 alias → 保留旧索引回滚。相关性调优必须保存查询集与人工判断，比较 NDCG/Recall，而不是只凭一条搜索结果。

## 6. 验收题 {/* #验收题 */}

- object 与 nested 为什么会产生不同匹配？
- Index/Search Analyzer 不一致何时合理？
- Mapping 为什么难以原地改类型？
- 动态字段怎样影响 master 节点？

## 7. 参考资料 {/* #参考资料 */}

- [Mapping](https://www.elastic.co/docs/manage-data/data-store/mapping)
- [Text analysis](https://www.elastic.co/docs/manage-data/data-store/text-analysis)
