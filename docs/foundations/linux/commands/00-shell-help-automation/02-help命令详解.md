---
title: help 命令详解：查询 Bash Builtin、关键字与语法
sidebar_position: 2
description: 讲清 Bash help 的 -d/-m/-s、pattern、返回状态，以及 help、man、type、--help 的选择边界。
tags: [Linux, Bash, help, Builtin, 命令帮助]
---

# `help` 命令详解：查询 Shell 自己的接口

`help` 是 Bash builtin，用于查询 builtin、reserved word 和部分语法主题。`man cd` 可能打开一组 builtins 的手册，而 `help cd` 能直接显示当前 Bash 版本的真实语法。

## 1. 全部参数

```text
help [-dms] [PATTERN ...]
```

| 参数 | 含义 |
|---|---|
| `-d` | 每个主题只显示简短描述 |
| `-m` | 以 man-page 风格显示 |
| `-s` | 只显示语法 synopsis |
| `PATTERN` | 匹配主题；无参数列出全部主题 |

```bash
help
help -s read mapfile
help -m '[[‘  # 实际使用 ASCII [[，此处不要复制弯引号
help 'set'
```

Pattern 没有匹配时返回非零，可用于判断 builtin 是否有帮助主题，但识别命令仍优先 `type -a`。

## 2. 帮助入口选择

| 对象 | 首选入口 |
|---|---|
| Bash builtin/keyword | `help NAME` |
| 外部程序 | `NAME --help`、`man NAME`、`info NAME` |
| 函数/alias/解析结果 | `type -a NAME`、`declare -f NAME`、`alias NAME` |
| 系统调用/配置格式 | `man 2 NAME` / `man 5 NAME` |

`help test` 与 `/usr/bin/test --help` 可能是不同实现；先确认实际执行对象。

## 3. 验收与参考

能从错误命令名迅速找到当前 Bash 的 synopsis 和返回规则，且不会用互联网上另一版本参数替代本机帮助。

- [Bash Builtins](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[type 命令详解](./03-type命令详解.md)。
