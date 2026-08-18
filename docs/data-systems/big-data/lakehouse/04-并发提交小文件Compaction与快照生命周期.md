---
title: "Iceberg 并发提交、小文件、Compaction 与快照生命周期"
sidebar_label: "04. Iceberg 并发提交、小文件、Compaction 与快照生命周期"
sidebar_position: 4
description: "治理高频提交、文件与 Manifest 膨胀、并发冲突、Delete Files 和安全垃圾回收。"
tags: [Iceberg, Compaction, 小文件, Snapshot Expiration]
---

# Iceberg 并发提交、小文件、Compaction 与快照生命周期

湖仓性能会随持续写入退化：高并行流 writer 每 checkpoint 产生小文件，更新产生 delete files，fast append积累 manifests，旧 snapshots 保留被替换文件。治理必须在不改变逻辑数据和不破坏在途 reader 的前提下进行。

## 1. 小文件来源

```text
每批潜在文件数 ≈ writer并行度 × 活跃表分区数 × 每分区roll次数
```

每分钟提交、128 writer、多个动态分区会快速膨胀。目标文件大小只有在单 writer/partition 能积累足够数据时才生效。

## 2. 影响

- Catalog/metadata/manifest 对象增加；
- Planning 需要更多请求与文件任务；
- Reader 打开文件、footer 和调度开销；
- 对象存储请求费用；
- GPU/批任务顺序吞吐下降；
- 每次 commit 冲突概率和元数据重写增加。

## 3. Data File Rewrite

Compaction 读取一组小 data files，按目标大小/排序重新写大文件，并提交 replace snapshot。逻辑 count/checksum应不变。选择 bin-pack、sort 或 z-order 类策略需按引擎支持和查询模式验证。

Compaction 会暂时同时保留旧/新文件，放大 I/O 与空间；与实时 writer 并发可能冲突，应限并发、分区隔离和重试。

## 4. Delete File Rewrite

Merge-on-read 表 delete files过多会让 reader 每次合并。可重写/合并 delete，或将删除应用到新 data files。要验证 sequence/可见性和并发写，不能简单删除 delete 文件。

## 5. Manifest Rewrite

过多小 manifest 增加 planning。Rewrite manifests可按 partition/spec 聚类和合并元数据，不等同 data compaction。分别观察 manifest count/size 与 data file count/size。

## 6. Snapshot Expiration

过期 snapshot 后，只有不再被任何有效 snapshot、branch/tag引用的文件才可删除。保留策略需覆盖：最长查询、回滚、审计、流作业 checkpoint、分支/tag 和灾备。

过期太激进会让长查询/回滚失败；永不过期会持续占空间。先 dry-run/列出影响（按工具能力），设置最小年龄和最少保留版本，并在备份/恢复测试后执行。

## 7. Orphan Removal

Orphan removal 针对从未被表元数据引用或已无引用的对象，安全年龄必须大于最长 write/commit/retry。对象存储 LIST 一致性、跨表共享路径和迁移文件都会增加误删风险。每表独立前缀和受控 writer 可降低风险。

## 8. 并发提交

Append 通常较易合并重试；overwrite/delete/compaction 需校验修改范围与新提交是否冲突。持续冲突时不要无限重试，先检查是否多个任务重写同一分区、maintenance 与 writer 重叠或 Catalog 延迟。

## 9. 治理 SLO

监控 snapshot commit P95/失败、file/manifest/delete 数、大小分布、planning time、scan files/bytes、compaction backlog、snapshot age/引用和存储增长。为 maintenance 设每日字节预算与业务限速。

## 10. 掌握验收

- 从 writer×分区×提交频率估算小文件；
- 区分 data/delete/manifest rewrite；
- 解释 compaction 的临时空间与并发冲突；
- 在 branch/tag/长查询约束下设计 snapshot expiration；
- 清理前证明文件无有效引用。

上一篇：[Schema/Partition Evolution](./03-Schema-Partition-Evolution与Time-Travel.md)　下一篇：[Iceberg 对接 Spark、Flink、Trino](./05-Iceberg对接Spark-Flink-Trino生产实践.md)

## 11. 参考资料 {/* #参考资料 */}

- [Iceberg Maintenance](https://iceberg.apache.org/docs/latest/maintenance/)
