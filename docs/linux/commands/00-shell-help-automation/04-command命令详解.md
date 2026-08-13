---
title: command 命令详解：绕过 Function、查询解析结果与默认 PATH
sidebar_position: 4
description: 完整讲解 Bash command 的 -p/-v/-V、函数绕过、builtin/外部命令选择与可移植探测。
tags: [Linux, Bash, command, PATH, Shell]
---

# `command` 命令详解：按普通命令规则执行

`command` 是 POSIX/Bash builtin。它绕过同名 shell function，继续按 builtin 与 PATH 查找执行；常用于函数包装器调用原命令，以及脚本探测命令解析结果。它不会绕过 alias 的语法展开，alias 通常在 `command` 执行前已展开命令词位置。

## 1. 全部参数

```text
command [-pVv] COMMAND [ARG...]
```

| 参数 | 含义 |
|---|---|
| `-p` | 使用实现保证能找到标准 utilities 的默认 PATH |
| `-v` | 打印用于调用名称的单个描述/路径 |
| `-V` | 以更详细的人类可读形式描述解析结果 |

```bash
command -v kubectl
command -V printf
command ls --color=auto
```

## 2. 函数包装器

```bash
rm() {
  printf 'wrapper target count=%d\\n' "$#" >&2
  command rm "$@"
}
```

`command rm` 避免函数递归，但仍可能调用 Bash builtin（若存在）或 PATH 中外部文件。要固定供应链边界应使用经过验证的绝对路径，而不是假设 PATH 安全。

## 3. 探测的正确边界

```bash
if command -v jq >/dev/null 2>&1; then
  jq --version
fi
```

这只证明当前 Shell 能解析名称，不证明版本兼容、执行权限在稍后仍存在或程序可信。后续还要检查版本/能力，并保持受控 PATH。

## 4. 验收与参考

能解释 `command -v`、`type -a` 和 `which` 的差异，能安全编写 wrapper，并知道 `-p` 是默认 utility PATH 而不是特权模式。

- [Bash Builtins：command](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[printf 命令详解](./05-printf命令详解.md)。
