---
title: "MySQL 配置分层、内存预算、连接与线程模型"
sidebar_position: 1
tags: [MySQL, 配置, 内存, 连接池, 线程模型]
description: "建立配置来源、全局与会话内存、连接和执行线程的容量模型，避免照抄参数与连接数失控。"
---

# MySQL 配置分层、内存预算、连接与线程模型

调优不是寻找一份“万能 my.cnf”，而是让配置与工作负载、硬件、SLO 和故障模型匹配。参数应先分类，再基于证据修改。

## 1. 配置从哪里生效

```text
编译默认值
→ option file
→ 启动参数
→ SET PERSIST / SET GLOBAL
→ SET SESSION
```

排查时同时查询运行值和来源：

```sql
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
SELECT VARIABLE_NAME, VARIABLE_SOURCE, VARIABLE_PATH
FROM performance_schema.variables_info
WHERE VARIABLE_NAME IN
 ('innodb_buffer_pool_size','max_connections','tmp_table_size');
```

修改分为动态/静态、全局/会话、持久/仅本次运行。`SET GLOBAL` 通常只影响新会话；`SET PERSIST` 会写持久配置。变更前确认版本、权限、重启行为和回滚命令。

## 2. 内存不是一个 Buffer Pool

可用下面的上界模型做第一次审查：

```text
mysqld memory
≈ global fixed/shared
+ active sessions × per-session working memory
+ background/replication/P_S memory
+ allocator fragmentation and native overhead
```

全局大项通常包括 Buffer Pool、redo 相关缓冲、Performance Schema、表缓存等。会话内存包括 thread stack、网络缓冲、digest、排序、Join、读取和临时结果；很多缓冲按语句需要才增长，但高并发同时触发时仍会叠加。

```sql
SHOW VARIABLES WHERE Variable_name IN (
 'innodb_buffer_pool_size','max_connections','thread_stack',
 'sort_buffer_size','join_buffer_size','read_buffer_size',
 'read_rnd_buffer_size','tmp_table_size','max_allowed_packet'
);
```

错误公式是把所有 per-session 上限机械相加后乘 `max_connections`，因为并非全部同时分配；更危险的错误是完全忽略并发乘法。正确方法是结合 Performance Schema memory 汇总、进程 RSS 和压力测试建立实测峰值。

```sql
SELECT EVENT_NAME,
       CURRENT_NUMBER_OF_BYTES_USED,
       HIGH_NUMBER_OF_BYTES_USED
FROM performance_schema.memory_summary_global_by_event_name
ORDER BY CURRENT_NUMBER_OF_BYTES_USED DESC
LIMIT 30;
```

## 3. 为操作系统保留空间

不要把物理内存全部给 Buffer Pool。还要给这些对象留预算：

- mysqld 非 Buffer Pool 内存；
- 内核、文件系统元数据和网络；
- 监控、备份、日志和安全代理；
- 在线 DDL、恢复和流量峰值；
- 容器 cgroup 上限与 page cache。

目标不是“内存用满”，而是峰值下无 OOM、无持续 swap 抖动且缓存有效。容器中同时观察宿主机和 cgroup，不能只看 `free`。

## 4. 连接不是吞吐

默认连接处理通常为每个客户端连接关联一个线程。大量空闲连接也消耗文件描述符、内存和管理资源；大量活跃连接会增加 CPU 调度和锁竞争。

```sql
SHOW GLOBAL STATUS WHERE Variable_name IN (
 'Threads_connected','Threads_running','Threads_created',
 'Connections','Aborted_connects','Max_used_connections'
);
SHOW VARIABLES WHERE Variable_name IN (
 'max_connections','thread_cache_size','wait_timeout'
);
```

关键区别：

```text
connected ≠ running
max_connections ≠ safe concurrency
more connections ≠ more QPS
```

当 `Threads_running` 超过 CPU 和存储能承受的并发后，吞吐可能不再增长而 P99 急升。

## 5. 连接池容量

应用总连接上界：

```text
instances × pool max per instance
+ jobs/admin/monitor/replication reserve
≤ database safe connection budget
```

必须给故障登录和运维留保留量。连接池还应配置获取超时、语句超时、连接最大寿命、健康检查和泄漏检测。扩容应用实例时若不下调单池上限，会瞬间放大数据库连接。

用 Little's Law 做粗估：

```text
required concurrency ≈ throughput × average DB time
```

再用压测验证 P99 拐点，而不是把池设成任意大数。

## 6. 参数变更流程

```text
提出假设
→ 保存基线和来源
→ 在代表性负载下单变量实验
→ 观察吞吐/P99/内存/I/O/锁/复制
→ 小流量灰度
→ 记录持久化与回滚
```

典型反模式：一次改十个参数、只看 QPS、不留 OS 内存、用连接数掩盖慢 SQL、无压测就调大会话缓冲。

## 7. 验收实验

逐步增加客户端并发，记录 `Threads_running`、QPS、P95/P99、RSS、page faults、磁盘延迟和错误率。找到“吞吐趋平但延迟上翘”的饱和点，生产容量应留余量。

## 参考资料

- [How MySQL Uses Memory](https://dev.mysql.com/doc/refman/8.4/en/memory-use.html)
- [Connection Interfaces](https://dev.mysql.com/doc/refman/8.4/en/connection-interfaces.html)
- [Using System Variables](https://dev.mysql.com/doc/refman/8.4/en/using-system-variables.html)

