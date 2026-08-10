---
title: "Linux VFS 与一次 read 的完整路径"
sidebar_position: 1
tags: [Linux, VFS, 文件系统, 块设备, eBPF, 存储]
description: "从文件描述符、系统调用、VFS、页缓存、文件系统、块层到 NVMe，完整解释一次 Linux 文件读取以及分层排查方法。"
---

# Linux VFS 与一次 read 的完整路径

应用读取模型文件时通常只调用 `open()` 和 `read()`，但数据可能来自 Linux 页缓存，也可能经过文件系统、块层、设备驱动和 NVMe；如果路径是 NFS，还会进入 RPC 与网络；如果使用对象存储 SDK，则根本不是 POSIX `read` 的同一条语义链。

本文先用本地文件建立最基础的路径模型：

```text
应用 → 系统调用 → 文件描述符 → VFS → 页缓存
                              ├─ 命中：复制给用户空间
                              └─ 未命中：文件系统 → 块层 → 驱动 → 设备
```

## 1. 学习目标

完成本文后，应能够：

- 区分路径名、inode、dentry、file 对象和文件描述符；
- 解释 `openat()` 与 `read()` 各自做了什么；
- 画出 Buffered Read 从用户态到块设备的完整路径；
- 解释页缓存命中为什么可能完全没有磁盘 I/O；
- 区分逻辑文件偏移、文件系统块和设备 LBA；
- 使用 `strace`、`pidstat`、`iostat`、`perf` 或 eBPF 分层观察；
- 根据现象判断瓶颈在应用、缓存、文件系统、块层还是设备。

## 2. 三类接口先分清

### 2.1 文件接口

```c
int fd = open("/models/model.bin", O_RDONLY);
ssize_t n = read(fd, buf, size);
```

应用使用路径、目录、权限、文件偏移和 POSIX 语义。ext4、XFS、NFS、CephFS 都可向应用提供文件接口，但下层实现不同。

### 2.2 块接口

块设备暴露按扇区或逻辑块寻址的空间，例如 `/dev/nvme0n1`。文件系统把文件映射到块设备。数据库也可能直接访问裸块设备，但必须自己管理布局与一致性。

### 2.3 对象接口

S3 通过 HTTP API 按 Bucket、Key、Version 读写完整对象或 Range，不提供通用 inode、目录、随机覆盖写和 POSIX 锁。对象存储 SDK 的读取路径是 socket/network stack，而不是本地文件系统的 VFS 块路径。

FUSE 可以把对象接口呈现为目录，但语义和性能仍受转换层限制。

## 3. 文件相关的五个核心对象

### 3.1 路径名

`/models/revision-42/model-00001.safetensors` 是用户空间看到的名字。内核需要逐级解析目录。

### 3.2 dentry

dentry 表示目录项，把一个名字与 inode 关联。dentry cache 加速路径查找。负 dentry 还可以缓存“这个名字不存在”。

### 3.3 inode

inode 表示文件系统对象的元数据和操作集合，例如：

- 文件类型和权限；
- UID/GID；
- 大小和时间；
- 数据块映射；
- 文件系统提供的 inode/file/address_space 操作。

inode 不保存用户使用的完整路径名；同一 inode 可以有多个硬链接名字。

### 3.4 file 对象

成功 `open()` 后，内核创建或引用一个打开文件描述，保存：

- 当前文件偏移；
- 打开标志；
- 关联 dentry/inode；
- 文件操作表；
- 凭证与状态。

多个文件描述符可能引用同一个 file 对象，例如 `dup()` 后共享文件偏移；分别 `open()` 通常产生不同 file 对象。

### 3.5 文件描述符

文件描述符只是进程文件描述符表中的整数索引。`fd=3` 对另一个进程没有相同含义。

```text
进程 fd 表
  fd 3 ──→ struct file ──→ dentry ──→ inode
```

## 4. `openat()`：先把路径变成可操作对象

现代 libc 经常使用 `openat()`。内核大致执行：

1. 从根目录或指定目录 fd 开始；
2. 逐级查找 dentry；
3. 遇到缓存未命中时调用文件系统查找；
4. 处理挂载点、符号链接和命名空间；
5. 检查目录搜索权限、文件权限和安全模块；
6. 根据标志执行创建、截断等操作；
7. 建立 file 对象并分配文件描述符。

路径很深、目录项很多、远程文件系统 RTT 高或权限检查复杂时，`open()` 本身就可能成为小文件工作负载瓶颈。

使用 `strace` 区分打开与读取：

```bash
strace -ttT -e trace=openat,read,pread64,close \
  <application> <arguments>
```

关键字段：

- `-ttT` 记录时间和系统调用耗时；
- 返回值是实际读取字节或错误码；
- 大量短 `openat/stat/close` 常指向元数据压力；
- 一个 `read()` 很慢不代表一定是磁盘，也可能等待远程文件系统或锁。

`strace` 有开销，只在测试或短时诊断使用。

## 5. `read()` 的入口

应用调用：

```c
ssize_t read(int fd, void *buf, size_t count);
```

内核首先验证：

