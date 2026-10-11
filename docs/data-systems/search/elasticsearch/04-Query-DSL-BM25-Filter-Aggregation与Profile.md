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

### 1.1 从倒排表到 Bool 执行

一个 term 的 postings 按文档 ID 排序，记录出现位置、词频等信息。AND 可以对较短列表逐个推进，在其他列表中寻找同一个 ID；OR 合并候选，NOT 排除候选。例如 `[1,3,8,10]` 与 `[3,4,8]` 的交集是 `[3,8]`，无须扫描整个文档库。实际执行可利用跳跃结构、位图和 two-phase approximation，匹配候选后才计算昂贵的确认或分数。

Filter 省去相关性计分，但不保证零开销或每次命中缓存；缓存资格、选择性和复用次数决定是否值得缓存。Top-K 计分还可以用安全的分数上界跳过不可能超过当前第 K 名的块。前提是上界覆盖实际评分函数；这与随意截断候选的 ANN 近似不是一回事。[Lucene 9.12 Scorer 接口](https://lucene.apache.org/core/9_12_3/core/org/apache/lucene/search/Scorer.html)

## 2. Query 类型 {/* #query-类型 */}

`term` 面向未经分析的精确 term，`match` 会分析文本；`range` 处理数值/日期；`multi_match` 跨字段；prefix/wildcard/regexp 尤其前导通配可能昂贵。查询前用 `_analyze` 和 mapping 证明字段语义。

## 3. BM25 与业务排序 {/* #bm25-与业务排序 */}

相关性评测使用带标注查询集和 NDCG/Recall/CTR，不以少量肉眼结果调 boost。Function score/script score 增加灵活性，也可能逐候选计算并破坏缓存。

### 3.1 BM25 的每个变量到底影响什么

对一个字段中的查询词 t，Lucene 9.12 的 BM25 可写成以下形式，多个词的贡献再求和：

```text
idf(t) = ln(1 + (N-df(t)+0.5)/(df(t)+0.5))
norm(d) = k1·(1-b+b·dl(d)/avgdl)
score(t,d) = boost·idf(t)·tf(t,d)/(tf(t,d)+norm(d))
```

N 是该字段的文档统计数，df 是含词文档数，tf 是文档内词频，dl 是字段长度，avgdl 是平均长度；不是数据库所有记录数和字符串字符数。默认 `k1=1.2`、`b=0.75`。教科书常在分子再乘 `k1+1`，Lucene 此版本省去这个对同一配置恒定的因子，核对 `_explain` 时不要混用公式；长度 norm 的编码也会带来离散化。[BM25Similarity 源码](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.12.3/lucene/core/src/java/org/apache/lucene/search/similarities/BM25Similarity.java)

设 N=1000、df=10，则 idf 约 4.557。dl=avgdl=100 时，tf=1 的词频因子为 `1/2.2≈0.455`，tf=3 为 `3/4.2≈0.714`：重复三次不是得分三倍。tf=3 而 dl=200 时，norm=2.1，因子降为 `3/5.1≈0.588`。b=0 取消长度归一化；k1 越小，词频越快饱和。它们控制文本统计，不直接表达商品热度或业务价值。

### 3.2 跨分片统计与最终 Top-K

默认查询可能使用分片本地的词统计，罕见词在不同分片的 idf 不同。`dfs_query_then_fetch` 先收集全局词统计，再执行查询，可减少这种评分偏差，但增加往返；它不是全局执行所有查询计算。[Search API 的 search_type](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-search)

若所有分片用一致、固定、可比较的最终排序，每片返回本地前 K 个就足以求全局前 K 个：若文档在自己分片排在 K 名之后，那么同片至少 K 个文档全局也排在它前面。分页需覆盖 `from+size`，并列需一致 tie-break。这个证明不覆盖候选截断后的 rescore、近似 kNN 或先分组再排序，也不证明分片本地统计等于全局 BM25。

## 4. Aggregation {/* #aggregation */}

Bucket 分组，Metric 计算，Pipeline 处理聚合结果。Terms 分布式合并可能近似；高基数聚合占内存，深层嵌套放大 buckets。大规模枚举使用 composite 分页。

### 4.1 为什么 terms 不能套用文档 Top-K 的证明

假设三片分别有独有词 A、B、C，各在自己的分片出现 100 次；共同词 X 每片出现 90 次。若每片只返回本地第一名，协调端只见 A/B/C 各 100 次，完全漏掉全局第一的 X=270 次。桶的全局值是跨片求和，一个桶即使每片都不是第一，也可能全局第一；文档的固定排序证明因此失效。

扩大 `shard_size` 增加送往协调端的桶，通常降低漏计，却不对任意分布保证精确。`doc_count_error_upper_bound` 的解释依赖排序方式，默认按计数降序时有可用界，按子聚合等方式排序不能照搬这个界。结果中的 `sum_other_doc_count` 也不是某个已返回桶的误差。枚举全部桶可用 composite，但枚举顺序不等于已经按全局计数求出了 Top-K。[Terms aggregation 的准确性与排序规则](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-terms-aggregation)

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
- tf 从 1 增到 3 为什么不使 BM25 得分变成三倍？
- 为什么分片 Top-K 文档可以精确合并，Top-K terms 却可能漏掉全局第一名？

## 8. 参考资料 {/* #参考资料 */}

- [Query DSL](https://www.elastic.co/docs/explore-analyze/query-filter/languages/querydsl)
- [Search Profile](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/search-profile)
