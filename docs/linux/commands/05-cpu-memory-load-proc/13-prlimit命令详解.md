---
title: "prlimit 命令详解：查询修改进程 RLIMIT 与受限启动"
sidebar_label: "13. prlimit 命令详解：查询修改进程 RLIMIT 与受限启动"
sidebar_position: 13
description: "完整讲解 util-linux prlimit 的全部通用与资源参数、soft/hard limit、PID 身份、权限、systemd/容器边界和资源限制故障排查。"
tags: [Linux, prlimit, RLIMIT, nofile, nproc, util-linux]
---

# prlimit 命令详解：查询修改进程 RLIMIT 与受限启动

`prlimit` 读取或修改现有进程的 POSIX/Linux resource limits，也可先设置限制再执行命令。RLIMIT 是进程级继承约束，不等于 cgroup 容量控制。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | util-linux 2.42.2 文档基线 |
| 内核接口 | `prlimit64(2)`、`/proc/PID/limits` |
| 安全级别 | 查询 `[R]`；修改/启动 `[W]`，错误限制可中断服务 `[D]` |

```text
prlimit [options] [--resource[=limits]] [--pid PID[:INODE]]
prlimit [options] [--resource[=limits]] command [arguments ...]
```

## 2. limit 语法与 soft/hard

| 写法 | 效果 |
|---|---|
| 不给 `=limits` | 只查询该资源 |
| `soft:hard` | 同时设置 |
| `soft:` | 只改 soft |
| `:hard` | 只改 hard |
| `value` | soft/hard 都设为 value |
| `-1` 或 `unlimited` | `RLIM_INFINITY` |

soft 是内核实际执行的当前阈值，必须 `soft <= hard`；非特权进程可把 soft 提高到 hard，但通常不能把 hard 提高回来。文章示例优先只改 soft，且仅在测试子进程使用。

## 3. 全部通用参数

| 参数 | 含义 |
|---|---|
| `-p, --pid=PID[:INODE]` | 目标 PID；新版本可附 pidfs inode 加固身份 |
| `-o, --output=LIST` | 指定输出列；`--help` 查看本机列 |
| `--noheadings` | 无表头 |
| `--raw` | raw 输出 |
| `--verbose` | 详细模式 |
| `-h, --help` | 帮助 |
| `-V, --version` | 版本 |

不指定 PID 或 command 时作用于自身/显示当前上下文。PID 可复用；支持 pidfs 的新版可用 `PID:INODE` 绑定身份，旧版没有此能力。

## 4. 全部资源参数

| 参数 | RLIMIT | 含义 |
|---|---|---|
| `-c, --core` | CORE | core file 最大大小 |
| `-d, --data` | DATA | data segment 最大大小 |
| `-e, --nice` | NICE | 可提高调度优先级的上限 |
| `-f, --fsize` | FSIZE | 可创建文件最大大小 |
| `-i, --sigpending` | SIGPENDING | 当前 real UID 的 pending signal 上限 |
| `-l, --memlock` | MEMLOCK | 可锁定地址空间上限 |
| `-m, --rss` | RSS | 最大 RSS；Linux 通常不强制/仅历史语义 |
| `-n, --nofile` | NOFILE | 单进程文件描述符号上限 |
| `-q, --msgqueue` | MSGQUEUE | real UID 的 POSIX MQ bytes 上限 |
| `-r, --rtprio` | RTPRIO | realtime priority 上限 |
| `-s, --stack` | STACK | stack 最大大小 |
| `-t, --cpu` | CPU | CPU 时间秒数，soft 通常触发 SIGXCPU |
| `-u, --nproc` | NPROC | 当前 real UID 的进程/线程计数上限 |
| `-v, --as` | AS | 虚拟地址空间上限 |
| `-x, --locks` | LOCKS | 文件锁数量上限 |
| `-y, --rttime` | RTTIME | realtime task 不阻塞时的 CPU 时间上限 |

