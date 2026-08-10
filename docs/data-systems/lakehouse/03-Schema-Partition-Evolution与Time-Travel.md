---
title: Iceberg Schema Evolution、Partition Evolution 与 Time Travel
sidebar_position: 3
tags: [Iceberg, Schema Evolution, Partition Evolution, Time Travel]
description: 理解字段 ID、分区规范演进、隐藏分区、历史快照和安全回滚。
---

# Iceberg Schema Evolution、Partition Evolution 与 Time Travel

传统目录表把物理分区写进路径和 SQL，改分区常需重写历史。Iceberg 用稳定字段 ID 和版本化 partition spec，使新旧文件可按不同布局共存，查询仍基于业务字段表达。

## 1. Schema Evolution

表 schema 为字段分配稳定 ID。安全操作可包括添加、删除、重命名、重排和有限类型提升，具体规则以表规范版本为准。字段重命名不等于删旧列再建同名列，稳定 ID 可避免旧文件被误解释。

语法兼容不代表业务兼容：金额单位、时区、枚举、nullable 语义变化仍需数据契约和版本。所有 reader/writer 都要做兼容测试。

## 2. Partition Transform

Iceberg 可从源列推导 partition 值，例如 identity、day/hour、bucket、truncate 等。查询写 `event_time` 条件，表元数据推导到对应 partition，无需用户手写物理目录字段，这就是 hidden partitioning 的价值。

选择 transform：时间范围查询用 day/hour，均匀分布/Join 可考虑 bucket，字符串前缀/数值范围可考虑 truncate。分区应控制每分区数据量、写并发与文件数。

## 3. Partition Evolution

新 partition spec 只影响新写文件，旧文件保留旧 spec；manifest标注其 spec。Reader 对每种 spec分别转换过滤条件并合并结果。因此可以从 day 改 hour，或增加 bucket，而不立即重写全部历史。

演进并不自动优化旧数据；若历史查询也需要新布局，可按收益选择 rewrite。

## 4. Time Travel

按 snapshot ID 或时间读取历史版本，可用于审计、复现、对比和回滚。按时间选择的具体边界与时区需明确，关键任务最好记录精确 snapshot ID。

Rollback/设置当前 snapshot 改变“当前指针”，但后续提交和分支历史要谨慎。若旧 snapshot已过期或其文件被删除，无法 time travel。

## 5. Branch 与 Tag

若引擎/规范支持，可用 branch隔离写入/验证，用 tag 固定重要版本。它们仍引用文件，会影响 snapshot expiration 与存储占用。生产应定义 owner、保留期和合并/发布流程。

## 6. 演进流程

1. 盘点所有 reader/writer 版本和字段使用；
2. 在副本表执行 schema/spec 变化；
3. 新旧文件混合读写，验证 filter、类型、delete 和统计；
4. 发布数据契约与回滚 snapshot；
5. 分阶段上线 writer，再 reader；
6. 观察 planning、文件大小和查询成本；
7. 过观察期再过期旧历史。

## 7. 实验

初始按 day 分区，写两天数据；改为 hour 或 day+bucket 后再写，查看 files metadata中的 spec ID。执行相同业务谓词，证明新旧布局均返回。重命名列并查询旧 snapshot，记录字段 ID 和结果。

## 8. 掌握验收

- 解释字段 ID 为何比列位置/名称可靠；
- 根据 workload 选择 partition transform；
- 说明新旧 partition spec 如何共存；
- 用 snapshot ID 复现一批计算；
- 将 tag/branch 引用纳入生命周期。

上一篇：[Iceberg Metadata 与 Snapshot](./02-Iceberg-Metadata-Manifest-Snapshot与读写路径.md)　下一篇：[并发提交、小文件、Compaction 与快照生命周期](./04-并发提交小文件Compaction与快照生命周期.md)

## 参考资料

- [Iceberg Evolution](https://iceberg.apache.org/docs/latest/evolution/)
- [Iceberg Partitioning](https://iceberg.apache.org/docs/latest/partitioning/)
