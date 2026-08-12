---
title: fuser 命令详解：按文件、挂载点与端口定位进程
sidebar_position: 2
description: 讲清 psmisc fuser 的 namespace、mount、IPv4/IPv6、交互 kill、信号、用户与访问类型输出。
tags: [Linux, fuser, 挂载, 端口, 进程]
---

# `fuser` 命令详解：从对象快速找到 PID

`fuser` 按文件、文件系统或网络端点列出正在使用它们的进程。它比 `lsof` 更适合“这个 mount/端口被谁占用”的快速判断，也能发信号；因此同一命令既是 `[R]` 也可能是 `[D]`。

## 1. 参数

```text
fuser [OPTIONS] NAME...
fuser [OPTIONS] -n SPACE NAME...
```

| 参数 | 含义 |
|---|---|
| `-a, --all` | 连无进程使用的名称也显示 |
| `-m, --mount` | NAME 所在文件系统的所有进程 |
| `-M, --ismountpoint` | 配合 `-m`，要求 NAME 真是 mount point，防误杀 |
| `-n, --namespace SPACE` | `file`、`tcp`、`udp`；可用 `PORT/tcp` 简写 |
| `-4, --ipv4`、`-6, --ipv6` | 限定地址族 |
| `-u, --user` | PID 后显示用户名 |
| `-v, --verbose` | 类似 ps 的详细表格 |
| `-l, --list-signals` | 列出信号名 |
| `-k, --kill` | 向找到的进程发信号 |
| `-SIGNAL` | 指定信号，默认 KILL |
| `-i, --interactive` | kill 前逐个确认；非交互 stdin 下无效 |
| `-w, --writeonly` | 只处理写入该对象的进程 |
| `-s, --silent` | 静默，仅靠退出状态；与 `-a/-u/-v` 冲突 |
| `-I, --inode` | 按 inode 比较名称（版本相关） |
| `-h, --help`、`-V, --version` | 帮助与版本 |

## 2. 只读用法

```bash
fuser -v /var/log/app.log
sudo fuser -vmM /models
sudo fuser -v 8000/tcp
sudo fuser -n udp 53
```

访问字母通常包括：`c` cwd、`e` executable、`f/F` 打开文件/写入、`r` root、`m` mmap/shared library。kernel mount、swap 等也可能显示特殊标记。

## 3. 终止流程

`fuser -k` 默认发送 `SIGKILL`，不适合作为第一步。正确顺序：

```bash
sudo fuser -vmM /mnt/target
sudo fuser -k -TERM -i -m -M /mnt/target
# 等待并复查，必要且批准后再升级信号
```

`-M` 防止路径不是挂载点时把整个底层文件系统的进程纳入范围。仍应先记录 PID start time、unit/container 归属和数据刷盘状态。

## 4. 边界与验收

权限不足、不同 mount/PID Namespace、NFS 内核线程和短命进程会让结果不完整。端口查找只代表 socket 占用，不代表服务健康。验收标准：能安全定位 busy mount，默认先 TERM 并验证退出，绝不把未审查的 PID 集合直接 KILL。

## 5. 官方参考

- [psmisc：fuser(1)](https://man7.org/linux/man-pages/man1/fuser.1.html)

下一篇：[strace 命令详解](./03-strace命令详解.md)。
