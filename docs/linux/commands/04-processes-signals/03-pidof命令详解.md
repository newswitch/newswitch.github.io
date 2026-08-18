---
title: "pidof 命令详解：按程序名查询 PID 与实现边界"
sidebar_label: "03. pidof 命令详解：按程序名查询 PID 与实现边界"
sidebar_position: 3
description: "完整讲解 procps-ng pidof 的参数、单结果、root directory、脚本、内核线程、TID、排除 PID、分隔符和 pgrep 对比。"
tags: [Linux, pidof, procps-ng, PID, 进程查找]
---

# pidof 命令详解：按程序名查询 PID 与实现边界

`pidof` 按运行程序名称输出 PID，适合兼容脚本和简单查询。复杂筛选优先使用 `pgrep`；systemd 服务优先查询 unit/cgroup，而不是猜进程名。

## 1. 语法与完整参数

```text
pidof [-s] [-c] [-q] [-w] [-x] [-o PID[,...]] ... [-t] [-S SEP] program ...
```

| 参数 | 作用 |
|---|---|
| `-s` | 只返回一个 PID；未承诺是最新、最旧或主进程 |
| `-c` | 只返回 root directory 与当前进程相同的进程；非 root 对他人进程可能忽略 |
| `-q` | 静默，仅用退出码判断 |
| `-w` | 也显示无可见 command line 的进程，如内核工作线程 |
| `-x` | 尝试匹配运行指定脚本的 shell；检测简单，可能漏掉 `/usr/bin/env` 脚本 |
| `-o PID` | 排除 PID，可重复/列表；`%PPID` 表示调用 pidof 的父进程 |
| `-t` | 输出所有 TID 而不是 PID |
| `-S SEP` | 指定多 PID 分隔符；`-d` 是 sysvinit 兼容别名 |

procps-ng 手册没有通用 `--help/--version` 长参数保证；先用 `pidof --help`/包版本确认本机实现，因为 sysvinit、BusyBox 与 procps-ng 参数不同。

## 2. 使用与边界

```bash
pidof nginx
pidof -q nginx
pidof -S, nginx
pidof -o %PPID -x backup.sh
```

多个 program 操作数可返回多组 PID，但纯文本不标识每个 PID 属于哪个名称。`-s` 不是“主 PID”选择器；多实例服务不要依赖它。

`-c` 比较 `/proc/PID/root`，可帮助区分 chroot/container root，但它不等于比较完整 namespace、cgroup 或容器身份。PID namespace 仍决定可见 PID。

## 3. 退出码和安全性

`0` 表示至少找到一个请求程序，`1` 表示一个都没找到。语法/实现错误的细分不如 pgrep 明确，自动化要保留 stderr。

不要把 `kill $(pidof name)` 当通用停服方法：空替换、多 PID、PID 复用、同名无关实例和重启监督器都会产生风险。优先使用服务控制面；必须处理 PID 时验证 UID、启动时间、cgroup 和 argv。

## 4. 实验与掌握标准

运行多个同名实例和一个脚本，覆盖 `-s/-q/-w/-x/-o/-t/-S/-c`；在容器内外比较结果，并与 `pgrep -a/-f/-x` 对照。

掌握标准：能列出本实现全部参数；能说明 `-s` 不保证主进程、`-x` 不可靠识别所有脚本、`-c` 不等于 namespace 匹配；知道何时改用 pgrep/cgroup。

## 5. 官方参考 {/* #官方参考 */}

- [procps-ng：pidof(1)](https://man7.org/linux/man-pages/man1/pidof.1.html)
- [Linux proc_pid_root(5)](https://man7.org/linux/man-pages/man5/proc_pid_root.5.html)

上一篇：[`pgrep` 命令详解](./02-pgrep命令详解.md)

下一篇：[`pstree` 命令详解](./04-pstree命令详解.md)