某些 limit 在 Linux 不执行或按 UID 而非单进程计数；必须查 `getrlimit(2)` 对应资源语义。

## 5. 查询与稳定输出

```bash
prlimit --pid 1234
prlimit --pid 1234 --nofile --nproc --stack --core
prlimit --pid 1234 --nofile -o RESOURCE,SOFT,HARD,UNITS --noheadings --raw
cat /proc/1234/limits
```

输出列名随 util-linux 版本，以 `prlimit --help` 为准。机器脚本固定列、raw、无表头，并验证 PID 启动时间/身份。

## 6. 受限启动与修改运行进程

```bash
# 安全实验：只影响新子进程
prlimit --nofile=256:512 --core=0:0 -- ./lab-server

# 只降低现有进程 soft limit；先保存旧值与回滚命令
prlimit --pid 1234 --nofile
sudo prlimit --pid 1234 --nofile=1024:
```

降低现有 `NOFILE` 不会自动关闭已打开 fd，但后续 open/socket/accept 可能失败；降低 AS/FSIZE/CPU 等可能迅速造成业务错误或信号。修改前确认服务支持、流量、回滚、权限与监控。

## 7. `nofile`、`nproc` 常见层级

```text
应用当前 RLIMIT
  ← 父进程/登录 PAM
  ← systemd LimitNOFILE/LimitNPROC
  ← 容器 runtime / OCI rlimits
另有：fs.file-max、fs.nr_open、cgroup pids.max
```

`EMFILE` 表示进程 fd 达到 RLIMIT_NOFILE，`ENFILE` 更偏系统 file table；提高 nofile 前还要检查 fd 泄漏、select 限制、system-wide 上限和内存开销。`RLIMIT_NPROC` 按 real UID 计数 Linux tasks，root/能力存在例外；容器控制总任务更常用 `pids.max`。

## 8. 权限、systemd 与容器

查询/修改他进程受 UID、capability、ptrace/LSM 限制；提高 hard limit 需要特权。systemd 管理服务应在 unit 中声明 `Limit*=` 后受控重启，而不是手工改一次丢失；Kubernetes/OCI 是否支持某个 rlimit 取决于 runtime 和安全策略。

RLIMIT 与 cgroup 互补：前者是进程继承阈值，后者控制进程集合的 CPU/memory/IO/PID。`RLIMIT_AS` 不是可靠容器内存隔离，`RLIMIT_RSS` 在 Linux 通常不是实际容量控制。

## 9. 常见误判、退出状态与实验

| 误判 | 修正 |
|---|---|
| 提高 nofile 就修复 fd 问题 | 先找泄漏/连接生命周期并查系统层上限 |
| NPROC 是单进程线程上限 | Linux 常按 real UID 的 tasks 计数 |
| RSS limit 能做容器内存限制 | Linux 通常不强制；用 cgroup memory |
| 修改现有进程会持久化 | 重启后由父进程/systemd/runtime 重新继承 |
| PID 一直代表同一进程 | 防 PID 复用，核对启动时间/新 pidfs inode |

成功为 `0`，权限、目标消失、无效限制或执行失败为非 `0`。实验：在测试 Shell 查询；以低 nofile/core/cpu 启动程序并观察 errno/signal；比较 Bash ulimit、systemd unit、cgroup pids/memory。

掌握标准：能列出全部参数和资源，解释 soft/hard/继承/UID 口径，区分 RLIMIT、sysctl、systemd 与 cgroup，并安全设计变更回滚。

## 10. 官方参考 {/* #官方参考 */}

- [util-linux prlimit(1)](https://man7.org/linux/man-pages/man1/prlimit.1.html)
- [Linux getrlimit(2)](https://man7.org/linux/man-pages/man2/getrlimit.2.html)
- [systemd.exec Limit*](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Process%20Properties)

上一篇：[`slabtop` 命令详解](./12-slabtop命令详解.md)

下一篇：[`ulimit` 命令详解](./14-ulimit命令详解.md)
