---
title: "页缓存、预读、回写与 Direct I/O"
sidebar_position: 2
tags: [Linux, Page Cache, Direct IO, mmap, writeback, 存储]
description: "理解 Linux 页缓存、readahead、脏页回写、fsync、mmap 与 Direct I/O 的语义、性能和排障方法。"
---

# 页缓存、预读、回写与 Direct I/O

Linux 存储性能中最容易误判的是缓存：同一个文件第一次读取 5 秒，第二次只需 0.5 秒；一次 `write()` 很快返回，几秒后磁盘才突然繁忙；数据库使用 Direct I/O，而模型加载通常依赖页缓存。

要正确解释这些现象，需要把“应用完成”“数据进入内核”“设备完成”和“断电后仍存在”分开。

## 1. 学习目标

- 解释页缓存如何统一文件读取与文件映射；
- 区分 cache hit、minor fault、major fault；
- 理解顺序预读何时有益、何时造成浪费；
- 解释脏页、后台回写、限流和 `fsync()`；
- 区分 Buffered I/O、Direct I/O 和 `mmap`；
- 设计冷/热缓存、顺序/随机、同步/异步对照实验；
- 分析模型加载、训练数据读取和 Checkpoint 的缓存行为。

## 2. 页缓存是什么

页缓存是内核用物理内存缓存文件内容的机制。缓存以“文件/inode + 文件偏移”标识，而不是简单按磁盘扇区标识。

```text
file A offset 0..4095  → cache page/folio
file A offset 4096...  → cache page/folio
file B offset 0..4095  → another cache entry
```

内存没有被应用使用时，拿来缓存文件通常是好事；应用需要内存时，干净缓存页可以回收。因而 Linux 上“free 很少、cache 很多”不一定是内存泄漏，更应关注 `MemAvailable`、回收压力和 working set。

```bash
grep -E 'MemTotal|MemFree|MemAvailable|Cached|Dirty|Writeback' /proc/meminfo
```

## 3. Buffered Read

默认普通文件 `read()` 走页缓存：

```text
应用 read
  → 查 page cache
  ├─ hit：内存复制到用户 buffer
  └─ miss：读取设备/远程后端到 cache，再复制给用户
```

### 3.1 为什么仍有一次复制

页缓存属于内核地址空间，`read()` 通常需要把数据复制到用户缓冲区。因此热缓存吞吐可能受 CPU 和内存带宽限制。

### 3.2 缓存命中不等于零成本

仍可能有：

- 系统调用；
- 页表和缓存查找；
- 用户空间复制；
- cgroup 内存记账；
- NUMA 远端内存访问；
- 文件锁和应用处理。

## 4. `mmap` 与 page fault

`mmap()` 建立文件到虚拟地址空间的映射，通常不立即读取全部文件。访问一个尚未映射到物理页的地址时产生 page fault。

```text
应用 load address
  → 页表无有效映射
  → page fault
  → 页缓存命中？
      ├─ 是：建立页表映射
      └─ 否：读取文件页，完成后建立映射
```

- **minor fault：**不需要从存储读取，例如页已在缓存，只需建立映射；
- **major fault：**需要等待 I/O 把页面带入内存。

观察：

```bash
pidstat -r -p <pid> 1
perf stat -e page-faults,minor-faults,major-faults -- <command>
```

工具事件名称与内核/架构有关，以本机 `perf list` 为准。

## 5. Readahead：用顺序性换吞吐

当内核识别到顺序访问时，会在应用明确请求之前预读后续页面：

```text
应用需要 page 10
内核读取 page 10..17
应用随后读取 11..17 时命中缓存
```

好处：

- 合并更大的 I/O；
- 隐藏设备或网络时延；
- 提高顺序读取吞吐；
- 减少应用等待次数。

代价：

- 随机访问时读入不用的数据；
- 挤占有价值的缓存；
- 多流并发可能放大后端带宽；
- 错误识别访问模式会增加尾延迟。

### 5.1 应用提示

应用可通过 `posix_fadvise()` 或 `madvise()` 表达顺序、随机、即将使用或不再需要等提示。它们是提示，不是绝对命令，实际效果取决于内核和访问方式。

### 5.2 块设备 readahead

可以查看块设备预读设置：

```bash
lsblk -o NAME,RA,ROTA,SIZE,TYPE,MOUNTPOINTS
blockdev --getra /dev/<device>
```

不要看到顺序吞吐低就盲目增大。文件系统、应用和远程存储可能还有自己的并发/预取层，需要单变量测试。

## 6. Buffered Write 与脏页

普通 `write()` 通常先把数据复制到页缓存并标记为 dirty：

```text
应用 write
  → 数据进入 page cache
  → 页面标记 Dirty
  → write 返回
  → 后台 writeback
  → 文件系统/块层/设备
```

因此 `write()` 很快返回只代表数据被内核接受，不一定已进入持久介质。

### 6.1 后台回写

内核根据脏页比例、年龄、内存压力和文件系统策略发起后台回写。若生成脏页速度长期超过设备落盘速度，会出现：

