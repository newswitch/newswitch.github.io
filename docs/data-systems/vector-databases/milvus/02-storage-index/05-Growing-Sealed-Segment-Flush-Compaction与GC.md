---
title: "Growing/Sealed Segment、Flush、Compaction 与 Garbage Collection"
sidebar_label: "05. Growing/Sealed Segment、Flush、Compaction 与 Garbage Collection"
sidebar_position: 5
description: "理解向量数据从实时 Growing Segment 到 Sealed、索引和垃圾回收。"
tags: [Milvus, Segment, Flush, Compaction]
---

# Growing/Sealed Segment、Flush、Compaction 与 Garbage Collection

Segment 是存储、索引、加载和查询调度的重要单元。

```text
stream mutations
→ Growing Segment（实时、通常暴力/增量搜索）
→ seal policy
→ flush binlogs/stats/delta logs to object storage
→ build index
→ load Sealed Segment on QueryNode
→ compact small/deleted segments
→ GC obsolete artifacts
```

## 1. 查询 {/* #查询 */}

查询需要合并 Growing 与已加载 Sealed 的结果。Growing 数据多会增加暴力搜索成本；Sealed 太碎会增加 fan-out、metadata、索引文件和调度开销。

## 2. Flush {/* #flush */}

Flush 推进持久化/Segment 状态，但频繁手工 Flush 会制造小 Segment，反而恶化索引和查询。生产让自动策略工作，只有备份/测试等明确场景触发并观察结果。

## 3. Compaction {/* #compaction */}

Compaction 合并 Segment、应用 Delete/Upsert 影响并生成新 Segment。过程消耗 DataNode、对象存储带宽和临时空间；旧 Segment 在安全时间点后由 GC 删除。

## 4. 故障定位 {/* #故障定位 */}

写入积压查 streaming/WAL 与 DataNode；新数据慢查 timestamp/Growing；小 Segment 多查批次/Flush；磁盘/对象增长查 compaction、delete、GC 和失败任务。

## 5. 观察 Segment 生命周期 {/* #观察-segment-生命周期 */}

以小批高频和大批低频两组写入做对比，采集 insert latency、flush 次数、segment 数量、compaction backlog、对象存储请求与查询 P99。通过管理 API/Attu 查看 Growing → Sealed → Indexed/Loaded 的变化；不要依赖内部对象名作为稳定 API。

Milvus 3.0 的 Storage V3 使用对象存储上的 manifest、column group 与 delta log，Snapshot/External Collection 也建立在这条存储路径上。阅读 2.x 的 binlog/segment 资料时必须标注版本，不能假设 3.0 的持久化布局完全相同。

小 Segment 过多时先修复写入批次、flush 频率和数据分布，再评估 compaction。强制 flush/compaction 会增加对象存储、CPU 和临时空间压力；任何调参都要同时观察前台延迟、积压和回收速度。

## 6. 验收题 {/* #验收题 */}

- Growing 与 Sealed 的查询方式为何不同？
- 频繁 Flush 如何制造性能问题？
- Delete 何时真正回收空间？
- Compaction 为什么需要额外对象空间？

## 7. 参考资料 {/* #参考资料 */}

- [Milvus architecture](https://milvus.io/docs/architecture_overview.md)
- [Compaction](https://milvus.io/docs/compact_data.md)
