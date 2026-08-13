---
title: coredumpctl 命令详解：崩溃转储查询、导出与调试
sidebar_position: 7
description: 完整讲解 coredumpctl 的 list/info/dump/debug 子命令与全部参数，理解 core 存储、journal 元数据、匹配、符号、容器、敏感数据和证据保全。
tags: [Linux, coredumpctl, core dump, systemd-coredump, GDB, 故障排查]
---

# `coredumpctl` 命令详解：崩溃转储查询、导出与调试

core dump 是进程崩溃时地址空间等状态的快照，可能包含密码、token、请求正文、模型数据和用户隐私。`coredumpctl` 查询 systemd-coredump 写入 journal 的元数据，并在 core 仍存在时导出或交给调试器。

## 1. 数据路径

```text
进程收到致命信号
  → kernel.core_pattern 调用 systemd-coredump
  → 元数据进入 journal
  → core 按 coredump.conf 进入外部文件或 journal/不保存
  → coredumpctl 按元数据查找、导出、调试
```

元数据存在不保证 core 仍在：journal 与 `/var/lib/systemd/coredump` 保留周期独立，可能显示 `present`、`missing`、`truncated`、`none` 等状态。

## 2. 语法、命令和匹配

```text
coredumpctl [OPTIONS...] [COMMAND] [PID|COMM|EXE|MATCH...]
```

| 命令 | 用途 |
|---|---|
| `list` | 列出匹配的 dump；默认命令 |
| `info` | 显示详细元数据和可能的 stack trace |
| `dump` | 把 core 写到 stdout 或 `--output=FILE` |
| `debug` | 用调试器打开 core；`gdb` 是兼容别名 |

匹配参数：纯整数是 PID；不含 `/` 的名称匹配 `COREDUMP_COMM`；含 `/` 的路径匹配 `COREDUMP_EXE`；含 `=` 的是 journal 字段匹配。

```bash
coredumpctl list
coredumpctl info /usr/local/bin/api
coredumpctl list COREDUMP_UID=1000
coredumpctl info -1                 # 最后一个匹配项
```

PID 会复用，跨时间不要只靠 PID；同时核对 timestamp、boot ID、exe、build ID、UID、unit 与 invocation。

## 3. 全部选择和时间参数

| 参数 | 含义 |
|---|---|
| `-1` | 只处理最后一个匹配 dump |
| `-n N` | 最多显示 N 条 |
| `-S, --since=TIME` | 起始时间 |
| `-U, --until=TIME` | 结束时间 |
| `-r, --reverse` | 新到旧 |
| `-F, --field=FIELD` | 列出匹配记录中字段的所有值 |
| `--all` | 读取 `/var/log/journal` 的所有普通 journal，而不仅默认集合 |

时间查询要覆盖崩溃前后窗口；core 只保留崩溃瞬间，根因可能早已出现在应用、OOM、内核、磁盘或依赖日志中。

## 4. 导出与调试参数

| 参数 | 含义 |
|---|---|
| `-o, --output=FILE` | `dump` 输出文件；未给时写 stdout |
| `--debugger=DEBUGGER` | 调试器，默认通常为 gdb；也可用 `$SYSTEMD_DEBUGGER` |
| `-A, --debugger-arguments=ARGS` | 额外调试器参数 |

```bash
umask 077
coredumpctl dump -1 --output=core.api
coredumpctl debug -1
coredumpctl debug -1 -A '-batch -ex bt -ex "info threads"'
```

导出前确认目标磁盘空间、文件权限和证据编号；不要把 core 放到公开工件、聊天、普通对象存储或源码仓库。调试器会执行符号加载脚本等能力，对不可信 core/二进制使用隔离环境并配置安全策略。

## 5. 离线来源和输出参数

| 参数 | 含义 |
|---|---|
| `--file=GLOB` | 指定 journal 文件，可重复 |
| `-D, --directory=DIR` | 指定 journal 目录 |
| `--root=ROOT` / `--image=IMAGE` | 离线 root/磁盘镜像 |
| `--image-policy=POLICY` | 镜像分区策略 |
| `-q, --quiet` | 抑制权限/进行中 dump 等提示 |
| `--json=MODE, -j` | JSON 输出 |
| `--no-legend` | 隐藏表头 |
| `--no-pager` | 禁用 pager |
| `-h, --help` / `--version` | 帮助/版本 |

离线调查要同时取得 journal 与外部 core 文件；只复制 journal 目录可能只剩元数据。记录原文件 hash、mtime、权限、xattr 和 systemd 版本。

## 6. 符号与可复现调试

可靠 backtrace 需要与崩溃时完全匹配的 executable、shared libraries、debug symbols、build ID 和架构。容器崩溃时宿主机记录的路径/UID 是外部视角，调试可能要使用容器镜像/rootfs。

```bash
coredumpctl info -1
systemd-analyze inspect-elf /path/to/executable
```

优化、strip、JIT、损坏栈、内存越界和不同软件版本都会降低栈可靠性。不要看到最顶层函数就直接归因；检查全部线程、寄存器、信号、fault address 和调用上下文。

## 7. 为什么没有 core

按顺序检查：

1. `ulimit -c` / `RLIMIT_CORE` 是否为 0。
2. `kernel.core_pattern` 是否指向 systemd-coredump 或其他 handler。
3. `coredump.conf` 的 `Storage=`、`ProcessSizeMax=`、`ExternalSizeMax=` 等。
4. service 的 `LimitCORE=`、sandbox 和 namespace。
5. dump 是否因磁盘、quota、OOM、权限、rate limit 被截断/删除。
6. 程序是否真的由会产生 core 的信号终止。

setuid/特权程序还有 `fs.suid_dumpable` 等安全限制；不要仅为取 core 在生产全局放宽。

## 8. 退出状态与实验

成功返回 0；没有匹配项也按失败处理，脚本应区分“无结果”与读取/权限/损坏错误。`dump` 要验证文件非空、类型、hash 和调试器能否识别。

在不含秘密的 VM 编译一个明确调用 `abort()` 的小测试程序，记录 crash 前后 journal，执行 list/info/dump/debug，安装匹配 debug symbols 后比较栈质量，再验证 retention 删除导致的 `missing`。不要在生产制造崩溃。

掌握标准：能列出全部命令和参数，解释 metadata/core 分离，按多个稳定字段定位 dump，安全导出并构建匹配符号环境，系统排查“为什么没有 core”。

## 官方参考

- [coredumpctl(1)](https://www.freedesktop.org/software/systemd/man/latest/coredumpctl.html)
- [systemd-coredump(8)](https://www.freedesktop.org/software/systemd/man/latest/systemd-coredump.html)
- [coredump.conf(5)](https://www.freedesktop.org/software/systemd/man/latest/coredump.conf.html)

上一篇：[`loginctl` 命令详解](./06-loginctl命令详解.md)

下一篇：[`systemd-delta` 命令详解](./08-systemd-delta命令详解.md)
