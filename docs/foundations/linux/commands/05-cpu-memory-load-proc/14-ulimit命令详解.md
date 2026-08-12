---
title: ulimit 命令详解：Bash 资源限制、soft/hard 与继承
sidebar_position: 14
description: 完整讲解 Bash 5.3 ulimit 的全部选项、单位、soft/hard limit、Shell 进程继承、nofile/nproc/core/stack 和 systemd/容器边界。
tags: [Linux, Bash, ulimit, RLIMIT, nofile, 资源限制]
---

# `ulimit` 命令详解：Bash 资源限制、soft/hard 与继承

`ulimit` 是 Bash builtin，它查询或修改当前 Shell 的 resource limits；之后启动的子进程继承这些限制。它不能直接修改已运行的兄弟进程，也不会自动持久化到 systemd 服务。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | GNU Bash 5.3 builtin 基线；其他 Shell 选项不同 |
| 内核接口 | `getrlimit/setrlimit` |
| 安全级别 | 查询 `[R]`；修改当前 Shell 及后代 `[W/D]` |

```text
ulimit [-HS] -a
ulimit [-HS] [-bcdefiklmnpqrstuvxPRT] [limit]
```

```bash
type -a ulimit
help ulimit
printf '%s\n' "$BASH_VERSION"
```

没有单独的外部 `ulimit` 能回头改变父 Shell；即使某系统有同名程序，其影响范围也不同。

## 2. soft/hard 与设置规则

| 参数 | 含义 |
|---|---|
| `-S` | 查询/设置 soft limit |
| `-H` | 查询/设置 hard limit |
| 均不写（查询） | 查询 soft |
| 均不写（设置） | Bash 同时设置 soft 与 hard，风险较高 |

特殊 limit 值：`soft`、`hard`、`unlimited`。普通用户可把 soft 提高到 hard，但降低 hard 后通常无法在当前会话提高回来；安全操作显式写 `-S`。

## 3. 全部资源选项

| 选项 | 资源 | Bash 默认单位/说明 |
|---|---|---|
| `-a` | 全部 | 只报告，不设置 |
| `-b` | socket buffer | 未缩放数，平台可能不支持 |
| `-c` | core file | 1024-byte blocks；POSIX mode 为 512-byte blocks |
| `-d` | data segment | KiB |
| `-e` | nice priority | 未缩放 |
| `-f` | file size | 1024-byte blocks；POSIX mode 为 512-byte blocks；无选项默认它 |
| `-i` | pending signals | 数量 |
| `-k` | kqueues | 数量，Linux 通常不适用 |
| `-l` | locked memory | KiB |
| `-m` | resident set | KiB；很多系统不执行该限制 |
| `-n` | open file descriptors | 数量 |
| `-p` | pipe buffer | 512-byte blocks |
| `-q` | POSIX message queue | Bash 数值按 1024-byte increments；内核资源本身表示 queue bytes |
| `-r` | realtime priority | 未缩放 |
| `-s` | stack | KiB |
| `-t` | CPU time | seconds |
| `-u` | processes/tasks per real UID | 数量 |
| `-v` | virtual memory/address space | KiB |
| `-x` | file locks | 数量 |
| `-P` | pseudoterminals | 数量 |
| `-R` | realtime nonblocking CPU time | microseconds |
| `-T` | threads | 数量，平台/内核可能不提供独立 RLIMIT |

选项存在不表示目标 Linux 内核实际执行该 limit。`help ulimit` 显示当前 Bash 构建能力；用 `prlimit`/`/proc/PID/limits` 核对内核映射。

## 4. 查询示例

```bash
ulimit -Sa
ulimit -Ha
ulimit -Sn
ulimit -Hn
prlimit --pid $$
```

报告中的 `unlimited` 是 `RLIM_INFINITY`，不代表没有其他约束；`fs.nr_open`、`fs.file-max`、cgroup、systemd、PAM、权限和应用自身仍可形成上限。

## 5. 安全设置与继承

```bash
# 用子 Shell 实验，退出后自动恢复父 Shell
(
  ulimit -Sn 256 || exit 1
  ulimit -Sc 0 || exit 1
  exec ./lab-server
)
```

Shell builtin 修改当前进程限制，随后 fork/exec 的后代继承；在 subshell 中设置可限制影响范围。不要在登录 Shell 不经记录降低 hard limit。

## 6. `nofile` 故障排查

```bash
ulimit -Sn; ulimit -Hn
prlimit --pid "$pid" --nofile
ls -1 "/proc/$pid/fd" 2>/dev/null | wc -l
sysctl fs.nr_open fs.file-max
```

`Too many open files`/`EMFILE` 要结合当前 fd 数、增长趋势、连接关闭、文件泄漏与应用使用的 IO API。仅提高阈值会推迟而非修复泄漏；`select(2)` 还可能有 `FD_SETSIZE` 约束。

## 7. core、stack、CPU 与 NPROC

- `ulimit -Sc 0` 禁止后代生成传统 core，但 systemd-coredump、容器和 kernel core_pattern 还影响实际处理。
- stack 过低会导致深递归/线程栈问题；过高的默认线程 stack 也可能增加虚拟地址保留。
- CPU soft limit 到达通常发送 `SIGXCPU`，继续运行可能到 hard limit 被 `SIGKILL`；它计 CPU time，不是墙钟 deadline。
- NPROC 在 Linux 常对 real UID 的 tasks 计数，不是“单进程最多线程数”；root/能力存在例外，容器总 PID 用 cgroup `pids.max`。

## 8. systemd、PAM、容器与 SSH

登录会话可能由 PAM limits 初始化，systemd 服务用 `LimitNOFILE=` 等，OCI runtime 通过 rlimits 配置。你 SSH 登录后执行 `ulimit` 看到的是当前 Shell 继承链，不代表某 systemd 服务。

```text
PAM/login/sshd → interactive Shell → 子命令
systemd manager → unit Limit*= → service
container runtime → OCI rlimits → container init → workload
```

服务变更应写入正确声明源并受控重启验证，不能把 `.bashrc` 当服务配置。

## 9. 常见误判、退出状态与实验

| 误判 | 修正 |
|---|---|
| `ulimit -n 65535` 只改 soft | 未写 `-S` 时 Bash 会同时尝试 soft/hard |
| `.bashrc` 能影响 systemd 服务 | 两条继承链不同 |
| unlimited 没有上限 | 仍有 sysctl/cgroup/内核/应用限制 |
| `-u` 是每进程线程数 | Linux 常按 real UID tasks 计数 |
| `-m` 能可靠限制内存 | Linux 通常不执行 RLIMIT_RSS，使用 cgroup |

成功为 `0`；无效选项、值、soft>hard、权限或 setrlimit 失败为非 `0`。实验：在 subshell 比较父子继承；触发低 nofile/fsize/cpu/core；比较登录 Shell、systemd transient service 与容器。

掌握标准：能列出全部 Bash 选项与单位，解释 soft/hard/继承，定位实际配置源，并区分 RLIMIT 与 sysctl/cgroup。

## 官方参考

- [GNU Bash 5.3：ulimit](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html#index-ulimit)
- [Linux getrlimit(2)](https://man7.org/linux/man-pages/man2/getrlimit.2.html)
- [PAM limits.conf(5)](https://man7.org/linux/man-pages/man5/limits.conf.5.html)

上一篇：[`prlimit` 命令详解](./13-prlimit命令详解.md)

下一篇：[`sysctl` 命令详解](./15-sysctl命令详解.md)
