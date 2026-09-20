---
title: "Buffered Read 与预读：一次文件读取何时真正访问存储"
sidebar_label: "05. Buffered Read 与预读"
sidebar_position: 5
description: "深入分析 buffered read、Page Cache 命中、folio、readahead、短读、Major Fault 与块 IO 归因。"
tags: [Linux, Buffered IO, Page Cache, Readahead, read]
---

# Buffered Read 与预读：一次文件读取何时真正访问存储

普通文件 `read()` 通常先访问 Page Cache。缓存未命中时，文件系统发起读取并可能顺带预读后续数据。应用请求大小、Page Cache 页面和实际设备请求大小不一定相等。

## 1. 命中路径

```text
read(fd, user_buf, count)
→ fd 找到 struct file
→ VFS 调用文件 read_iter
→ 按文件偏移查 address_space 中 folio
→ 页面有效：copy_to_user
→ 更新 file position
→ 返回实际字节数
```

这条路径不提交新的设备读取，但仍消耗 CPU、内存带宽、页锁和用户复制成本。

## 2. 未命中路径

```text
Page Cache miss
→ 分配 folio
→ 文件系统把逻辑文件偏移映射到底层块/远端对象
→ 提交 IO
→ 当前任务等待或异步完成
→ 设备 DMA/网络返回数据
→ 标记页面 uptodate
→ 唤醒任务并复制到用户缓冲区
```

本地文件系统通常进入块层；NFS 等网络文件系统走 RPC/网络路径；tmpfs 的内容本来就在内存，不经过普通块设备文件读取路径。

## 3. Readahead

内核根据连续访问历史扩大预读窗口，把尚未显式请求的后续页提前读入。顺序读取吞吐因此提高，但错误预读会浪费带宽和缓存。

```text
应用 read 128 KiB
→ 内核识别顺序访问
→ 设备实际读取更大的连续范围
→ 后续 read 直接命中缓存
```

`strace` 看到的 read 大小不能代表设备请求大小；`iostat` 看到的设备吞吐也不能直接按某一个进程的 read 字节解释。

## 4. 短读和 EOF

`read` 返回值可能小于 count，原因包括到达 EOF、信号、特殊文件或当前对象语义。普通阻塞磁盘文件在文件尾前常尽量满足请求，但应用仍必须按 POSIX 返回值处理短读。

返回 0 对普通文件表示 EOF，不是错误；`-1/EINTR` 则表示在没有成功传输相应数据的条件下被信号中断等错误语义。

## 5. read 与 mmap 的缺页统计

显式 `read` 把 Page Cache 内容复制到已存在的用户缓冲页；文件 `mmap` 在 CPU 首次访问映射时通过 Fault 把文件页映射进页表。两者都可触发底层读取，但统计入口不同。

Major Fault 通常表示 Fault 路径需要 IO，不包含所有显式 `read` 的设备未命中。因此不能只用进程 majflt 统计全部文件读取缓存未命中。

## 6. 观察证据

```bash
strace -ttT -e trace=read,pread64,readv -- <command>
pidstat -d -p <PID> 1
cat /proc/<PID>/io
iostat -x 1
```

`/proc/PID/io` 的 `rchar` 和 `read_bytes` 口径不同，可能提示缓存效果，但共享缓存、异步 IO、预读和归因边界使其不能成为精确命中率。

需要验证路径时可使用文件系统/块层 tracepoint，但应限定设备、PID 和采样窗口，避免跟踪本身造成压力。

## 7. AI 模型加载中的意义

多副本读取同一模型文件时，Page Cache 可能共享文件页；但 Safetensors mmap、框架复制、NUMA 放置和 GPU H2D 传输仍会增加其他内存。重复冷启动是否访问存储，要同时看 Page Cache、进程映射、存储读和 H2D，而不是只看模型文件大小。

## 8. 练习与答案

**问题：`read()` 耗时 20 微秒是否证明 NVMe 延迟只有 20 微秒？**

答案：不能。数据可能已在 Page Cache，根本没有发起 NVMe 读取。

**问题：进程 Major Fault 为零是否证明所有 read 都命中 Page Cache？**

答案：不能。显式 buffered read 的设备读取不一定以该进程 Major Fault 计数呈现，预读和异步路径也会改变归因。

下一篇：[Buffered Write、回写与 fsync](./06-Buffered-Write回写与fsync.md)
