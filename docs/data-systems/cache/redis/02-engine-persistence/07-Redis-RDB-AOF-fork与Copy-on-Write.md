---
title: "RDB、AOF、多段 AOF、fork 与 Copy-on-Write"
sidebar_label: "07. RDB、AOF、多段 AOF、fork 与 Copy-on-Write"
sidebar_position: 7
description: "以 Redis 8.6 解释 RDB 快照时点、AOF 三种刷盘策略、多段文件与重写，结合 COW、指标和故障模型理解持久化与恢复边界。"
tags: [Redis, RDB, AOF, Fork, COW]
---

# RDB、AOF、多段 AOF、fork 与 Copy-on-Write

Redis 把数据放在内存中执行，不意味着每个返回 `OK` 的写入都已经进入稳定存储。持久化要区分：数据何时修改、何时写入文件、何时完成刷盘，以及故障后究竟能恢复到哪里。

本文以 **Redis Open Source 8.6、Linux** 为基线。多段 AOF 从 Redis 7.0 起使用；旧版单文件教程不能直接用于当前文件集合。命令中的实验端口为 `127.0.0.1:16379`，输出均为教学示意，不是生产实测。

## 1. RDB {/* #rdb */}

### 1.1 快照保存哪个时刻

`BGSAVE` 的主要路径是：

```text
父进程 fork 子进程，形成数据视图
  ├─ 父进程继续处理请求
  └─ 子进程序列化该视图 → 临时 RDB → 完成后替换最终文件
```

假设 10:00 开始快照，10:00:20 完成，10:00:25 主机故障。新文件对应的是开始快照时的数据视图，不能因为文件刚刚生成，就认为它包含到 10:00:20 的全部写入。生成成功时间和数据恢复点不是同一概念。

