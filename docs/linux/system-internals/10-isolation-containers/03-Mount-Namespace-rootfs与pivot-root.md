---
title: "Mount Namespace、rootfs 与 pivotroot：容器文件系统怎样组装"
sidebar_label: "03. Mount Namespace、rootfs 与 pivotroot"
sidebar_position: 3
description: "解释挂载树、传播属性、OverlayFS、bind mount、pivot_root 和容器文件可见性。"
tags: [Linux, Mount Namespace, rootfs, OverlayFS, pivot_root]
---

# Mount Namespace、rootfs 与 pivotroot：容器文件系统怎样组装

容器镜像不是一块独立磁盘。运行时把镜像层、可写层、volume、`/proc`、`/sys`、设备节点和配置文件组装成挂载树，再让进程把其中某个目录视为 `/`。

## 1. 典型路径

```text
解包/挂载镜像只读层
→ OverlayFS 合并 lowerdir + upperdir + workdir
→ 创建 Mount Namespace
→ bind mount volumes、secret、resolv.conf 等
→ 设置 private/slave 等传播属性
→ pivot_root 或等价切换根目录
→ 挂载 proc/sysfs/devpts 并应用只读、nosuid、nodev、noexec
→ exec 容器进程
```

## 2. `chroot` 与 `pivot_root`

`chroot` 改变路径解析根，但不创建 Namespace、不限制已打开 FD，也不是安全沙箱。`pivot_root` 在新的 Mount Namespace 中交换新旧根，运行时随后卸载旧根，形成更干净的挂载视图。

## 3. OverlayFS 语义

读取先查 upper 再查 lower；第一次修改 lower 文件时可能发生 copy-up。删除 lower 文件可用 whiteout 隐藏。其 inode、rename、hardlink、xattr 和 page cache 行为不能简单等同单一 ext4/XFS。

容器层增长可能来自日志、临时文件和 copy-up；不能只看应用写入量推断实际空间放大。

## 4. 挂载传播

| 属性 | 新子挂载传播方向 |
|---|---|
| shared | 双向传播到 peer group |
| slave | 接收 master，通常不反向传播 |
| private | 不传播 |
| unbindable | private 且不能 bind clone |

Kubernetes 某些 CSI/宿主机挂载需要传播，但错误的 shared 配置也可能把容器挂载泄漏到宿主。

```bash
findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION
cat /proc/<PID>/mountinfo
nsenter -t <PID> -m -- findmnt
```

`mountinfo` 的 mount ID、parent ID、root、mount point 和 optional fields 能区分同一 superblock 的不同 bind view。

## 5. 删除文件为何空间不释放

容器日志文件即使在容器视图删除，宿主上的进程 FD 仍可能打开同一 inode。应同时检查目标 Mount Namespace 和宿主 `/proc/<PID>/fd`，不要只在容器里 `du`。

## 6. 练习与答案

**问题：容器里修改 `/etc/hosts` 一定写入镜像 upperdir 吗？**

答案：不一定。运行时通常把该文件单独 bind mount 进容器，来源可能由运行时管理。

**问题：容器内重新挂载为 rw 能否绕过宿主只读 bind mount？**

答案：取决于权限、User/Mount Namespace、传播和内核检查；无相应 capability 通常不能任意 remount，且底层 superblock/挂载属性仍约束。

下一篇：[User Namespace、UID/GID 映射与 Rootless](./04-User-Namespace-ID映射与Rootless.md)