1. Dirty 持续增加；
2. writeback 线程忙；
3. 应用写入被限流；
4. 延迟从“很低”突然变成尖峰；
5. 内存回收和其他工作负载受影响。

观察：

```bash
watch -n 1 "grep -E 'Dirty|Writeback' /proc/meminfo"
vmstat 1
iostat -xz 1
```

生产环境不要为了追求跑分随意修改全局 dirty 参数。它们影响整机数据安全、延迟和内存行为。

## 7. `fsync` 到底保证什么

`fsync(fd)` 请求把文件数据和必要元数据同步到稳定存储；`fdatasync()` 更聚焦数据及读取所必需的元数据。具体持久化还依赖：

- 文件系统实现与挂载选项；
- 写屏障/flush/FUA；
- 设备缓存是否正确上报和受电源保护；
- RAID 控制器缓存；
- 远程文件系统与后端的稳定写语义。

不要把以下事件混为一谈：

```text
write 返回
≠ close 返回
≠ fsync 返回
≠ 应用事务提交
≠ 跨机架/跨站点副本完成
```

应用需要何种保证取决于 RPO。Checkpoint 常用临时目录/文件写入、同步、生成 manifest 和原子提交标记，避免恢复端看到半成品。

## 8. Direct I/O

使用 `O_DIRECT` 时，I/O 尝试绕过普通页缓存，在用户缓冲区与存储之间直接传输：

```text
应用 aligned buffer
  → 文件系统 direct-I/O path
  → block layer
  → device
```

### 8.1 优点

- 避免页缓存与应用自有缓存重复；
- 应用更直接控制缓存和并发；
- 大内存数据库可获得更稳定行为；
- 压测设备时减少页缓存干扰。

### 8.2 代价与限制

- 缓冲区地址、I/O 大小和文件偏移常有对齐要求；
- 小而随机的同步 I/O 可能很慢；
- 应用必须管理缓存、并发和生命周期；
- 不同文件系统和内核支持细节不同；
- 与同一文件的 Buffered I/O 混用可能产生复杂一致性和性能行为；
- “Direct” 不等于绕过文件系统、RAID、设备缓存或远程后端。

可以使用 `statx()` 的 direct-I/O alignment 信息（若文件系统和内核支持）或按目标文件系统文档确定对齐要求，不能假定永远是 4 KiB。

## 9. Buffered、mmap 与 Direct 的选择

| 方式 | 缓存 | 常见场景 | 关键风险 |
|---|---|---|---|
| Buffered read/write | 内核页缓存 | 模型文件、通用应用、工具 | 冷热差异、脏页尖峰 |
| mmap | 共享页缓存+页表 | 随机访问、模型映射、索引 | fault 延迟、SIGBUS、回收 |
| Direct I/O | 应用自管为主 | 数据库、设备基准、特定引擎 | 对齐、复杂度、小 I/O 延迟 |

选择不能只看单次吞吐：还要考虑内存占用、复用、尾延迟、并发、正确性和实现复杂度。

## 10. 缓存归谁记账

在容器环境中，文件缓存可能计入 memory cgroup。不同 cgroup 版本和内核行为存在细节差异，但必须建立以下意识：

- 容器读取大模型可能增加 cgroup 文件缓存；
- memory limit 不只约束进程匿名内存；
- 多 Pod 访问同一文件时，物理页可能共享，但归属和回收行为需要实际观察；
- 节点内存压力会回收模型页，导致后续冷读；
- 将 page cache 和 GPU HBM 使用相加才接近模型服务的整体内存成本。

检查：

```bash
cat /sys/fs/cgroup/<path>/memory.current
cat /sys/fs/cgroup/<path>/memory.stat
```

路径和字段取决于 cgroup v1/v2 与运行时，不要硬编码生产脚本。

## 11. 远程文件系统还有多层缓存

以 NFS 为例：

```text
应用
→ 客户端 page cache
→ NFS client 属性/目录缓存
→ RPC / 网络
→ 服务端 page cache
→ 服务端文件系统
→ 服务端块设备
```

一次热读可能完全停留在客户端；清空客户端缓存后仍可能命中服务端缓存。因而测试 NFS 后端磁盘与测试用户体验是不同实验。

CephFS、SMB 和并行文件系统各有自己的客户端缓存与一致性协议，不能把本地 ext4 结论原样套用。

## 12. 冷缓存实验怎样做才可信

### 12.1 最安全的方法

- 使用从未读取过的新测试文件；
- 使用专用测试节点或临时 VM；
- 文件明显大于可用缓存；
- 重启隔离测试实例；
- 使用 Direct I/O 测设备，但明确它不代表应用 Buffered I/O。

### 12.2 谨慎使用 drop_caches

`/proc/sys/vm/drop_caches` 会影响整机缓存。仅能在专用实验环境、确认无其他负载且由管理员执行。它不应成为生产压测步骤，也不能代替服务端缓存控制。

### 12.3 记录实验上下文

- `MemAvailable` 和 cache；
- 文件大小与 checksum；
- 设备/挂载；
- 第几次运行；
- 是否 Direct；
- 并发、块大小和队列深度；
- 服务端缓存是否可能命中。

