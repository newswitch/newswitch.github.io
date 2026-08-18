---
title: "pstree 命令详解：父子树、线程、进程组与 namespace 迁移"
sidebar_label: "04. pstree 命令详解：父子树、线程、进程组与 namespace 迁移"
sidebar_position: 4
description: "完整讲解 psmisc pstree 的参数、树压缩、PID/PGID、父链、线程、UID 与 namespace 变化、安全上下文及 procfs 可见性。"
tags: [Linux, pstree, psmisc, 进程树, namespace]
---

# pstree 命令详解：父子树、线程、进程组与 namespace 迁移

`pstree` 把 PPID 关系显示成树。它适合观察 supervisor、worker 和 shell pipeline 的父子关系，但父子树不等于资源/故障边界：进程可 reparent，服务边界通常由 cgroup/unit 定义。

## 1. 语法与完整参数

```text
pstree [option ...] [pid | user]
```

| 参数 | 作用 |
|---|---|
| `-a`, `--arguments` | 显示 command line，并关闭进程分支压缩 |
| `-A`, `--ascii` | ASCII 画线 |
| `-c`, `--compact-not` | 不压缩相同子树 |
| `-C`, `--color=age` | 按进程年龄着色 |
| `-g`, `--show-pgids` | 显示 PGID |
| `-G`, `--vt100` | VT100 画线 |
| `-h`, `--highlight-all` | 高亮当前进程及祖先 |
| `-H`, `--highlight-pid PID` | 高亮指定 PID 及祖先；终端不支持时失败 |
| `-k`, `--kthreads` | 显示内核线程 |
| `-l`, `--long` | 不按终端宽度截断长行 |
| `-n`, `--numeric-sort` | 同父子进程按 PID 而非名字排序 |
| `-N`, `--ns-sort TYPE` | 按 ipc/mnt/net/pid/time/user/uts namespace 分树 |
| `-p`, `--show-pids` | 显示 PID，并关闭进程分支压缩 |
| `-P`, `--show-paths` | 显示运行中程序磁盘路径 |
| `-s`, `--show-parents` | 显示指定 PID 的祖先链 |
| `-S`, `--ns-changes` | 标记 namespace 变化 |
| `-t`, `--thread-names` | 尽可能显示完整线程名 |
| `-T`, `--hide-threads` | 隐藏线程 |
| `-u`, `--uid-changes` | 标记父子 UID 变化 |
| `-U`, `--unicode` | Unicode 画线 |
| `-V`, `--version` | 显示版本 |
| `-Z`, `--security-context` | 显示安全属性/SELinux context |

## 2. 树压缩与线程表示

默认会把相同分支压成 `N*[process]`，线程常显示为 `{thread}`：

```bash
pstree -ap
pstree -acp PID
pstree -pt PID
pstree -Tp PID
```

压缩适合概览，不适合计数/自动解析；用 `-c -p` 展开。线程名可由应用修改且可能截断，需用 TID 与应用 dump 对齐。

## 3. process group、UID 与 namespaces

```bash
pstree -pg PID
pstree -puS PID
sudo pstree -pNZ pid
```

`-g` 让你看出同一 pipeline/process group；`-u` 观察 setuid、sudo 或服务降权；`-S/-N` 帮助定位容器边界。普通用户或 hidepid procfs 可能看不到他人信息，树上会出现问号或缺失分支。

`-P` 显示的磁盘路径仍受 mount namespace、删除/替换文件和权限影响；不能仅凭路径证明二进制完整性。

## 4. 生产排障范式

```bash
pstree -aps PID
ps -o pid,ppid,pgid,sid,tty,stat,lstart,cgroup,comm,args -p PID
systemctl status UNIT
```

先用祖先链确认入口/supervisor，再用 PID/PGID/SID/cgroup 补齐结构。孤儿进程被 subreaper 或 PID 1 收养后，树只展示当前 PPID，无法恢复历史父子关系；需要审计/eBPF/服务日志时间线。

## 5. 退出状态、实验与掌握标准

正常展示返回 `0`，PID/参数无效或高亮/读取失败返回非 `0`；脚本不要解析画线字符，使用 `/proc`、`ps -o` 或 API。

实验：创建嵌套 shell、pipeline、线程程序和 `setsid` 子进程，比较压缩/展开、线程隐藏、PGID、父链、UID 和 namespace 标记。

掌握标准：能列出全部参数；能说明 PPID 树、process group、session、cgroup 与 namespace 是不同关系；不把可视树当稳定机器接口。

## 6. 官方参考 {/* #官方参考 */}

- [psmisc：pstree(1)](https://man7.org/linux/man-pages/man1/pstree.1.html)
- [Linux proc_pid_status(5)](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html)

上一篇：[`pidof` 命令详解](./03-pidof命令详解.md)

下一篇：[`jobs` 命令详解](./05-jobs命令详解.md)
