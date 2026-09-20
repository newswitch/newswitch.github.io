---
title: "Namespace 对象、clone 与 nsfs：进程为什么能看见不同的系统"
sidebar_label: "01. Namespace 对象、clone 与 nsfs"
sidebar_position: 1
description: "理解 task_struct 的 Namespace 引用、clone/unshare/setns、nsfs inode 和 Namespace 生命周期。"
tags: [Linux, Namespace, clone, setns, nsfs]
---

# Namespace 对象、clone 与 nsfs：进程为什么能看见不同的系统

Namespace 让一组进程引用不同的内核视图对象。它不是虚拟机，也不复制一套内核；系统调用仍由同一个宿主内核处理，只是在查找 PID、挂载、网络对象等时使用调用进程所属 Namespace。

## 1. 关联关系

```text
task_struct
├─ nsproxy → mnt / uts / ipc / pid-for-children / cgroup / time
├─ cred → user namespace 与身份
└─ mm / files / fs / signal 等可按 clone flag 共享或复制
```

并非所有 Namespace 都以完全相同字段挂在 `nsproxy`，PID 和 User Namespace 还具有父子层级及特殊规则。

## 2. 三个操作

| 接口 | 作用 |
|---|---|
| `clone` / `clone3` | 创建任务，并按 flag 创建/加入共享对象 |
| `unshare` | 让当前任务脱离某些共享上下文并获得新 Namespace |
| `setns` | 通过 Namespace 文件描述符加入已有 Namespace |

加入 Namespace 通常需要相应 User Namespace 中的 capability；不同类型还有单线程、父子关系等额外限制。

## 3. nsfs 与生命周期

```bash
readlink /proc/<PID>/ns/*
lsns
stat -Lc '%n %i' /proc/<PID>/ns/net
```

`net:[402653xxxx]` 中数字可用于同机比较 nsfs inode 标识，但不是跨重启全局 ID。只要还有进程、打开的 Namespace FD 或 bind mount 引用，对象就可继续存在；最后引用消失后才销毁。

```bash
mount --bind /proc/<PID>/ns/net /run/netns/saved
```

持久引用能保留 Namespace，却不会自动保留其中所有外部资源和业务进程。

## 4. Namespace 不等于安全

Namespace 改变名字解析和可见范围，但是否能操作对象仍由 credential、capability、LSM、seccomp 和具体子系统检查。共享宿主内核也意味着内核漏洞可能跨越容器边界。

## 5. 现场对比

```bash
for n in mnt pid net ipc uts user cgroup time; do
  printf '%-8s ' "$n"
  readlink "/proc/<PID>/ns/$n" 2>/dev/null || true
done
cat /proc/<PID>/status | grep -E 'NSpid|NStgid'
```

排查时要明确命令在哪个 PID/Mount/Network Namespace 执行。容器内 `ps`、`mount` 和 `ip addr` 看到的不是宿主机全局事实。

## 6. 练习与答案

**问题：两个进程 `/proc/PID/ns/net` inode 相同，能否说明所有网络配置相同？**

答案：说明它们引用同一个 Network Namespace；但 socket 权限、cgroup/BPF、进程身份和时间点仍可能不同。

**问题：Namespace 中最后一个业务进程退出，对象一定立刻销毁吗？**

答案：不一定。打开 FD、bind mount 或其他内核引用可继续保持它。

下一篇：[PID Namespace、PID 1 与信号语义](./02-PID-Namespace-PID1与信号语义.md)