- fd 是否有效且允许读取；
- 用户缓冲区是否可写；
- count 和偏移是否合法；
- 文件类型是否支持读取。

随后通过 VFS 调用对应文件系统的读取实现。VFS 的作用不是保存所有文件数据，而是提供统一对象模型和操作入口，使 ext4、XFS、tmpfs、NFS 等能够被相同系统调用访问。

## 6. Buffered Read 与页缓存

默认普通文件读取通常是 Buffered I/O。文件内容以页为单位进入 page cache；现代内核内部可能以 folio 表示一组连续页，但学习时先理解为缓存页。

```text
read(fd, user_buf, 1 MiB)
  ↓
VFS / filesystem read iterator
  ↓
查找 file offset 对应的 page-cache entries
  ├─ 全部命中 → copy_to_user → 返回
  └─ 有缺页   → 发起读取 → 等待完成 → copy_to_user
```

### 6.1 热缓存读取

如果所需数据已经在页缓存中：

- 不产生新的块设备请求；
- 仍有内核查找、内存访问和用户空间复制；
- 性能可能受内存带宽和 CPU 限制；
- `iostat` 可能几乎为零，但应用读取很快。

### 6.2 冷缓存读取

缓存未命中时：

1. 找到文件逻辑偏移对应的缓存页；
2. 文件系统把文件偏移映射到设备块；
3. 生成块 I/O；
4. 请求进入块层队列和设备驱动；
5. 设备完成后触发中断或轮询处理；
6. 页被标记为 Uptodate；
7. 等待的读取者复制数据并返回。

顺序读取还可能触发 readahead，实际读取的设备数据大于当前系统调用请求量。

## 7. 从文件偏移到物理设备

应用看到的是文件偏移：

```text
offset 0 ... file_size-1
```

文件系统负责将它映射到：

- extent 或块映射；
- 可能的 hole（稀疏文件空洞）；
- 压缩、加密、校验或写时复制结构；
- 下层块设备的逻辑块地址。

因此一次连续 1 MiB 文件读取不一定对应设备上连续 1 MiB：文件可能碎片化，也可能处于 LVM、RAID、dm-crypt 或网络块设备之上。

典型路径：

```text
ext4/XFS 文件
  → extent mapping
  → bio
  → blk-mq request queue
  → device-mapper/LVM（可选）
  → NVMe/SCSI driver
  → controller queue
  → NAND/SSD media
```

## 8. 块层与 blk-mq

块层接收上层 bio，完成合并、拆分、调度和提交。现代多核设备通常使用 blk-mq：

```text
CPU software submission context
  → software queue
  → hardware dispatch queue
  → device command queue
  → completion
```

关键理解：

- 应用一次 `read()` 可产生多个块请求；
- 多次应用 I/O 也可能被合并；
- 请求大小、队列深度与设备并行能力共同影响吞吐；
- 排队时间增加时，应用延迟可能在设备服务时间不变的情况下上升；
- NVMe 支持多队列，不等于单线程单深度负载自动获得峰值带宽。

## 9. I/O 完成与进程唤醒

设备完成命令后，驱动处理完成事件，块层结束 bio，文件系统/页缓存把页面标记为可用，等待进程被唤醒。

如果进程同步调用 `read()` 且缓存未命中，它可能处于睡眠等待；这并不持续消耗 CPU。观察到进程处于 `D` 状态表示不可中断睡眠，常见于等待 I/O，但还需要结合内核等待点和设备/网络证据。

```bash
ps -eo state,pid,comm,wchan:32 | awk '$1=="D"'
```

不能看到 D 状态就直接杀进程。若底层 I/O 长期不返回，进程即使收到信号也可能要等内核调用退出。

## 10. `read`、`pread`、`mmap` 和异步 I/O

### 10.1 `read`

使用并更新 file 对象的当前偏移，适合顺序流。

### 10.2 `pread`

显式指定偏移，不改变共享文件偏移，便于并发随机读取。

### 10.3 `mmap`

把文件映射到进程地址空间。首次访问未驻留页面时发生 page fault，内核读取文件页。I/O 从 `read()` 调用时间转移到内存访问时间。

```text
mmap 成功 ≠ 所有数据已读入内存
```

`mmap` 适合随机访问和共享页，但故障时错误可能以 `SIGBUS` 等形式暴露，性能分析要观察 page fault。

### 10.4 AIO/io_uring

异步接口允许提交多个请求并在完成后收割结果，减少线程阻塞并提高队列深度。它不会自动让设备更快，收益取决于内核、文件系统、I/O 模式和应用结构。

## 11. 错误在哪一层产生

| 错误/现象 | 优先检查 |
|---|---|
| `ENOENT` | 路径、挂载、dentry、发布原子性 |
| `EACCES` | UID/GID、mode、ACL、安全模块、导出权限 |
| `EIO` | 文件系统、块设备、远程后端、内核日志 |
| `ENOSPC` | 文件系统空间、inode、thin pool、后端配额 |
| `ESTALE` | NFS 文件句柄与服务端对象变化 |
| read 延迟高、设备空闲 | 页错误、远程 FS、锁、CPU、应用同步 |
| 设备忙、应用吞吐低 | I/O 大小、随机性、队列、文件系统、写放大 |

