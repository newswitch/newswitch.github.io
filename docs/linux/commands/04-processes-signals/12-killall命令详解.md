---
title: killall 命令详解：按名称、年龄、namespace 与进程组发信号
sidebar_position: 12
description: 完整讲解 Linux psmisc killall 参数、精确/正则匹配、PGID、用户、PID namespace、进程年龄、等待、SELinux context 和跨平台风险。
tags: [Linux, killall, psmisc, signal, namespace]
---

# `killall` 命令详解：按名称、年龄、namespace 与进程组发信号

Linux psmisc `killall` 向所有匹配名称的进程发信号，默认 TERM。它的作用域很宽，且在某些非 Linux 系统上 `killall` 语义可能完全不同；root 绝不能凭记忆跨平台使用。

## 1. 语法与完整参数

```text
killall [options] [--] name ...
killall -l | --list
```

| 参数 | 作用 |
|---|---|
| `-e`, `--exact` | 长名称无法取得完整值时跳过，而非按前 15 字符杀 |
| `-I`, `--ignore-case` | 忽略名称大小写 |
| `-g`, `--process-group` | 向匹配项所在 PGID 每组发送一次 |
| `-i`, `--interactive` | 每次发送前确认；不适合无人值守脚本 |
| `-l`, `--list` | 列出信号名 |
| `-n`, `--ns PID` | 只匹配与 PID 相同的 PID namespace |
| `-o`, `--older-than TIME` | 只选早于时长的进程，单位 `s/m/h/d/w/M/y` |
| `-q`, `--quiet` | 无匹配时不报怨，但退出码仍非零 |
| `-r`, `--regexp` | 把 name 解释为 POSIX ERE |
| `-s`, `--signal SIGNAL`, `-SIGNAL` | 指定信号 |
| `-u`, `--user USER` | 只选择该用户；可不写 name |
| `-v`, `--verbose` | 报告成功发送 |
| `-V`, `--version` | 显示版本 |
| `-w`, `--wait` | 每秒检查直到所有目标消失，可能无限等待且有 PID 复用竞态 |
| `-y`, `--younger-than TIME` | 只选晚于时长的进程 |
| `-Z`, `--context REGEX` | 按安全上下文 ERE；必须放在其他参数前，可不写 name |
| `--` | 结束选项 |

## 2. 精确作用域

```bash
killall -e -u myagent -n 1234 -v -TERM myagent
```

名称、UID、PID namespace、年龄和 context 应组合缩小范围。`-g` 把单进程匹配扩大到整个 process group，要先用 `ps -o pid,pgid` 确认不会包含交互 Shell 或其他任务。

名称含 `/` 时工具尝试按正在执行的文件选择，但并非所有 executable 都保持可验证打开，不能当完整二进制身份认证。

## 3. `--wait` 的陷阱

目标忽略信号、停在 `D`、成为 zombie 或被监督器重启时，`-w` 可永远不返回；扫描间 PID 消失又复用时也不能可靠识别。外层必须有独立期限，且更优先使用服务管理器/支持 pidfd 的等待。

## 4. 退出状态和跨平台风险

每个给定 name 至少有一个进程成功收到信号时返回 `0`，否则非零；`-u/-Z` 无 name 时至少匹配一个即可。发送成功不等于退出成功。

在 Solaris 等系统，`killall` 可能表示终止极广泛进程。自动化必须校验 OS、实现、版本与绝对路径；多数场景优先 pkill/systemctl。

## 5. 实验与掌握标准

只对测试账户/namespace 创建同名进程，覆盖全部参数；验证长名 `-e`、ERE、PGID、age、context（若 SELinux）、`-w` 对忽略/zombie 的行为和退出码。

掌握标准：能列出全部参数；能解释 name/PGID/namespace/context 范围；知道 `-w` 非 pidfd 等待且可能永久阻塞，不在共享主机宽匹配。

## 官方参考

- [psmisc：killall(1)](https://man7.org/linux/man-pages/man1/killall.1.html)
- [Linux signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)

上一篇：[`pkill` 命令详解](./11-pkill命令详解.md)

下一篇：[`pidwait` 命令详解](./13-pidwait命令详解.md)
