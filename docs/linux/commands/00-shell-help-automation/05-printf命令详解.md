---
title: "printf 命令详解：格式化、转义、变量赋值与安全输出"
sidebar_label: "05. printf 命令详解：格式化、转义、变量赋值与安全输出"
sidebar_position: 5
description: "完整讲解 Bash printf 的 -v、格式说明、%q/%Q/%b/%T、宽度精度、locale、重复格式和 format string 风险。"
tags: [Linux, Bash, printf, 格式化, 安全脚本]
---

# printf 命令详解：格式化、转义、变量赋值与安全输出

Bash `printf` 按格式字符串输出，行为比跨实现的 `echo -e/-n` 更可预测。它还支持 shell-escaped `%q`、时间 `%T` 和 `-v` 赋值；格式字符串如果来自不可信输入会成为注入或异常输出入口。

## 1. 语法与选项

```text
printf [-v VAR] FORMAT [ARGUMENTS]
```

`-v VAR` 把结果写入变量而非 stdout。FORMAT 会循环复用直到消耗完参数；参数不足时数值按 0、字符串按空值处理。

| 格式 | 含义 |
|---|---|
| `%s`、`%c` | 字符串、首字符 |
| `%d/%i`、`%u`、`%o`、`%x/%X` | 有符号、无符号、八进制、十六进制整数 |
| `%f/%e/%g` | 浮点格式 |
| `%b` | 解释参数中的反斜杠转义；反斜杠 c 停止输出 |
| `%q`、`%Q` | 输出可重用的 shell-quoted 形式 |
| `%(FMT)T` | strftime 时间；参数 -1 当前时间、-2 Shell 启动时间 |
| `%%` | 百分号 |

支持 flags、field width、precision 以及 `*` 动态宽度或精度，也支持换行、制表符、十六进制和 Unicode 等反斜杠转义。

## 2. 安全模式

```bash
printf '%s\\n' "$user_input"
printf 'name=%q\\n' "$name"
printf -v timestamp '%(%FT%T%z)T' -1
printf '%s\\0' "${files[@]}"
```

永远不要把用户输入直接当 FORMAT：其中百分号和转义会被二次解释。固定 FORMAT，把输入只放参数位置。`%q` 适合诊断和生成 Bash 可读文字，不是 JSON、SQL 或 HTML 转义。

## 3. 数字、locale 与错误

数字参数可接受 shell/C 常量形式；locale 影响小数点与字符宽度。自动化可设 `LC_ALL=C` 获得稳定机器格式，但不要让它悄悄改变用户可见语言逻辑。

无效格式、写入失败或 `-v` 变量错误会非零退出；管道下还要用 `pipefail` 捕获 broken pipe。

## 4. 验收与参考

能用 NUL 安全输出数组，区分 `%s/%b/%q`，理解格式复用、宽度精度和 locale，并坚持“格式固定、数据入参”。

- [Bash Builtins：printf](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[read 命令详解](./06-read命令详解.md)。
