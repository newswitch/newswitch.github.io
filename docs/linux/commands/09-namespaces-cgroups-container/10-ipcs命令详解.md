---
title: "ipcs 命令详解：System V IPC 对象、限制与 Namespace 现场"
sidebar_label: "10. ipcs 命令详解：System V IPC 对象、限制与 Namespace 现场"
sidebar_position: 10
description: "完整讲解 ipcs 的消息队列、共享内存、信号量、ID、创建者、限制、时间、字节与 IPC Namespace 排障。"
tags: [Linux, ipcs, IPC Namespace, 共享内存, 信号量]
---

# ipcs 命令详解：System V IPC 对象、限制与 Namespace 现场

`ipcs` 读取当前 IPC Namespace 中的 System V message queue、shared memory 和 semaphore 状态。容器内外可能看到完全不同的集合；它不显示 POSIX `shm_open` 对象、Unix socket 或匿名共享映射。

## 1. 语法与参数

```text
ipcs [resource-option] [output-format]
ipcs -i ID
```

| 参数 | 含义 |
|---|---|
| `-q, --queues` | 消息队列 |
| `-m, --shmems` | 共享内存段 |
| `-s, --semaphores` | 信号量数组 |
| `-a, --all` | 三类对象，默认行为 |
| `-i, --id ID` | 查看指定资源 ID 详情；需配资源类型 |
| `-c, --creator` | creator/owner 身份 |
| `-l, --limits` | 当前 Namespace 限制 |
| `-p, --pid` | creator/last-operation PID |
| `-t, --time` | 最近操作时间 |
| `-u, --summary` | 使用量摘要 |
| `-b, --bytes` | 以 bytes 显示大小 |
| `--human` | 人类可读单位 |
| `--numeric-perms` | 八进制权限 |
| `-h, --help`、`-V, --version` | 帮助与版本 |

```bash
ipcs -m -p -t
ipcs -q -u
ipcs -s -l
ipcs -m -i 32768
```

## 2. 关键字段

| 字段 | 解释 |
|---|---|
| `key` | `ftok` 等生成的查找键；`0x00000000` 常表示 IPC_PRIVATE |
| `shmid/msqid/semid` | 内核对象 ID，生命周期内可能复用 |
| `owner/perms` | 当前 owner 与低 9 位访问权限 |
| `bytes/nattch` | 共享段大小与当前 attach 数 |
| `cpid/lpid` | 创建者与最近操作者 PID；要按同一 PID Namespace 解读 |
| `dest` | 已标记删除，等待最后 detach 后回收 |

## 3. 容器与泄漏排障

```bash
readlink /proc/$pid/ns/ipc
sudo nsenter -t "$pid" -i -- ipcs -a
grep -E 'shm|msg|sem' /proc/sys/kernel/* 2>/dev/null
```

共享内存耗尽时先按 Namespace 固定对象，比较限制、段大小、attach 数与创建/最后操作 PID。不要看到旧对象就立刻 `ipcrm`；仍被数据库、浏览器或推理进程使用的对象会造成数据损坏或服务中断。

## 4. 常见误区与验收

- `df /dev/shm` 与 `ipcs -m` 不等价：前者常是 tmpfs/POSIX shm，后者是 SysV shm。
- 宿主 `ipcs` 看不到某 Pod：先进入目标 IPC Namespace。
- ID 存在但 PID 不存在：PID 可能属于另一 Namespace，或创建者已退出但对象仍持久。
- 资源限制是 Namespace 化的内核参数，容器看到的值需与其创建方式一起解释。

掌握标准：能区分 SysV/POSIX IPC，能在正确 Namespace 关联 IPC ID、进程和限制，并在删除前证明对象已无人使用。

## 5. 官方参考

- [util-linux：ipcs(1)](https://man7.org/linux/man-pages/man1/ipcs.1.html)
- [Linux：sysvipc(7)](https://man7.org/linux/man-pages/man7/sysvipc.7.html)

下一篇：[systemd-cgls 命令详解](./11-systemd-cgls命令详解.md)。
