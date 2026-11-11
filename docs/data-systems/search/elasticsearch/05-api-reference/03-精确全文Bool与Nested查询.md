---
title: "Elasticsearch 精确全文 Bool 与 Nested 查询"
sidebar_label: "03. 精确、全文、Bool 与 Nested 查询"
sidebar_position: 3
description: "用固定文档解释 term、terms、range、exists、match、match_phrase、multi_match、bool、prefix、wildcard 与 nested，核对命中并定位零结果。"
tags: [Elasticsearch, Query DSL, Bool, 全文搜索, Nested]
---

# Elasticsearch 精确全文 Bool 与 Nested 查询

查询先要回答“字段按什么方式索引”，再决定“使用什么条件”。同样是字符串，category 是 keyword，name 是分词 text，name.raw 是完整 keyword；三者不能套用同一种匹配直觉。

以下请求基于 [六条基准数据](./01-HTTP请求认证响应与实验数据.md)，命中集合按 ID 表述，不保证未显式排序时的响应顺序。评分随查询与版本变化，不固定某个 `_score` 数字。

## 1. 全部查询与按 ID 查询

```http
GET es_api_lab_products_v1/_search
{"query":{"match_all":{}},"size":10,"track_total_hits":true}

GET es_api_lab_products_v1/_search
{"query":{"ids":{"values":["p1","p3"]}}}
```

第一项命中六条，第二项命中 p1/p3。`ids` 使用 Elasticsearch `_id`，不是自动查询所有名为 id 的业务字段。要查 doc_id 可使用其 keyword term 条件。

## 2. term 与 terms 查询精确值

```http
GET es_api_lab_products_v1/_search
{"query":{"term":{"category":"gpu"}}}

GET es_api_lab_products_v1/_search
{"query":{"terms":{"category":["storage","network"]}}}
```

分别命中 p1/p2/p5 和 p3/p4/p6。terms 中多个候选值是“其中任一匹配”，不是同时具备所有值；数组字段要表达同时包含多个标签，可在 bool 中放多个 term。

term 不对输入执行全文分词。`term name:"GPU server"` 不会自动拆成 gpu 和 server；对 name.raw 的完整值匹配则需要大小写和内容符合其索引语义。默认 keyword 不会替你做大小写归一化。

## 3. range 与 exists

```http
GET es_api_lab_products_v1/_search
{"query":{"range":{"price":{"gte":400,"lt":1500}}}}

GET es_api_lab_products_v1/_search
{"query":{"range":{"created_at":{"gte":"2026-11-02T00:00:00Z","lt":"2026-11-03T00:00:00Z"}}}}

GET es_api_lab_products_v1/_search
{"query":{"bool":{"must_not":[{"exists":{"field":"owner"}}]}}}
```

三个结果集合依次为 p1/p4/p6、p2/p3、p4。`gte/gt/lte/lt` 分别表示大于等于、大于、小于等于、小于；时间连续区间常用左闭右开，避免边界重复。

exists 判断字段是否存在可索引的值，不只是 `_source` 是否出现键。通常 null、空数组不产生这样的值，空字符串却可以存在；`null_value`、`ignore_above` 等 Mapping 还会改变判断。`now` 与时区也需要明确，先用绝对 UTC 时间建立预期。[Exists query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-exists-query)。

## 4. match 与 match_phrase

先观察分析结果：

```http
POST es_api_lab_products_v1/_analyze
{"field":"name","text":"GPU server"}
```

standard 分析器会得到 gpu、server 这类 term。再比较：

```http
GET es_api_lab_products_v1/_search
{"query":{"match":{"name":{"query":"GPU server","operator":"or"}}}}

GET es_api_lab_products_v1/_search
{"query":{"match":{"name":{"query":"GPU server","operator":"and"}}}}

GET es_api_lab_products_v1/_search
{"query":{"match_phrase":{"name":{"query":"GPU server","slop":0}}}}
```

本数据中 OR 命中 p1/p2/p5，AND 命中 p1/p2，短语也命中 p1/p2。但 AND 只要求词都出现，不要求短语顺序与相邻位置；match_phrase 根据 token 位置匹配，`slop` 允许相应位置距离，不是允许随意错字。[Match](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query)、[Match phrase](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query-phrase)。

## 5. bool 把业务条件组织起来

“查询名称包含 gpu，且在售、有库存、价格不超过 1600 的商品”：

