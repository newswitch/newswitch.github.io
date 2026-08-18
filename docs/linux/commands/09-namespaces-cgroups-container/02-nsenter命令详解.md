---
title: "nsenter 命令详解：安全进入容器 Namespace 与进程现场"
sidebar_label: "02. nsenter 命令详解：安全进入容器 Namespace 与进程现场"
sidebar_position: 2
description: "完整讲解 nsenter 全部参数、目标 PID/inode、八类 namespace、root/cwd/env/cgroup/credentials、PID fork 语义和安全排障流程。"
tags: [Linux, nsenter, Namespace, 容器, 故障排查]
---

# nsenter 命令详解：安全进入容器 Namespace 与进程现场

`nsenter` 对选定 namespace 调用 `setns(2)`，再执行程序。它比“进入容器”更精确：可以只进入 network 做抓包，或进入 mount+PID 读取同一 `/proc`。选择过多会改变 root、身份和资源作用域，应按最小集合进入。

## 1. 语法与 namespace 参数

```text
nsenter [OPTIONS] [PROGRAM [ARG...]]
```

| 参数 | 进入对象 |
|---|---|
| `-a, --all` | 目标进程默认路径中的全部可进入 namespace |
| `-t, --target PID[:INODE]` | 从 `/proc/PID` 取得上下文；inode 可防 PID 重用 |
| `-m, --mount[=FILE|=:NSID]` | mount namespace |
| `-u, --uts[=FILE|=:NSID]` | UTS namespace |
| `-i, --ipc[=FILE|=:NSID]` | IPC namespace |
| `-n, --net[=FILE|=:NSID]` | network namespace |
| `-N, --net-socket FD` | 从 socket FD 取得 network namespace |
| `-p, --pid[=FILE|=:NSID]` | PID namespace |
| `-U, --user[=FILE|=:NSID]` | user namespace |
| `-C, --cgroup[=FILE|=:NSID]` | cgroup namespace |
| `-T, --time[=FILE|=:NSID]` | time namespace |
| `--user-parent[=LEVEL]` | 进入目标 user namespace 的父级，层数依参数 |

无 `PROGRAM` 时按 `$SHELL`、passwd shell、`/bin/sh` 回退。

## 2. 执行上下文全部参数

| 参数 | 含义 |
|---|---|
| `-S, --setuid UID` | 进入后设置 UID；`follow` 跟随目标凭据 |
| `-G, --setgid GID` | 设置 GID；`follow` 跟随目标凭据 |
| `--preserve-credentials` | 进入 user namespace 后不自动切到 UID/GID 0 |
| `--keep-caps` | 改 UID/GID 时尽量保留 capabilities |
| `-r, --root[=DIR]` | 根目录默认跟随 `/proc/PID/root`，或指定路径 |
| `-w, --wd[=DIR]` | cwd 默认跟随 `/proc/PID/cwd`，或指定路径 |
| `-W, --wdns=DIR` | 在目标 mount namespace 中解释工作目录 |
| `-e, --env` | 从目标 `/proc/PID/environ` 导入环境 |
| `-F, --no-fork` | 进入 PID namespace 时不 fork；通常新程序不会获得预期内部 PID 视图 |
| `-Z, --follow-context` | SELinux 构建中跟随目标执行 context |
| `-c, --join-cgroup` | 把新进程加入目标进程 cgroup |
| `-h, --help`、`-V, --version` | 帮助与版本 |

不同 util-linux 版本可能缺少 nsid、PID inode、user-parent 等新接口，以本机 `--help` 为准。

## 3. 最小进入原则

```bash
# 只看目标网络栈
sudo nsenter -t PID -n -- ip addr

# 读取目标 mount 视图和匹配 procfs
sudo nsenter -t PID -m -p --mount-proc -- ps -ef  # 若本版本支持相应组合

# 常见容器 shell
sudo nsenter -t PID -m -u -i -n -p -- /bin/sh
```

进入 `-n` 后，命令使用目标路由/防火墙/socket 视图，但文件和二进制仍来自调用者 mount/root，除非同时选择 `-m/-r`。这正适合在极简容器里借用宿主诊断工具，也意味着工具可能加载宿主配置和证书，结论要注明视角。

## 4. PID namespace 为何默认 fork

`setns` 到 PID namespace 只影响**后代**。nsenter 默认 fork，让 child 真正处于目标 PID mapping；`--no-fork` 直接 exec 时，调用进程自身 PID namespace 身份不会被追溯改变。目标 namespace 的 PID 1 若已退出，则无法正常创建新成员。

## 5. `--all` 不代表完整复制

即使 `--all`，以下仍独立：

- root、cwd、environment 和 umask；
- cgroup membership（除非 `--join-cgroup`）；
- SELinux context、seccomp filter 与 no_new_privs；
- open file descriptors、rlimit 和 session/TTY；
- container runtime metadata。

`--env` 可能读取 secret；`--root`/`--wd` 可遭目标进程改变 symlink 的竞态。生产先确认稳定 PID/inode，避免进入不可信进程上下文后执行高权限 shell。

## 6. 权限与 user namespace

每种 `setns` 都有 owner user namespace 的 capability 检查；mount/network 等常需要相应 `CAP_SYS_ADMIN`。进入 user namespace可能获得其内部 capability，但不会获得宿主初始 user namespace 权限。跟随 credentials、keep-caps 与 SELinux context 的组合必须在测试机验证。

## 7. 标准容器现场流程

```bash
pid=TARGET
ps -o pid,lstart,cgroup,user,comm,args -p "$pid"
lsns -p "$pid"
cat "/proc/$pid/status" | grep -E '^(Uid|Gid|Cap|NoNewPrivs|Seccomp):'
sudo nsenter -t "$pid" -n -- ss -lntup
sudo nsenter -t "$pid" -m -p -- /bin/sh
```

先只读，退出后验证没有遗留 shell/namespace bind mount。进入生产容器进行写操作仍属于生产变更。

## 8. 官方参考

- [util-linux：nsenter(1)](https://man7.org/linux/man-pages/man1/nsenter.1.html)
- [Linux setns(2)](https://man7.org/linux/man-pages/man2/setns.2.html)

下一篇：[unshare 命令详解](./03-unshare命令详解.md)。
