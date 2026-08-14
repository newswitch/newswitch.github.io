---
title: "Page、Row Format、聚簇索引与二级索引"
sidebar_position: 2
tags: [MySQL, InnoDB, Page, Row Format, 聚簇索引]
description: "从 InnoDB Page 和记录布局理解聚簇索引、二级索引、回表、页分裂、大字段和主键设计。"
---

# Page、Row Format、聚簇索引与二级索引

InnoDB 的 I/O、缓存和 B+Tree 管理以 Page 为核心，不是每次只从磁盘读取一行。理解 Page 后，回表、覆盖索引、页分裂和“大主键为什么贵”会自然连起来。

---

## 1. 从表到 Page

```text
Table
→ Clustered B+Tree + Secondary B+Trees
→ Index Pages
→ Records
→ Columns
```

一个 Page 包含页头、记录、空闲空间、目录与校验等结构。默认 Page Size 常见为 16 KiB，但应查询目标实例，且初始化后不能当作普通动态参数随意修改。

```sql
SHOW VARIABLES LIKE 'innodb_page_size';
```

---

## 2. B+Tree

索引树包含：

- Root Page；
- 非叶子 Page：保存键范围与子页指针；
- 叶子 Page：保存聚簇记录或二级索引条目；
- 兄弟页之间的顺序关系，支持范围扫描。

树高受记录/键宽度和页填充影响。更宽的键让每页条目更少，可能增加页数、缓存和 I/O。

---

## 3. 聚簇索引

InnoDB 聚簇索引叶子保存完整行记录，通常按主键组织：

```text
Primary Key B+Tree
leaf: [PK | row columns]
```

主键范围查询能顺序访问相邻叶子页。更新主键意味着记录逻辑位置变化，因此主键应稳定。

没有显式主键时，InnoDB 会选择可用唯一非空索引或内部生成行标识；这会削弱应用和运维对行身份的控制。

---

## 4. 二级索引

二级索引叶子通常保存：

```text
[secondary key | primary key]
```

查询需要非索引列时：

```text
二级索引找到主键
→ 使用主键访问聚簇索引
→ 读取完整行
```

这就是回表。大量随机回表可能造成 Buffer Pool 和 I/O 压力。

---

## 5. 覆盖索引

若二级索引已包含过滤、排序和返回所需列，可以直接从二级索引完成查询，避免回表。

```sql
KEY idx_orders_customer_created
  (customer_id, created_at, id)
```

但不要把所有返回列都加入索引：索引越宽，写放大、空间、缓存和 DDL 成本越高。用工作负载频率与收益评估。

---

## 6. 为什么主键宽度传播

每个二级索引叶子需要保存主键。若使用很宽的字符串主键：

```text
1 个宽主键
× 多个二级索引
× 全部行
→ 显著空间与缓存成本
```

UUID 是否适合作主键不能只争论“随机”。还要看二进制/文本表示、插入分布、页分裂、全局唯一需求和索引数量。

---

## 7. Page Split 与 Merge

目标叶子页没有足够空间时可能分裂：

```text
读取/锁定目标页
→ 分配新页
→ 搬移部分记录
→ 更新父节点
→ 记录日志
```

随机主键插入更容易在树中不同位置产生分裂与随机写。顺序主键也可能形成右侧热点，在超高并发/分布式场景需权衡。

删除记录不会总是立即让文件缩小；空间可能留在表空间复用，页合并和物理回收有各自条件。

---

## 8. Row Format 与大字段

常见现代 Row Format 会把部分长可变列内容放到溢出页，聚簇记录保留指针/前缀等信息。实际行为受行格式、列长度和 Page 空间影响。

大 `TEXT/BLOB/JSON` 会增加：

- 溢出页访问；
- Buffer Pool 占用；
- 网络返回；
- Redo/Undo/Binlog；
- 备份恢复；
- DDL 和复制成本。

不要用 `SELECT *` 无条件读取大列；可按访问频率拆扩展表或对象存储，但要设计一致性。

```sql
SHOW TABLE STATUS FROM shop LIKE 'orders'\G
SHOW CREATE TABLE shop.orders\G
```

---

## 9. 行记录中的事务信息

InnoDB 会为记录维护内部事务标识和 Roll Pointer 等信息，用于定位最近修改事务、连接 Undo 版本链和处理删除标记。

因此更新不是简单覆盖字节：它需要支持回滚、并发可见性和恢复。

---

## 10. 索引条件与回表成本

一条查询的代价不能只看返回 10 行：

```text
扫描二级索引条目数
+ 回表次数
+ Page 是否命中
+ MVCC 版本检查
+ 排序/过滤丢弃
```

后续 `EXPLAIN ANALYZE` 要比较 estimated rows 与 actual rows，并结合 Handler/Buffer Pool 指标。

---

## 11. 隐式转换与索引

索引列被函数包裹、类型不匹配或排序规则转换时，可能无法使用理想范围：

```sql
WHERE DATE(created_at) = '2026-08-14'
```

更容易形成范围的写法：

```sql
WHERE created_at >= '2026-08-14 00:00:00'
  AND created_at <  '2026-08-15 00:00:00'
```

最终以执行计划证明，不把规则背成绝对结论。

---

## 12. Page 损坏与校验

Page 从磁盘读入时会进行结构/校验检查。错误可能来自：

- 存储介质；
- 内存或 DMA；
- 文件系统/控制器；
- 不安全复制数据文件；
- 软件 Bug。

遇到 Page Corruption：先保护现场、停止扩大写入、保存错误日志与存储健康证据，优先从已验证备份恢复。`innodb_force_recovery` 是数据抢救工具，不是长期运行模式。

---

## 13. 实验

1. 为相同数据创建短整数主键和宽字符串主键表；
2. 增加多个二级索引，比较大小；
3. 用二级索引查询分别返回覆盖列和非覆盖列；
4. 生成顺序/随机主键写入，观察页与 I/O 行为；
5. 插入大 JSON/TEXT，比较 `SELECT *` 与只读小列；
6. 删除大量行，观察逻辑行数、表空间与重建差异。

## 14. 验收题

1. 聚簇索引和二级索引叶子分别保存什么？
2. 什么是回表，什么时候可以避免？
3. 宽主键为何会放大所有二级索引？
4. Page Split 会带来哪些成本？
5. 删除行为什么不代表 `.ibd` 立即变小？
6. 大字段如何影响 Page、缓存和日志？
7. Page Corruption 为什么不能靠重启作为修复？

下一篇进入 Buffer Pool、脏页与数据页安全刷盘。

## 官方参考

- [InnoDB Physical Structure](https://dev.mysql.com/doc/refman/8.4/en/innodb-physical-structure.html)
- [Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)
- [InnoDB Row Formats](https://dev.mysql.com/doc/refman/8.4/en/innodb-row-format.html)