## 12. 分层观测工具

### 12.1 应用系统调用

```bash
strace -c -e trace=%file,read,write,pread64,pwrite64 <command>
pidstat -d -p <pid> 1
```

回答：调用频率、大小、耗时和错误是什么？

### 12.2 进程与内存

```bash
pidstat -r -p <pid> 1
vmstat 1
grep -E 'MemAvailable|Cached|Dirty|Writeback' /proc/meminfo
```

回答：是否有 major fault、内存压力、脏页或回写积压？

### 12.3 文件和文件系统

```bash
stat <file>
findmnt <path>
df -hT <path>
df -i <path>
filefrag -v <file>
```

`filefrag` 需要权限且结果与文件系统相关，用于观察 extent，不代表设备性能结论。

### 12.4 块设备

```bash
lsblk -o NAME,KNAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,ROTA,MODEL
iostat -xz 1
```

回答：请求率、大小、队列、延迟和吞吐是否异常？

### 12.5 内核函数与 I/O 延迟

`perf`、ftrace、bpftrace 和 BCC 可以观察 page fault、VFS、block request 与 I/O 延迟。具体 tracepoint 和函数随内核版本变化，应先列出本机可用事件：

```bash
perf list | grep -E 'block:|fault|vfs'
bpftrace -l 'tracepoint:block:*'
```

生产环境使用前评估开销、权限与数据暴露，避免对高频事件输出每条日志。

## 13. 一个可复现实验

在独立测试文件系统创建一个大于常见 readahead 窗口的文件，固定测试文件、设备和并发。

### 13.1 观察系统调用

```bash
strace -ttT -e trace=openat,read,close \
  dd if=<test-file> of=/dev/null bs=1M status=none
```

### 13.2 同时观察设备

```bash
iostat -xz 1
pidstat -d -p <pid> 1
```

比较第一次和第二次读取：

- 第二次更快且设备读取很少：页缓存命中；
- 两次都有设备读取：文件大于缓存、内存压力或使用 Direct I/O；
- 应用读取小但设备读取较大：可能存在 readahead；
- `read()` 次数很多且每次很小：应用 I/O 粒度可能限制性能。

不要在共享生产节点执行 `drop_caches`。它影响全机缓存，会扰动其他业务。需要冷缓存时，使用专用测试机、新测试文件、独立 cgroup/VM 或可重建测试环境。

## 14. AI 模型加载中的路径

普通本地文件加载：

```text
模型 loader
→ open/read 或 mmap
→ VFS
→ page cache
→ 文件系统
→ NVMe
→ 用户空间/主机内存
→ pinned memory（可能）
→ PCIe H2D
→ GPU HBM
```

NFS 模型加载在 VFS 下方进入 NFS client、RPC 和网络；CephFS 进入 Ceph 客户端与 MDS/OSD；对象下载先经过 HTTP/socket，写入文件后又可能经过 VFS。不同来源最终都需要理解缓存与 H2D。

Safetensors 或其他 loader 使用 `mmap` 时，模型文件打开很快不代表模型页已经全部进入内存。实际 page fault 可能分布在后续加载阶段。

## 15. 常见误区

1. **一次 `read(1 MiB)` 就是一次 1 MiB 磁盘请求。**可能拆分、合并、缓存或预读。
2. **`read()` 返回就代表数据持久化。**读取与写持久化不是同一问题。
3. **磁盘无 I/O 就不是存储问题。**远程文件系统、页错误、锁和缓存都可能等待。
4. **第二次读快说明设备快。**很可能只是页缓存。
5. **VFS 就是文件系统。**VFS 是统一抽象，ext4/XFS/NFS 是具体实现。
6. **mmap 会立刻把文件全部加载。**通常按访问触发 page fault。
7. **队列越深越好。**吞吐达到平台后，继续增加只会抬高延迟。

## 16. 排查方法总结

```text
明确文件与挂载类型
→ 查看应用调用和访问模式
→ 判断页缓存命中/缺页
→ 检查文件系统与空间/inode
→ 检查块层队列和设备延迟
→ 检查设备、控制器和内核错误
→ 使用相同负载复测
```

掌握标准：面对一个“模型文件读取慢”的问题，能够用证据判断时间花在路径解析、缓存缺页、文件系统映射、块队列、设备，还是后续 H2D，而不是只看一张 `iostat` 截图。

下一篇：[页缓存、预读、回写与 Direct I/O](./02-页缓存预读回写与Direct%20IO.md)。

## 参考资料

- [Linux kernel VFS documentation](https://docs.kernel.org/filesystems/vfs.html)
- [Linux kernel page cache documentation](https://docs.kernel.org/mm/page_cache.html)
- [Linux kernel multi-queue block IO](https://docs.kernel.org/block/blk-mq.html)
- [Linux man-pages: read(2)](https://man7.org/linux/man-pages/man2/read.2.html)
- [Linux man-pages: open(2)](https://man7.org/linux/man-pages/man2/open.2.html)
- [Linux man-pages: mmap(2)](https://man7.org/linux/man-pages/man2/mmap.2.html)
