---
title: "Insert、Upsert、Delete、Timestamp 与一致性级别"
sidebar_label: "04. Insert、Upsert、Delete、Timestamp 与一致性级别"
sidebar_position: 4
description: "理解 Milvus 写入确认、Timestamp、可见性、删除和一致性级别。"
tags: [Milvus, Insert, Upsert, Consistency]
---

# Insert、Upsert、Delete、Timestamp 与一致性级别

```text
SDK mutation → Proxy → streaming/WAL
→ growing segment → query visibility
→ seal/flush → persisted artifacts → index/load
```

Insert 返回不等于所有 QueryNode 已加载索引。Milvus 使用逻辑时间戳协调写入与查询可见性；一致性级别决定查询等待到哪个时间边界。

## 1. 一致性 {/* #一致性 */}

- Strong：查询等待最新可见边界，延迟可能更高；
- Session：同客户端会话读到自己的写；
- Bounded：允许受控陈旧换延迟/吞吐；
- Eventually：最快但新写可能暂不可见。

准确行为和默认值以固定版本 SDK/Collection 为准。业务要按 read-after-write、RAG 新知识生效时间和成本选择，不能全部设 Strong。

## 2. Upsert/Delete {/* #upsertdelete */}

Upsert 按主键产生新版本/变更，不是传统原地覆盖；Delete 先形成删除标记，物理空间由 Compaction/GC 后续回收。查询、存储和备份会在一段时间内看到相关历史成本。

## 3. 幂等和批次 {/* #幂等和批次 */}

稳定主键 + 业务版本帮助处理超时重试。批量写逐项处理失败；记录 source offset、row count、timestamp 和错误。不要用随机 ID 重试同一业务记录。

## 4. 可执行一致性实验 {/* #可执行一致性实验 */}

对同一主键执行 insert/upsert、flush、search、delete，再分别用 Strong、Bounded、Eventually 和 Session 一致性读取。记录写入返回的 timestamp/主键、首次可见时间和不同客户端会话的差异，而不是只验证“最后能查到”。

```python
r = c.insert("consistency_lab", [{"id": 1, "embedding": [0.1,0.2,0.3,0.4]}])
c.flush("consistency_lab")
print(c.query("consistency_lab", filter="id == 1", output_fields=["id"]))
c.delete("consistency_lab", filter="id == 1")
```

删除通常以逻辑删除/delta 进入存储和查询路径，空间回收依赖 compaction/GC。业务读后写保证要落到同一会话或显式时间戳语义；跨系统双写仍需幂等、重试、对账或 CDC，Milvus 的一致性级别不提供跨数据库事务。

## 5. 验收题 {/* #验收题 */}

- 写入确认与可搜索为何不同？
- Session 与 Strong 的应用体验差异？
- Delete 为何不立即释放对象存储？
- Upsert 如何处理乱序旧版本？

## 6. 参考资料 {/* #参考资料 */}

- [Consistency](https://milvus.io/docs/consistency.md)
- [Insert/upsert/delete](https://milvus.io/docs/insert-update-delete.md)
