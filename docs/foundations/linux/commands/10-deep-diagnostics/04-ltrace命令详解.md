---
title: ltrace 命令详解：动态库调用、PLT 与系统调用联合跟踪
sidebar_position: 4
description: 讲清 ltrace 的 library/symbol filter、attach、follow-fork、参数类型、时间统计、局限与动态链接故障排查。
tags: [Linux, ltrace, 动态链接, 共享库, 调试]
---

# `ltrace` 命令详解：动态库调用边界

`ltrace` 主要通过断点观察动态链接程序经过 PLT 的 library calls，也可选看 syscall。它适合验证程序调用了哪个库函数和返回值；静态链接、inline、直接绑定、本地隐藏符号、JIT 和优化会让调用不可见。

## 1. 主要参数

```text
ltrace [OPTIONS] COMMAND [ARG...]
ltrace [OPTIONS] -p PID...
```

| 参数 | 含义 |
|---|---|
| `-p PID` | 附加进程 |
| `-f` | 跟踪 fork/clone 后代 |
| `-e FILTER` | 选择 library calls；支持符号/库匹配和排除 |
| `-x FILTER` | 跟踪入口地址对应符号，即使不是 PLT call |
| `-l LIBRARY` | 只跟踪指定库实现的调用 |
| `-S` | 同时显示 system calls |
| `-c` | 汇总时间与调用次数 |
| `-t/-tt/-ttt`、`-r`、`-T` | 时间戳、相对时间、调用耗时 |
| `-s N`、`-A N` | 字符串和数组显示上限 |
| `-n N`、`-a COL` | 调用缩进和返回值对齐 |
| `-o FILE` | 写入文件 |
| `-C` | 反解 C++ 名称 |
| `-F FILE` | 额外 prototype 配置 |
| `-b` | 不输出 signal 消息 |
| `-D MASK` | ltrace 自身调试掩码 |
| `-u USER` | 以用户身份运行命令 |
| `-V`、`-h` | 版本与帮助 |

过滤表达式跨版本语法有差异，先用小程序验证匹配范围，避免通配所有调用。

## 2. 实战

```bash
# DNS/NSS 调用路径
ltrace -f -tt -T -e 'getaddrinfo+gethostbyname*@*' command

# 动态内存调用汇总
ltrace -c -e 'malloc+calloc+realloc+free' command

# 动态库与 syscall 联合观察
timeout 15s ltrace -f -S -o trace.log command
```

先用 `file`、`readelf -l/-d`、`ldd` 判断是否动态链接以及实际解释器/依赖。`ltrace` 的 prototype 数据若不准确，参数解码会错；不能因为显示了一个整数就认为类型解释正确。

## 3. 安全与验收

断点会暂停线程，高频 library call 开销很大；输出也可能含口令与明文 buffer。生产中限进程、函数、时长和字符串长度。attach 失败时检查 ptrace/Yama/LSM 和 PID Namespace，不要永久降安全策略。

掌握标准：能解释 PLT、动态解析和直接/内联调用的可见性边界；能用 `strace` 交叉验证库函数最终触发的内核接口。

## 4. 官方参考

- [ltrace project manual](https://man7.org/linux/man-pages/man1/ltrace.1.html)
- [Linux：ld.so(8)](https://man7.org/linux/man-pages/man8/ld.so.8.html)

下一篇：[perf stat 命令详解](./05-perf-stat命令详解.md)。