RDB 适合保存一个时间点的数据集，文件通常紧凑；恢复速度仍受数据量、存储和加载过程影响。后台生成也并非零阻塞：`fork` 本身、内存页表处理、COW 和磁盘竞争，都可能影响请求延迟。[BGSAVE](https://redis.io/docs/latest/commands/bgsave/)

### 1.2 save 条件与 COW

配置片段如下，数值用于说明条件，不是统一生产推荐：

```text
save 900 1
save 300 10
save 60 10000
```

每组是“经过相应秒数且达到修改次数”的条件，多组之间可以分别触发。它不是每天固定时刻的任务，也不保证磁盘变慢时仍按精确间隔产生成功快照。`save ""` 关闭定时快照条件，不等于禁止手动 BGSAVE 或复制过程中生成 RDB。

fork 后父子最初共享物理页。父进程修改子进程仍需要的页时发生 Copy-on-Write，简称 COW：额外成本更接近**被改写的不同页面**，不是简单把业务写入字节数乘以时间。同一页反复修改也不能机械按每次写入累加。

例如一个教学模型中，4 GiB 相关页面有四分之一在子进程存活期间首次被改写，会产生约 1 GiB 的额外页复制；这还没计入页表、子进程和其他开销。若原 RSS 已为 4.6 GiB，容器限额只有 5 GiB，就不能因为 `maxmemory` 尚有余量而认为安全。观察方法与内存边界见 [Redis 内存管理](./06-Redis内存过期与淘汰.md)。

## 2. AOF {/* #aof */}

### 2.1 write 与 fsync 不是一回事

```text
命令修改内存
→ 形成 AOF 记录并进入缓冲
→ write 写入操作系统文件缓存
→ fsync/fdatasync 等同步路径要求存储持久化
```

`write` 成功通常不代表断电后仍能找回数据。只终止 Redis 进程而保留操作系统，与内核崩溃、宿主机断电是不同故障模型。存储是否正确兑现同步写语义，也影响最终保证。

### 2.2 appendfsync 三种策略

以下讨论 AOF 已启用，且没有通过其他选项跳过同步写的普通路径：

| 取值 | 主要行为 | 确认与故障边界 | 常见代价 |
| --- | --- | --- | --- |
| `always` | 每批追加执行同步刷盘 | 普通路径在回复前等待相应同步操作；依赖 OS/存储正确实现 | 慢盘延迟直接影响请求；可批量提交，不是每条命令必有独立一次 fsync |
| `everysec` | 通常每秒安排后台同步 | 返回成功不等待该写入所在轮次一定完成同步；有未持久化窗口 | 性能与持久性的常见折中，也是本版本示例配置的默认策略 |
| `no` | Redis 不主动按 AOF 策略执行 fsync，由 OS 回写 | 即使 Redis 已返回成功，主机故障仍可能损失未刷部分 | 没有每次同步等待，但不代表磁盘无竞争或一定更快 |

`everysec` 的“一秒”是正常调度下的目标，不是任意故障条件下的严格损失上限。后台同步积压、调度和底层存储异常会改变窗口；`no` 也不能解释成固定“最多丢 30 秒”。[AOF 持久性说明](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/#how-durable-is-the-append-only-file)

一个教学时间线：10:00:00.000 最近一轮同步完成，10:00:00.200 的写入已返回 OK，10:00:00.600 宿主机断电。在 `everysec` 下，这条写入仍可能没有持久化；改成一次只终止进程的实验，并不能证明断电也安全。

### 2.3 多段 AOF 与重写

开启 RDB Preamble 的常见文件布局为：

```text
appendonlydir/
├── appendonly.aof.1.base.rdb
├── appendonly.aof.1.incr.aof
└── appendonly.aof.manifest
```

名称里的序号会变化，Base 也可使用 AOF 格式。Base 描述重写时的数据状态，Incremental 保存后续变化，Manifest 决定有效文件集合及加载顺序。这里的 `base.rdb` 属于 AOF 恢复链，不等于独立 `dump.rdb` 快照。

`BGREWRITEAOF` 不是把历史操作全部原样归档，而是生成足以重建当前状态的紧凑 Base。Redis 7+ 在重写期间启用新的增量文件，子进程完成新 Base 后，再以 Manifest 的原子替换切换有效集合；后续变更不能因重写被遗漏。[BGREWRITEAOF](https://redis.io/docs/latest/commands/bgrewriteaof/)

| 配置 | 本版本示例配置值 | 需要理解的边界 |
| --- | --- | --- |
| `appendonly` | `no` | `appendfsync` 配好了，不代表 AOF 已开启 |
| `no-appendfsync-on-rewrite` | `no` | `no` 表示不因后台保存而主动跳过原同步策略；设为 `yes` 会降低相应阶段的持久性 |
| `auto-aof-rewrite-percentage` | `100` | 相对重写基线的增长比例，不是磁盘使用率；`0` 关闭自动重写 |
| `auto-aof-rewrite-min-size` | `64mb` | 与增长比例共同限制自动重写触发，避免小文件频繁重写 |
| `aof-load-truncated` | `yes` | 针对特定尾部不完整情形，不是任意损坏均可忽略 |

例如重写基线为 80 MiB、当前 AOF 为 160 MiB，增长为 100%；还需满足最小大小与后台调度条件。不要把 `aof_base_size` 简单当成目录中某一个 Base 文件今天的大小。配置语义以 [Redis 8.6.0 redis.conf](https://github.com/redis/redis/blob/8.6.0/redis.conf) 为准。

## 3. 同时启用 {/* #同时启用 */}

Redis 同时启用 RDB 与 AOF 时，重启优先使用 AOF 重建数据。关键是**启动配置是否启用 AOF、所需文件集合是否有效**，不是看到目录中有两个文件就各加载一次。

不能假设 AOF 报错后一定自动回退到独立 RDB。日志可能表明加载失败、接受了特定尾部截断，或使用了与预期不同的目录；必须确认实际加载来源和数据结果。`aof-load-truncated` 也不等于允许忽略文件中间的任意格式错误。

RDB、AOF 和副本不等于外部备份：它们可能一起接收误删，文件也可能随主机一起损坏。完整的文件集合、ACL/模块、TTL 和 Cluster 恢复步骤见 [持久化备份与 Cluster 恢复专项](../04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md)。

## 4. 监控 {/* #监控 */}

先读取实例版本、实际配置和状态，不直接修改策略：

```bash
redis-cli -h 127.0.0.1 -p 16379 INFO server
redis-cli -h 127.0.0.1 -p 16379 CONFIG GET appendonly appendfsync no-appendfsync-on-rewrite
redis-cli -h 127.0.0.1 -p 16379 INFO persistence
redis-cli -h 127.0.0.1 -p 16379 INFO stats
redis-cli -h 127.0.0.1 -p 16379 INFO memory
```

从这些输出中摘取的示意字段如下，不是一份完整 INFO：

```text
loading:0
rdb_bgsave_in_progress:0
rdb_last_bgsave_status:ok
rdb_last_cow_size:1073741824
aof_enabled:1
aof_rewrite_in_progress:0
aof_last_write_status:ok
aof_pending_bio_fsync:0
aof_delayed_fsync:5
latest_fork_usec:18000
```

`latest_fork_usec=18000` 是最近一次 fork 耗时约 18 ms，不是整个 BGSAVE 耗时；`rdb_last_cow_size` 这里为 1 GiB，不是 Redis 全部内存。`aof_delayed_fsync=5` 是累计值，需比较时间窗口内增量，不能据此断言此刻仍在积压。

`ok` 和 `in_progress=0` 只说明相应状态，不证明备份已异地保存或满足 RPO。若延迟上升，继续关联磁盘同步写延迟、剩余容量、RSS、COW、子进程持续时间以及容器内存事件。[INFO 字段说明](https://redis.io/docs/latest/commands/info/)

## 5. 故障实验 {/* #故障实验 */}

只在可丢弃的隔离实例或测试虚拟机中验证，保留独立的原始备份，不对生产实例执行终止、断电或写满磁盘操作。

| 场景 | 需要回答的问题 |
| --- | --- |
| 正常停止并启动 | 正常收尾后的数据与加载来源是否正确 |
| 仅 Redis 进程异常退出 | OS 缓存仍存活时，哪些记录能恢复 |
| 测试虚拟机/主机异常掉电 | 未同步的文件缓存能否丢失；不能用进程实验替代 |
| BGSAVE 或 Rewrite 期间高写入 | fork、COW、磁盘竞争与 P99 怎样变化 |
| 在文件副本上制造缺失/损坏 | 是否拒绝加载、是否发现缺段，以及损失是否被业务校验发现 |

客户端把**实际收到成功的业务 ID 集合 A**保存在被测节点之外，恢复后读取集合 B，检查 `A - B`，再核对值、TTL 和业务不变量。只比较最大序号或 Key 数，可能漏掉中间缺口。并发写入时也不能把序号天然当作提交顺序。

## 6. 持久化与恢复实验 {/* #持久化与恢复实验 */}

下面实验假设隔离实例已启用 AOF，并已检查 `aof_enabled=1`。后台工作会产生额外资源峰值；先发起快照并读取状态，不同时盲目发起多个任务：

```bash
redis-cli -h 127.0.0.1 -p 16379 BGSAVE
redis-cli -h 127.0.0.1 -p 16379 INFO persistence
```

等待 `rdb_bgsave_in_progress=0` 且本轮保存成功后，再单独观察重写：

```bash
redis-cli -h 127.0.0.1 -p 16379 BGREWRITEAOF
```

`Background saving started` 表示工作已启动，不是最终文件已经成功生成；Rewrite 也可能被安排稍后执行。结合 INFO 和服务端日志确认完成，再记录恢复点、耗时及资源峰值。

文件检查只对已复制到隔离目录的产物执行：

```bash
redis-check-rdb /lab/restore-copy/dump.rdb
redis-check-aof /lab/restore-copy/appendonlydir/appendonly.aof.manifest
```

默认先检查，不直接加 `--fix`。修复可能截断数据，应保留原件、明确允许损失并在隔离恢复后校验；成功通过文件检查也不代表 TTL、模块和业务数据都正确。目录与完整恢复方法复用 [恢复专项](../04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md)，不要手工删掉 Manifest 仍引用的“旧文件”。

## 7. 验收题 {/* #验收题 */}

### 7.1 BGSAVE 为什么不阻塞全部写却仍会造成 P99？

答案：后台序列化不等于整个过程没有同步成本。fork、页表、父进程写入造成的 COW，以及后台磁盘竞争都可能增加请求延迟；应对齐 fork 耗时、COW、I/O 和业务延迟，而不是仅看子进程在后台。

### 7.2 AOF 写入 Page Cache 与 fsync 有何区别？

答案：前者通常只是进入 OS 文件缓存；同步操作才要求下层按持久化语义完成。仅进程退出可能保留 OS 缓存，掉电则不同，因此两种实验不能互相证明。

### 7.3 多段 AOF 为什么不能随意删“旧文件”？

答案：文件名较旧不等于已失效。Manifest 可能仍依赖该 Base 或增量段，缺失会破坏加载链。有效集合切换应由 Redis 的重写和 Manifest 机制管理。

### 7.4 RDB/AOF 同时启用时备份要保存什么？

答案：保存独立 RDB、完整且一致的 AOF 恢复集合、配置与版本、ACL/模块等依赖，并记录恢复点。恢复时按启动配置选择加载来源，在隔离环境核对值、TTL 与业务状态；不是把两类文件各加载一次。

### 7.5 everysec 是否严格保证最多丢一秒？

答案：不是。它是正常运行下的同步周期目标，实际窗口受调度、同步积压、存储及相关选项影响。需要用明确故障模型验证 RPO，而不是把目标周期当成硬上限。

### 7.6 always 是否意味着每条命令各执行一次 fsync？

答案：不是。普通路径可把同一批命令合并追加与同步，关键是相应回复与同步完成的顺序。批量减少固定成本，不会让慢盘同步等待消失。

### 7.7 AOF Rewrite 能否替代保留历史版本的备份？

答案：不能。它面向当前数据状态的紧凑恢复，并非永久保留每次历史写入；误删也可能进入新状态。历史恢复点仍需独立备份与保留策略。

## 8. 参考资料 {/* #参考资料 */}

- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis 8.6.0 配置基线](https://github.com/redis/redis/blob/8.6.0/redis.conf)
- [BGSAVE](https://redis.io/docs/latest/commands/bgsave/)
- [BGREWRITEAOF](https://redis.io/docs/latest/commands/bgrewriteaof/)
- [INFO](https://redis.io/docs/latest/commands/info/)
