---
title: chroot 命令详解：切换根目录、身份与隔离误区
sidebar_position: 7
description: 讲清 GNU chroot 的用户组参数、命令查找、动态库、设备与 proc 挂载、逃逸边界和修复环境实践。
tags: [Linux, chroot, rootfs, 容器, coreutils]
---

# `chroot` 命令详解：切换根目录，但不是安全沙箱

`chroot` 调用 `chroot(2)` 后把进程的路径解析根切到 `NEWROOT`，再执行命令。它不会自动创建 mount/PID/network/user Namespace，不限制 capability，也不会自动挂载 `/proc`、`/sys`、`/dev`；拥有足够权限的进程可能逃出，因此不能独立作为不可信代码沙箱。

## 1. 语法与 GNU 参数

```text
chroot [OPTION] NEWROOT [COMMAND [ARG]...]
chroot OPTION
```

| 参数 | 含义 |
|---|---|
| `--groups=G_LIST` | 逗号分隔补充组 |
| `--userspec=USER[:GROUP]` | 进入后以用户/组执行 |
| `--skip-chdir` | 不切到新 `/`；仅当 NEWROOT 是旧 `/` 时允许 |
| `--help`、`--version` | 帮助与版本 |

未给 `COMMAND` 时运行 `${SHELL:-/bin/sh} -i`。程序路径在切根后解析，因此 `NEWROOT/bin/sh`、动态加载器和依赖库必须存在。

## 2. 建立可解释的修复环境

```bash
findmnt /mnt/root
file /mnt/root/bin/sh
ldd /mnt/root/bin/sh
sudo mount --rbind /dev  /mnt/root/dev
sudo mount --make-rslave /mnt/root/dev
sudo mount -t proc proc /mnt/root/proc
sudo mount --rbind /sys  /mnt/root/sys
sudo chroot /mnt/root /bin/sh
```

退出后按相反顺序卸载。使用 `--rbind` 后立即把传播改为 `rslave`，避免 chroot 内卸载向宿主传播。DNS 还可能需要受控提供 `resolv.conf`；不要覆盖目标系统原配置而不留备份。

## 3. 身份与 Namespace 边界

```bash
sudo chroot --userspec=65534:65534 --groups=65534 /srv/rootfs /usr/bin/id
```

降权减少风险，但根目录中的设备节点、宿主共享 mount、开放文件描述符、capability 和 LSM context 仍要单独检查。真正的容器隔离至少还涉及 user/mount/PID/network Namespace、cgroup、capability bounding、seccomp 和 LSM。

## 4. 常见错误

| 错误 | 检查 |
|---|---|
| `No such file or directory` 但程序存在 | ELF interpreter 或共享库是否缺失；用 `readelf -l`/`ldd` 核对 |
| `/proc` 为空 | 是否在目标 root 挂载独立 procfs |
| DNS 失败 | resolver 配置、网络 Namespace 与 NSS 库 |
| 设备操作影响宿主 | `/dev` 是否与宿主共享、能力是否过大 |
| 退出后目录无法卸载 | 是否仍有进程/cwd/递归 bind mount 占用 |

## 5. 安全等级与验收

`chroot` 本身是 `[W]`；配合宿主设备和可写 bind mount 可达到 `[D]`。验收标准：能解释“路径视图”和“安全隔离”的差别，能为离线系统修复准备并完整清理 mount，能通过程序解释器而非复制猜测定位 ENOENT。

## 6. 官方参考

- [GNU Coreutils：chroot invocation](https://www.gnu.org/software/coreutils/manual/html_node/chroot-invocation.html)
- [Linux：chroot(2)](https://man7.org/linux/man-pages/man2/chroot.2.html)

下一篇：[pivot_root 命令详解](./08-pivot_root命令详解.md)。
