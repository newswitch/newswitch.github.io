---
title: "lsof 命令详解：打开文件、网络端点、挂载占用与已删除文件"
sidebar_label: "01. lsof 命令详解：打开文件、网络端点、挂载占用与已删除文件"
sidebar_position: 1
description: "讲清 lsof 的 AND/OR 选择规则、PID/user/command/path/FD/network 过滤、机器输出、repeat 模式和 Namespace 限制。"
tags: [Linux, lsof, 文件描述符, 网络, SRE]
---

# lsof 命令详解：打开文件、网络端点、挂载占用与已删除文件

Linux 中 socket、目录、设备、库、cwd 和普通文件都可由进程持有。`lsof` 综合 `/proc` 等来源回答“谁打开了什么”，常用于卸载忙、端口占用、删除后空间不释放和配置文件仍被旧进程使用。

## 1. 语法与选择规则

```text
lsof [options] [--] [names]
```

不同类型选择条件默认 **OR**，同类型多个条件也多为 OR；使用 `-a` 才把前后条件按 AND 连接。参数紧凑且实现差异较大，执行前查看 `lsof -h` 和 `lsof -v`。

| 选项族 | 代表参数 | 含义 |
|---|---|---|
| 进程 | `-p PID`、`^PID`、`-c CMD`、`-u USER`、`-g PGID` | 选择/排除进程 |
| FD/对象 | `-d FDSET`、`+d DIR`、`+D DIR`、`-a` | FD、目录单层/递归、条件 AND |
| 网络 | `-i [46][PROTO][@HOST][:PORT]`、`-n`、`-P` | socket 过滤，禁 DNS/端口名解析 |
| 文件系统 | `-b`、`-f`、`-x f\|l` | 避免阻塞调用、控制 FS 识别、跨 FS/链接 |
| 输出 | `-F FIELDS`、`-t`、`-l`、`+L [N]` | 机器字段、只 PID、数字 UID、link count |
| 重复 | `+r SEC`、`-r SEC` | 重复到无结果/持续重复 |
| 内核 | `-K`、`-T`、`-X` | tasks、TCP/TPI 信息、特殊文件支持（依实现） |
| 常规 | `-h`、`-v`、`--` | 帮助、版本、结束选项 |

## 2. 四个生产场景

```bash
# 已删除但仍占空间
sudo lsof -nP +L1

# 端口监听者
sudo lsof -nP -iTCP:8000 -sTCP:LISTEN

# 某挂载点占用（先用非递归）
sudo lsof -nP -- /models

# PID 的特定 FD，机器可解析输出
sudo lsof -a -p 1234 -d '0-20' -Fpcfnt
```

`+D` 会递归 stat 大目录，网络/分布式文件系统上可能很慢；先用精确路径、`findmnt` 和 `fuser -m` 缩小范围。

## 3. 关键列

| 列 | 含义 |
|---|---|
| `COMMAND/PID/TID/USER` | 进程/线程身份 |
| `FD` | `cwd`、`rtd`、`txt`、`mem` 或数字 FD；后缀表示访问模式/锁 |
| `TYPE/DEVICE/SIZE-OFF/NODE` | 对象类型、设备号、大小或偏移、inode |
| `NAME` | 路径、socket endpoint、状态或附加信息 |

同一路径可对应不同 mount Namespace/inode；容器问题应固定宿主 PID 并检查 `/proc/PID/mountinfo`。无 root 权限时结果不完整，不等于无人占用。

## 4. 风险与故障排查

- 不要把 `lsof -t` 未经确认直接管道给 `kill -9`；PID 可重用，先核对 start time 和业务身份。
- `+L1` 后优先让服务 reopen/rotate 或滚动重启；截断 `/proc/PID/fd/N` 可能破坏应用。
- 命令卡住可尝试精确选择和 `-b`，但 `-b` 会牺牲信息完整性。
- 自动化使用 `-F` 的 NUL/字段协议，不解析对齐表格。

## 5. 验收与参考

能解释 `df` 与 `du` 不一致、找出 mount busy 的 cwd/root/FD、区分监听 socket 和已建立连接，并知道结果受权限与 Namespace 限制。

- [lsof project documentation](https://github.com/lsof-org/lsof/blob/master/Lsof.8)
- [Linux：proc_pid_fd(5)](https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html)

下一篇：[fuser 命令详解](./02-fuser命令详解.md)。
