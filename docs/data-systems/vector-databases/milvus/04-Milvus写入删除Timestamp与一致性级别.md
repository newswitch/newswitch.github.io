---
title: "Insert、Upsert、Delete、Timestamp 与一致性级别"
sidebar_position: 4
tags: [Milvus, Insert, Upsert, Consistency]
description: "理解 Milvus 写入确认、Timestamp、可见性、删除和一致性级别。"
---

# Insert、Upsert、Delete、Timestamp 与一致性级别

```text
SDK mutation → Proxy → streaming/WAL
→ growing segment → query visibility
→ seal/flush → persisted artifacts → index/load
```

Insert 返回不等于所有 QueryNode 已加载索引。Milvus 使用逻辑时间戳协调写入与查询可见性；一致性级别决定查询等待到哪个时间边界。

## 一致性

- Strong：查询等待最新可见边界，延迟可能更高；
- Session：同客户端会话读到自己的写；
- Bounded：允许受控陈旧换延迟/吞吐；
- Eventually：最快但新写可能暂不可见。

准确行为和默认值以固定版本 SDK/Collection 为准。业务要按 read-after-write、RAG 新知识生效时间和成本选择，不能全部设 Strong。

## Upsert/Delete

Upsert 按主键产生新版本/变更，不是传统原地覆盖；Delete 先形成删除标记，物理空间由 Compaction/GC 后续回收。查询、存储和备份会在一段时间内看到相关历史成本。

## 幂等和批次

稳定主键 + 业务版本帮助处理超时重试。批量写逐项处理失败；记录 source offset、row count、timestamp 和错误。不要用随机 ID 重试同一业务记录。

## 验收题

- 写入确认与可搜索为何不同？
- Session 与 Strong 的应用体验差异？
- Delete 为何不立即释放对象存储？
- Upsert 如何处理乱序旧版本？

## 参考资料

- [Consistency](https://milvus.io/docs/consistency.md)
- [Insert/upsert/delete](https://milvus.io/docs/insert-update-delete.md)
