---
title: "InnoDB 内存与磁盘整体架构"
sidebar_label: "01. InnoDB 内存与磁盘整体架构"
sidebar_position: 1
tags: [MySQL, InnoDB, Buffer Pool, Tablespace, 架构]
description: "建立 InnoDB 内存、磁盘、后台线程和一次读写的全局地图，为事务、索引和恢复打基础。"
---

# InnoDB 内存与磁盘整体架构

InnoDB 是 MySQL 8.4 的默认存储引擎。它负责表和索引、事务、MVCC、行锁、Redo/Undo 与崩溃恢复；SQL 解析、优化、权限和 Binlog 等仍位于 MySQL Server 层。

---

## 1. 总体地图

```text
MySQL Server
  Parser / Optimizer / Executor / Binlog
                 │ Handler API
                 ▼
InnoDB
├─ 内存
│  ├─ Buffer Pool
│  ├─ Log Buffer
│  ├─ Change Buffer（内存部分）
│  └─ Adaptive Hash Index 等
├─ 磁盘
│  ├─ System / File-per-table / General Tablespace
│  ├─ Undo Tablespace
│  ├─ Redo Log
│  ├─ Doublewrite Files
│  └─ Temporary Tablespace
└─ 后台工作
   ├─ Page Cleaner / Flush
   ├─ Purge
   ├─ I/O Threads
   └─ Log Writer / Checkpoint / Recovery
```

任何性能或恢复结论都要指出状态位于哪一层。

---

## 2. Buffer Pool

Buffer Pool 以 Page 为单位缓存表和索引数据。读请求先查内存，未命中才从表空间读取；写请求通常先修改内存 Page，成为脏页，随后后台刷盘。

它不只缓存“表数据”，还包含索引页、Undo 相关页、自适应结构和管理元数据。

```text
SELECT
→ B+Tree 定位 Page
→ Buffer Pool 命中：内存读取
→ 未命中：磁盘读取并放入 Buffer Pool
```

Buffer Pool 大不等于一定快：全表扫描污染、随机工作集大于内存、锁等待和错误执行计划都不能只靠加内存解决。

---

## 3. Log Buffer

数据修改产生 Redo，先进入内存 Log Buffer，再由日志线程写入/刷入 Redo 文件。

大事务可能在提交前产生大量 Redo；Log Buffer 太小会更早写出，但盲目增大只改变缓冲，不消除最终磁盘带宽与提交持久性要求。

---

## 4. Tablespace

### System Tablespace

保存实例级 InnoDB 结构，并可能包含 Change Buffer 等状态。它不是简单的某张业务表文件。

### File-per-table Tablespace

常见默认模式下，每张 InnoDB 表的表和索引数据位于独立 `.ibd` 表空间，便于对象级管理和空间回收操作，但不意味着可直接复制单个文件完成一致备份。

### General Tablespace

可由多个表共享，需要明确生命周期、加密和运维边界。

### Undo Tablespace

保存 Undo 记录，用于事务回滚和构造历史版本。长事务会阻止旧 Undo 清理。

---

## 5. Redo、Undo、Binlog 的位置

| 日志 | 所属 | 核心用途 |
| --- | --- | --- |
| Redo | InnoDB | 崩溃后重放已记录的页修改 |
| Undo | InnoDB | 回滚事务、MVCC 历史版本 |
| Binlog | MySQL Server | 复制、PITR、逻辑变更传播 |

一次提交要协调 InnoDB 与 Server 日志。三者任何一个都不是另外两个的完整替代品。

---

## 6. Doublewrite

数据页比底层原子写单元更大时，断电或进程异常可能留下部分写 Page。InnoDB 先把待刷页写入 Doublewrite 区域，再写最终表空间位置；恢复时可使用完整副本修复 torn page。

它保护 Page 原子性，不替代 Redo、备份或存储副本。为了跑分关闭它会改变数据完整性边界。

---

## 7. 后台刷页

脏页不能无限积累。Page Cleaner 根据：

- 脏页比例；
- Redo 空间压力；
- I/O 能力；
- Checkpoint 推进；
- 空闲和工作负载变化

逐步刷盘。

