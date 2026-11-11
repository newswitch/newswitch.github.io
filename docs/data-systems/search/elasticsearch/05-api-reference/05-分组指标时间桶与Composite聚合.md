---
title: "Elasticsearch 分组指标时间桶与 Composite 聚合"
sidebar_label: "05. 分组、指标、时间桶与 Composite 聚合"
sidebar_position: 5
description: "用六条数据核对 terms、stats、date_histogram、cardinality、percentiles、nested 与 pipeline 聚合，解释筛选范围、近似误差和 composite 游标。"
tags: [Elasticsearch, Aggregation, Terms, Composite, 统计]
---

# Elasticsearch 分组指标时间桶与 Composite 聚合

搜索返回文档，聚合计算文档集合上的分组和指标。一次请求可以同时完成两者，但 `size`、query、post_filter 与桶内过滤各自控制不同范围。

以下统计均基于 [六条基准数据](./01-HTTP请求认证响应与实验数据.md)未修改的状态。响应中的静态数值由样例数据推导；近似算法不固定某个小数结果。

## 1. terms 分组与桶内指标

```http
GET es_api_lab_products_v1/_search
{
  "size":0,
  "aggs":{"by_category":{
    "terms":{"field":"category","size":10},
    "aggs":{"price_stats":{"stats":{"field":"price"}}}
  }}
}
```

`size: 0` 不返回文档 hits，不是“不执行搜索”；聚合仍执行。每个桶的 doc_count 与 stats 是不同统计：

| category | doc_count | price.sum | price.avg |
| --- | --- | --- | --- |
| gpu | 3 | 4700 | 约 1566.67 |
| storage | 2 | 700 | 350 |
| network | 1 | 500 | 500 |

默认 terms 返回数量最多的一批桶，不是全部类别枚举。对多分片/高基数数据，要理解 `shard_size`、`doc_count_error_upper_bound` 与 `sum_other_doc_count`，不能把“未显示的桶数量”当作“某个桶的误差”。单分片六条样例也不能证明生产 terms 永远精确。[Terms 聚合](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-terms-aggregation)。

字段应是 keyword 或支持聚合的类型；不要为对 name 分组而随手开启大 text 字段 fielddata，应该先确认实际是要按完整值 name.raw 还是按分词 term 分组。

## 2. 只算指标与近似去重

```http
GET es_api_lab_products_v1/_search
{"size":0,"aggs":{"price_stats":{"stats":{"field":"price"}},"vendor_count":{"cardinality":{"field":"vendor","precision_threshold":100}},"latency_percentiles":{"percentiles":{"field":"latency_ms","percents":[50,95,99]}}}}
```