```http
GET es_api_lab_products_v1/_search
{
  "query":{"bool":{
    "must":[{"match":{"name":"gpu"}}],
    "filter":[
      {"term":{"status":"active"}},
      {"range":{"stock":{"gt":0}}},
      {"range":{"price":{"lte":1600}}}
    ],
    "must_not":[{"term":{"vendor":"blocked-vendor"}}]
  }}
}
```

命中 p1/p5。must 和 filter 都可约束必须匹配，但 filter 不贡献相关性分数；是否缓存取决于查询和执行条件，不保证写进 filter 就立刻变快。

### 5.1 should 默认不一定必须命中

```http
GET es_api_lab_products_v1/_search
{"query":{"bool":{"filter":[{"term":{"status":"active"}}],"should":[{"term":{"category":"gpu"}},{"term":{"category":"storage"}}],"minimum_should_match":1}}}
```

命中 p1/p3/p5/p6。如果去掉 minimum_should_match，在已有 must/filter 的 bool 中，should 默认可能只是加分，不再排除 network 商品 p4。只有 should 且没有 must/filter 的 bool，默认至少匹配一个 should。显式写清业务需要，别把 should 永远当成 SQL OR。[Bool query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-bool-query)。

## 6. 多字段、前缀、通配与容错

```http
GET es_api_lab_products_v1/_search
{"query":{"multi_match":{"query":"gpu","fields":["name^2","category"],"type":"best_fields"}}}

GET es_api_lab_products_v1/_search
{"query":{"prefix":{"name.raw":{"value":"GPU"}}}}

GET es_api_lab_products_v1/_search
{"query":{"wildcard":{"name.raw":{"value":"GPU*pro"}}}}
```

多字段查询可给字段 boost，但分数不是简单把所有字段都相加，取决于 type；前缀匹配 p1/p2/p5，通配例子匹配 p2。`^2` 影响相关性，不是把数量或业务价值乘二。

名称自动补全、高基数前导通配和正则查询不能只靠“语法能执行”判断成本。经常搜索前缀时，应结合专用字段/分析器设计。`match` 的 `fuzziness` 用于编辑距离容错，不是同义词、拼音或中文语义理解；昂贵查询也可能被 `search.allow_expensive_queries` 限制。

## 7. nested 保证同一子对象满足条件

要求“alice 的某条评论评分至少为 5”：

```http
GET es_api_lab_products_v1/_search
{"query":{"nested":{"path":"reviews","query":{"bool":{"filter":[{"term":{"reviews.user":"alice"}},{"range":{"reviews.score":{"gte":5}}}]}},"inner_hits":{"size":3}}}}
```

只命中 p1。p2 虽然有 alice，也有评分 5，但它们属于不同评论。nested 将两个条件限制到同一个子文档；`inner_hits` 可展示匹配评论，但会增加取回开销。[Nested query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-nested-query)。

`must_not` 放在 nested 内部表示“存在某个子对象满足内部排除后的条件”，不一定表示“所有子对象都没有某条件”。要排除含某类子对象的父文档，常需在外层 bool.must_not 包住相应 nested 查询，先用具体数据验证逻辑。

## 8. 零结果的检查顺序

先确认实际索引和时间范围，再读取 Mapping，使用 `_analyze` 检查 token，然后拆开 bool 逐项测试。最后核对刷新可见性与当前账号的数据访问权限。

不要用 `match_all` 证明所有字段查询都正常，也不要在生产上通过扩大时间窗口、改成全索引通配符来猜原因。评分解释与性能分析见 [诊断 API](./08-集群分片节点与慢查询诊断API.md)。

## 9. 练习与答案

**问题一：terms 指定两个值时，是 AND 还是任一匹配？**

答案：任一值匹配。要同时要求数组字段包含两个值，应组合两个必须成立的 term 条件。

**问题二：为什么有 filter 的 bool 加了 should 后，p4 仍可能返回？**

答案：这种结构下 should 默认可以不匹配。业务要求至少命中一个候选时，应显式设置 minimum_should_match。

**问题三：match 的 AND 能否替代短语查询？**

答案：不能。AND 约束词都出现，短语还约束 token 的顺序和位置，两者语义不同。

**问题四：p2 有 alice 和 5 分，为何 nested 例子不返回它？**

答案：alice 的评分是 2，评分 5 属于 bob。nested 要求同一评论对象同时满足两个条件。

## 10. 官方参考

- [Query 与 Filter Context](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-filter-context)
- [Term query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-term-query)
- [Multi-match](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-multi-match-query)
- [Nested query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-nested-query)
