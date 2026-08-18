---
title: "cgroup v2 原生文件接口：控制器、限制、事件与 PSI 实战"
sidebar_label: "15. cgroup v2 原生文件接口：控制器、限制、事件与 PSI 实战"
sidebar_position: 15
description: "用 cgroupfs 文件完整讲解 v2 委派、subtree_control、cpu.max、memory.max/events、io.max/stat、pids 与 PSI。"
tags: [Linux, cgroup v2, PSI, CPU, 内存]
---

# cgroup v2 原生文件接口：控制器、限制、事件与 PSI 实战

cgroup v2 的稳定管理接口是文件系统：目录代表资源域，控制文件代表配置、计数器、事件和压力。本篇不是某个可执行命令的参数页，而是为 `systemd-cgtop`、libcgroup 和 Kubernetes 排障提供底层读法。

## 1. 从父级委派控制器

```bash
cat /sys/fs/cgroup/cgroup.controllers
cat /sys/fs/cgroup/cgroup.subtree_control
cat /sys/fs/cgroup/cgroup.procs
```

父级只能把自己可用的 controller 写入 `cgroup.subtree_control`，子级才会出现对应接口。domain controller 遵守 no-internal-process：启用 controller 的内部节点不能同时承载普通进程。systemd 主机应通过 `Delegate=yes` 获得可管理子树。

## 2. 四类接口必须分开

| 类别 | 示例 | 回答的问题 |
|---|---|---|
| 配置 | `cpu.max`、`memory.max`、`io.max`、`pids.max` | 允许多少 |
| 当前/累计 | `memory.current`、`cpu.stat`、`io.stat` | 用了多少、累计发生什么 |
| 事件 | `memory.events`、`pids.events`、`cgroup.events` | 是否命中过阈值/OOM/人口变化 |
| 压力 | `cpu.pressure`、`memory.pressure`、`io.pressure` | 任务因资源等待损失了多少时间 |

## 3. 只读排障模板

```bash
cg=/sys/fs/cgroup/PATH
cat "$cg/cgroup.type"
cat "$cg/cgroup.procs"
cat "$cg/cpu.max"; cat "$cg/cpu.stat"; cat "$cg/cpu.pressure"
cat "$cg/memory.current"; cat "$cg/memory.max"; cat "$cg/memory.events"
cat "$cg/io.stat"; cat "$cg/io.pressure"
cat "$cg/pids.current"; cat "$cg/pids.max"; cat "$cg/pids.events"
```

`cpu.max` 是 quota/period，不是 affinity；`memory.high` 通常触发节流回收，`memory.max` 是硬边界；`memory.events.local` 不累计子组；`io.stat` 的 `major:minor` 要用 `lsblk` 映射设备；PSI 的 `some/full` 表示等待时间比例，不等价于利用率。

## 4. 安全修改原则

任何 limit 下调前先保存旧值、观察峰值与事件，明确进程集合和回滚。尤其是：

- `memory.max` 低于工作集可能 OOM；
- `pids.max` 过低会阻断线程/fork，连排障 shell 都可能进不去；
- `io.max` 设备号写错会限错盘；
- 将 PID 写入 `cgroup.procs` 是迁移状态，不是复制。

## 5. 验收与参考

能从一个慢 Pod 判断是 CPU throttling、memory reclaim/OOM、IO pressure 还是 PID limit；能证明限制来自 systemd、Kubernetes QoS 或手工 cgroup，而不是只看一个数。

- [Linux Kernel：Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Linux Kernel：Pressure Stall Information](https://docs.kernel.org/accounting/psi.html)

本分类完成。返回 [Linux 命令参考库](../../00-Linux命令参考库学习路线.md)。
