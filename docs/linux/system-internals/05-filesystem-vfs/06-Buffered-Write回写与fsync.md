---
title: "Buffered Write、回写与 fsync：数据何时才真正持久化"
sidebar_label: "06. Buffered Write、回写与 fsync"
sidebar_position: 6
description: "分析 write 返回、脏页、writeback、fsync/fdatasync、目录持久化、设备缓存与错误报告边界。"
tags: [Linux, Writeback, fsync, Dirty Page, 数据持久化]
---

# Buffered Write、回写与 fsync：数据何时才真正持久化

Buffered Write 先修改 Page Cache 并标记脏页，随后由后台或同步路径写入文件系统和设备。`write()` 成功通常表示内核接受数据，不表示掉电后一定存在。

## 1. 写入路径

```text
write(fd, buf, count)
→ VFS 权限和范围检查
→ 文件系统 write_iter
→ 获取/创建 Page Cache folio
→ copy_from_user
→ 更新文件大小/时间等元数据
→ 标记 folio Dirty
→ 返回用户态

之后：
脏页 → writeback → 文件系统映射 → bio/request → 设备
```

内核可以合并和重排写入，提高吞吐；代价是“调用完成”和“持久化完成”分离。

## 2. 谁触发回写

- 周期性后台回写。
- 脏页超过后台阈值。
- 内存回收需要释放文件页。
- 应用调用 `fsync/fdatasync/msync`。
- 文件系统 sync、卸载或冻结。
- 分配者因脏页过多被平衡/节流。

大内存服务器若仅使用百分比阈值，可能积累非常大的脏数据量；现代配置还可使用字节阈值。参数调整必须结合写带宽、设备延迟和故障恢复时间。

## 3. fsync 与 fdatasync

- `fsync(fd)`：要求文件数据及恢复这些数据所需的相关元数据完成同步。
- `fdatasync(fd)`：可省略不影响数据读取的部分元数据同步。
- `syncfs(fd)`：同步 fd 所在文件系统。
- `sync()`：发起更广范围同步，但其完成语义和应用事务边界不能替代文件级协议。

成功还依赖文件系统把 flush/FUA 等要求正确传递给块层和设备。存储控制器是否有掉电保护，会影响设备缓存的持久化保证。

## 4. 新文件为什么还要同步目录

写入并 fsync 新文件可以保证文件内容路径的一部分，但文件名到 inode 的目录项是父目录元数据。需要崩溃后保证新名称存在的更新协议通常还要 fsync 父目录。

安全替换常见顺序：

```text
create temp in same filesystem
→ write all bytes
→ fsync(temp)
→ rename(temp, target)
→ fsync(parent directory)
```

这只是一种模式；数据库还需要 WAL、校验和、恢复顺序等更完整协议。

## 5. Writeback 错误如何报告

设备写入可能在原始 `write()` 返回后才失败。通用 Page Cache 无法精确记录每个脏页由哪个文件描述符写入，因此错误可能在后续 `fsync`、close 或另一个相关操作上报告。

应用忽略 `fsync` 返回值，就可能把持久化失败误判为成功。只记录最初 write 成功也无法证明数据安全。

## 6. 观察脏页和回写

```bash
grep -E '^(Dirty|Writeback|WritebackTmp):' /proc/meminfo
grep -E 'nr_dirty|nr_writeback|nr_dirtied|nr_written' /proc/vmstat
vmstat -w 1
pidstat -d -p <PID> 1
```

存储侧还要观察设备队列、时延和错误。脏页稳定不增长不代表每个业务事务都正确调用了 fsync，只说明系统总体回写没有无限积压。

## 7. 常见性能问题

- burst 写入先在内存快速返回，达到阈值后突然节流。
- 多进程同时 fsync 形成同步写尖峰。
- Checkpoint 大文件把 Page Cache 和回写队列打满。
- 文件系统日志和数据写竞争相同设备。
- 设备缓存 flush 延迟放大尾部时延。
- 内存回收等待脏页回写，连带读请求变慢。

## 8. 练习与答案

**问题：write 返回全部字节，机器立即断电，数据一定存在吗？**

答案：不一定。数据可能只在 Page Cache、文件系统日志或易失设备缓存中，必须由应用定义并执行完整持久化协议。

**问题：fsync 成功能否证明数据库事务完整？**

答案：只能证明相应文件同步请求在该存储栈承诺范围内成功。事务还取决于 WAL 顺序、多个文件/目录、原子更新、校验和和副本协议。

下一篇：[mmap、Direct IO 与稀疏文件](./07-mmap-Direct-IO与稀疏文件.md)
