---
title: "ext4、XFS、日志与崩溃一致性：文件系统保证了什么"
sidebar_label: "09. ext4、XFS、日志与崩溃一致性"
sidebar_position: 9
description: "比较 ext4 与 XFS 的核心组织方式，解释元数据日志、ordered write、fsync、恢复和应用事务边界。"
tags: [Linux, ext4, XFS, Journal, Crash Consistency]
---

# ext4、XFS、日志与崩溃一致性：文件系统保证了什么

日志文件系统主要保证文件系统元数据在崩溃后能恢复到可遍历的一致状态，不等于所有应用最新写入都已持久化，更不等于多个业务文件组成原子事务。

## 1. ext4 的核心概念

ext4 常见机制包括：

- Block Group 组织磁盘空间。
- Extent 描述连续物理块范围。
- JBD2 Journal 记录元数据事务。
- Delayed Allocation 延后决定物理块，提高布局质量。
- 多种数据日志模式，常见 ordered 模式协调数据与元数据提交顺序。

Delayed Allocation 使逻辑写入成功和物理块分配进一步分离，因此磁盘空间紧张时，错误可能在 writeback/fsync 阶段才暴露。

## 2. XFS 的核心概念

XFS 通过多个 Allocation Group 把文件系统划分成可并行管理区域，适合大容量和并发工作负载；使用日志保护元数据更新，并有独立的数据与元数据结构、延迟分配和 extent 管理。

“XFS 更适合大文件”或“ext4 更稳定”都过于笼统。实际差异要结合内核/工具版本、文件数量、并发、扩缩容、reflink、配额、修复流程和团队经验。

## 3. Journal 保护什么

概念事务：

```text
准备元数据更新
→ 写入 journal 事务
→ 提交记录
→ 更新 home location
→ 回收 journal 空间
```

崩溃恢复时重放已提交事务，避免目录、分配位图和 inode 等处于互相矛盾的半更新状态。数据内容是否进入 journal 取决于文件系统模式；即使记录数据，也不能替代数据库并发控制和 WAL 协议。

## 4. fsync 与 rename 协议

应用要保证配置或状态文件崩溃后原子替换，通常必须同时处理：

- 临时文件内容。
- 临时文件 inode 元数据。
- rename 目录项。
- 父目录持久化。
- 底层设备 flush 保证。

文件系统会为常见应用模式做一些保护，但程序不能依赖未写入接口契约的偶然行为。

## 5. 恢复工具不是日常修复按钮

- ext4 常用 `e2fsck`，通常应离线或按发行版流程执行。
- XFS 挂载时执行日志恢复，结构修复使用 `xfs_repair`，同样需要正确离线和备份策略。

底层硬件仍在报错时反复修复可能扩大损失。先采集内核日志、SMART/NVMe 错误、阵列状态和镜像，再制定恢复顺序。

## 6. 观察

```bash
findmnt -no SOURCE,FSTYPE,OPTIONS /mountpoint
tune2fs -l /dev/DEVICE 2>/dev/null | head
xfs_info /mountpoint 2>/dev/null
journalctl -k | grep -i -E 'ext4|xfs|I/O error|buffer error|read-only'
```

不要对正在使用的未知设备直接运行修复命令。只读信息查询也应确认设备映射，避免把 LVM、multipath 的底层路径当成文件系统设备。

## 7. 练习与答案

**问题：使用 ext4/XFS 后，数据库是否可以关闭 WAL？**

答案：不可以据此推导。文件系统日志主要维护文件系统一致性；数据库 WAL 维护数据库事务顺序、原子性和恢复语义，层次不同。

**问题：fsck 修复成功是否证明磁盘硬件健康？**

答案：不能。它只说明文件系统结构修复过程完成，还要检查设备介质、控制器、链路和持续错误。

下一篇：[删除文件、文件锁与空间异常](./10-删除文件锁与空间异常.md)
