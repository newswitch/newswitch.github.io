---
title: "一次 read 的完整路径：从用户缓冲区到文件系统和 Page Cache"
sidebar_label: "05. 一次 read 的完整路径"
sidebar_position: 5
description: "以 read 系统调用串联文件描述符、VFS、Page Cache、缺页、块 IO、睡眠和返回值。"
tags: [Linux, read, VFS, Page Cache, 系统调用]
---

# 一次 read 的完整路径：从用户缓冲区到文件系统和 Page Cache

`read(fd, buf, count)` 看似简单，却能串联系统调用、进程文件表、VFS、文件系统、Page Cache、内存管理和块设备。关键问题不是背调用栈，而是判断这一次读取在哪一层命中、等待或失败。

## 1. 调用前有哪些对象

`fd` 不是磁盘文件，而是当前进程 `files_struct` 中的索引：

```text
fd
→ files_struct / fdtable
→ struct file（一次打开实例、偏移、标志）
→ dentry（路径名缓存对象）
→ inode（文件元数据和数据映射）
→ address_space（文件页缓存关系）
```

两个进程可以打开同一个 inode 得到不同 `struct file`，也可以在 `fork` 后共享同一个打开文件描述，从而共享文件偏移。

## 2. 通用读取路径

以 Linux 6.6 的普通同步读取为概念基线：

```text
用户态 read()
  → 系统调用入口
  → ksys_read()
  → fdget_pos() 查找 struct file 并处理位置
  → vfs_read() 权限和范围检查
  → 文件的 read_iter 实现
  → Page Cache 查找/填充
  → copy_to_user() 复制到用户缓冲区
  → 更新文件偏移
  → 返回字节数
```

具体函数会因文件类型、内核版本和 IO 模式不同。管道、Socket、字符设备、procfs 和普通文件都可以使用 `read`，但后续实现完全不同。

## 3. Page Cache 命中

如果目标文件页已在 Page Cache 且有效：

```text
定位页缓存 folio
→ 校验范围
→ 复制数据到用户缓冲区
→ 返回
```

这条路径不需要向磁盘提交新的读请求，但仍消耗 CPU、内存带宽并可能等待页锁。`read()` 很快不能证明磁盘很快，只能说明这次读取可能没有等待磁盘。

## 4. Page Cache 未命中

缓存未命中时，文件系统根据 inode 的映射信息确定数据位置，向块层提交 IO。当前任务通常等待页面完成：

```text
Page Cache miss
→ 分配缓存页/folio
→ 文件系统映射逻辑偏移
→ bio / request
→ blk-mq
→ 设备驱动
→ DMA 把数据写入内存
→ 中断通知完成
→ 唤醒等待任务
→ copy_to_user
```

等待期间任务常处于不可中断睡眠 `D`，但不能看到一个 `D` 就断定磁盘损坏；NFS、驱动、锁和其他内核等待也可能出现该状态。

## 5. Read-ahead 为什么会改变结果

内核可能判断访问是顺序读取并预读后续页面。应用只请求当前范围，块设备却可能读取更大范围。后续 `read()` 因预读命中而变快，因此：

- 一次测试不能代表稳定设备时延。
- `strace` 的 `read` 大小不等于实际块 IO 大小。
- 顺序读和随机读即使总字节数相同，设备行为也可能不同。

## 6. 返回值必须正确解释

| 返回 | 含义 |
|---:|---|
| `> 0` | 实际读取的字节数，可能小于 `count` |
| `0` | EOF，或某些特殊对象当前语义下没有更多数据 |
| `-1` 并设置 errno | 调用失败 |

短读不是自动等于故障。管道、终端、Socket 和文件尾都可能短读；正确程序必须循环处理尚未取得的数据，并根据协议或文件语义判断结束条件。

## 7. 怎样区分缓存命中和设备读取

```bash
strace -ttT -e read,openat,close -- your_program
pidstat -d -p <PID> 1
cat /proc/<PID>/io
```

`/proc/PID/io` 中：

- `rchar` 是传给读取类系统调用的字符数量口径之一。
- `read_bytes` 更接近进程导致从存储层取得的字节。

两者差异可以提示 Page Cache，但有共享缓存、回写归因和异步 IO 等边界，不能把差值当成精确命中率。需要更细证据时再使用块层和文件系统 tracepoint。

## 8. 三条不同路径

| 模式 | 主要特点 | 不能简单理解为 |
|---|---|---|
| Buffered IO | 通常通过 Page Cache | 一定复制两次、一定慢 |
| Direct IO | 尽量绕过 Page Cache，受对齐等约束 | 完全绕过内核和所有缓存 |
| `mmap` | 访问时由缺页建立文件页映射 | 文件提前完整载入内存 |

`mmap` 把“读取时机”从显式 `read` 转移到内存访问和 Page Fault，观察方法也随之改变。

## 9. 故障定位示例

现象：`read()` 偶发耗时 800ms。

合理的证据链：

1. `strace -T` 证明确实卡在 `read`，而不是此前 DNS、锁或应用计算。
2. 同期 `pidstat -d`、块设备延迟和 PSI IO 判断是否存在存储等待。
3. Major Fault、回收和内存 PSI 判断是否由内存压力驱逐缓存。
4. 如果块设备无请求，继续检查管道/Socket/特殊文件语义和内核锁等待。
5. 必要时用 tracepoint 确认请求提交与完成时间。

不能仅凭一条慢 `read` 得出“磁盘坏了”。

## 10. 练习与答案

**问题：文件已经在 Page Cache，`read` 是否完全不访问内存？**

答案：不是。数据本身就在内存中的 Page Cache，内核还要访问页缓存元数据并把数据送到用户缓冲区；只是通常不需要等待块设备读取。

**问题：为什么 `read()` 返回的数据量可能小于请求量但没有 errno？**

答案：短读是合法结果，可能因为到达 EOF、管道或 Socket 当前可用数据较少、信号或设备语义。调用者应按接口契约继续处理。

下一模块：[Linux 系统启动导读](../02-boot-system/00-Linux系统启动导读.md)
