---
title: "PID Namespace、PID 1 与信号语义：容器主进程为什么特殊"
sidebar_label: "02. PID Namespace、PID 1 与信号"
sidebar_position: 2
description: "解释层级 PID 映射、Namespace init、孤儿收养、信号处理和容器僵尸进程。"
tags: [Linux, PID Namespace, PID 1, Signal, Zombie]
---

# PID Namespace、PID 1 与信号语义：容器主进程为什么特殊

同一个 `task_struct` 可在嵌套 PID Namespace 中拥有不同 PID。容器内看到 PID 1，不代表它是宿主机真正的全局 PID 1。

## 1. 层级映射

```text
宿主 PID Namespace：进程 PID 42731
└─ 容器 PID Namespace：同一进程 PID 1
   └─ 更内层 Namespace：可以有另一映射
```

祖先 Namespace 能看见后代任务并用祖先 PID 操作；子 Namespace 看不到祖先中的其他任务。

```bash
grep -E '^(Pid|PPid|NSpid|NStgid):' /proc/<host-pid>/status
readlink /proc/<host-pid>/ns/pid
readlink /proc/<host-pid>/ns/pid_for_children
```

## 2. Namespace init 的职责

PID 1 是该 Namespace 的 init：

- 收养 Namespace 内孤儿并 `wait` 回收。
- 对某些未显式注册 handler 的信号具有特殊处理语义。
- 它退出时，内核会终止该 PID Namespace 中剩余进程，之后不能再正常创建新任务。

应用直接作为 PID 1 若不回收子进程，可能累积 zombie；若不处理 `SIGTERM`，容器停止会等到超时再 `SIGKILL`。

## 3. PID Namespace 与 `/proc`

仅创建 PID Namespace 不会自动让 `ps` 只看到内部进程。还要在对应 Mount Namespace 重新挂载 procfs，使 procfs 使用正确 PID Namespace 视图。

## 4. 信号链路

```text
容器运行时向宿主 PID 发 SIGTERM
→ 内核进行 PID/权限解析
→ 容器 PID 1 的 handler 执行
→ PID 1 应把信号转发给工作子进程
→ wait/reap 后退出
```

shell 包装脚本若不 `exec` 应用、不转发信号，会造成“Pod 一直 Terminating”。

## 5. 排查

```bash
ps -o pid,ppid,stat,cmd --forest
grep -E 'SigIgn|SigCgt|SigBlk' /proc/<PID>/status
ls -l /proc/<PID>/task/<TID>/children
nsenter -t <host-pid> -p -m -- ps -ef
```

`Z` 进程已释放大部分资源，只保留退出状态等待 parent 回收；杀 zombie 无效，应修复父进程的 wait 逻辑。

## 6. 练习与答案

**问题：容器里 `kill -9 1` 与宿主机 `kill -9 1` 一样吗？**

答案：完全不同。PID 解析发生在调用者的 PID Namespace；容器 PID 1 通常对应宿主机另一个 PID。权限和 Namespace init 规则也不同。

**问题：加一个 tini 类 init 能解决所有停止问题吗？**

答案：它可正确转发信号并回收孤儿，但应用自身优雅退出、preStop、终止宽限期和外部依赖仍需设计。

下一篇：[Mount Namespace、rootfs 与 pivot_root](./03-Mount-Namespace-rootfs与pivot-root.md)
