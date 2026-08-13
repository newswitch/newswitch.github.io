---
title: set 命令详解：Shell 选项、位置参数、errexit 与 pipefail
sidebar_position: 11
description: 完整讲解 Bash set 的短选项和 -o 长选项、$@ 重设、nounset、errexit、xtrace、noclobber、monitor 与 pipefail 陷阱。
tags: [Linux, Bash, set, pipefail, 安全脚本]
---

# `set` 命令详解：改变当前 Shell 的执行语义

`set` 同时管理 shell options 和位置参数。它影响当前执行环境及部分子 Shell，属于脚本最关键也最容易被误解的 builtin。

## 1. 语法

```text
set [-abefhkmnptuvxBCEHPT] [-o OPTION] [--] [-] [ARG ...]
set +OPTION
```

对大多数选项，`-` 启用、`+` 禁用。无参数时显示全部变量，不应在含密钥环境直接记录。

## 2. 常用短选项

| 短项 | `-o` 名 | 含义 |
|---|---|---|
| `-e` | `errexit` | 未被特定语法上下文处理的失败使 Shell 退出 |
| `-u` | `nounset` | 展开未设置变量时报错 |
| `-x` | `xtrace` | 输出展开后的命令 |
| `-v` | `verbose` | 输出读入的 Shell 行 |
| `-n` | `noexec` | 读语法不执行（交互行为例外） |
| `-f` | `noglob` | 禁 filename expansion |
| `-C` | `noclobber` | `>` 不覆盖已存在普通文件；`>|` 可强制 |
| `-E` | `errtrace` | ERR trap 向函数/替换/子 Shell 继承 |
| `-T` | `functrace` | DEBUG/RETURN trap 继承 |
| `-P` | `physical` | `cd` 等使用物理目录结构 |
| `-m` | `monitor` | job control，非交互脚本通常关闭 |
| `-a` | `allexport` | 后续赋值自动 export，易泄露 |
| `-b` | `notify` | 立即报告后台 job 完成 |
| `-h` | `hashall` | 查找时记住外部命令位置 |

其他 `-o` 包含 `pipefail`、`posix`、`vi/emacs`、`history`、`histexpand`、`ignoreeof`、`privileged`、`onecmd`、`nolog` 等，以 `set -o` 列出本机全集。

## 3. 严格模式不是异常系统

```bash
set -Eeuo pipefail
```

- `errexit` 在 `if/while/until` 条件、`&&/||` 列表、`!`、非最后 pipeline 等上下文有例外；显式 `if ! command; then ... fi` 更可靠。
- `nounset` 对可选值使用 `${name:-}` 或 `${name:?message}`，数组和位置参数要单测。
- `pipefail` 返回最右侧非零命令的状态，但还要立即保存 `$?` 或 `${PIPESTATUS[@]}`。
- `xtrace` 会泄露展开后的 secret；使用单独 FD 并在敏感段关闭。

## 4. 位置参数

```bash
set -- first "two words" --literal-dash
printf '%s\\n' "$@"
set --   # 清空位置参数
```

`--` 结束选项并重设 `$1...`；单独 `-` 也结束选项并关闭 xtrace/verbose。始终用 `"$@"` 保留边界。

## 5. 验收与参考

能解释每个严格选项的例外，正确保存 pipeline 状态，安全重设 `$@`，不会把 `set -e` 当成完整错误处理。

- [Bash：The Set Builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html)

下一篇：[shopt 命令详解](./12-shopt命令详解.md)。
