---
title: "倒排索引、Term Dictionary、Postings 与 Doc Values"
sidebar_position: 2
tags: [Elasticsearch, Lucene, Inverted Index, Doc Values]
description: "理解全文搜索、过滤、排序和聚合背后的 Lucene 数据结构。"
---

# 倒排索引、Term Dictionary、Postings 与 Doc Values

一份文档会按字段写入不同访问结构：

```text
text → analyzer → terms → term dictionary → postings(docID, freq, positions)
keyword/numeric/date → inverted index + doc values
_source → stored original JSON（通常压缩）
```

## 倒排索引

Term Dictionary 快速定位词项，Postings 保存包含该词的文档 ID，按配置还可保存频率、位置和 offset。Phrase/highlight 依赖更多位置数据，索引更大。

Query 先查 term 再遍历 postings；Filter 不计算相关性，结果可参与缓存；全文 Query 可能按 BM25 计算 score。

## Doc Values

Doc Values 是面向列的磁盘结构，适合排序、聚合和脚本按文档取字段。`text` 默认不用于聚合；通常为同一业务字段建立 `text` + `keyword` multi-field。关闭 doc_values 可省空间，但失去高效排序/聚合。

## `_source` 与 stored fields

`_source` 用于返回、重建、更新和 Reindex。禁用会损失重要能力；若响应大，应 source filtering，而非轻率关闭。Fetch 慢常来自读取/解压巨大 `_source`。

## 基数与空间

高基数 keyword 增加 term/doc values 和聚合内存；文本字段大量 unique token 会扩大 dictionary/postings。用真实 mapping 对相同数据建立不同索引，比较 segment 文件、写入、查询和聚合。

## 验收题

- Postings 和 Doc Values 的访问方向有何不同？
- text 为何不能直接做常规聚合？
- Phrase query 为什么比 term query 需要更多索引信息？
- Query 快但 Fetch 慢可能是哪层？

## 参考资料

- [Elasticsearch mapping](https://www.elastic.co/docs/manage-data/data-store/mapping)
- [Lucene scoring](https://lucene.apache.org/core/)
