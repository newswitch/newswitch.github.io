---
title: "一次文件读取从 read、VFS、Page Cache 到 NVMe"
sidebar_label: "02. read 到 Page Cache 与 NVMe"
sidebar_position: 2
description: "追踪 read 系统调用经过文件描述符、VFS、文件系统、Page Cache、Block Layer、NVMe Queue、DMA 和 I/O Completion 的完整路径。"
tags: [read, VFS, Page Cache, Block Layer, NVMe, DMA]
---

# 一次文件读取从 read、VFS、Page Cache 到 NVMe

`read()` 不一定访问磁盘。目标数据若已在 Page Cache，读取主要是内存复制；只有 Cache Miss 且文件需要从块设备取数时，才进入文件系统映射、Block Layer 和 NVMe。

## 1. 用户态入口

```c
ssize_t n = read(fd, buffer, length);
```

典型入口：

```text
libc Wrapper
→ System Call Instruction
→ Kernel Syscall Entry
→ 根据 fd 查找当前进程文件表
→ struct file
→ VFS Read 操作
```

`fd` 只是当前进程文件描述符表中的整数索引，不是磁盘地址。

## 2. VFS 对象

| 对象 | 表示什么 |
| --- | --- |
| `struct file` | 一次打开实例、当前位置和 Flags |
| `dentry` | 路径名到 Inode 的缓存关系 |
| `inode` | 文件元数据和文件系统对象 |
| `address_space` | 文件页面与 Page Cache 的关系 |
| `folio/page` | 内存中的文件数据载体 |

VFS 提供统一接口，具体 Ext4、XFS 等文件系统实现数据映射和读取方法。

## 3. Page Cache 命中路径

```text
read(fd, user_buffer, len)
→ 找到文件偏移对应 Folio/Page
→ 页面已 Uptodate
→ 从 Page Cache 复制到 User Buffer
→ 更新文件偏移
→ 返回字节数
```

此时没有 NVMe 命令。延迟主要来自系统调用、Page Cache 查找、内存复制、缺页和调度。

## 4. Page Cache Miss

目标页面不存在或未 Uptodate 时：

1. 分配/锁定 Folio；
2. 文件系统把文件偏移映射到设备块；
3. 触发 Read I/O，并可能进行 Readahead；
4. 当前线程等待页面完成，或异步路径稍后获取结果；
5. I/O 完成后标记页面 Uptodate 并唤醒等待者。

稀疏文件的 Hole 可能直接返回零，不访问设备。

## 5. 文件系统到 Block Layer

简化转换：

```text
File Offset / Folio
→ Filesystem Extent / Block Mapping
→ BIO 描述一个或多个内存 Segment
→ Block Multi-Queue
→ Request
→ NVMe Driver Queue
```

内核版本和文件系统实现会使用不同接口，例如 Folio、iomap、Buffer Head 或 Bio，但核心问题相同：把文件逻辑范围转换为设备 LBA 与内存缓冲区。

## 6. NVMe 提交

```text
Driver 填写 NVMe Command
→ 把 PRP/SGL 指向目标内存页面
→ 写入 Submission Queue
→ MMIO Doorbell
→ Controller DMA 读取命令
→ 从介质读取数据
→ DMA 写入 Page Cache 页面
→ 写 Completion Queue
```

CPU 没有从 SSD 逐字节复制数据；NVMe Controller 通过 DMA 写入内存。CPU 负责准备命令、映射和完成处理。

## 7. IOMMU 与 DMA 地址

Driver 把内存页面映射为设备可访问的 DMA Address。启用 IOMMU 时，设备通常使用 IOVA：

```text
NVMe DMA 使用 IOVA
→ IOMMU Page Table
→ Host Physical Page
```

IOMMU 提供隔离和重映射。映射错误可能导致 DMA Fault，而不是普通文件权限错误。

## 8. 完成与返回

```text
NVMe Completion
→ MSI-X Interrupt 或 Polling
→ NVMe Driver 完成 Request
→ Block Layer 完成 BIO
→ Folio 标记 Uptodate / 解锁
→ 唤醒 read 线程
→ Copy to User Buffer
→ read 返回
```

若读取被信号中断、设备报错或只得到部分数据，`read()` 可能短读或返回错误。调用方必须按返回值处理。

## 9. Buffered I/O 与 Direct I/O

| 路径 | 数据驻留 | 主要特点 |
| --- | --- | --- |
| Buffered I/O | Page Cache + User Buffer | Cache、Readahead，通常有一次 Copy to User |
| Direct I/O | 尽量在用户 Buffer 与设备间直接 DMA | 对齐/生命周期约束，绕过大部分 Page Cache |
| `mmap` | 文件 Page 映射进进程地址空间 | 首次访问通过 Page Fault 取页 |

Direct I/O 不等于完全没有 Kernel，也不保证零拷贝；文件系统、块层、驱动和 DMA 映射仍然存在。

## 10. 延迟分解

```text
read 延迟 = 调用和调度
          + Page Cache 查找/缺页
          + 文件系统映射
          + Block Queue 等待
          + NVMe Controller/介质
          + DMA/Completion
          + Copy to User
```

同一文件第二次读取明显更快，常见原因是 Page Cache 命中，不代表 SSD 本身变快。

## 11. 观测方法

```bash
strace -ttT -e read,pread64 <command>
vmtouch -v <file>
iostat -x 1
pidstat -d 1
nvme smart-log /dev/nvme0
```

进一步可使用 Block Tracepoint、eBPF 或 `blktrace` 观察 Queue 与 Completion。生产环境不要通过随意清空 Page Cache 制造对照。

## 12. 练习与答案

**问题：`read()` 耗时很低且磁盘 IOPS 为零，数据从哪里来？**

答案：大概率来自 Page Cache，也可能是稀疏文件 Hole、内存文件系统或其他非块设备来源，应结合文件系统和 Cache 状态确认。

**问题：NVMe 已 DMA 到 Page Cache，为什么 Buffered `read()` 还需要 Copy？**

答案：Page Cache 属于 Kernel 管理的文件页面，普通 `read()` 需要把请求范围复制到进程提供的 User Buffer。`mmap` 等路径可以改变这一访问方式。

延伸阅读：[Linux VFS 与一次 read 的完整路径](../../storage/linux-io/01-Linux%20VFS与一次read的完整路径.md)。
