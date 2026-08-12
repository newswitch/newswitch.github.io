---
title: kill 命令详解：信号、进程组、pidfd 与安全升级
sidebar_position: 10
description: 完整讲解 Bash builtin 与 util-linux kill 的参数、信号 0、PID/PGID、signal mask、queue、handler、pidfd timeout、退出码和生产终止流程。
tags: [Linux, kill, signal, pidfd, 进程终止]
---

# `kill` 命令详解：信号、进程组、pidfd 与安全升级

`kill` 的本质是发送信号，不是“必然杀死”。Shell 通常优先执行 builtin，外部 util-linux `kill` 提供 signal mask、pidfd timeout、queue 等更多功能；必须先确认实现。

## 1. 两种实现与语法

```bash
type -a kill
help kill
/bin/kill --version
/bin/kill --help
```

Bash 常见语法：

```text
kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...
kill -l | -L [sigspec | exit_status]
```

util-linux 当前语法：

```text
kill [-signal|-s signal] [options] [--] PID[:inode]...
kill -l [number|0xmask] | -L
kill -d PID[:inode]
```

## 2. util-linux 完整参数

| 参数 | 作用 |
|---|---|
| `-SIGNAL` / `-s`, `--signal SIGNAL` | 指定信号，默认 `TERM` |
| `-l`, `--list [VALUE]` | 列信号，或把编号/十六进制 mask 转为名称 |
| `-L`, `--table` | 表格列出信号名与编号 |
| `-a`, `--all` | 按命令名解析时不限于当前 UID |
| `-p`, `--pid` | 按命令名只打印 PID，不发信号 |
| `-r`, `--require-handler` | 目标未捕获该信号时不发送 |
| `--verbose` | 输出将发送到哪个 PID/信号 |
| `-q`, `--queue VALUE` | 用 sigqueue/pidfd 附带整数值 |
| `--timeout MS SIGNAL` | 等待后向同一 pidfd 身份发后续信号；可重复 |
| `-d`, `--show-process-state PID` | 解码 `/proc/PID/status` 的 blocked/ignored/caught |
| `-h`, `--help` | 显示帮助 |
| `-V`, `--version` | 显示版本 |

`PID:inode` 是 pidfs 进程身份格式，需要 Linux 6.9+ 和 `getino`，可消除 PID 复用竞态；版本支持有限。

## 3. PID 参数语义

| 参数 | 目标 |
|---|---|
| `N > 0` | PID N |
| `0` | 调用者所在 process group |
| `-N` | PGID N；先指定信号或用 `-- -N` 避免被当选项 |
| `-1` | 调用者有权发信号的广泛进程集合，极高风险 |
| Bash `%1` | 当前 Shell jobspec，由 builtin 解析 |

```bash
kill -TERM -- "$pid"
kill -TERM -- -"$pgid"
kill -0 -- "$pid"
```

信号 0 不递送信号，只检查目标存在/权限；成功也不能证明它仍是原进程或健康。

## 4. 信号处理与线程

`TERM` 可捕获并清理；`KILL` 和 `STOP` 不可捕获/阻塞/忽略。向多线程进程的 TID 作为 kill 参数，信号仍面向线程组，由一个未阻塞线程处理；精准线程信号需要相应 API。

```bash
/bin/kill -d "$pid"
/bin/kill -l 0x0000000000004000
```

pending/blocked/ignored/caught 是位图状态，不证明 handler 能及时运行。任务在 `D` 状态时，信号可 pending 到返回可中断点。

## 5. 无 PID 复用的升级链

```bash
/bin/kill --verbose \
  --timeout 10000 KILL \
  --signal TERM "$pid"
```

外部 kill 用 pidfd 确保后续 KILL 只发给同一进程；手写 `kill TERM; sleep; kill KILL` 可能在间隔中命中复用 PID。更高层仍应优先 service/cgroup lifecycle，因为单 PID 可能留下子进程。

## 6. 权限、退出码与生产流程

发送者需匹配目标真实/保存 UID或具备 `CAP_KILL`；SIGCONT 还允许同 session 的特例。容器 user/PID namespace 和 LSM 可限制。

util-linux：`0` 成功，`1` 失败，`64` 多目标部分成功。Bash builtin 返回非零表示至少有对象/信号失败，细节依版本。

生产流程：确认 PID+启动时间+cgroup → 保存线程栈/日志/连接 → 停入口 → TERM/应用约定信号 → 有界等待 → 必要时 KILL → wait/reap/控制面验证 → 数据一致性检查。

## 7. 实验与掌握标准

对自建进程覆盖 builtin/external、信号 0、PID/PGID/jobspec、TERM handler、blocked/ignored、queue、timeout 和退出码；模拟 PID 消失但不要向无关进程发信号。

掌握标准：能列出两种实现参数；能解释信号权限、默认动作、线程交付、pidfd；能不用固定 `sleep` 竞态实现安全升级。

## 官方参考

- [util-linux：kill(1)](https://man7.org/linux/man-pages/man1/kill.1.html)
- [Linux signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)
- [Linux kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html)

上一篇：[`wait` 命令详解](./09-wait命令详解.md)

下一篇：[`pkill` 命令详解](./11-pkill命令详解.md)
