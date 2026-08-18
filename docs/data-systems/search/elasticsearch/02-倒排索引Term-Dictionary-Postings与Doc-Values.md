---
title: "倒排索引、Term Dictionary、Postings 与 Doc Values"
sidebar_label: "02. 倒排索引、Term Dictionary、Postings 与 Doc Values"
sidebar_position: 2
description: "理解全文搜索、过滤、排序和聚合背后的 Lucene 数据结构。"
tags: [Elasticsearch, Lucene, Inverted Index, Doc Values]
---

# 倒排索引、Term Dictionary、Postings 与 Doc Values

一份文档会按字段写入不同访问结构：

```text
text → analyzer → terms → term dictionary → postings(docID, freq, positions)
keyword/numeric/date → inverted index + doc values
_source → stored original JSON（通常压缩）
```

## 1. 倒排索引 {/* #倒排索引 */}

Term Dictionary 快速定位词项，Postings 保存包含该词的文档 ID，按配置还可保存频率、位置和 offset。Phrase/highlight 依赖更多位置数据，索引更大。

Query 先查 term 再遍历 postings；Filter 不计算相关性，结果可参与缓存；全文 Query 可能按 BM25 计算 score。

## 2. Doc Values {/* #doc-values */}

Doc Values 是面向列的磁盘结构，适合排序、聚合和脚本按文档取字段。`text` 默认不用于聚合；通常为同一业务字段建立 `text` + `keyword` multi-field。关闭 doc_values 可省空间，但失去高效排序/聚合。

## 3. `_source` 与 stored fields {/* #source-与-stored-fields */}

`_source` 用于返回、重建、更新和 Reindex。禁用会损失重要能力；若响应大，应 source filtering，而非轻率关闭。Fetch 慢常来自读取/解压巨大 `_source`。

## 4. 基数与空间 {/* #基数与空间 */}

高基数 keyword 增加 term/doc values 和聚合内存；文本字段大量 unique token 会扩大 dictionary/postings。用真实 mapping 对相同数据建立不同索引，比较 segment 文件、写入、查询和聚合。

## 5. 可执行实验：同一文档的两条读取路径 {/* #可执行实验同一文档的两条读取路径 */}

以下实验以 Elasticsearch 9.x REST API 为基线；先用 `GET /` 记录集群版本，跨大版本时核对 mapping 和查询弃用项。

```http
PUT lab_terms
{"mappings":{"properties":{"message":{"type":"text","fields":{"raw":{"type":"keyword"}}},"latency":{"type":"long"}}}}

POST lab_terms/_doc/1?refresh=true
{"message":"GPU node is ready","latency":12}

POST lab_terms/_analyze
{"field":"message","text":"GPU nodes are ready"}

GET lab_terms/_termvectors/1?fields=message&term_statistics=true
GET lab_terms/_search
{"sort":[{"latency":"asc"}],"fields":["message.raw","latency"],"_source":false}
```

`_analyze`/`_termvectors` 用来证明 token 和 postings 侧行为；排序读取 `doc_values`。不要为了对 `text` 排序而直接打开 `fielddata`，它会把字段数据放进 JVM heap。实验后查看 `GET _nodes/stats/indices/fielddata,query_cache`，并删除索引。

排障顺序固定为 mapping → analyzer token → term 是否存在 → 查询改写/profile → shard。若业务值能 `_source` 看见却搜索不到，首先怀疑 analyzer、刷新与字段类型，而不是盲目重建整个集群。

## 6. 验收题 {/* #验收题 */}

- Postings 和 Doc Values 的访问方向有何不同？
- text 为何不能直接做常规聚合？
- Phrase query 为什么比 term query 需要更多索引信息？
- Query 快但 Fetch 慢可能是哪层？

## 7. 参考资料 {/* #参考资料 */}

- [Elasticsearch mapping](https://www.elastic.co/docs/manage-data/data-store/mapping)
- [Lucene scoring](https://lucene.apache.org/core/)
