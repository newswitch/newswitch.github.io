---
title: "Network、UTS、IPC、Time 与 cgroup Namespace：各自隔离了什么"
sidebar_label: "05. 其他 Namespace 及其边界"
sidebar_position: 5
description: "系统解释 Network、UTS、IPC、Time、cgroup Namespace 的对象、共享边界和常见误区。"
tags: [Linux, Network Namespace, IPC Namespace, Time Namespace, cgroup Namespace]
---

# Network、UTS、IPC、Time 与 cgroup Namespace：各自隔离了什么

不同 Namespace 隔离不同全局资源。容器可以共享其中一部分、隔离另一部分；“在同一个 Pod”也不代表所有容器的每种 Namespace 都相同。

## 1. 对照表

| Namespace | 主要隔离对象 | 不负责的内容 |
|---|---|---|
| Network | 网卡、地址、路由、邻居、端口、netfilter、Socket 视图 | 物理 NIC 本身、cgroup 带宽策略 |
| UTS | hostname、domainname | DNS 解析配置、时区 |
| IPC | SysV IPC、POSIX message queue | Unix socket 文件所在挂载树 |
| Time | boot/monotonic 等 offset | realtime 的任意独立设置、硬件时钟 |
| cgroup | `/proc/PID/cgroup` 路径视图 | 实际资源限制与计费 |

## 2. Network Namespace

一个网络设备在同一时刻属于一个 NetNS（少数设备/控制面有特殊性）。veth pair 两端可位于不同 NetNS，包从一端发送会在另一端接收。

```bash
nsenter -t <PID> -n -- ip -d link
nsenter -t <PID> -n -- ip route
nsenter -t <PID> -n -- ss -lntup
```

监听 `0.0.0.0:80` 只占用该 NetNS 的端口空间。hostNetwork Pod 与宿主共享 NetNS，端口和路由影响完全不同。

## 3. UTS 与 DNS

修改 hostname 属于 UTS；`/etc/resolv.conf` 是挂载进来的普通文件。两者常同时由容器运行时设置，但内核机制无直接绑定。

## 4. IPC

共享 IPC Namespace 的容器可看见同一 SysV shared memory/semaphore/message queue 和 POSIX mqueue。`/dev/shm` 则还涉及 tmpfs 挂载和容量，既有 IPC/内存语义又有 Mount Namespace 配置。

## 5. Time Namespace

Time Namespace 为部分时钟维护 offset，允许 checkpoint/restore 等场景调整容器看到的运行时间。它不创建独立时钟硬件，也不能让每个容器随意设置全局 wall clock。

## 6. cgroup Namespace

它把进程看到的 cgroup 路径根相对化，避免暴露宿主完整层级，但资源控制仍由真实 cgroup 对象执行。不能因为容器中路径显示 `/` 就认为进程未受限制。

## 7. 练习与答案

**问题：两个容器共享 Network Namespace，是否也自动共享 `/etc/hosts`？**

答案：不自动。`/etc/hosts` 属于各自 Mount Namespace 视图，运行时可以配置相同或不同来源。

**问题：cgroup Namespace 能否给进程增加 CPU 配额？**

答案：不能。它改变路径可见性；配额由 cgroup 控制器和委派权限决定。

下一篇：[cgroup v2 层级、控制器与委派](./06-cgroup-v2层级控制器与委派.md)
