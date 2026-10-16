---
title: "Index、Refresh、Translog、Flush、Segment 与 Merge"
sidebar_label: "05. Index、Refresh、Translog、Flush、Segment 与 Merge"
sidebar_position: 5
description: "理解 Elasticsearch 写入可见性、持久性和 Lucene Segment I/O 放大。"
tags: [Elasticsearch, Refresh, Translog, Segment, Merge]
---

# Index、Refresh、Translog、Flush、Segment 与 Merge

```text
index request
→ in-memory indexing buffer + translog
→ replica copies
→ refresh opens new searchable segment
→ flush creates Lucene commit/new translog generation
→ merge combines immutable segments
```

## 1. 四个时间点 {/* #四个时间点 */}

- 写请求确认：按当前副本/等待策略处理；
- Refresh：文档对 Search 可见；
- Translog fsync：故障恢复持久性；
- Flush/Lucene commit：缩短恢复链，不等于每次写都执行。

实时 GET 可从实时路径找到尚未 refresh 的文档，Search 近实时。`refresh=wait_for` 等待自然 refresh；`refresh=true` 强制刷新会制造小 segment，批量写入不要滥用。

## 2. Merge {/* #merge */}

更新/删除产生新文档和删除标记，Merge 重写 segment 回收空间。Merge 消耗磁盘吞吐、CPU 和临时空间；磁盘接近水位时可能既无法 merge 又无法分配。

## 3. Bulk 调优 {/* #bulk-调优 */}

批次按字节和耗时控制，逐项处理部分失败。提高 refresh interval/临时减少副本可加速一次性导入，但必须有恢复计划，且完成后恢复设置并等待 green。

## 4. 观测 {/* #观测 */}

关注 segment count/size、refresh/flush/merge time、indexing pressure、translog、rejection、磁盘和 Page Cache。Force merge 主要用于只读索引，生产热写索引盲目执行会放大 I/O。

## 5. 可执行实验：观察一次写入何时可搜、何时持久 {/* #可执行实验观察一次写入何时可搜何时持久 */}

```http
PUT write_lab
{"settings":{"index.refresh_interval":"-1"}}
POST write_lab/_doc/1
{"value":"before-refresh"}
GET write_lab/_search?q=value:before-refresh
POST write_lab/_refresh
GET write_lab/_search?q=value:before-refresh
GET write_lab/_stats?filter_path=indices.*.primaries.{docs,refresh,flush,translog,segments,merges}
GET _cat/segments/write_lab?v
```

第一次搜索通常看不到文档，显式 refresh 后可见；这证明“写响应成功”和“可搜索”不是同一时刻。Flush 负责建立新的 Lucene commit 并推进 translog generation，不等于把每条写入立即变成独立 segment。

批量导入可临时拉长 refresh，但必须记录恢复动作。不要周期性执行 force merge 作为日常优化；它适合只读索引，并会造成大量 IO、临时磁盘和超大 segment。出现写延迟时依次查看 bulk rejection、translog、refresh、merge throttling、磁盘延迟和 JVM，而不是直接调大所有线程池。

## 6. 验收题 {/* #验收题 */}

- 写成功为何 Search 可能看不到？
- Refresh 与 Flush 有何差异？
- 更新为何增加删除标记？
- 强制 Refresh 如何制造 Merge 压力？

## 7. 参考资料 {/* #参考资料 */}

- [Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)
- [Translog](https://www.elastic.co/docs/reference/elasticsearch/index-settings/translog)
