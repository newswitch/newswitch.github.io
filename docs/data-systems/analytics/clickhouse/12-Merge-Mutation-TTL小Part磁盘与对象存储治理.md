---
title: "Merge、Mutation、TTL、小 Part、磁盘与对象存储治理"
sidebar_position: 12
tags: [ClickHouse, Merge, Mutation, TTL, Parts]
description: "治理后台合并、Mutation、生命周期、小 Part 和多磁盘/对象存储。"
---

# Merge、Mutation、TTL、小 Part、磁盘与对象存储治理

## Merge

后台合并同分区相邻 Part，减少文件并应用表引擎语义。持续写入速度超过 Merge 能力会形成 backlog、小 Part 和写入拒绝。

## Mutation

ALTER UPDATE/DELETE 常重写受影响 Part，异步执行。`system.mutations` 查看进度/失败；大范围 Mutation 与写入/查询竞争 I/O，并产生额外临时空间。优先分区替换、TTL、上游修正或版本化数据模型。

## TTL

可删除/移动行或列，但通常在 Merge 中生效，不保证到点立即物理消失。合规删除需确认实际 Part 和备份生命周期，不只看 TTL 表达式。

## 小 Part

根因通常是小批高频、过细分区、过多租户表或异步写配置碎片化。先合并上游批次和修正分区；盲目 `OPTIMIZE FINAL` 会制造巨量 I/O。

## 存储策略

多磁盘/对象存储 tier 通过 storage policy/volume 管理。评估本地 cache、对象请求/带宽、故障恢复和生命周期；不能让 Bucket policy 删除仍引用对象。

## 验收题

- Mutation 为什么不是 OLTP 行更新？
- TTL 为何不会准点立即释放空间？
- 小 Part 的首要治理位置在哪里？
- OPTIMIZE FINAL 有何生产风险？

## 参考资料

- [Avoid mutations](https://clickhouse.com/docs/managing-data/update_mutations)
- [TTL](https://clickhouse.com/docs/guides/developer/ttl)
