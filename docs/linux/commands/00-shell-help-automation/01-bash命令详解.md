---
title: "bash 命令详解：调用模式、启动文件、POSIX、调试与受限 Shell"
sidebar_label: "01. bash 命令详解：调用模式、启动文件、POSIX、调试与受限 Shell"
sidebar_position: 1
description: "系统讲解 Bash invocation 长短参数、login/interactive/POSIX 模式、启动文件、-c/-s、调试选项和环境继承。"
tags: [Linux, bash, Shell, POSIX, 自动化]
---

# bash 命令详解：调用模式、启动文件、POSIX、调试与受限 Shell

`bash` 既是交互 Shell 也是脚本解释器。调用参数决定它从哪里读命令、是否交互/login、读取哪些启动文件、启用哪些选项以及 `$0/$@` 如何赋值。

## 1. 语法与单字符选项

```text
bash [GNU long option] [option] ...
bash [GNU long option] [option] script-file [arguments]
```

| 参数 | 含义 |
|---|---|
| `-c STRING [NAME [ARG...]]` | 执行字符串；NAME 成为 `$0`，后续为 `$@` |
| `-s` | 从标准输入读命令，参数仍进入 `$@` |
| `-i` | 强制交互模式 |
| `-l` | 作为 login shell |
| `-r` | restricted shell |
| `-O SHOPT` / `+O SHOPT` | 启用/禁用 shopt 选项 |
| `-D` | 列出 `$"..."` 可翻译字符串，不执行 |
| `-E`、`-T` | ERR/DEBUG/RETURN trap 继承 |
| `-v`、`-x` | 读入行/展开后命令调试输出 |
| `-n` | 读语法但不执行；不能证明运行正确 |
| `-eufhkmnptBCP` | 对应 `set` 的同名字母行为 |

`--` 结束选项；仅一个 `-` 也表示选项结束并关闭 `-v/-x`。

## 2. GNU 长选项

必须出现在单字符选项之前：

| 参数 | 含义 |
|---|---|
| `--debugger` | 安排 debugger profile，并启用 extdebug |
| `--dump-po-strings`、`--dump-strings` | 输出可翻译字符串 |
| `--help`、`--version` | 帮助/版本 |
| `--init-file FILE`、`--rcfile FILE` | 交互非 login shell 用 FILE 替代 `~/.bashrc` |
| `--login` | login shell |
| `--noediting` | 交互时禁 Readline |
| `--noprofile` | 不读 login profile |
| `--norc` | 不读交互 rc |
| `--posix` | 启用 POSIX mode |
| `--pretty-print` | 读入后格式化输出而非执行 |
| `--restricted` | restricted 模式 |
| `--verbose`、`--debug` | 等价 `-v`、`-n` |

## 3. 启动文件矩阵

| 模式 | 典型文件 |
|---|---|
| interactive login | `/etc/profile`，然后首个可读的 `~/.bash_profile`、`~/.bash_login`、`~/.profile` |
| interactive non-login | `~/.bashrc` |
| non-interactive script | 若设置，读取 `$BASH_ENV` 指向的文件 |
| login exit | `~/.bash_logout` |

发行版还可能在系统 profile 中 source `/etc/profile.d/*`。以 `bash --noprofile --norc` 建立干净基线。

## 4. 安全调试

```bash
bash -n script.sh
BASH_XTRACEFD=9 bash -x script.sh 9>trace.log
bash --noprofile --norc script.sh
```

`-x` 会展开变量，可能把 token/password 写入日志；敏感区段先 `set +x`。`bash -n` 不展开变量、不执行重定向或命令，仍需测试和 ShellCheck。

## 5. 验收与参考

能预测 `$0/$@`、启动文件和交互/login 差异；能建立无 profile 的可复现执行环境；不把 restricted shell 当作安全沙箱。

- [Bash Invocation](https://www.gnu.org/software/bash/manual/html_node/Invoking-Bash.html)
- [Bash Startup Files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html)

下一篇：[help 命令详解](./02-help命令详解.md)。
