---
title: "Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite"
sidebar_label: "03. Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite"
sidebar_position: 3
description: "沿读页、修改、刷脏与恢复解释 Buffer Pool、LRU、Checkpoint、Change Buffer 和 Doublewrite，结合 MySQL 8.4 参数与监控算例定位内存和 I/O 压力。"
tags: [MySQL, InnoDB, Buffer Pool, 脏页, Doublewrite]
---

# Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite

Buffer Pool 是 InnoDB 缓存表与索引页的内存区域，不是“把 SELECT 结果缓存起来”，也不是 MySQL 进程使用的全部内存。一次查询会访问哪些页，取决于执行计划、索引与数据分布；一次提交成功，也不要求把它修改的所有数据页立刻写回表空间。

把读写路径分开看，才能理解为什么命中率很高仍会慢、为什么脏页不能直接淘汰，以及 Redo 与 Doublewrite 为什么都需要。本文以 MySQL 8.4 LTS、InnoDB 和通常的 16 KiB 页为主线；页大小应查询实际实例。监控数值是教学算例，不是生产采样。

## 1. Page 状态

### 1.1 一次索引读如何进入 Buffer Pool

执行器请求一条记录时，InnoDB 按索引找到相应的表空间页。若页已在 Buffer Pool，通常直接访问内存；若不在，先取得可用页框，再发起读入，之后解析记录。一次 SQL 可能命中许多页，也可能触发多次随机读，不能把 SQL 次数等同于页读取次数。

```text
需要访问某个数据/索引页
  ├─ 已在 Buffer Pool → 访问页内记录
  └─ 不在 → 取得可用页框 → 读入目标页 → 访问记录
                 ↑
       没有可用页框时，要寻找可回收的缓存页
```

### 1.2 可回收性与脏状态是不同维度

| 状态 | 含义 | 是否能直接回收 |
| --- | --- | --- |
| Free page/frame | 可供分配的页框 | 可以用于装入新页 |
| Clean page | 当前页没有尚待写回表空间的修改 | 还要满足没有被使用、没有进行中 I/O 等条件 |
| Dirty page | 内存页包含尚未写回最终表空间的修改 | 不能直接丢弃，需要安全刷页 |
| Pinned/In-use 或 I/O 中 | 当前有人使用或读写尚未完成 | 即使 clean，也不能随意回收 |

这些不是四个互斥桶：一个页可以同时 dirty 且正在被使用。事务提交状态也是另一维，已提交的数据页可以仍然 dirty；页被刷过也不等于整笔事务已提交，事务可见性与回滚仍由事务机制保证。

Buffer Pool 用不同管理结构服务不同目标：Free list 管可分配页，LRU list 管回收次序，Flush list 追踪脏页及其最早修改位置。同一脏页可能同时被 LRU 与 Flush list 管理，不能把两条链当成两份业务数据。

## 2. LRU 不是简单队列

InnoDB 将 LRU 分为 young/new 与 old 两段。新读入的页先放在 old 段头部，而不是立即认定为最热数据，避免一次扫描大量数据就挤掉长期工作集。

```text
LRU 头 → young 段 → old 段头 → old 段 → LRU 尾
                         ↑                 ↓
                     新读入页         优先考虑回收
```

| 参数 | MySQL 8.4 基线 | 控制什么 |
| --- | --- | --- |
| `innodb_old_blocks_pct` | 37，百分比 | old 段的大致占比，不是脏页比例 |
| `innodb_old_blocks_time` | 1000 毫秒 | old 页首次访问后的保护时间窗；窗内访问不因此晋升 young |

保护时间过了，还需要后续符合条件的访问才可能晋升，不是后台定时器到点把所有 old 页自动变热。设为 0 会取消这个时间保护，短时反复访问扫描页更容易把它们提升；增大也可能让有用的新热点更难晋升，不能只按“越抗扫描越好”设置。

