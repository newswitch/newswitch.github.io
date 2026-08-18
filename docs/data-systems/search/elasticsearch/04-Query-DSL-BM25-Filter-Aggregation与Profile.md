---
title: "Query DSL、BM25、Filter、Aggregation 与 Profile"
sidebar_label: "04. Query DSL、BM25、Filter、Aggregation 与 Profile"
sidebar_position: 4
description: "从 bool query、相关性、过滤、聚合和 Profile 构建可解释搜索。"
tags: [Elasticsearch, Query DSL, BM25, Aggregation, Profile]
---

# Query DSL、BM25、Filter、Aggregation 与 Profile

## 1. Bool 语义 {/* #bool-语义 */}

```text
must        必须匹配并可计分
filter      必须匹配、不计分
should      可选/按 minimum_should_match
must_not    排除
```

精确状态、租户、时间范围放 filter；全文相关性放 query。避免在脚本中逐文档实现可索引条件。

## 2. Query 类型 {/* #query-类型 */}

`term` 面向未经分析的精确 term，`match` 会分析文本；`range` 处理数值/日期；`multi_match` 跨字段；prefix/wildcard/regexp 尤其前导通配可能昂贵。查询前用 `_analyze` 和 mapping 证明字段语义。

## 3. BM25 与业务排序 {/* #bm25-与业务排序 */}

相关性评测使用带标注查询集和 NDCG/Recall/CTR，不以少量肉眼结果调 boost。Function score/script score 增加灵活性，也可能逐候选计算并破坏缓存。

## 4. Aggregation {/* #aggregation */}

Bucket 分组，Metric 计算，Pipeline 处理聚合结果。Terms 分布式合并可能近似；高基数聚合占内存，深层嵌套放大 buckets。大规模枚举使用 composite 分页。

## 5. Profile {/* #profile */}

`profile: true` 展示 shard 内 Query/Aggregation 组件耗时，不包含网络、协调队列、Fetch 等全部端到端时间，且有开销。配合 slow log、task、客户端 trace 和节点指标。

## 6. 可执行实验：把“结果不对”和“查询太慢”分开 {/* #可执行实验把结果不对和查询太慢分开 */}

```http
GET products/_search
{
  "profile": true,
  "query": {"bool": {"must": [{"match": {"title": "gpu server"}}],"filter": [{"term": {"status": "online"}}]}},
  "aggs": {"by_vendor": {"terms": {"field": "vendor", "size": 10}}},
  "size": 20,
  "track_total_hits": false
}
```

先在固定索引快照和固定查询集上记录命中、排序、P50/P95/P99，再只改变一个变量。`filter` 不参与评分并可能复用缓存；`must` 参与评分。高基数字段的大 `terms` 聚合、深分页和脚本最容易扩大 CPU/heap 消耗。

`profile` 会增加开销，只用于采样诊断。排障时同时保存 `_search` 请求、响应 `took`、客户端端到端耗时、慢日志和 `GET _nodes/hot_threads`；`took` 很小但用户很慢，问题通常在排队、网络、代理或客户端解析，而不是 Query DSL 本身。

## 7. 验收题 {/* #验收题 */}

- term 与 match 的根本差异是什么？
- Filter 为何通常比计分 Query 更合适做状态过滤？
- Terms aggregation 为什么可能近似？
- Profile 很快但请求慢还要查什么？

## 8. 参考资料 {/* #参考资料 */}

- [Query DSL](https://www.elastic.co/docs/explore-analyze/query-filter/languages/querydsl)
- [Search Profile](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-profile)
