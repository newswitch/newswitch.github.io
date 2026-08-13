---
title: read 命令详解：IFS、反斜杠、分隔符、超时与文件描述符
sidebar_position: 6
description: 完整讲解 Bash read 的 -r/-d/-n/-N/-t/-u/-a/-p/-s/-e/-i，以及 IFS 分词、NUL 输入和 pipeline subshell。
tags: [Linux, Bash, read, IFS, 安全脚本]
---

# `read` 命令详解：把输入边界保留下来

`read` 从标准输入或指定 FD 读取记录，经 `IFS` 分词后赋给变量。默认反斜杠是 escape/continuation，所以读取原始路径和配置行几乎总应使用 `-r`。

## 1. 全部参数

```text
read [-Eers] [-a ANAME] [-d DELIM] [-i TEXT] [-n NCHARS]
     [-N NCHARS] [-p PROMPT] [-t TIMEOUT] [-u FD] [NAME ...]
```

| 参数 | 含义 |
|---|---|
| `-r` | 反斜杠不转义，原样读取 |
| `-d DELIM` | 读到 DELIM 首字符；空 DELIM 表示 NUL |
| `-n N` | 最多 N 字符，遇 delimiter 可提前结束 |
| `-N N` | 精确 N 字符，除 NUL 外忽略 delimiter |
| `-t SEC` | 超时，可为小数；只对终端、pipe、socket 等有效 |
| `-u FD` | 从指定 FD 读取 |
| `-a ARRAY` | 分词结果写数组并先清空数组 |
| `-p PROMPT` | 交互提示，不加换行 |
| `-s` | 终端输入不回显 |
| `-e/-E` | 使用 Readline，`-E` 不启用默认补全 |
| `-i TEXT` | Readline 初始文本，需配合 `-e/-E` |

无 NAME 时写 `REPLY`，且不做普通 IFS 分词。

## 2. 安全循环

```bash
while IFS= read -r line || [[ -n $line ]]; do
  printf '%s\\n' "$line"
done < input.txt

while IFS= read -r -d '' path; do
  printf '%q\\n' "$path"
done < <(find . -type f -print0)
```

`IFS=` 防止去掉前后 IFS whitespace；`-r` 保留反斜杠；末尾的条件处理最后一行无换行。NUL 记录适合任意 Unix 文件名。

## 3. Pipeline 子 Shell 陷阱

```bash
count=0
producer | while read -r line; do ((count++)); done
printf '%s\\n' "$count"  # 常仍为 0
```

pipeline 每段通常在 subshell，循环内变量不回写父 Shell。改用输入重定向或 process substitution，或理解并显式配置 `lastpipe` 的限制。

## 4. 退出状态与敏感输入

EOF 非零，超时返回大于 128 的状态（具体以版本为准）。`-s` 只关闭终端回显，值仍在 Shell 内存，后续 `set -x`、进程参数或日志可能泄露。不要把密码通过 argv 传给其他程序。

## 5. 验收与参考

能读取包含空格、反斜杠、无末尾换行和 NUL 分隔的输入，能解释 IFS 和 pipeline subshell，正确处理 EOF/timeout。

- [Bash Builtins：read](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[mapfile 命令详解](./07-mapfile命令详解.md)。
