---
title: "mmap、Direct IO 与稀疏文件：三种不同的数据访问语义"
sidebar_label: "07. mmap、Direct IO 与稀疏文件"
sidebar_position: 7
description: "比较 mmap、Buffered IO、O_DIRECT、DAX 和稀疏文件的缓存、对齐、缺页、持久化与一致性边界。"
tags: [Linux, mmap, O_DIRECT, Sparse File, DAX]
---

# mmap、Direct IO 与稀疏文件：三种不同的数据访问语义

选择 IO 模式不是简单比较“谁少一次复制”。必须考虑访问模式、缓存复用、对齐、异步并发、错误处理、内存压力和持久化协议。

## 1. Buffered IO、mmap 与 Direct IO

| 模式 | 主要数据路径 | 优势 | 风险/边界 |
|---|---|---|---|
| Buffered IO | 用户缓冲区 ↔ Page Cache ↔ 文件系统 | 通用、缓存和预读成熟 | 双份缓存风险、回写时机 |
| 文件 mmap | 用户页表映射 Page Cache | 按需访问、减少显式 read/copy | Fault 延迟、SIGBUS、回写控制复杂 |
| O_DIRECT | 用户缓冲区 ↔ 文件系统/块层 | 应用自管缓存、减少 Page Cache 干扰 | 对齐、并发、一致性和实现差异 |

O_DIRECT 通常尽量绕过 Page Cache 数据缓存，但仍经过系统调用、VFS、文件系统映射、块层和驱动，不等于“绕过内核”。

## 2. mmap 的错误发生在访问时

映射成功不代表所有页面可读取。文件被截断、底层 IO 失败或访问超出有效范围时，CPU 访问映射可能触发 `SIGBUS`。程序必须把 mmap 的错误模型与普通 read 返回 errno 区分。

`MAP_SHARED` 修改需按要求 `msync/fsync`；`MAP_PRIVATE` 写入形成 COW 私有页，不更新原文件。

## 3. O_DIRECT 对齐

Direct IO 对缓冲区地址、文件偏移和长度可能有设备/文件系统相关对齐要求。现代接口可查询部分直接 IO 对齐信息，但兼容程序仍应按目标文件系统和设备验证。

```bash
stat -f /path
lsblk -o NAME,LOG-SEC,PHY-SEC,MIN-IO,OPT-IO,ALIGNMENT
```

对齐错误可能返回 `EINVAL`，也可能在某些组合下回退或表现不同，不能把某文件系统测试结果推广到全部环境。

## 4. 混用 Buffered 与 Direct IO

同一文件范围同时使用 buffered、mmap 和 direct IO，需要处理 Page Cache 一致性、写入顺序和应用并发。内核/文件系统提供相应协调，但混用容易产生性能抖动和错误假设，数据库通常由专门 IO 层集中管理。

## 5. 稀疏文件

稀疏文件的逻辑大小可以大于实际分配块数，未分配洞读取为零：

```bash
truncate -s 1T sparse.img
ls -lh sparse.img
du -h sparse.img
stat sparse.img
```

`ls` 看逻辑大小，`du` 看已分配块近似值。复制、归档和备份工具若不保留 sparse 语义，可能把洞展开成真实零数据并占满目标空间。

## 6. DAX 的不同边界

DAX 面向可直接寻址持久内存等场景，让文件映射绕过传统 Page Cache。它不等于 O_DIRECT，也不适用于所有块设备和文件系统。持久化顺序还涉及 CPU Cache flush 和内存屏障，不能沿用普通磁盘的全部假设。

## 7. 怎样选

- 通用文件服务和顺序读取：先从 buffered IO 开始。
- 大量随机页级访问：评估 mmap 的 Fault 和错误模型。
- 数据库自带缓存、严格控制并发：可评估 Direct IO。
- 任何选择都用真实块大小、并发、工作集和崩溃恢复验证。

## 8. 练习与答案

**问题：O_DIRECT 是否保证写入已持久化？**

答案：不保证。绕过 Page Cache 不等于设备缓存已落盘，仍要按接口和文件系统使用同步/flush 语义。

**问题：1TiB 稀疏文件是否一定占用 1TiB 磁盘？**

答案：不是。逻辑范围中的洞未分配实际数据块；但后续写入、复制方式、文件系统元数据和预分配会改变占用。

下一篇：[挂载、Mount Namespace 与传播](./08-挂载-Mount-Namespace与传播.md)
