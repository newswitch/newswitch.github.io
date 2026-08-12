---
title: mapfile/readarray 命令详解：批量读取数组、分隔符与回调
sidebar_position: 7
description: 完整讲解 Bash mapfile/readarray 的 -d/-t/-n/-O/-s/-u/-C/-c、NUL 记录、内存边界与 callback 时机。
tags: [Linux, Bash, mapfile, 数组, 自动化]
---

# `mapfile` / `readarray` 命令详解：把记录批量读入数组

`mapfile` 从 FD 读取记录到 indexed array，`readarray` 是同义词。它避免 `for x in $(command)` 的分词和 glob 错误，但会把数据整体保存在内存，不适合无限流或超大输入。

## 1. 全部参数

```text
mapfile [-d DELIM] [-n COUNT] [-O ORIGIN] [-s COUNT] [-t]
        [-u FD] [-C CALLBACK] [-c QUANTUM] [ARRAY]
```

| 参数 | 含义 |
|---|---|
| `-d DELIM` | 记录分隔符；空值读取 NUL 分隔 |
| `-t` | 删除每条末尾 delimiter |
| `-n COUNT` | 最多读取 COUNT 条；0 表示全部 |
| `-O ORIGIN` | 从数组下标 ORIGIN 写，不清空既有数组 |
| `-s COUNT` | 先跳过 COUNT 条 |
| `-u FD` | 从 FD 读取 |
| `-C CALLBACK` | 每 QUANTUM 条调用 callback |
| `-c QUANTUM` | callback 周期，默认 5000 |

未指定 ARRAY 时使用 `MAPFILE`。未给 `-O` 会先清空目标数组。

## 2. 可靠用法

```bash
mapfile -t lines < config.list
mapfile -d '' -t files < <(find . -type f -print0)
printf '%s\\n' "${files[@]}"
```

`"${array[@]}"` 才逐元素保留边界；未加引号或使用 `${array[*]}` 会重新拼接或分词。

## 3. Callback 语义

callback 在给数组元素赋值之前执行，Bash 会把即将写入的下标和该行作为额外参数附加到 callback 字符串。callback 字符串会再次按 Shell 语法求值，不要由不可信输入拼接。

```bash
progress() { printf 'next-index=%s\\n' "$1" >&2; }
mapfile -t -C progress -c 1000 rows < data.txt
```

## 4. 边界与验收

大文件用 `while IFS= read -r` 流式处理；来自命令的 mapfile 要检查 producer 退出状态，process substitution 不自动传回其状态。验收标准：能用 NUL 安全收集路径、正确展开数组，并为输入量设置上限。

## 5. 官方参考

- [Bash Builtins：mapfile](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[declare 命令详解](./08-declare命令详解.md)。