## 13. 读实验：顺序、随机、冷热

在专用测试文件上，使用 `fio` 对比：

```bash
fio --name=buffered-read \
  --filename=<test-file> --rw=read --bs=1M \
  --direct=0 --ioengine=psync --numjobs=1 \
  --size=<validated-test-size> --group_reporting
```

```bash
fio --name=direct-read \
  --filename=<test-file> --rw=read --bs=1M \
  --direct=1 --ioengine=libaio --iodepth=16 \
  --size=<validated-test-size> --group_reporting
```

解释边界：

- 两个测试走的缓存和并发模式不同，不能只比较数字得出“Direct 更好”；
- `libaio`、`io_uring` 支持取决于系统和文件系统；
- 对共享文件系统压测前必须限制目录、容量和并发；
- 测试文件不可是重要业务数据。

## 14. 写实验：吞吐与持久化分开

比较不等待持久化的 Buffered Write 与每次/周期同步的写入。`fio` 可以使用 `fsync`、`fdatasync`、`end_fsync` 等参数构造语义，但要先阅读当前版本文档。

需要分别报告：

- 应用提交带宽；
- Dirty/Writeback 变化；
- 设备实际写带宽；
- 同步操作 P95/P99；
- 测试结束后等待落盘的时间；
- 文件系统和设备缓存保护能力。

仅记录写入阶段的高 GB/s，可能只是把数据堆在内存。

## 15. AI 场景分析

### 15.1 模型冷启动

第一次加载：存储读取 + 校验 + 反序列化 + H2D；第二次可能命中节点 page cache 或本地缓存。扩容策略必须使用冷启动分位数，而不是开发机热缓存结果。

### 15.2 多副本同节点

多个进程读取同一只读模型文件可受益于页缓存；是否通过 mmap 共享物理页取决于 loader 和内存映射方式。GPU HBM 中的权重通常仍按实例/并行策略占用。

### 15.3 训练数据

顺序分片、足够大的预取和 DataLoader 能隐藏 I/O；海量小文件则受 open/stat、目录和网络 RTT 限制。盲目增加 worker 可能把后端压垮。

### 15.4 Checkpoint

Checkpoint 写入容易先堆积在页缓存，随后集中回写。训练日志里“save function returned”不一定等同于满足 RPO，需要检查框架的同步与提交语义。

## 16. 典型问题与证据

### 16.1 第一次慢、第二次快

证据组合：第一次设备/NFS 有读取和 major fault，第二次 cache 高、设备读取少。结论是冷缓存路径慢，不应把第二次数字当冷启动 SLO。

### 16.2 写入前半段很快，后来突然卡

Dirty 增长后达到限流阈值，设备持续写满，应用被 writeback 限制。需要降低写入峰值、提高后端能力或调整应用同步/分片，而不是只提高全局 dirty 上限。

### 16.3 GPU 周期性空闲

训练 DataLoader 每隔一段时间出现 major fault 或远程读，GPU 等数据。可验证本地缓存、预取、数据格式和 worker 数。

### 16.4 节点内存充足但模型重新加载慢

可能是 cgroup 内存限制/回收、节点其他工作负载驱逐缓存、模型 revision 改变或缓存目录被淘汰。检查 working set 和实际 cache key。

## 17. 常见误区

1. **cache 就是可浪费内存。**它可能是模型冷启动性能的关键工作集。
2. **`write` 返回就是数据安全。**缺少同步和后端持久化语义。
3. **Direct I/O 一定更快。**它牺牲共享缓存并增加应用责任。
4. **mmap 不占内存。**访问后的文件页仍占物理内存并参与回收。
5. **增大 readahead 总能提高吞吐。**随机/多流场景可能放大无效 I/O。
6. **清缓存是普通压测动作。**在共享节点会伤害其他业务。
7. **只看设备平均延迟。**应用可能卡在 page fault、写回限流或远程协议。

## 18. 掌握标准

应能独立解释并验证：

- 为什么同一模型第一次和第二次加载不同；
- 为什么 Buffered Write 的应用带宽可能远高于设备带宽；
- `fsync()` 与业务事务/Checkpoint 提交的关系；
- mmap fault 与 `read()` 缓存未命中的差异；
- 什么场景适合 Direct I/O；
- 怎样设计不干扰生产的冷热缓存实验；
- 如何把 Dirty、Writeback、fault、设备 I/O 和 GPU 空洞放到同一时间线。

下一篇：[存储性能指标与 fio 压测方法](./03-存储性能指标与fio压测方法.md)。

## 参考资料

- [Linux kernel page cache](https://docs.kernel.org/mm/page_cache.html)
- [Linux kernel memory management](https://docs.kernel.org/admin-guide/mm/index.html)
- [Linux man-pages: fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html)
- [Linux man-pages: open(2)](https://man7.org/linux/man-pages/man2/open.2.html)
- [Linux man-pages: posix_fadvise(2)](https://man7.org/linux/man-pages/man2/posix_fadvise.2.html)
- [Linux man-pages: madvise(2)](https://man7.org/linux/man-pages/man2/madvise.2.html)
