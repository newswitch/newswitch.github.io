---
title: tail 命令详解：尾部截取、日志跟踪与轮转语义
sidebar_position: 5
description: 完整讲解 GNU coreutils tail 的全部参数、正计数、follow descriptor/name、retry、PID、inotify 与轮询、日志截断轮转、NUL 记录和容器排障。
tags: [Linux, tail, GNU coreutils, 日志, inotify]
---

# `tail` 命令详解：尾部截取、日志跟踪与轮转语义

`tail` 默认输出每个输入的最后 10 行。`-f/-F` 又把它变成持续观察增长文件的工具。要正确排障，必须区分“跟踪已打开 inode”与“跟踪这个路径名”，否则日志轮转后很容易一直盯着旧文件。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；follow 会长期占用文件描述符并持续产生 IO |
| 主要对象 | 文件尾部、增长中的 inode 或路径名 |

```bash
type -a tail
env tail --version
env tail --help
```

## 2. 完整语法与全部参数

```text
tail [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-c [+]N` | `--bytes=[+]N` | 输出末尾 N 字节；`+N` 从开头第 N 字节开始 |
| 无 | `--debug` | 向 stderr 输出 follow 实现等调试信息 |
| `-f` | `--follow[=HOW]` | 持续读取新增内容；HOW 为 `descriptor` 或 `name` |
| `-F` | 无 | 等价于 `--follow=name --retry` |
| 无 | `--max-unchanged-stats=N` | name+轮询时连续 N 次无变化后重新 open/fstat，默认 5 |
| `-n [+]N` | `--lines=[+]N` | 输出末尾 N 行；`+N` 从开头第 N 行开始 |
| 无 | `--pid=PID` | follow 时指定 writer PID；可重复，全部消失后退出 |
| `-q` | `--quiet`、`--silent` | 从不输出文件名 header |
| 无 | `--retry` | 打开失败后持续重试，主要与 follow 配合 |
| `-s N` | `--sleep-interval=N` | 轮询间隔秒数，默认 1.0，可为非负小数 |
| `-v` | `--verbose` | 始终输出文件名 header |
| `-z` | `--zero-terminated` | 使用 NUL 而非 LF 切分记录 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件或 `FILE=-` 时读取标准输入。标准输入是管道/FIFO 时，`-f` 对它通常无效。

## 3. 计数与单位

```bash
tail -n 100 -- app.log
tail -n +2 -- table.tsv
tail -c 4K -- artifact
tail -c +17 -- framed.bin
```

- 无符号 N：从尾部取 N 条。
- `+N`：从开头第 N 条开始，序号从 1 起。
- `-c` 与 `-n` 支持 `b=512`、`KB=1000`、`K/KiB=1024`、`MB/M/MiB` 以及更大的 `G/T/P/E/Z/Y/R/Q` 后缀。
- `tail -n +1` 输出全部内容；`tail -n 0` 不输出初始行。

`-c` 可能切入 UTF-8 字符或结构化帧，只适合明确按字节定义的协议。

## 4. 多文件 header

多个文件默认在数据来源切换时输出：

```text
==> app.log <==
```

```bash
tail -q -n 20 -- a.log b.log
tail -v -n 20 -- one.log
```

机器处理不应依赖解析 header 文本；可用 `-q` 并在独立进程中加结构化 source 字段，或使用日志系统查询接口。

## 5. `--follow=descriptor` 与 `--follow=name`

### 5.1 descriptor：默认

```bash
tail -f -- app.log
tail --follow=descriptor -- app.log
```

打开文件后跟随 file descriptor 指向的 inode。路径被 rename 或 unlink 后，只要写进程还写旧 inode，tail 仍能看到内容；但新建同名日志不会自动切换。

### 5.2 name

```bash
tail --follow=name -- app.log
```

持续确认名称当前映射的 device+inode，适合 rename+create 日志轮转。文件短暂消失时若未加 `--retry`，可能报告后不再检查。

### 5.3 `-F`

```bash
tail -F -- app.log
```

等价于 name+retry，适合常见轮转，但如果路径永久错误，它会一直重试；自动化需要超时、进程管理和告警。

## 6. 三种日志变化

| 变化 | descriptor | name/`-F` |
|---|---|---|
| 正常 append | 继续读 | 继续读 |
| rename 旧文件并创建新同名文件 | 继续旧 inode | 切到新名称对应 inode |
| copytruncate 把原 inode 截短后继续写 | 检测缩小，从头继续 | 同样检测截短并继续 |
| unlink 后 writer 仍持有 fd | 继续读旧 inode | 尝试寻找新同名文件 |

轮转排障要同时查看应用如何 reopen、logrotate 策略、路径 inode、打开 fd 和 tail 模式。

```bash
stat -c '%d:%i %s %n' -- app.log
lsof -- app.log
lsof +L1
```

## 7. inotify 与轮询

Linux 上可用 inotify 时，变化通常由事件及时触发；某些远端/特殊文件系统、不支持环境或资源限制下会退化为轮询。

```bash
tail --debug -F -- app.log
```

调试输出可确认实现。

