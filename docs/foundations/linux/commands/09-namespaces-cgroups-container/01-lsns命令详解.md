---
title: lsns 命令详解：盘点 Namespace、父子所有权与成员进程
sidebar_position: 1
description: 完整讲解 lsns 参数、namespace inode、类型、owner/parent/process 树、持久 namespace、JSON 输出、权限与容器现场用法。
tags: [Linux, lsns, Namespace, 容器, util-linux]
---

# `lsns` 命令详解：盘点 Namespace、父子所有权与成员进程

`lsns` 扫描 procfs，按 namespace inode 聚合成员进程，并尽可能解析 user namespace 所有权、父子关系和 nsfs 持久挂载。它是盘点入口，不会进入或创建 namespace。

## 1. 语法与全部参数

```text
lsns [OPTIONS] [NAMESPACE_INODE]
```

| 参数 | 含义 |
|---|---|
| `-H, --list-columns` | 列出可用于 `--output` 的列；可配合 JSON/raw |
| `-J, --json` | JSON 输出 |
| `-l, --list` | 强制列表格式 |
| `-n, --noheadings` | 不打印表头 |
| `-o, --output LIST` | 显式选择列；`+LIST` 追加默认列 |
| `--output-all` | 输出本版本全部列 |
| `-P, --persistent` | 只显示由 nsfs bind mount 持有、没有成员进程的 namespace |
| `-p, --task PID` | 只显示该进程持有的 namespace |
| `-Q, --filter EXPR` | libsmartcols 实验性表达式过滤 |
| `-r, --raw` | raw 输出 |
| `-t, --type TYPE` | 过滤 `mnt/net/ipc/user/pid/uts/cgroup/time`，可重复 |
| `-u, --notruncate` | 不截断列 |
| `-W, --nowrap` | 多行单元格改为逗号分隔单行 |
| `-T, --tree[=process|parent|owner]` | 进程、父 namespace 或 user-owner 树；省略关系时为 owner |
| `-h, --help` | 帮助 |
| `-V, --version` | 版本 |

```bash
lsns -l -o NS,TYPE,PATH,NPROCS,PID,USER,COMMAND
lsns -p 1234
lsns -t user -T owner
lsns -J -l -o NS,TYPE,NPROCS,PATH
```

## 2. inode 才是实例身份

```bash
readlink /proc/1234/ns/mnt
stat -Lc '%i' /proc/1234/ns/mnt
lsns -t mnt INODE
```

`mnt:[4026531841]` 中数字是 nsfs inode。同类型相同 inode 表示同一 instance；不同类型即便数字偶然相同也不能合并比较。PID 和 time 还存在 `*_for_children`，代表新后代将加入的 namespace。

## 3. 默认输出不是稳定接口

自动化固定格式和列：

```bash
lsns --list --noheadings --raw \
  --output NS,TYPE,NPROCS,PID,COMMAND
```

先用 `lsns -H` 获取版本支持列。`NSFS` 可能是多行，脚本用 `--nowrap`。JSON 形态受 libsmartcols 版本影响，升级要做 schema 测试。

## 4. 三种树不是一回事

- `process`：每个 namespace 中的进程父子树；
- `parent`：可发现类型的 namespace parent/child；
- `owner`：非 user namespace 由哪个 user namespace 拥有。

```bash
lsns -T process -t pid
lsns -T parent -t pid -t user
lsns -T owner
```

owner 关系决定 capability 在哪个 user namespace 中检查，是理解 rootless 容器的关键。

## 5. 可见性限制

非 root 可能无权读取其他进程 `/proc/PID/ns`；hidepid、PID namespace 和独立 procfs 都会缩小视图。一次 `lsns` 不是全局事务快照，进程可在扫描中退出。

持久 namespace 若只由 bind mount 持有且没有进程，旧版工具可能看不到；新版 `--persistent` 借助 nsfs ioctl 发现，但仍受内核和权限限制。

## 6. 容器排障模板

```bash
pid=TARGET
ps -o pid,lstart,cgroup,comm,args -p "$pid"
lsns -p "$pid" -o NS,TYPE,PATH,NPROCS,PID,COMMAND
for n in cgroup ipc mnt net pid time user uts; do
  readlink "/proc/$pid/ns/$n" 2>/dev/null
done
```

先固定宿主 PID 与启动时间，再把 inode 记录到工单。不要用 namespace inode 作为跨重启的永久容器 ID。

## 7. 退出状态与实验

`0` 成功，`1` 一般错误，`2` 表示内核不认识所需 ioctl。实验：创建 UTS/user/mount namespace，比较 list 与三种 tree，挂载一个持久 UTS namespace后退出成员进程，再观察 `--persistent` 与权限差异。

## 8. 官方参考

- [util-linux：lsns(8)](https://man7.org/linux/man-pages/man8/lsns.8.html)
- [Linux namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)

下一篇：[nsenter 命令详解](./02-nsenter命令详解.md)。
