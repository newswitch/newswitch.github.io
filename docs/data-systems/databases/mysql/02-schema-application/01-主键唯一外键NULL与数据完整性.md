---
title: "主键、唯一约束、外键、NULL 与数据完整性"
sidebar_label: "01. 主键、唯一约束、外键、NULL 与数据完整性"
sidebar_position: 1
tags: [MySQL, 主键, 外键, 约束, 数据完整性]
description: "从实体完整性、唯一性、引用完整性和业务范围出发，正确设计 MySQL 主键、唯一键、外键、CHECK、NULL 与默认值。"
---

# 主键、唯一约束、外键、NULL 与数据完整性

应用校验可以改善用户体验，但不能替代数据库约束。并发请求、批处理、后台任务、迁移脚本和人工操作都可能绕过某一层应用；数据库是所有写路径汇合的最后边界。

---

## 1. 五类完整性

| 类型 | 要回答的问题 | 常用机制 |
| --- | --- | --- |
| 实体完整性 | 怎样唯一识别一行 | `PRIMARY KEY` |
| 唯一性 | 哪些业务值不能重复 | `UNIQUE` |
| 引用完整性 | 子记录必须引用什么父记录 | `FOREIGN KEY` |
| 域完整性 | 值允许什么范围 | 类型、`NOT NULL`、`CHECK` |
| 跨行/跨表业务规则 | 多行合计、状态机是否合法 | 事务、锁、应用与专门约束设计 |

没有一种约束能自动表达全部业务规则。关键是把能稳定、低成本由数据库保证的规则下沉，并为其余规则设计并发安全的事务。

---

## 2. 主键

```sql
CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(320) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
```

InnoDB 使用主键组织聚簇索引；二级索引条目保存主键，因此主键应：

- 唯一、非空、稳定；
- 尽量短；
- 不频繁更新；
- 生成策略可处理并发、合并与长期增长。

没有显式主键时，InnoDB 仍需内部行标识，但应用、复制、运维工具和数据修复会更困难。业务表应显式定义主键。

### 自增主键不是全局业务编号

自增值可能跳号，回滚、重启或并发都不保证连续。它适合内部标识，不适合需要法律连续性的票据编号。订单号等业务标识通常另设唯一列。

---

## 3. 唯一约束

```sql
ALTER TABLE customers
  ADD CONSTRAINT uk_customers_email UNIQUE (email);
```

唯一约束解决并发竞态：两个请求同时“先查不存在，再插入”，应用检查都可能通过，最终只有数据库唯一约束能原子拒绝重复。

应用正确流程：

1. 尝试写入；
2. 识别 Duplicate Key 错误码；
3. 根据幂等语义返回已有对象或冲突；
4. 不把所有数据库异常都当成重复。

### NULL 与 UNIQUE

NULL 表示未知，唯一索引对 NULL 的行为与普通值不同，可能允许多个 NULL。若业务要求值必须存在且唯一，应组合 `NOT NULL` 与 `UNIQUE`。

---

## 4. 联合唯一键

```sql
CREATE TABLE tenant_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  username VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uk_tenant_username UNIQUE (tenant_id, username)
) ENGINE=InnoDB;
```

它表达“同一租户内用户名唯一”，而不是全局唯一。

列顺序还影响索引查询能力，约束设计与访问模式要共同评审，但不能为了查询方便改变业务唯一性语义。

---

## 5. 外键

```sql
CREATE TABLE orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_orders_customer (customer_id),
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
) ENGINE=InnoDB;
```

外键保证：不能插入不存在的父记录，不能在仍被引用时随意删除父记录。

父子列的类型、符号属性和索引条件必须兼容。MySQL/InnoDB 要求外键列有可用索引；定义和变更时用 `SHOW CREATE TABLE` 验证实际结果。

### 引用动作

| 动作 | 含义 | 风险 |
| --- | --- | --- |
| `RESTRICT`/`NO ACTION` | 有引用时拒绝父记录变更 | 需要应用显式处理 |
| `CASCADE` | 父变更传播到子表 | 大级联可能持锁、产生日志和复制压力 |
| `SET NULL` | 子外键置 NULL | 子列必须允许 NULL，业务要能解释“无父对象” |

InnoDB 不提供延迟到事务提交才检查的外键语义；规则按语句执行边界处理。

---

## 6. 要不要使用外键

适合：

- 单实例内强关系；
- 写入规模和级联范围可控；
- 数据正确性比极端写吞吐更重要；
- 所有写入都经过同一数据库边界。

