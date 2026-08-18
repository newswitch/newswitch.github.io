---
title: "Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite"
sidebar_label: "03. Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite"
sidebar_position: 3
description: "理解 InnoDB 缓存、LRU、脏页、Checkpoint 刷盘、Change Buffer 和 Doublewrite 的性能与完整性边界。"
tags: [MySQL, InnoDB, Buffer Pool, 脏页, Doublewrite]
---

# Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite

Buffer Pool 把磁盘 Page 缓存在内存，使读写不必每次等待数据文件。性能来自延迟写回，但安全来自 Redo、Checkpoint 与 Doublewrite 的协作。

## 1. Page 状态

```text
Free Page       可分配
Clean Page      与磁盘一致，可淘汰
Dirty Page      内存版本更新，尚未写回最终表空间
Pinned/In-use   当前不能随意淘汰
```

内存满时不能直接丢弃脏页，必须先安全刷盘。

## 2. LRU 不是简单队列

InnoDB 使用经过调整的 LRU，区分新/旧区域，防止一次大扫描立刻挤掉全部热点。Page 是否提升、停留和淘汰受访问模式与配置影响。

现象：

- 报表全表扫描后在线查询变慢；
- Buffer Pool 很大但热点仍抖动；
- Read Ahead 读入大量未使用 Page；
- 重启后冷缓存导致延迟尖峰。

需要看 Page Read、Young/Not Young、Eviction Without Access 和业务延迟。

## 3. 命中率的误区

很高的整体命中率仍可能掩盖关键查询随机读；短时间窗口、不同表和不同业务的热点被聚合后更难判断。

结合：

```text
物理 Page Read/s
逻辑读
磁盘 await/队列
每 Digest rows examined
关键表/索引工作集
冷启动/批任务时间线
```

不要仅用 `Buffer Pool Hit Rate < 99%` 做通用告警。

## 4. 脏页怎样产生

`INSERT/UPDATE/DELETE` 修改 Buffer Pool Page，Page 标记为 Dirty。提交主要保证必要日志持久化，脏页可稍后写回。

```text
业务写入快
→ Dirty Pages 增长
→ Page Cleaner 后台刷盘
→ Checkpoint LSN 推进
```

若写入持续超过磁盘刷页能力，脏页与 Redo 压力积累，最终前台被节流。

## 5. 刷盘触发

刷盘受多种信号驱动：

- LRU 需要空闲 Page；
- 脏页水位；
- Redo Checkpoint Age；
- 自适应刷新估算；
- 空闲和关闭流程。

小 Redo 容量会迫使更频繁 Checkpoint；盲目把 Redo 设得巨大可能增加异常恢复需要扫描的工作范围。容量要基于写入速率、I/O 和 RTO 压测。

## 6. Doublewrite 的写入路径

```text
Dirty Page
→ Doublewrite 文件中的连续区域
→ fsync/持久化
→ 写到各自表空间最终位置
```

若最终 Page 写到一半发生故障，恢复可从 Doublewrite 找完整副本，再应用 Redo。

它不是把所有数据库保存两份，也不是业务备份。关闭会降低 torn-page 修复能力；仅在理解底层原子写保证和数据风险后评估。

## 7. Change Buffer

当部分二级索引 Page 不在 Buffer Pool 时，InnoDB 可把变更缓存，待 Page 以后读入再 Merge，从而避免立即随机读。

收益更可能出现在：

- 二级索引多；
- 写密集；
- 工作集大于内存；
- 存储随机 I/O 较贵。

代价：

- 占用 Buffer Pool/System Tablespace；
- 后续读取或恢复时 Merge；
- Merge 追赶带来 I/O；
- 不适用于所有索引类型。

MySQL 8.4 的实际默认 `innodb_change_buffering` 应查询目标实例，不照搬旧文章。

## 8. 观测

```sql
SHOW ENGINE INNODB STATUS\G

SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';
SHOW GLOBAL STATUS LIKE 'Innodb_pages%';

SELECT NAME, COUNT, COMMENT
FROM information_schema.innodb_metrics
WHERE NAME LIKE '%ibuf%';
```

再对齐：磁盘读写、await、util/队列、fsync、CPU iowait、业务 P99 和批任务。

`INNODB_BUFFER_PAGE` 等逐页视图可能很重，优先在测试实例使用。

## 9. Buffer Pool 大小

专用数据库常把较大内存分给 Buffer Pool，但不能机械使用某个百分比。预留：

- Server/Performance Schema；
- 每连接/排序/Join/临时表；
- Binlog/复制/备份；
- OS、文件系统和运维工具；
- 容器与其他进程；
- 峰值和故障诊断余量。

Swap 或 OOM Kill 往往比小一点 Buffer Pool 更糟。

## 10. 冷启动

重启后数据页需要重新进入内存，表现为物理读和延迟上升。可保存/恢复 Buffer Pool 热点信息、执行受控预热或渐进导流，但都不能替代容量余量。

扩容、故障切换和发布的容量模型要包含冷缓存状态。

## 11. 调优实验

固定数据集和工作负载，分别测：

1. 冷缓存与热缓存；
2. 在线短查询 + 全表扫描干扰；
3. 持续写入到脏页/Checkpoint 压力；
4. 不同 Buffer Pool/Redo 容量；
5. Change Buffer 实际状态；
6. 正常停止、异常退出后的恢复时间。

同时保存 P99、QPS、Page Read/Write、Dirty、Redo、磁盘和恢复时间，不以单次跑分结论调生产。

## 12. 验收题

1. Clean Page 与 Dirty Page 有何区别？
2. 为什么高命中率仍可能存在关键 I/O 瓶颈？
3. Redo 容量怎样影响刷页与恢复？
4. Doublewrite 与 Redo 分别解决什么？
5. Change Buffer 何时可能有收益和代价？
6. 为什么 Buffer Pool 不能占满容器全部内存？
7. 冷启动为什么要进入高可用容量规划？

下一篇连接事务的三类日志：Redo、Undo 与 Binlog。

## 13. 官方参考 {/* #官方参考 */}

- [Buffer Pool](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool.html)
- [Change Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-change-buffer.html)
- [Doublewrite Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-doublewrite-buffer.html)
- [InnoDB Checkpoints](https://dev.mysql.com/doc/refman/8.4/en/innodb-checkpoints.html)
