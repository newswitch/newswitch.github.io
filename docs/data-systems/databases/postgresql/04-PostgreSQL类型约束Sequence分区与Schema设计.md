---
title: "类型、约束、Sequence、Partition 与 Schema 设计"
sidebar_label: "04. 类型、约束、Sequence、Partition 与 Schema 设计"
sidebar_position: 4
description: "从数据类型、约束、标识列、分区和在线演进设计可长期维护的 PostgreSQL Schema。"
tags: [PostgreSQL, Schema设计, Partition, Constraint]
---

# 类型、约束、Sequence、Partition 与 Schema 设计

正确 Schema 把业务不变量放入数据库，并让常用查询与存储布局匹配。

## 1. 类型和约束 {/* #类型和约束 */}

- 金额用整数最小单位或 `numeric(p,s)`，不用浮点；
- 时间明确 `timestamp with time zone` 表示时刻，时区在展示层转换；
- ID 选择 bigint/UUID 时评估索引局部性和分布式生成；
- `NOT NULL`、CHECK、UNIQUE、FK 是并发下可靠约束；
- Enum 修改成本高，稳定集合可用，频繁变化考虑引用表/约束。

约束不仅保证正确，还帮助优化器推理。应用先查再写不能替代 UNIQUE，因为两个并发事务可同时通过检查。

## 2. Sequence/Identity {/* #sequenceidentity */}

Identity 通常由 Sequence 提供值。Sequence 为吞吐允许 cache，事务回滚不会回收数字，因此只能保证唯一递增趋势，不能保证无空洞或严格提交顺序。

## 3. 分区 {/* #分区 */}

Range/List/Hash 分区用于裁剪、生命周期和维护超大表。分区键应出现在主要过滤和保留策略中。分区过多增加规划、catalog 和运维成本；分区不是自动提升所有查询。

```text
parent partitioned table
├─ 2026_08
├─ 2026_09
└─ default/next partitions
```

提前创建未来分区，监控 Default 分区和分区裁剪。唯一约束通常需包含分区键才能跨分区正确实现。

## 4. 在线演进 {/* #在线演进 */}

采用 expand-migrate-contract：先加可兼容列/索引，再双读写或回填，验证后收紧约束，最后删除旧字段。大表 `CREATE INDEX CONCURRENTLY`、`NOT VALID`/`VALIDATE CONSTRAINT` 有不同锁与失败清理语义。

## 5. Schema 评审实验 {/* #schema-评审实验 */}

```sql
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL,
  amount numeric(18,2) CHECK (amount >= 0),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id)
) PARTITION BY RANGE (created_at);
CREATE TABLE orders_2026_08 PARTITION OF orders
FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

测试时覆盖时区边界、NULL、金额精度、重复键、缺少分区和 sequence/identity 跳号。Sequence 保证并发取号，不保证无间隙；业务连续编号需要独立流程。分区键必须出现在适当的唯一约束中，并准备未来分区和 default partition 监控。

变更前用 `pg_depend`/目录和应用查询盘点依赖，区分 metadata-only 与会扫描/重写表的 DDL。大表加约束可先 `NOT VALID` 再 `VALIDATE CONSTRAINT`；所有 DDL 仍要设置 `lock_timeout`、观察锁等待并准备回滚。

## 6. 验收题 {/* #验收题 */}

- Sequence 为什么会跳号？
- FK 相比应用检查解决了什么并发问题？
- 分区键为什么影响唯一约束？
- 大表加 NOT NULL 如何减少长锁风险？

## 7. 参考资料 {/* #参考资料 */}

- [Data types](https://www.postgresql.org/docs/18/datatype.html)
- [Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)
- [Partitioning](https://www.postgresql.org/docs/18/ddl-partitioning.html)
