---
title: "文件系统与 VFS 导读：从路径名到持久化数据"
sidebar_label: "00. 文件系统与 VFS 导读"
sidebar_position: 0
description: "以一次 open/read/write/fsync 为主线，串联 VFS 对象、路径解析、Page Cache、文件系统和块设备。"
tags: [Linux, VFS, 文件系统, inode, Page Cache]
---

# 文件系统与 VFS 导读：从路径名到持久化数据

应用看到的是路径和文件描述符，VFS 看到的是 mount、dentry、inode 与 `struct file`，具体文件系统再把逻辑文件偏移映射到自己的数据结构或远端协议。理解这几层，才能解释“文件存在但打不开”“write 成功却重启后丢数据”“df 满而 du 不大”等问题。

## 1. 整体路径

```mermaid
flowchart LR
    A["路径名"] --> M["Mount Namespace/挂载点"]
    M --> D["dentry/dcache"]
    D --> I["inode 元数据"]
    I --> F["struct file 打开实例"]
    F --> V["VFS 操作"]
    V --> PC["Page Cache / mmap"]
    PC --> FS["ext4/XFS/NFS/tmpfs/OverlayFS"]
    FS --> BIO["块 IO 或网络协议"]
```

VFS 是内核的统一抽象层，不是磁盘上的一种文件系统。ext4、XFS、tmpfs、procfs 和 NFS 都向 VFS 提供对应操作，但是否持久化、是否经块设备、缓存一致性和错误语义并不相同。

## 2. 四个最容易混淆的对象

| 对象 | 表示什么 | 一个典型关系 |
|---|---|---|
| superblock | 一次已挂载文件系统实例 | 一个块设备可以被一个或多个挂载视图引用 |
| inode | 文件系统对象元数据 | 多个硬链接 dentry 可指向同一 inode |
| dentry | 名称在目录层次中的缓存关系 | 同一 inode 可有多个名字 |
| `struct file` | 一次打开实例 | 多个 fd 可引用同一打开实例 |

文件描述符只是进程文件表中的整数索引；删除文件名只移除目录项，不会强制关闭已有打开实例。

## 3. 三条不同的“成功”边界

```text
write 返回成功
≠ 数据已提交到文件系统
≠ 数据已进入设备持久介质
≠ 应用事务在崩溃后一定成立
```

持久化需要同时理解应用协议、`fsync/fdatasync`、目录项持久化、文件系统日志、块层 flush/FUA、设备缓存和副本系统。任何单层“有日志”都不能代替完整事务保证。

## 4. 本模块文章

1. [VFS 核心对象](./01-VFS核心对象.md)
2. [路径解析、dcache 与符号链接](./02-路径解析-dcache与符号链接.md)
3. [文件描述符与打开文件生命周期](./03-文件描述符与打开文件生命周期.md)
4. [inode、权限、链接与时间戳](./04-inode权限链接与时间戳.md)
5. [Buffered Read 与预读](./05-Buffered-Read与预读.md)
6. [Buffered Write、回写与 fsync](./06-Buffered-Write回写与fsync.md)
7. [mmap、Direct IO 与稀疏文件](./07-mmap-Direct-IO与稀疏文件.md)
8. [挂载、Mount Namespace 与传播](./08-挂载-Mount-Namespace与传播.md)
9. [ext4、XFS、日志与崩溃一致性](./09-ext4-XFS日志与崩溃一致性.md)
10. [删除文件、文件锁与空间异常](./10-删除文件锁与空间异常.md)

## 5. 观察边界

```bash
findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS
stat /path/to/file
namei -l /path/to/file
ls -l /proc/<PID>/fd
grep -E 'Dirty|Writeback|Cached' /proc/meminfo
```

命令只能观察一部分状态：`findmnt` 描述挂载视图，`stat` 描述 inode 相关元数据，`/proc/PID/fd` 描述进程引用。网络文件系统、容器 Mount Namespace 和 OverlayFS 还需要到正确 Namespace 与层次观察。

## 6. 掌握标准

能够从路径解析到 inode，再到打开文件实例；能够解释 Page Cache 命中、预读、脏页和回写；能够区分 `write`、`fsync` 与业务事务；能够从挂载、引用、inode、块分配和文件系统日志定位空间与一致性问题。

下一篇：[VFS 核心对象](./01-VFS核心对象.md)
