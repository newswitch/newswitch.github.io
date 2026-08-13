---
title: getopts 与 shift 命令详解：脚本短选项、位置参数与错误契约
sidebar_position: 14
description: 完整讲解 Bash getopts 的 optstring、OPTIND/OPTARG/OPTERR、静默模式、-- 与 shift 边界。
tags: [Linux, Bash, getopts, shift, CLI]
---

# `getopts` 与 `shift`：构建脚本命令行接口

`getopts` 每次解析一个短选项并更新 `OPTIND/OPTARG`；`shift` 删除已处理的位置参数。二者一起形成 POSIX 风格脚本 CLI。Bash builtin `getopts` 不原生解析 GNU 长选项。

## 1. getopts 语法

```text
getopts OPTSTRING NAME [ARG ...]
```

OPTSTRING 中每个字符是允许的短选项；字符后冒号表示需要参数。默认解析 `$@`，给 ARG 时解析指定列表。结果：

- 选项字母写入 NAME；
- 参数写入 `OPTARG`；
- 下一位置索引写入 `OPTIND`，初始为 1；
- 结束时 NAME 为 `?` 且返回非零。

OPTSTRING 以冒号开头进入静默错误模式：未知选项时 NAME=`?`、OPTARG=字符；缺参数时 NAME=`:`、OPTARG=字符。否则 getopts 自己诊断，可用 `OPTERR=0` 关闭。

## 2. 标准模板

```bash
usage() { printf 'usage: %s [-v] [-o file] -- args...\\n' "$0" >&2; }

verbose=false output=
while getopts ':vo:' opt; do
  case $opt in
    v) verbose=true ;;
    o) output=$OPTARG ;;
    :) printf 'option -%s needs an argument\\n' "$OPTARG" >&2; usage; exit 2 ;;
    ?) printf 'unknown option: -%s\\n' "$OPTARG" >&2; usage; exit 2 ;;
  esac
done
shift "$((OPTIND - 1))"
```

调用函数多次解析新列表前局部设置 `OPTIND=1`；Bash 不自动为同一 Shell 的下一轮重置。

## 3. shift 语法与风险

```text
shift [N]
```

默认删除 `$1`；N 必须在 `0..$#`，超范围非零且参数不变。永远先由解析器计算 N，不用不可信字符串直接做算术 shift。

`--` 让调用者结束选项，getopts 会推进到其后。负数作为业务参数时也建议调用者显式使用 `--`。

## 4. 验收与参考

能定义未知选项、缺参、help 的稳定退出码，保留剩余参数边界，正确重置 OPTIND，并明确长选项是否由另一解析层实现。

- [Bash Bourne Shell Builtins：getopts/shift](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)

下一篇：[trap 命令详解](./15-trap命令详解.md)。
