---
title: "unshare 命令详解：创建 Namespace、UID 映射与最小容器实验"
sidebar_label: "03. unshare 命令详解：创建 Namespace、UID 映射与最小容器实验"
sidebar_position: 3
description: "完整讲解 unshare 的 namespace、fork、proc、root、propagation、UID/GID 映射、time offset、信号和持久化参数及安全边界。"
tags: [Linux, unshare, Namespace, user namespace, 容器原理]
---

# unshare 命令详解：创建 Namespace、UID 映射与最小容器实验

`unshare` 为调用路径创建一个或多个新 namespace 后执行程序。它适合学习和构建受控沙箱原型，但 namespace 本身不提供完整安全隔离：仍需 rootfs、capability、LSM、seccomp、cgroup 和文件描述符治理。

## 1. 创建 namespace 的全部参数

| 参数 | 对象 |
|---|---|
| `-m, --mount[=FILE]` | mount namespace；FILE 将 namespace bind mount 持久化 |
| `-u, --uts[=FILE]` | UTS namespace |
| `-i, --ipc[=FILE]` | IPC namespace |
| `-n, --net[=FILE]` | network namespace |
| `-p, --pid[=FILE]` | PID namespace；持久化需要 `--fork` |
| `-U, --user[=FILE]` | user namespace |
| `-C, --cgroup[=FILE]` | cgroup namespace，只虚拟化视图，不创建资源限制 |
| `-T, --time[=FILE]` | time namespace |

FILE 所在 mount 不能是 shared propagation，否则持久 bind mount 可能失败。

## 2. 进程、根和挂载参数

| 参数 | 含义 |
|---|---|
| `-f, --fork` | fork 子进程运行程序；PID namespace 基本必需 |
| `--forward-signals` | 父 unshare 向 child 转发 SIGINT/SIGTERM，隐含 fork |
| `--kill-child[=SIGNAL]` | unshare 父退出时杀 child；隐含 fork，可配合 PDEATHSIG |
| `--mount-proc[=DIR]` | 在新 mount namespace 挂 procfs，默认 `/proc`；隐含 mount |
| `--mount-binfmt[=DIR]` | 挂载私有 binfmt_misc |
| `-R, --root DIR` | 执行前改变 root directory |
| `-w, --wd DIR` | 改变工作目录 |
| `--propagation private|shared|slave|unchanged` | 设置新 mount namespace 的递归传播；默认 private |
| `--keep-caps` | 创建 user namespace 后保留 capability |
| `--setuid UID`、`--setgid GID` | 映射建立后切换身份 |

## 3. UID/GID 映射全部参数族

| 参数 | 含义 |
|---|---|
| `-r, --map-root-user` | 当前 euid/egid 映射为内部 0；隐含 user 与 deny setgroups |
| `-c, --map-current-user` | 当前 ID 映射为内部同值 |
| `--map-user UID|NAME`、`--map-group GID|NAME` | 把当前 effective ID 映射为指定内部 ID |
| `--map-users INNER:OUTER:COUNT|auto|subids|all` | 可重复 UID range 映射；新版顺序为 inside:outside:count |
| `--map-groups INNER:OUTER:COUNT|auto|subids|all` | 可重复 GID range 映射 |
| `--map-auto` | UID/GID 都用首个 subid block 映射到从内部 0 开始 |
| `--map-subids` | UID/GID 首个 subid block identity map |
| `--setgroups allow|deny` | 写 gid_map 前控制 setgroups；非特权通常必须 deny |
| `--owner UID:GID` | 设置新 user namespace owner |

2.39 以前 `--map-users/groups` 旧逗号顺序不同。脚本先检测版本，绝不能交换 inside/outside 后直接用于生产。

## 4. time namespace 与其他参数

| 参数 | 含义 |
|---|---|
| `--monotonic OFFSET` | 设置 CLOCK_MONOTONIC offset |
| `--boottime OFFSET` | 设置 CLOCK_BOOTTIME offset |
| `--keep-caps` | user namespace 身份变化时保留能力 |
| `-h, --help`、`-V, --version` | 帮助与版本 |

time namespace 不隔离 realtime wall clock；offset 单位/格式以本机帮助为准。

## 5. 正确的 PID+proc 实验

```bash
sudo unshare --fork --pid --mount-proc --uts --mount \
  sh -c 'echo $$; hostname demo; ps -ef; sleep 60'
```

`--pid` 只改变后代 PID 映射；`--fork` 让 child 成为内部 PID 1；`--mount-proc` 避免仍看到外层 PID 的 procfs。PID 1 必须回收 child，并正确处理停止信号，真实容器 runtime 会提供 init/reaper 方案。

## 6. rootless user+mount 实验

```bash
unshare --user --map-root-user --mount --uts --fork sh
id
cat /proc/self/uid_map
cat /proc/self/gid_map
```

内部 root 不能修改宿主网络、模块或任意 mount。能否创建非特权 user namespace还受 sysctl、LSM、发行版和容器 runtime 策略控制。

## 7. mount propagation 风险

util-linux 默认在新 mount namespace 把 `/` 递归 private，避免 mount/unmount 传播回宿主。使用 `--propagation unchanged/shared` 前必须读取：

```bash
findmnt -o TARGET,PROPAGATION /
cat /proc/self/mountinfo
```

错误传播设置会把测试挂载泄漏到宿主或使持久 namespace 失败。

## 8. 这不是安全沙箱

namespace 不关闭网络、不清理环境/FD、不限制资源、不自动 drop capability、不设置 seccomp，也不保证 rootfs 只读。不要运行不可信代码，除非再建立完整安全边界并经过威胁建模。

## 9. 官方参考

- [util-linux：unshare(1)](https://man7.org/linux/man-pages/man1/unshare.1.html)
- [Linux user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)

下一篇：[newuidmap 命令详解](./04-newuidmap命令详解.md)。
