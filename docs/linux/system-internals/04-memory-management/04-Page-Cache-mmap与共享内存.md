---
title: "Page Cache、mmap 与共享内存：同一物理页如何服务文件和多个进程"
sidebar_label: "04. Page Cache、mmap 与共享内存"
sidebar_position: 4
description: "解释文件页缓存、buffered IO、mmap、dirty/writeback、tmpfs 与 POSIX/System V 共享内存的关系。"
tags: [Linux, Page Cache, mmap, Shared Memory, Writeback]
---

# Page Cache、mmap 与共享内存：同一物理页如何服务文件和多个进程

Linux 会把文件内容缓存在物理内存中。普通 `read/write` 和文件 `mmap` 可以访问同一套 Page Cache 页面；共享内存也可以让多个进程映射同一组页，但其持久化语义取决于背后的对象。

## 1. Page Cache 是什么

Page Cache 以文件映射和文件偏移组织缓存页/folio：

```text
inode/address_space
  ├── offset 0      → folio A
  ├── offset 4 KiB  → folio B
  └── offset 8 KiB  → 未缓存
```

它用于：

- 命中读取，避免重复设备 IO。
- 聚合写入并延后回写。
- 在进程间共享同一文件页。
- 支撑可执行文件、共享库和文件 mmap。

Page Cache 使用内存不是天然浪费。真正要观察的是它是否可回收、工作集是否反复被驱逐以及回写是否阻塞。

## 2. read 与 mmap 的差别

### 2.1 buffered read {/* #buffered-read */}

```text
Page Cache 页面
→ 内核 read 路径
→ 复制到用户缓冲区
```

### 2.2 文件 mmap {/* #文件-mmap */}

```text
用户虚拟地址
→ 页表直接映射 Page Cache 页面
→ CPU load/store 访问
```

`mmap` 避免显式 `read` 调用和一次面向用户缓冲区的复制，但把 IO 时机转移到 Page Fault；随机访问、错误处理、页回收和持久化语义仍需处理，不能笼统称为“零成本零拷贝”。

## 3. MAP_SHARED 与 MAP_PRIVATE

- `MAP_SHARED`：修改对映射同一对象的其他进程可见，脏页可回写到底层文件。
- `MAP_PRIVATE`：写入触发 COW，形成进程私有匿名页，不回写原文件。

二者初始读取都可能共享相同文件缓存页。`MAP_PRIVATE` 不是一开始就复制完整文件。

## 4. Dirty Page 与 Writeback

写入 Page Cache 后页面变脏，数据尚未一定到达持久介质。后台回写、内存压力或显式同步会把脏页交给文件系统和块层。

```bash
grep -E '^(Cached|Dirty|Writeback|WritebackTmp):' /proc/meminfo
grep -E 'nr_dirty|nr_writeback|pgpgout' /proc/vmstat
```

`write()` 返回通常只说明数据已被内核接受到相应缓存/路径；应用需要按其一致性要求使用 `fsync`、数据库 WAL 和设备持久化语义。文件系统日志不自动保证应用事务完整。

## 5. 共享内存的几种形式

| 机制 | 背后对象 | 生命周期/可见性 |
|---|---|---|
| 匿名 `MAP_SHARED` | 共享匿名映射 | 继承/传递映射关系的进程 |
| POSIX shm | 通常在 tmpfs，如 `/dev/shm` | 有名称和权限，可由多进程打开 |
| System V shm | 内核 IPC 对象 | 由 key/ID 和 IPC Namespace 管理 |
| `memfd_create` | 内存文件对象 | 通过 fd 传递，可做 sealing |
| 文件 `MAP_SHARED` | 普通文件 Page Cache | 受文件权限与持久化语义控制 |

共享内存位于系统 RAM/Page Cache 管理体系，并不是 GPU 显存。容器 `--shm-size` 或 Pod `/dev/shm` 大小限制的是 tmpfs/IPC 使用边界，还会受到 cgroup 内存限制。

## 6. RSS 为什么容易重复计算

多个进程映射同一共享库或共享内存页时，每个进程 RSS 都可能包含该页。把 RSS 直接相加会重复计算。PSS 把共享页按映射者数量分摊；USS 关注进程独占页。

```bash
cat /proc/<PID>/smaps_rollup
df -h /dev/shm
findmnt /dev/shm
```

PSS 是更合理的归因估算，但共享关系会随时间变化，读取 smaps 也有成本。

## 7. 文件删除与缓存

删除目录项不会使已打开文件立刻消失；`struct file` 和 inode 仍被引用，数据页也可继续存在。最后引用关闭后，文件系统才有条件回收空间。`lsof +L1` 可发现已删除但仍打开的文件，这属于文件生命周期，不是 Page Cache “泄漏”。

## 8. 练习与答案

**问题：两进程 mmap 同一只读模型文件，是否各占一份完整物理内存？**

答案：通常文件页可以通过 Page Cache 共享，两个进程各有虚拟映射和页表成本，但数据物理页不必重复。实际还受 COW、NUMA、副本和框架行为影响。

**问题：`/dev/shm` 有 64GiB，容器 memory limit 是 8GiB，能否写满 64GiB？**

答案：通常不能。tmpfs 页面仍计入内存和 cgroup 约束；达到 cgroup 限制可能回收、失败或触发 memcg OOM。

下一篇：[内存回收、Swap 与抖动](./05-内存回收-Swap与抖动.md)
