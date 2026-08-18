---
title: "pivotroot 命令详解：容器 Mount Namespace 的根文件系统切换"
sidebar_label: "08. pivotroot 命令详解：容器 Mount Namespace 的根文件系统切换"
sidebar_position: 8
description: "讲清 pivot_root 的 new_root、put_old、mount propagation、chdir、旧根卸载与容器初始化安全边界。"
tags: [Linux, pivot_root, Mount Namespace, rootfs, 容器]
---

# pivotroot 命令详解：容器 Mount Namespace 的根文件系统切换

`pivot_root NEW_ROOT PUT_OLD` 调用同名系统调用，把调用进程所在 Mount Namespace 的根挂载切换为 `NEW_ROOT`，并把旧根移动到新根下的 `PUT_OLD`。它改变的是挂载树，不是简单的路径前缀，因此是容器 runtime 常用原语；手工执行错误可能移动宿主挂载树。

## 1. 语法与前置条件

```text
pivot_root NEW_ROOT PUT_OLD
pivot_root --help
pivot_root --version
```

util-linux 实现只有帮助和版本选项。成功需要 `CAP_SYS_ADMIN`，并满足：

- `NEW_ROOT` 是目录且位于一个挂载点上；可先 bind mount 自身；
- `PUT_OLD` 位于 `NEW_ROOT` 之下；
- 当前根、`NEW_ROOT` 的父挂载不能是 shared propagation；
- 调用进程的 root/cwd 需要在切换后显式调整；
- 不能在初始 rootfs 上直接 pivot，通常先进入新的 mount Namespace。

## 2. 一次性实验流程

只在 disposable VM 中实验：

```bash
sudo unshare --user --map-root-user --mount --pid --fork /bin/sh
mount --make-rprivate /
mount --bind /srv/rootfs /srv/rootfs
mkdir -p /srv/rootfs/.oldroot
cd /srv/rootfs
pivot_root . .oldroot
exec chroot . /bin/sh
```

切换后应在新 root 中 `chdir /`，为 `/proc` 等伪文件系统准备匹配视图，最后执行 `umount -l /.oldroot` 并删除入口。上例用于理解步骤，不是生产容器实现；真正 runtime 还要关闭旧根 FD、降 capability、应用 LSM/seccomp 和 cgroup。

## 3. 为什么要先处理传播

如果父挂载是 shared，pivot 或后续卸载可能传播到同一 peer group。进入独立 mount Namespace 后先检查：

```bash
findmnt -o TARGET,PROPAGATION /
grep ' shared:' /proc/self/mountinfo
mount --make-rprivate /
```

不要在宿主初始 mount Namespace 里照抄实验。`--make-rprivate /` 是对当前 Namespace 挂载传播属性的变更，仍要先证明自己确实在隔离视图中。

## 4. 常见错误与验证

| 错误 | 根因方向 |
|---|---|
| `Invalid argument` | NEW_ROOT 不是挂载点、PUT_OLD 不在其下、shared propagation |
| `Device or resource busy` | 挂载关系或进程 cwd/root/FD 仍引用旧根 |
| 切换后仍能访问宿主 | 旧根未卸载、bind mount/FD 泄漏、权限未收缩 |
| `ps` 视图错误 | 没有同时创建 PID Namespace 和重新挂载 procfs |

```bash
findmnt -R /
cat /proc/self/mountinfo
readlink /proc/self/root
```

掌握标准：能画出切换前后挂载树，解释旧根为何必须移走并卸载，以及 mount propagation、Namespace 和 capability 各自负责什么。

## 5. 官方参考

- [util-linux：pivot_root(8)](https://man7.org/linux/man-pages/man8/pivot_root.8.html)
- [Linux：pivot_root(2)](https://man7.org/linux/man-pages/man2/pivot_root.2.html)

下一篇：[switch_root 命令详解](./09-switch_root命令详解.md)。
