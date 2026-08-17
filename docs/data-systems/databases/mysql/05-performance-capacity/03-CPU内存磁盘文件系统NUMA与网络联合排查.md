---
title: "CPU、内存、磁盘、文件系统、NUMA 与网络联合排查"
sidebar_position: 3
tags: [MySQL, Linux, CPU, IO, NUMA, 网络]
description: "把 MySQL 内部等待与 Linux CPU、内存、磁盘、文件系统、NUMA 和网络证据对齐，避免单指标调优。"
---

# CPU、内存、磁盘、文件系统、NUMA 与网络联合排查

数据库延迟是完整路径的结果：

```text
client → network → connection/thread → lock/CPU → Buffer Pool
→ filesystem → block device → durability flush → response
```

## 1. 先做时间关联

建立同一时区的故障时间线：业务 P99、发布/DDL/备份、MySQL 指标和 OS 指标。一次磁盘尖峰若发生在告警之后，可能是结果而非原因。

快速快照：

```bash
uptime
vmstat 1
pidstat -p $(pidof mysqld) 1
iostat -xz 1
ss -s
```

命令需在目标发行版安装相应工具；连续采集优于只截一行。

## 2. CPU：忙、等还是被限流

看 user/system/iowait/steal、运行队列、上下文切换和单核分布：

```bash
mpstat -P ALL 1
pidstat -u -w -t -p $(pidof mysqld) 1
```

- user 高：SQL 扫描、排序、表达式、压缩或加密；
- system 高：网络、文件系统、频繁系统调用；
- iowait 高：任务等待 I/O，但需结合块设备；
- steal 高：虚拟机 CPU 被宿主机抢占；
- 单核满：串行复制 worker、热点 mutex 或单查询瓶颈；
- cgroup throttling：容器配额造成周期性停顿。

CPU 高时按 digest 找总执行量，必要时在受控环境用 `perf` 火焰图；不要在未知开销下长时间采样生产。

## 3. 内存与 swap

```bash
free -h
vmstat 1
cat /proc/$(pidof mysqld)/status
```

关注 RSS、available、major faults、swap in/out、OOM 记录和 cgroup `memory.events`。Linux 的“free 很少”可能只是缓存；持续 `si/so` 和 major fault 才更危险。

MySQL 侧关联 Buffer Pool、连接数、会话缓冲和 P_S memory。OOM 后先保存内核日志和配置，不要只重启并调大容器上限。

## 4. 磁盘与文件系统

```bash
iostat -xz 1
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT
df -h
df -i
```

关注：吞吐、IOPS、平均/尾延迟、队列、设备利用率、磁盘空间和 inode。`%util=100` 在不同设备模型下含义不同，不能单独判故障。

区分数据页读、redo/binlog fsync、临时文件、备份和在线 DDL。MySQL 中查看文件 I/O 摘要，OS 中确认这些文件映射到哪个卷，避免把逻辑磁盘与同一底层设备误认为隔离。

文件系统满可能来自 binlog 保留、临时表、备份或被删除但仍打开的文件：

```bash
lsof +L1
```

删除活跃数据库文件不是释放空间的安全办法。

## 5. NUMA

多路服务器上，远端内存访问和不均衡分配会增加延迟：

```bash
numactl --hardware
numastat -p $(pidof mysqld)
```

检查 mysqld CPU/内存绑定、容器 cpuset、IRQ 分布和宿主机策略。NUMA 调整必须在同硬件与工作负载上压测，不能只看到 `numa_miss` 就随意绑定或关闭机制。

## 6. 网络

```bash
ss -s
sar -n DEV,TCP,ETCP 1
ip -s link
```

关注重传、丢包、错误、队列、连接建立和 RTT。数据库“执行 5 ms、接口 500 ms”时拆分连接池等待、服务端执行、结果传输和客户端消费。

跨地域半同步复制的 commit 至少受到网络往返影响；MTU、DNS、TLS 握手和负载均衡 idle timeout 也可能制造间歇错误。

## 7. 联合诊断矩阵

| MySQL 现象 | OS 证据 | 可能方向 |
|---|---|---|
| 物理读暴增 | device read latency/queue 高 | 工作集变化、全扫、缓存不足 |
| commit 变慢 | write/fsync 延迟高 | redo/binlog、存储抖动 |
| Threads_running 高 | CPU run queue 高 | 并发过载、重 SQL |
| Threads_running 高、CPU 低 | 锁等待多 | 长事务/热点行 |
| P99 周期尖峰 | cgroup throttle/备份周期 | 资源限流或后台任务 |
| 仅远端应用慢 | RTT/重传高 | 网络/结果集/连接池 |

## 8. 排查顺序

```text
确认业务影响和时间窗
→ 看数据库是在执行还是等待
→ 找 Top digest/阻塞链
→ 对齐 CPU、内存、I/O、网络
→ 检查变更和后台任务
→ 最小止血
→ 受控复现与永久修复
```

## 9. 实验

在隔离环境分别制造 CPU 密集查询、冷缓存大扫描、fsync 延迟、行锁等待和网络延迟。为每种故障记录 MySQL 与 OS 的不同指纹，形成自己的证据手册。

## 参考资料

- [MySQL Server Status Variables](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html)
- [Performance Schema Wait Tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-wait-tables.html)
- [Linux perf Wiki](https://perf.wiki.kernel.org/)
