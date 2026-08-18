---
title: "Merge、Mutation、TTL、小 Part、磁盘与对象存储治理"
sidebar_label: "12. Merge、Mutation、TTL、小 Part、磁盘与对象存储治理"
sidebar_position: 12
description: "治理后台合并、Mutation、生命周期、小 Part 和多磁盘/对象存储。"
tags: [ClickHouse, Merge, Mutation, TTL, Parts]
---

# Merge、Mutation、TTL、小 Part、磁盘与对象存储治理

## 1. Merge {/* #merge */}

后台合并同分区相邻 Part，减少文件并应用表引擎语义。持续写入速度超过 Merge 能力会形成 backlog、小 Part 和写入拒绝。

## 2. Mutation {/* #mutation */}

ALTER UPDATE/DELETE 常重写受影响 Part，异步执行。`system.mutations` 查看进度/失败；大范围 Mutation 与写入/查询竞争 I/O，并产生额外临时空间。优先分区替换、TTL、上游修正或版本化数据模型。

## 3. TTL {/* #ttl */}

可删除/移动行或列，但通常在 Merge 中生效，不保证到点立即物理消失。合规删除需确认实际 Part 和备份生命周期，不只看 TTL 表达式。

## 4. 小 Part {/* #小-part */}

根因通常是小批高频、过细分区、过多租户表或异步写配置碎片化。先合并上游批次和修正分区；盲目 `OPTIMIZE FINAL` 会制造巨量 I/O。

## 5. 存储策略 {/* #存储策略 */}

多磁盘/对象存储 tier 通过 storage policy/volume 管理。评估本地 cache、对象请求/带宽、故障恢复和生命周期；不能让 Bucket policy 删除仍引用对象。

## 6. 后台任务排障矩阵 {/* #后台任务排障矩阵 */}

```sql
SELECT * FROM system.merges ORDER BY elapsed DESC;
SELECT database, table, mutation_id, command, is_done, latest_fail_reason
FROM system.mutations WHERE NOT is_done;
SELECT partition, count(), sum(rows), sum(bytes_on_disk)
FROM system.parts WHERE active GROUP BY partition ORDER BY count() DESC;
```

小 part、merge、mutation、TTL move/delete 和对象存储上传共享 CPU、磁盘、网络与后台池。先确定积压来源和增长速度，再治理写入 batch/分区设计或限制重任务；同时提高所有后台并发通常会把前台查询压垮。

执行大 DELETE/UPDATE/TTL 前估算受影响 part、临时空间、完成时间和副本放大，设置停止线。对象存储策略要验证缓存命中、请求限额、生命周期不会提前删除 ClickHouse 管理对象，以及故障恢复时的下载带宽。

## 7. 验收题 {/* #验收题 */}

- Mutation 为什么不是 OLTP 行更新？
- TTL 为何不会准点立即释放空间？
- 小 Part 的首要治理位置在哪里？
- OPTIMIZE FINAL 有何生产风险？

## 8. 参考资料 {/* #参考资料 */}

- [Avoid mutations](https://clickhouse.com/docs/managing-data/update_mutations)
- [TTL](https://clickhouse.com/docs/guides/developer/ttl)
