---
title: "Index、Refresh、Translog、Flush、Segment 与 Merge"
sidebar_position: 5
tags: [Elasticsearch, Refresh, Translog, Segment, Merge]
description: "理解 Elasticsearch 写入可见性、持久性和 Lucene Segment I/O 放大。"
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

## 四个时间点

- 写请求确认：按当前副本/等待策略处理；
- Refresh：文档对 Search 可见；
- Translog fsync：故障恢复持久性；
- Flush/Lucene commit：缩短恢复链，不等于每次写都执行。

实时 GET 可从实时路径找到尚未 refresh 的文档，Search 近实时。`refresh=wait_for` 等待自然 refresh；`refresh=true` 强制刷新会制造小 segment，批量写入不要滥用。

## Merge

更新/删除产生新文档和删除标记，Merge 重写 segment 回收空间。Merge 消耗磁盘吞吐、CPU 和临时空间；磁盘接近水位时可能既无法 merge 又无法分配。

## Bulk 调优

批次按字节和耗时控制，逐项处理部分失败。提高 refresh interval/临时减少副本可加速一次性导入，但必须有恢复计划，且完成后恢复设置并等待 green。

## 观测

关注 segment count/size、refresh/flush/merge time、indexing pressure、translog、rejection、磁盘和 Page Cache。Force merge 主要用于只读索引，生产热写索引盲目执行会放大 I/O。

## 验收题

- 写成功为何 Search 可能看不到？
- Refresh 与 Flush 有何差异？
- 更新为何增加删除标记？
- 强制 Refresh 如何制造 Merge 压力？

## 参考资料

- [Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)
- [Translog](https://www.elastic.co/docs/reference/elasticsearch/index-settings/translog)