不适合直接套用：

- 跨实例/分片关系；
- 高吞吐异步链路；
- 超大级联删除；
- 生命周期由事件和最终一致性管理。

不用外键不等于不需要引用完整性。必须补充写入协议、定期对账、孤儿数据监控和修复流程。

---

## 7. CHECK 约束

```sql
CREATE TABLE order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quantity INT NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_unit_price_nonnegative CHECK (unit_price >= 0)
) ENGINE=InnoDB;
```

CHECK 适合稳定的行内规则，例如范围和列间关系。它不适合需要查询其他表、外部服务或大量历史数据的规则。

上线约束前先扫描旧数据。已有坏数据会使变更失败或迫使团队错误地关闭检查。

---

## 8. NOT NULL 与默认值

```sql
status TINYINT UNSIGNED NOT NULL,
created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
```

默认值适用于真正合理的缺省语义。不要给所有列设置“方便插入”的假默认值：

- 金额缺失变成 0；
- 未知时间变成纪元；
- 状态缺失变成某个合法状态；
- 必填名称变成空字符串。

这些值会让错误数据看似合法，后续很难区分。

---

## 9. 约束与字符排序语义

唯一字符串是否重复由排序规则影响。大小写不敏感排序规则下，`Alice` 与 `alice` 可能被视为相等。

对邮箱、用户名、订单号、设备 ID 分别定义：

- 是否大小写敏感；
- 是否规范化；
- Unicode 等价字符怎样处理；
- 唯一性依据原文还是规范值。

数据库约束必须与应用规范化使用同一语义，否则会出现应用认为不同、数据库认为相同，或反之。

---

## 10. 约束命名

使用可读、稳定名称：

```text
pk_orders
uk_orders_order_no
fk_orders_customer
chk_orders_amount_nonnegative
```

好处：

- 错误日志可识别；
- DDL 可精确删除/变更；
- 多环境对比稳定；
- 事故中能快速映射业务规则。

主键名称在 MySQL 中固定为 `PRIMARY`，其他约束名需遵守相应命名空间与长度边界。

---

## 11. 约束变更的生产风险

添加约束可能需要：

- 扫描历史数据；
- 构建索引；
- 获取 MDL；
- 等待长事务；
- 产生 I/O、Redo/Binlog 和复制压力；
- 因坏数据失败并回滚工作。

安全流程：

1. 离线检查历史数据；
2. 估算表大小和执行算法；
3. 检查长事务和 MDL；
4. 在影子/预生产使用生产规模验证；
5. 低峰执行并设置观测、停止和回滚条件；
6. 验证 Source 与 Replica 定义一致。

不要通过长期关闭 `foreign_key_checks` 来逃避坏数据。关闭检查的会话可能写入孤儿记录，而且重新开启并不等于自动把所有历史数据重新验证完毕。

---

## 12. 元数据检查

```sql
SHOW CREATE TABLE shop.orders\G

SELECT constraint_name, constraint_type, table_name
FROM information_schema.table_constraints
WHERE table_schema = 'shop'
ORDER BY table_name, constraint_type, constraint_name;
```

外键关系：

```sql
SELECT
  constraint_name,
  table_name,
  column_name,
  referenced_table_name,
  referenced_column_name
FROM information_schema.key_column_usage
WHERE table_schema = 'shop'
  AND referenced_table_name IS NOT NULL;
```

Schema 管理系统应定期对比期望定义和实际定义，避免人工热修复造成漂移。

---

## 13. 并发实验

两个会话同时执行相同业务键插入：

```sql
INSERT INTO customers(email, display_name)
VALUES ('same@example.com', 'First');
```

观察：

- 只有一个成功；
- 另一个收到明确唯一键错误；
- 应用是否错误重试；
- 表中最终只有一行；
- 错误日志和业务指标能否识别冲突。

再分别测试外键不存在、CHECK 越界、NULL 和级联范围。

---

## 14. 验收题

1. 为什么“先查再插”不能替代唯一约束？
2. 主键为什么应短且稳定？
3. UNIQUE 与 NULL 组合有什么语义风险？
4. `CASCADE` 为什么可能造成生产事故？
5. 不使用外键时需要补哪些完整性机制？
6. 为什么重新开启 `foreign_key_checks` 不等于历史数据一定正确？
7. 上线约束前需要哪些容量和 MDL 证据？

下一篇从关系建模角度学习范式、反范式和宽表取舍。

## 官方参考

- [CREATE TABLE Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table.html)
- [FOREIGN KEY Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)
- [CHECK Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html)