- `-s 0.2` 调整轮询间隔；越小，stat/open 和 CPU 开销越高。
- `--max-unchanged-stats=5` 只在 name+轮询下有意义；大致控制无变化多久重新确认 inode。
- 使用 inotify 时 `-s` 的轮询部分通常被忽略，但配合 `--pid` 时至少按该间隔检查 PID。

NFS、CephFS 等还受客户端元数据缓存、事件能力和网络故障影响，不要用本地 ext4 的延迟预期套用。

## 8. `--retry` 精确语义

```bash
tail --follow=name --retry -- delayed.log
```

- name 模式：文件消失或打不开时无限重试重新打开。
- descriptor 模式：只影响最初打开；成功打开后继续跟 fd，名称变化不需要再打开。
- 不配 follow 时使用通常会警告，价值有限。

重试不是错误恢复策略：磁盘卸载、权限改变、路径拼错、凭证失效都可能让它永远等待。

## 9. `--pid`

```bash
build >build.log 2>&1 &
writer_pid=$!
tail --pid="$writer_pid" -f -- build.log
wait "$writer_pid"
```

可重复多个 `--pid`，全部 PID 不存在后 tail 很快退出。限制：

- PID 必须与 tail 在同一主机/PID Namespace 中可见。
- PID 可能复用；writer 还可能 fork/daemonize，原 PID 消失但子进程继续写。
- 指错 PID 会过早或过晚退出。
- 某些系统不支持。
- writer 退出与最后一批数据可见之间可能有刷新时序。

## 10. NUL 记录

```bash
tail -z -n 10 -- records.nul |
while IFS= read -r -d '' item; do
  printf '%q\n' "$item"
done
```

`-z` 把 NUL 当记录分隔符，适合任意文件名列表。它不表示输出二进制安全可直接显示；记录内容仍可能含终端控制字节（除 NUL 外）。

## 11. 容器与服务日志边界

容器 stdout/stderr 通常由 runtime 捕获，文件可能位于宿主机而不在容器可见路径。`tail -F` 容器内文件并不等于 `kubectl logs -f`：

- runtime 可能使用独立日志格式、轮转和大小限制。
- Pod 重建后路径、容器 ID 和 Namespace 改变。
- 多副本日志需要集中查询，而不是 SSH 到单节点 tail。
- systemd 服务优先考虑 `journalctl -f -u service`，保留结构化字段和游标。

`tail` 适合局部证据，不是完整日志平台。

## 12. 旧语法与兼容性

GNU 兼容历史形式 `tail -NUM[bcl][f]`，部分老系统还把 `+4` 解释为从第 4 行开始。新脚本只使用明确现代形式：

```bash
tail -n 10 -- file
tail -n +4 -- file
```

GNU 没有 BSD `tail -r`；逆序使用 `tac`。

## 13. 退出状态与信号

普通模式成功为 `0`，失败为非 `0`。follow 通常不会自行退出，直到信号、`--pid` 条件或不可恢复错误。

```bash
timeout --signal=TERM 30s tail -F -- app.log
```

超时工具、systemd/Kubernetes 生命周期和 trap 应负责有界运行。`Ctrl-C`/SIGINT 终止并不代表被观察应用失败。

## 14. 常见故障

| 现象 | 检查方向 |
|---|---|
| 轮转后看不到新日志 | 正在 descriptor 跟旧 inode；改 name/`-F` |
| 重复看到旧内容 | 文件截断、轮转切换、重启后重新输出初始尾部 |
| 延迟突发 | 轮询间隔、网络文件系统缓存、应用缓冲 |
| `-F` 永不退出 | retry 语义；增加生命周期控制 |
| CPU/stat 调用高 | 轮询间隔过小、文件过多、无 inotify |
| `--pid` 过早结束 | PID Namespace、fork、PID 选错 |
| 删除日志仍占空间 | writer/tail 等进程持有旧 inode |
| 中文开头乱码 | `-c` 从多字节字符中间开始 |

## 15. 动手实验

1. 比较 `-n 10`、`-n +10`、`-c` 与单位后缀。
2. 两个文件比较 header 的默认、quiet、verbose。
3. 一个终端运行 descriptor follow，另一个 rename+create，观察旧/新 inode。
4. 用 name、name+retry、`-F` 重复实验。
5. 用 truncate 和 copytruncate 模拟日志缩小。
6. 用 `--debug` 判断 inotify/轮询，并观察 `-s`。
7. 启动临时 writer，用 `--pid` 让 tail 自动退出。
8. 在 NUL 数据上验证 `-z`。

## 16. 掌握标准

- 能列出 `tail` 全部参数和单位规则。
- 能准确解释 descriptor、name、retry、`-F`。
- 能分析 rename+create 与 copytruncate 两种轮转。
- 能判断 inotify、轮询、远端文件系统和 PID Namespace 的影响。
- 能为 follow 设置明确终止条件并定位打开后已删除文件。

## 官方参考

- [GNU coreutils 9.11：tail invocation](https://www.gnu.org/software/coreutils/manual/html_node/tail-invocation.html)
- [Linux inotify(7)](https://man7.org/linux/man-pages/man7/inotify.7.html)
- [Linux proc_pid_fd(5)](https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html)

上一篇：[`head` 命令详解](./04-head命令详解.md)

下一篇：[`wc` 命令详解](./06-wc命令详解.md)