刷得太慢会在 Redo 接近容量边界时触发前台节流；刷得太猛会抢占业务 I/O。调优要观察脏页、Checkpoint Age、Redo 速率与磁盘 await，而不是只改 I/O 线程数。

---

## 8. Purge

事务提交后，旧版本并不一定立即删除。只要仍有活跃 Read View 可能需要它，Undo 版本必须保留。Purge 在安全后清理历史版本和删除标记。

长事务造成：

```text
History List 增长
→ Undo 空间增长
→ 查询版本链更长
→ Purge 追赶产生 I/O
```

因此“只读大查询”也可能通过长快照影响整个实例。

---

## 9. Change Buffer 与 AHI

Change Buffer 可缓存不在 Buffer Pool 中的部分二级索引页变更，稍后合并，减少随机读；实际默认和适用范围按 8.4.x 变量核对，不能照搬旧版本调优经验。

Adaptive Hash Index 根据访问模式为部分热点建立内部哈希加速，但会有内存和并发开销。是否有效必须用指标和代表性负载验证。

这两者都不是业务可以直接定义的普通索引。

---

## 10. 一次读路径

```text
Executor 请求索引范围
→ InnoDB 查 B+Tree
→ 需要的 Page 是否在 Buffer Pool
→ 未命中则发起 I/O
→ 校验 Page 并放入 Buffer Pool
→ 根据 MVCC/锁语义读取记录
→ 二级索引需要时回表
→ 返回 Server 层过滤/聚合/发送
```

慢可能来自计划扫描多、Page 未命中、磁盘慢、版本链长、锁等待或客户端消费慢。

---

## 11. 一次写路径

```text
定位记录并获取锁
→ 生成 Undo
→ 修改 Buffer Pool Page
→ 生成 Redo 到 Log Buffer
→ Server 生成 Binlog
→ Commit 协调与日志刷盘
→ 事务锁释放
→ 脏页以后经 Doublewrite 写回表空间
→ 旧版本以后由 Purge 清理
```

提交完成不要求所有数据页已经写回；持久性依靠日志和恢复协议。

---

## 12. 观测入口

```sql
SHOW ENGINE INNODB STATUS\G

SELECT NAME, COUNT, TYPE, COMMENT
FROM information_schema.innodb_metrics
WHERE NAME LIKE 'buffer%'
   OR NAME LIKE 'log%';
```

以及 Performance Schema、`SHOW GLOBAL STATUS` 和系统 I/O 指标。不要高频扫描 `INNODB_BUFFER_PAGE` 等重型诊断表，官方明确提示它可能产生显著开销。

---

## 13. 内存不是只有 Buffer Pool

实例内存还包含：

- 每连接/每查询 Buffer；
- Performance Schema；
- Table/Open Cache；
- Binlog/复制；
- 排序与临时表；
- Server/插件/线程栈。

```text
总内存 ≠ innodb_buffer_pool_size
```

容器 Limit 下尤其要为峰值连接和临时内存留余量，避免被 OOM Kill。

---

## 14. 实验与验收

1. 查询所有 InnoDB 关键目录与容量变量；
2. 冷热两次执行相同索引查询，比较 Page Read；
3. 批量写入后观察脏页、Redo 和刷盘；
4. 开长事务，观察 History List/Undo 变化；
5. 重启实验实例，识别启动恢复日志阶段。

验收题：

1. Server 层与 InnoDB 的边界是什么？
2. Buffer Pool、Log Buffer 和表空间分别保存什么？
3. Doublewrite 解决什么，不能解决什么？
4. 长只读事务为什么会影响 Purge？
5. 提交后数据页为什么可以稍后刷盘？
6. 为什么内存预算不能只看 Buffer Pool？

下一篇进入最小存储单位：Page、Row Format 与两类索引。

## 官方参考

- [InnoDB Architecture](https://dev.mysql.com/doc/refman/8.4/en/innodb-architecture.html)
- [InnoDB In-Memory Structures](https://dev.mysql.com/doc/refman/8.4/en/innodb-in-memory-structures.html)
- [InnoDB On-Disk Structures](https://dev.mysql.com/doc/refman/8.4/en/innodb-on-disk-structures.html)
