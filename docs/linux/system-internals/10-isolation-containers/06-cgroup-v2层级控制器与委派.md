---
title: "cgroup v2 层级、控制器与委派：资源治理为什么是一棵树"
sidebar_label: "06. cgroup v2 层级、控制器与委派"
sidebar_position: 6
description: "解释统一层级、domain/threaded cgroup、subtree_control、no internal process 和 systemd 委派。"
tags: [Linux, cgroup v2, systemd, Delegation, Controller]
---

# cgroup v2 层级、控制器与委派：资源治理为什么是一棵树

cgroup 把任务组织为层级，并让各资源控制器在层级中记账、分配或限制。v2 使用统一层级，使 CPU、内存、IO 等控制器看到一致的任务组织。

## 1. 关键文件

| 文件 | 含义 |
|---|---|
| `cgroup.procs` | 该 cgroup 的进程成员 |
| `cgroup.threads` | threaded 模式下线程成员 |
| `cgroup.controllers` | 当前可向子树启用的控制器 |
| `cgroup.subtree_control` | 父节点为直接子节点启用的控制器 |
| `cgroup.events` | populated、frozen 等状态 |
| `cgroup.type` | domain、threaded 等类型 |

控制器参数出现在子节点，是因为父节点把资源分配规则应用给孩子；启用位置与限制位置不能混淆。

## 2. No Internal Process

对 domain controller，非根节点若要把控制器分发给子 cgroup，通常不能同时留有普通进程。这保证父节点作为资源分配边界，工作负载放在叶子或独立 child。

## 3. systemd 管理

systemd 把 service、scope、slice 映射为 cgroup。手工在 `/sys/fs/cgroup` 建目录可能与 PID 1 的生命周期管理冲突；服务资源策略优先用 unit 属性或获得显式 `Delegate=yes` 的子树。

```bash
systemd-cgls
systemctl show <unit> -p ControlGroup -p Delegate
cat /proc/<PID>/cgroup
```

## 4. 委派不是 chmod 一个目录

安全委派需要控制可写文件、祖先控制器、进程迁移和身份边界。委派者不能允许下级把不属于自己的进程拉入，或修改影响兄弟节点的参数。systemd 提供受约束的委派契约。

## 5. Namespace 与 cgroup

cgroup Namespace 改变路径视图，Mount Namespace 决定挂载可见性，User Namespace/capability 决定写权限，实际层级和控制器仍是宿主内核对象。

## 6. 练习与答案

**问题：`cgroup.controllers` 有 `cpu`，为什么当前目录没有 `cpu.max`？**

答案：该文件表示可向子树启用的控制器；当前节点是否出现控制文件还与父级 `cgroup.subtree_control`、cgroup 类型和层级状态有关。

**问题：把 PID 写入新 cgroup 后，子线程是否都移动？**

答案：写 `cgroup.procs` 按进程迁移，线程化 cgroup 和 `cgroup.threads` 规则不同；应按 v2 线程模式约束操作。

下一篇：[CPU、内存、IO 与 PID 资源控制](./07-cgroup资源控制与压力.md)
