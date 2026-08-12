---
title: awk/gawk 命令详解：记录、字段、Pattern-Action、数组与安全变量传递
sidebar_position: 25
description: 系统讲解 gawk -F/-v/-f/-e/-i/-l、记录字段、BEGIN/END、范围、数组、函数、getline、输出重定向与注入边界。
tags: [Linux, awk, gawk, 文本处理, 数据分析]
---

# `awk` / `gawk` 命令详解：面向记录与字段的语言

awk 对每个输入记录依次执行匹配的 `pattern { action }`，天然适合列式日志、报表和小型聚合。GNU `gawk` 扩展了网络、动态扩展、强类型 regexp 等能力；生产脚本要声明依赖的是 POSIX awk 还是 gawk。

## 1. gawk CLI 参数

```text
gawk [POSIX or GNU style options] -f PROGRAM-FILE [--] FILE...
gawk [OPTIONS] [--] 'PROGRAM' FILE...
```

| 参数 | 含义 |
|---|---|
| `-F FS, --field-separator=FS` | 输入字段分隔符 |
| `-v VAR=VAL, --assign=VAR=VAL` | 程序开始前赋值，适合安全传参 |
| `-f FILE, --file=FILE` | 程序文件，可重复 |
| `-e TEXT, --source=TEXT` | 与 `-f` 同时提供 inline source |
| `-i FILE, --include=FILE` | 加载 awk library |
| `-l LIB, --load=LIB` | 动态扩展库，属于代码加载边界 |
| `-b, --characters-as-bytes` | 按 bytes 而非 multibyte chars |
| `-c, --traditional`、`-P, --posix` | 兼容/严格 POSIX 模式 |
| `--lint[=MODE]`、`-L` | 检查可移植性/可疑结构 |
| `-p FILE, --profile=FILE` | profile/pretty print |
| `-D FILE, --debug[=FILE]` | debugger |
| `-M, --bignum` | MPFR/GMP 数值（若构建支持） |
| `-E FILE, --exec=FILE` | 程序文件并结束 option parsing |
| `-S, --sandbox` | 禁 system、重定向、pipe、动态扩展等副作用 |

## 2. 对象模型

| 变量 | 含义 |
|---|---|
| `RS/ORS` | 输入/输出记录分隔符 |
| `FS/OFS` | 输入/输出字段分隔符 |
| `$0`、`$1..$NF`、`NF` | 整条记录、字段、字段数 |
| `NR/FNR` | 全局/当前文件记录号 |
| `FILENAME/ARGC/ARGV` | 当前文件和参数 |
| `RSTART/RLENGTH` | `match()` 结果 |
| `SUBSEP` | 多维数组下标连接符 |

`BEGIN` 在输入前，普通 rule 对每条记录，`END` 在结束时；`BEGINFILE/ENDFILE` 是 gawk 扩展。pattern 可为表达式、regexp、`pat1,pat2` 范围或特殊 block。

## 3. 安全传参

```bash
awk -v threshold="$threshold" '
  $3 + 0 > threshold { count[$1]++ }
  END { for (k in count) print k, count[k] }
' data.tsv
```

不要把用户内容拼进 program source：`awk '$1 ~ /'$pattern'/'` 会破坏 quoting 或注入 awk 语法。用 `-v pattern="$pattern"`，再 `$1 ~ pattern`。注意 dynamic regexp 仍可能造成复杂匹配开销。

## 4. 数值、排序与 IO

awk 字符串和数字会隐式转换，`08`、科学计数、NaN、locale 小数点都要明确。关联数组迭代默认无稳定顺序；gawk 可用 `PROCINFO["sorted_in"]`，可移植脚本输出后交给 `sort`。

`getline`、`print > file`、`command | getline`、`system()` 会引入文件/命令副作用和资源泄漏；动态文件/管道用完 `close()`。不可信程序使用 `--sandbox`，但它不替代 OS 沙箱。

## 5. 验收与参考

能用记录/字段和数组完成聚合，安全传变量，解释隐式类型/locale/无序数组，并区分 POSIX awk 和 gawk 扩展。

- [GNU Awk User's Guide](https://www.gnu.org/software/gawk/manual/gawk.html)

下一篇：[jq 命令详解](./26-jq命令详解.md)。
