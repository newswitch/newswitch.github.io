---
title: "Page、Heap Tuple、TOAST、FSM 与 Visibility Map"
sidebar_position: 6
tags: [PostgreSQL, Page, Heap, TOAST, Visibility Map]
description: "从页面和行版本理解 PostgreSQL 表文件、宽字段、空闲空间与 Index-Only Scan。"
---

# Page、Heap Tuple、TOAST、FSM 与 Visibility Map

PostgreSQL Heap 表由固定大小页面组成。页面含 header、line pointers、tuple 和空闲区；索引通常保存 TID（block, offset）指向 Heap tuple。

```text
relation file → blocks/pages → line pointer → heap tuple
```

Tuple header 保存 xmin/xmax、状态位、null bitmap 等 MVCC 信息，所以一行占用大于业务字段总和。

## TOAST

超大变长字段可压缩并移出主表到 TOAST 表。查询不读取该列时可避免解压/外部读取；频繁读取大 JSON/文本会带来额外随机 I/O、CPU 和网络。更新宽字段也可能制造新 TOAST value。

## FSM 与 VM

- Free Space Map 记录页面可用空间，帮助 INSERT/UPDATE 找位置；
- Visibility Map 标记页面 all-visible/all-frozen，帮助 VACUUM 和 Index-Only Scan；
- VM 不是业务数据副本，崩溃后可由数据库维护。

Index-Only Scan 仍可能访问 Heap：若 VM 未标记 all-visible，需要检查可见性。频繁更新的表即使索引覆盖，也未必获得纯索引扫描。

## HOT Update

更新未被索引引用的列且页面有空间时可形成 HOT 链，减少索引写放大。Fillfactor 留空间可提高 HOT 机会，但增加表大小，需按更新模式测量。

## 观察

使用 `pageinspect` 等扩展只在受控环境研究页面；生产优先 `pg_stat_*`、`pg_relation_size`、dead tuple 和 buffer 指标。不要手工修改 relation 文件。

## 验收题

- 索引为何通常还要回 Heap？
- TOAST 对宽列查询有何影响？
- VM 如何帮助 Index-Only Scan？
- Fillfactor 与 HOT 的权衡是什么？

## 参考资料

- [Database page layout](https://www.postgresql.org/docs/18/storage-page-layout.html)
- [TOAST](https://www.postgresql.org/docs/18/storage-toast.html)
