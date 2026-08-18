---
title: "timeout 命令详解：期限、信号升级、前台 TTY 与退出码"
sidebar_label: "18. timeout 命令详解：期限、信号升级、前台 TTY 与退出码"
sidebar_position: 18
description: "完整讲解 GNU coreutils timeout 参数、duration、TERM/KILL、foreground、preserve-status、进程组与子进程边界、124/125/126/127/137 退出码。"
tags: [Linux, timeout, signal, deadline, coreutils]
---

# timeout 命令详解：期限、信号升级、前台 TTY 与退出码

`timeout` 启动命令并在期限后发送信号，默认 TERM。它限制的是 wrapper 观察的进程/进程组生命周期，不保证远端请求取消、数据回滚、所有 daemonized descendants 退出或业务达到一致状态。

## 1. 语法与 GNU 9.11 完整参数

```text
timeout [OPTION]... DURATION COMMAND [ARG]...
```

| 参数 | 作用 |
|---|---|
| `-f`, `--foreground` | 允许命令直接读 TTY/收终端信号；其 children 不会被 timeout 一并超时 |
| `-k DUR`, `--kill-after=DUR` | 初始信号后再等 DUR，仍运行则 KILL |
| `-p`, `--preserve-status` | 即使超时也尽量返回 COMMAND 的状态，而不是 124 |
| `-s SIG`, `--signal=SIG` | 超时时发送指定信号，默认 TERM |
| `-v`, `--verbose` | 把超时发送的信号写到 stderr |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

DURATION 是浮点数，可加 `s`（默认）、`m`、`h`、`d`；`0` 禁用对应期限。

## 2. 推荐 TERM→KILL 升级

```bash
timeout --verbose --signal=TERM --kill-after=10s 2m command arg
```

2 分钟后发 TERM，再等 10 秒发 KILL。kill-after 是“初始信号后的额外时长”，不是总时长。若程序需要 checkpoint/flush，窗口应从实测关停分布和业务风险制定。

## 3. 前台和进程组

默认 timeout 组织 process group 以便控制命令及通常的 descendants；`--foreground` 为交互程序让出 TTY，却明确不超时 children。程序若自行 `setsid`、double-fork、交给外部服务或远端提交任务，可能逃出 wrapper 范围。

因此超时后要验证 cgroup、端口、临时文件、子进程和远端 operation，而不只看 timeout 返回。

## 4. 退出码判定

| 状态 | 含义 |
|---:|---|
| `124` | 已超时，且未指定 preserve-status |
| `125` | timeout 自身失败 |
| `126` | 命令存在但不能执行 |
| `127` | 命令未找到 |
| `137` | COMMAND 或 timeout 收到 KILL（128+9） |
| 其他 | 未超时通常传播 COMMAND 状态；preserve-status 会改变超时返回 |

目标程序本身也可能合法返回 124/137，单一退出码无法证明事件来源；结合 `-v`、日志和时间线。

## 5. 超时不是应用 deadline

外部信号超时会中断整个进程；HTTP/gRPC/数据库应同时设置连接、请求和服务端 deadline，让下游取消工作。Kubernetes termination grace/systemd TimeoutStopSec/cgroup kill 解决的层次也不同。

## 6. 实验与掌握标准

测试正常 0/42、忽略 TERM、捕获 TERM、fork child、setsid child、TTY 读取、`-f/-k/-p/-s/-v` 和全部特殊退出码；验证超时后无残留。

掌握标准：能列出全部参数；能算两段期限和解释 process group/foreground；能区分 wrapper timeout、业务 deadline 与控制面 grace period。

## 7. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：timeout(1)](https://man7.org/linux/man-pages/man1/timeout.1.html)
- [GNU coreutils：timeout invocation](https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html)

上一篇：[`setsid` 命令详解](./17-setsid命令详解.md)

下一篇：[`sleep` 命令详解](./19-sleep命令详解.md)