报表扫描前后同时看热点查询物理读、young/not-young、预读和未使用预读页回收，以及业务 P99。某些扫描确实需要读取大量页，LRU 策略只能减少污染，不能消除扫描本身的 I/O、CPU 与并发竞争。[抗扫描机制](https://dev.mysql.com/doc/refman/8.4/en/innodb-performance-midpoint_insertion.html)解释了时间窗与比例的区别。

## 3. 命中率的误区

常用的区间命中率估算是：

```text
1 - ΔInnodb_buffer_pool_reads / ΔInnodb_buffer_pool_read_requests
```

分母是逻辑读请求，分子是不能直接由 Buffer Pool 满足、需要读入的请求；它不是逐 SQL 的延迟比例，也不等于操作系统看到的所有磁盘读。后台预读、数据文件缓存和实际存储路径还会影响设备指标。

必须对同一实例、同一连续时间窗取差值。实例重启或计数器重置时丢弃跨界样本，分母为 0 时不计算；不能把启动以来的平均值用于解释最近一分钟。

高命中率仍可能伴随三类问题：大量热点逻辑读掩盖少量关键查询的同步随机读；写入等待刷脏释放页框；锁、CPU、日志同步等根本不由读命中率解释。要按查询 Digest、表/索引工作集和故障时间线继续分解，不要仅使用 `Hit Rate < 99%` 的通用阈值。

## 4. 脏页怎样产生

`INSERT/UPDATE/DELETE` 修改相关数据页、索引页等，生成相应 Redo；页从 clean 变为 dirty，或已经 dirty 后继续被修改。同一个热页被更新一百次，不等于立即产生一百次完整数据页写回。

```text
修改 Buffer Pool 中的数据页，并生成 Redo
  ├─ 提交路径：按持久性配置处理必要日志与事务提交
  └─ 刷页路径：先满足 WAL → Doublewrite 等保护 → 写最终表空间
                                              ↓
                                  满足条件后推进 Checkpoint
```

Write-Ahead Logging（WAL）要求在相关数据页安全写回前，先满足对应 Redo 的持久化要求。数据页刷写与事务提交不是一条逐页同步流水线；Redo、Binlog 和提交的关系见[日志与完整提交路径](./04-Redo-Undo-Binlog与一次提交的完整路径.md)。

Checkpoint 推进还取决于最早仍未安全刷出的修改，不是“刷了任意一页就能把 Checkpoint 跳到当前 LSN”。若新修改持续产生、旧脏页迟迟不能完成写回，日志复用压力仍会增加。

## 5. 刷盘触发

### 5.1 缺可用页和日志复用压力是两条触发路径

LRU 回收需要可替换页框；候选若为脏页，必须先刷出。Flush list 则帮助处理老的未刷修改，支持推进 Checkpoint。这两种需求可能同时出现，但“free 少”与“Checkpoint Age 大”不是同一个指标。

| 信号/参数 | MySQL 8.4 基线 | 含义与边界 |
| --- | --- | --- |
| `innodb_max_dirty_pages_pct_lwm` | 10，百分比 | 提前增加刷页的低水位；0 关闭这条提前刷页机制，不关闭全部刷页 |
| `innodb_max_dirty_pages_pct` | 90，百分比 | 高脏页水位触发更积极刷页；不是内存使用率上限 |
| `innodb_adaptive_flushing` | ON | 根据负载与日志等压力调整后台刷新，不保证永远没有前台等待 |
| `innodb_io_capacity` | 10000，IOPS 估计值 | 后台刷页/合并使用的能力预算，不是实测设备能力，也不是整个 mysqld 的硬 IOPS 限流 |
| `innodb_io_capacity_max` | 默认与 io_capacity 的两倍相关 | 落后时允许更积极的后台 I/O；仍需查询实际值，不能当成所有刷新路径的绝对上限 |

紧急刷新等路径还受 `innodb_flush_sync` 等机制影响。把 io_capacity 填大不能使慢盘变快，填得不合适则可能让后台任务抢占前台 I/O。8.4 基线不应照抄旧版 `io_capacity=200` 的默认认知，详见[刷新配置](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool-flushing.html)与[I/O Capacity](https://dev.mysql.com/doc/refman/8.4/en/innodb-configuring-io-capacity.html)。

### 5.2 用 LSN 看待刷修改，而非只看脏页比例

常用 `Checkpoint Age = 当前 LSN - Checkpoint LSN` 判断尚未允许复用的日志跨度，单位是日志字节。脏页数量是页的数量，两者不能换算成固定比例：少量长期未刷的老页也可能拖住进度。

增加 `innodb_redo_log_capacity` 能扩大应对突发写入的窗口，但不能根治持续写入超过存储能力。配置容量也不等于可直接用满的业务缓冲，内部还有保留与安全水位；不能用“剩余容量 / 当前写速率”承诺精确故障倒计时。恢复时的扫描与重放工作还取决于实际未 Checkpoint 范围，不是把文件设大就必然慢同样倍数。原理见[Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)。

## 6. Doublewrite 的写入路径

```text
Dirty Page
→ Doublewrite 文件中的连续区域
→ fsync/持久化
→ 写到各自表空间最终位置
```

默认具备恢复保护时，这条顺序让表空间页写到一半发生故障后，仍可能从 Doublewrite 找到完整页副本，再应用 Redo。Redo 记录修改，不是任意损坏页的万能完整副本；它需要能解释和修复的页基础。

Doublewrite 通常批量写连续区域，不是每修改一条记录就独立写两次、fsync 两次。现代 MySQL 的 doublewrite 文件与历史“都在系统表空间里”的布局也不能混用理解。

| `innodb_doublewrite` 取值 | 保存内容与恢复能力 |
| --- | --- |
| `ON` / `DETECT_AND_RECOVER` | 默认的完整保护模式，保存页内容以检测并修复不完整页写 |
| `DETECT_ONLY` | 只保留检测所需元数据，不保留用于修复的完整页副本 |
| `OFF` | 关闭 Doublewrite 保护，不能把底层有 RAID/SSD 等同于已获得所需原子页写保证 |

启用模式之间的动态转换与切换 OFF 的限制不同，应查实际版本，不能在故障中随意关闭来“提速”。它不保存完整历史，也不抵抗误删表或整机全部介质损坏，不能替代备份、复制和恢复演练。模式差异见[Doublewrite 官方说明](https://dev.mysql.com/doc/refman/8.4/en/innodb-doublewrite-buffer.html)。

## 7. Change Buffer

### 7.1 延后的是合格二级索引页修改，不是提交日志

当合格二级索引页不在 Buffer Pool 时，可以先记录待合并的索引变化，等页以后读入或后台处理时再 merge，避免为了这次修改立刻随机读入该索引页。若页本来已在内存，通常直接修改；聚簇索引、需要即时唯一性检查等情况也不能简单套用这个路径。

Change Buffer 在内存中占用 Buffer Pool 的一部分，在磁盘上使用系统表空间结构，并受相应恢复机制保护。它不是只存在于进程内存中的“未提交队列”，不替代 Redo，也不是存储整行数据的另一份副本。[Change Buffer 原理](https://dev.mysql.com/doc/refman/8.4/en/innodb-change-buffer.html)解释了延迟合并与持久化位置。

### 7.2 MySQL 8.4 默认 none，六种分支要分清

`innodb_change_buffering` 在 MySQL 8.4 默认为 `none`，旧版常见默认 `all` 不应直接套用。它控制哪些操作允许缓冲，仍以操作/索引具备资格为前提：

| 取值 | 缓冲对象 |
| --- | --- |
| `none` | 不为新操作启用这项缓冲 |
| `inserts` | 插入索引记录 |
| `deletes` | 删除标记，delete-mark，不是物理删除 |
| `changes` | 插入和删除标记 |
| `purges` | 后台 purge 的物理删除 |
| `all` | 插入、删除标记和 purge |

这些词不是 SQL 动词的一对一映射：UPDATE 可能引起旧索引记录删除标记与新记录插入；deletes 与 purges 分别属于不同阶段。关闭新缓冲也不会把既有待合并工作凭空抹掉，仍需观察后续 merge。

`innodb_change_buffer_max_size` 默认 25，范围 0～50，单位是 Buffer Pool 总大小的百分比；它是最大允许占比，不是启动时就独占预留这么多内存。默认 none 时，仅凭这个参数为 25 不能断言实例正在使用四分之一内存做 Change Buffer。枚举与范围见[8.4 系统变量](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_change_buffering)。

### 7.3 收益与代价都取决于访问模式

工作集大于内存、二级索引写密集且随机读成本高时，合并可能减少立即读入的次数；若索引本来常驻内存，或者写后立即查询同一页，收益就可能很少。代价是缓存占用和延后 merge 的 I/O，甚至在提交后、重启后继续追赶。

评估时同时测写入和之后读取/合并阶段，而不是只比较批量插入结束时的 QPS。不要为启用优化而关闭业务必要的唯一性校验，也不要在没有实验的情况下把默认 none 改成 all。

## 8. 观测

```sql
SHOW ENGINE INNODB STATUS\G

SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';
SHOW GLOBAL STATUS LIKE 'Innodb_pages%';

SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_wait_free';

SHOW GLOBAL VARIABLES LIKE 'innodb_old_blocks%';
SHOW GLOBAL VARIABLES LIKE 'innodb_max_dirty_pages_pct%';
SHOW GLOBAL VARIABLES LIKE 'innodb_io_capacity%';
SHOW GLOBAL VARIABLES LIKE 'innodb_redo_log_capacity';

SELECT @@GLOBAL.innodb_page_size AS page_bytes,
       @@GLOBAL.innodb_buffer_pool_size AS pool_bytes,
       @@GLOBAL.innodb_buffer_pool_instances AS pool_instances,
       @@GLOBAL.innodb_buffer_pool_chunk_size AS chunk_bytes,
       @@GLOBAL.innodb_change_buffering AS change_mode,
       @@GLOBAL.innodb_doublewrite AS doublewrite_mode;

SELECT NAME, COUNT, COMMENT, STATUS
FROM information_schema.innodb_metrics
WHERE NAME LIKE '%ibuf%';
```

这些是观察语句，所需权限按目标实例配置。不要在排障时先执行 FLUSH STATUS 重置证据，也不要高频查询逐页 `INNODB_BUFFER_PAGE` 视图；后者可能引入明显开销。

### 8.1 先看当前页状态

假设查询得到 page_bytes=16384、pool_bytes=8589934592，以下是同一时刻的状态摘录：

```text
Innodb_buffer_pool_pages_total     524288
Innodb_buffer_pool_pages_data      512000
Innodb_buffer_pool_pages_dirty      65536
Innodb_buffer_pool_pages_free        8192
Innodb_buffer_pool_pages_misc        4096
```

总页数乘 16 KiB 为 8 GiB；dirty 是 data 的子集，不能再与 data 相加。脏页约 1 GiB；以总页数为分母的监控口径，脏页占 12.5%。与内部刷页阈值比较时还需对齐该版本的统计口径，不能拿一个自行计算的百分比倒推出具体触发原因。

Free 页少并不必然是问题，缓存本来就会利用可用空间；需结合是否能及时回收、是否出现等待和业务延迟。

### 8.2 对计数器取 60 秒差值

下表为两次采样整理，不是把两个时刻伪装成一份 SHOW 输出。期间没有重启或计数器重置：

| 累计计数器 | T0 | T1，60 秒后 |
| --- | --- | --- |
| `Innodb_buffer_pool_read_requests` | 1000000000 | 1010000000 |
| `Innodb_buffer_pool_reads` | 50000 | 51000 |
| `Innodb_buffer_pool_pages_flushed` | 100000 | 124000 |
| `Innodb_buffer_pool_wait_free` | 10 | 40 |

区间逻辑读 10,000,000 次，按上述公式命中率约 99.99%；需读入的请求为 1,000 次，约 16.67 次/秒。刷出 24,000 页，约 400 页/秒，按 16 KiB 粗算页载荷为 6.25 MiB/秒，但这不是所有设备写带宽，尚有日志、Doublewrite、备份等 I/O。

wait_free 增加 30，表示这段时间出现过等待可用页的情况，不是等待了 30 秒，也不是当前仍有 30 个线程等待。即使命中率高，也应检查回收、刷页、存储延迟与并发；不能只凭该计数就断言磁盘是唯一根因。状态变量定义见[Server Status Variables](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html)。

### 8.3 再对齐日志与磁盘

`SHOW ENGINE INNODB STATUS` 的日志段可包含以下字段，摘录仍为教学值：

```text
Log sequence number 8000000000
Log flushed up to   7999000000
Last checkpoint at  7200000000
```

Checkpoint Age 为 800,000,000 字节，约 762.94 MiB；当前 LSN 与已刷日志之间还有 1,000,000 字节，两种差值回答不同问题。继续观察它们随时间的变化，并与配置的 Redo 容量、pending I/O、fsync、磁盘 await/队列、CPU 和查询 P99 对齐，才知道是瞬时突发还是持续追不上。

Change Buffer 指标还应读取 STATUS 是否为 enabled；未开启或不适用的指标没有增长，不能解释成“所有写入已及时合并”。逐页/互斥等待等重型诊断只在有明确假设时使用。

## 9. Buffer Pool 大小

专用数据库常把较大内存分给 Buffer Pool，但不能机械使用某个百分比。预留：

- Server/Performance Schema；
- 每连接/排序/Join/临时表；
- Binlog/复制/备份；
- OS、文件系统和运维工具；
- 容器与其他进程；
- 峰值和故障诊断余量。

### 9.1 先做内存预算，再定缓存大小

假设容器内存上限为 16 GiB，教学预算分给 Buffer Pool 10 GiB、其他全局结构 1 GiB、实际并发下的连接/查询临时内存峰值 2 GiB、同容器其他开销及安全余量 3 GiB，合计才是 16 GiB。它不是可套用的推荐配置，而是说明需要按峰值逐项计算。

每连接内存也不能把所有参数简单相乘：不少缓冲按需分配，同一个复杂查询还可能分配多个操作缓冲。要用实际并发、执行计划与峰值测量估算。容器若只看宿主机总内存而忽略 cgroup 限制，可能“主机有余量、进程却被 OOM Kill”。Swap 或 OOM 往往比小一点 Buffer Pool 更糟。

### 9.2 动态扩缩不是改完立即零影响

`innodb_buffer_pool_size` 的单位为字节，可在线调整，但容量需按 `chunk_size × instances` 对齐，具体值以实际实例为准。8.4 的实例数量默认可能由内存与 CPU 等计算，不能沿用“所有实例固定 8 个”的旧认知。

缩小需要腾挪/回收页，可能增加刷脏和等待；增大也需要分配与初始化资源。先查询 size、chunk、instances 与 `Innodb_buffer_pool_resize_status`，在隔离环境验证耗时和 P99，再按变更窗口调整。运行时修改是否持久保存是另一件事，不能把一次 SET GLOBAL 当成重启后仍生效的配置。详见[Buffer Pool 大小](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool-resize.html)。

## 10. 冷启动

重启后数据页需要重新进入内存，表现为物理读和延迟上升。`innodb_buffer_pool_dump_at_shutdown`、`innodb_buffer_pool_load_at_startup` 可保存/加载热点页的标识信息，`innodb_buffer_pool_dump_pct` 控制转储比例，具体值应查询实例。

这种 dump 保存的是需要重新读取的页标识，不是把整个 Buffer Pool 的最新数据备份到一个可独立恢复的文件。load 仍需从数据文件读页，不能替代持久化、备份或崩溃恢复，也不能保证热度仍符合新流量，见[热点页状态保存与加载](https://dev.mysql.com/doc/refman/8.4/en/innodb-preload-buffer-pool.html)。

恢复进度可查 `Innodb_buffer_pool_load_status`。配合受控预热和渐进导流，观察物理读、磁盘与业务延迟；不要在生产为制造冷缓存去删除系统缓存或重启。故障切换时副本的工作集可能不同，容量模型必须包含冷缓存阶段，而非只测主库热态吞吐。

## 11. 调优实验

固定数据、执行计划、并发与存储条件，一次只改变一个主要因素。测试和故障注入只在隔离环境进行：

| 实验 | 主要验证 | 必须同时保存 |
| --- | --- | --- |
| 冷/热缓存对照 | 哪些查询依赖页驻留 | 物理读、关键 Digest、存储延迟和 P99 |
| 在线查询叠加扫描 | old/young 策略是否减少污染 | 扫描吞吐、热点延迟、young/not-young 和预读回收 |
| 持续写入 | 后台刷新是否能追上，不只看短跑 QPS | 脏页、wait_free、Checkpoint Age、日志与数据 I/O |
| 不同 Buffer Pool/Redo | 内存命中与写入突发窗口各贡献多少 | 内存峰值、刷页、尾延迟和恢复耗时 |
| Change Buffer 分支对照 | 是否真正触发、是否只是延后成本 | 写入与随后读取/merge 阶段的全部成本 |
| 正常停止/异常退出 | 预热与恢复分别耗时多少 | 日志恢复、页加载、逐条数据校验与业务恢复 |

例如把 Buffer Pool 加大后读取变快，并不能直接证明之前是刷脏瓶颈；把 Redo 加大后短时写入平滑，也不能证明持续处理能力提高。实验结论应回到它实际改变的资源和路径。

## 12. 验收题

### 12.1 Clean Page 与 Dirty Page 有何区别？

答案：Dirty 包含尚未写回最终表空间的修改，不能直接丢弃；Clean 不含这类待写修改，但是否可回收还受被使用和进行中 I/O 等条件影响。事务已提交不等于数据页已 clean。

### 12.2 为什么高命中率仍可能存在关键 I/O 瓶颈？

答案：全局平均会掩盖少量关键查询的同步读，读命中率也解释不了刷脏、日志同步和空闲页等待。应按连续采样差值计算，并结合 Digest、wait_free、磁盘和 P99，不能只拿启动以来 99.99% 证明数据库正常。

### 12.3 Redo 容量怎样影响刷页与恢复？

答案：较大容量增加突发写入的缓冲窗口，减轻迫近复用边界的压力，但不能提高设备持续刷页能力。恢复工作取决于实际未 Checkpoint 的范围和工作量，不是文件配置大小的简单倍数。

### 12.4 Doublewrite 与 Redo 分别解决什么？

答案：Redo 用于重建页修改；Doublewrite 在完整保护模式下提供可能用于修复 torn page 的完整页副本。Redo 不等于任意损坏页都可直接重建，Doublewrite 也不是完整业务备份，两者不能互相替代。

### 12.5 Change Buffer 何时可能有收益和代价？

答案：合格二级索引页不在内存、随机读代价高且可延迟合并时，可能减少立即读入；代价是空间占用和后续 merge。索引常驻内存或写后立即读取时收益可能有限，需测完整写入与后续读取阶段。

### 12.6 为什么 Buffer Pool 不能占满容器全部内存？

答案：mysqld 还有全局结构、连接、查询操作、临时表、复制和诊断等开销，且必须按 cgroup 限制留峰值余量。Buffer Pool 不是进程 RSS 上限，按宿主机内存分配可能导致容器 OOM。

### 12.7 冷启动为什么要进入高可用容量规划？

答案：新主或重启实例未必已有主业务工作集，读页与预热会增加存储和尾延迟。热点页 dump 仅保存标识，load 还需重新读数据；因此热态 QPS 不能代表切换后的立即承载能力。

### 12.8 wait_free 增加 30 代表等待 30 秒吗？

答案：不是，它是发生等待的累计次数。需取区间差值并与空闲页回收、刷页、并发和存储延迟关联；单个计数不能给出等待时长，也不能单独证明唯一根因是慢盘。

### 12.9 old_blocks_time 到期，old 页会自动晋升吗？

答案：不会。它定义首次访问后的保护窗口，窗口后还需符合条件的再次访问。时间窗和 old 段占比控制的是不同方面；盲目增大保护也可能影响真实新热点进入 young 段。

### 12.10 DETECT_ONLY 和 ON 的 Doublewrite 保护相同吗？

答案：不同。DETECT_ONLY 只保存检测元数据，不保存用于修复的完整页；ON/DETECT_AND_RECOVER 才具备对应恢复副本。检测到损坏不等于已经拥有可修复的数据。

### 12.11 Change Buffer 的 deletes、purges 与默认值是什么？

答案：deletes 缓冲删除标记，purges 缓冲后续物理删除，changes 合并插入与删除标记，all 包含三类。MySQL 8.4 默认 none，不为新操作启用缓冲；max_size=25 也不代表已预留或实际占用四分之一 Buffer Pool。

下一篇讨论[Redo、Undo 与 Binlog 的提交路径](./04-Redo-Undo-Binlog与一次提交的完整路径.md)。

## 13. 官方参考 {/* #官方参考 */}

- [Buffer Pool](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool.html)
- [Change Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-change-buffer.html)
- [Doublewrite Buffer](https://dev.mysql.com/doc/refman/8.4/en/innodb-doublewrite-buffer.html)
- [InnoDB Checkpoints](https://dev.mysql.com/doc/refman/8.4/en/innodb-checkpoints.html)
- [Making the Buffer Pool Scan Resistant](https://dev.mysql.com/doc/refman/8.4/en/innodb-performance-midpoint_insertion.html)
- [Configuring Buffer Pool Flushing](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool-flushing.html)
- [Configuring InnoDB I/O Capacity](https://dev.mysql.com/doc/refman/8.4/en/innodb-configuring-io-capacity.html)
- [InnoDB System Variables](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html)
- [Configuring Buffer Pool Size](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool-resize.html)
- [InnoDB Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [Server Status Variables](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html)
- [Saving and Restoring the Buffer Pool State](https://dev.mysql.com/doc/refman/8.4/en/innodb-preload-buffer-pool.html)