price.stats 的 count=6、sum=5900、min=300、max=2000、avg≈983.33。vendor 的精确集合是 acme/beta；cardinality 是近似计数算法，小样本通常接近这个值，但不能因样例得到 2 就声称全量数据绝对无误差。[Cardinality](https://www.elastic.co/docs/reference/aggregations/search-aggregations-metrics-cardinality-aggregation)。

percentiles 返回分位数估计，不同方法、配置与数据分布会影响结果。这里 latency_ms 只是六个演示数值；真实延迟 P99 需要足够样本和正确时间窗口，不是取六个数的平均值，也不能平均不同节点各自的 P99。[Percentiles](https://www.elastic.co/docs/reference/aggregations/search-aggregations-metrics-percentile-aggregation)。

## 3. 时间桶与空桶

```http
GET es_api_lab_products_v1/_search
{
  "size":0,
  "query":{"range":{"created_at":{"gte":"2026-11-01T00:00:00Z","lt":"2026-11-05T00:00:00Z"}}},
  "aggs":{"by_day":{
    "date_histogram":{"field":"created_at","calendar_interval":"day","time_zone":"UTC","min_doc_count":0},
    "aggs":{"price_total":{"sum":{"field":"price"}}}
  }}
}
```

UTC 日期 11 月 1～4 日的文档数依次是 1、2、2、1，price_total 依次是 1200、2300、2000、400。`key_as_string` 是可读桶边界，`key` 通常是时间数值。

`calendar_interval: day` 按日历日组织，`fixed_interval: 24h` 是固定时长，在有夏令时的时区不总是等价。要填充范围外侧的空桶，可按需求设置 extended_bounds；它扩展桶，不替代 query 对文档范围的过滤。[Date histogram](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-datehistogram-aggregation)。

## 4. query、filter 聚合与 post_filter

```http
GET es_api_lab_products_v1/_search
{
  "size":2,
  "query":{"term":{"status":"active"}},
  "aggs":{
    "all_active_categories":{"terms":{"field":"category"}},
    "active_gpu":{"filter":{"term":{"category":"gpu"}},"aggs":{"avg_price":{"avg":{"field":"price"}}}}
  },
  "post_filter":{"term":{"category":"gpu"}}
}
```

query 首先限制所有普通聚合与 hits 的文档集合，这里是五条 active。all_active_categories 仍看到 gpu=2、storage=2、network=1；桶内 active_gpu 只统计 p1/p5，均价 1350。

post_filter 进一步过滤返回 hits，因此这里只显示 GPU，但不会把前面所有普通聚合再缩成 GPU 范围。这适合某些分面交互，不是保证搜索更快的优化开关。[搜索结果过滤与 post_filter](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/filter-search-results)。

## 5. Pipeline 聚合处理的是聚合结果

```http
GET es_api_lab_products_v1/_search
{
  "size":0,
  "aggs":{
    "by_day":{
      "date_histogram":{"field":"created_at","calendar_interval":"day","time_zone":"UTC","min_doc_count":0},
      "aggs":{
        "price_total":{"sum":{"field":"price"}},
        "running_total":{"cumulative_sum":{"buckets_path":"price_total"}}
      }
    }
  }
}
```

running_total 依次为 1200、3500、5500、5900。`buckets_path` 指向指标聚合名，不是文档字段名；它累计的是每日价格总和，不是库存变化或订单营业额。

`bucket_script` 可对桶内多个指标计算，`bucket_selector` 可筛桶，但后者通常在前面的聚合执行后处理结果，并不省掉已经发生的分桶开销。父级和兄弟 Pipeline 的放置位置也不同，不能把任意表达式放到任意桶下面。[Cumulative sum](https://www.elastic.co/docs/reference/aggregations/search-aggregations-pipeline-cumulative-sum-aggregation)。

## 6. Composite 分页枚举分组键

如果目标是遍历 category/vendor 的所有组合，使用 composite，而不是把 terms.size 无限调大：

```http
GET es_api_lab_products_v1/_search
{"size":0,"aggs":{"groups":{"composite":{"size":2,"sources":[{"category":{"terms":{"field":"category"}}},{"vendor":{"terms":{"field":"vendor"}}}]},"aggs":{"price_total":{"sum":{"field":"price"}}}}}}
```

默认按 sources 顺序比较 key。第一页组合为 gpu/acme、gpu/beta。查看 `aggregations.groups.after_key`，将**真实完整对象**放到下一次 after 中，不能自己猜或始终使用最后一个 bucket.key：

```http
GET es_api_lab_products_v1/_search
{"size":0,"aggs":{"groups":{"composite":{"size":2,"after":{"category":"gpu","vendor":"beta"},"sources":[{"category":{"terms":{"field":"category"}}},{"vendor":{"terms":{"field":"vendor"}}}]},"aggs":{"price_total":{"sum":{"field":"price"}}}}}}
```

这里 after 是基准示例，需要与第一次真实响应一致。后续依次覆盖 network/beta、storage/acme、storage/beta，直到没有更多桶。Composite 的 key 顺序不是全局 count 排名；分页期间数据持续变化也要考虑一致视图，不能把多个独立时点的桶当成一次原子统计。[Composite](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-composite-aggregation)。

## 7. Nested 聚合与父文档数

```http
GET es_api_lab_products_v1/_search
{"size":0,"aggs":{"reviews_scope":{"nested":{"path":"reviews"},"aggs":{"by_user":{"terms":{"field":"reviews.user"},"aggs":{"parent_products":{"reverse_nested":{}}}}}}}}
```

先进入 reviews 子文档范围，再按 user 分组，reverse_nested 返回父商品范围。基准总共七条评论，alice/bob/carol 分别是 3/3/1 条；不能把 nested doc_count 直接当作商品数。

某商品的同一用户有多条评论时，评论数与去重父商品数会进一步分离。要问“评论数量”还是“有评论的商品数量”，先明确统计单位，再选择 nested/reverse_nested 路径。[Nested aggregation](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-nested-aggregation)。

## 8. 聚合异常先看什么

先核对 Mapping、query 范围、缺失值、多值字段和时区，再分析误差、跨分片合并与资源成本。多值字段的同一文档可进入多个桶，桶计数相加不一定等于去重文档总数。

高基数 terms、深层子聚合和大量 top_hits 都会扩大内存和协调端压力。`size: 0` 只关闭文档返回，不能避免 Circuit Breaker。执行计划与节点内存分析见 [诊断 API](./08-集群分片节点与慢查询诊断API.md)。

## 9. 练习与答案

**问题一：`size: 0` 是否意味着聚合不读取文档集合？**

答案：不是。它只是不返回 hits，分组与指标仍需按查询范围执行。

**问题二：post_filter 限定 GPU 后，为何聚合里仍有 network？**

答案：post_filter 影响返回 hits，不缩小前面普通聚合的 query 范围。本例聚合仍基于所有 active 商品。

**问题三：Composite 的 after 能否一律取最后一个 bucket.key？**

答案：不能。应使用响应返回的 after_key；官方不保证它总等于最后一个桶的 key。

**问题四：七条 nested 评论是否表示七个商品？**

答案：不是。统计单位是子文档，当前只有六个商品。返回父范围或统计父商品时需要 reverse_nested 等适当操作。

## 10. 官方参考

- [聚合总览](https://www.elastic.co/docs/reference/aggregations)
- [Terms](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-terms-aggregation)
- [Composite](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-composite-aggregation)
- [Date histogram](https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-datehistogram-aggregation)
