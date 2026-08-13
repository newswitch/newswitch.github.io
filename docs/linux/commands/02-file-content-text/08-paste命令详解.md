---
title: paste 命令详解：按列或串行合并记录
sidebar_position: 8
description: 完整讲解 GNU coreutils paste 的全部参数、并行与串行模式、循环分隔符、转义、标准输入复用、NUL 记录、不等长输入和表格数据边界。
tags: [Linux, paste, GNU coreutils, 字段合并, NUL]
---

# `paste` 命令详解：按列或串行合并记录

`paste` 把多个输入中相同序号的记录横向合并，或在 `-s` 下把每个文件的记录串成一行。它按位置连接，不按 key 关联；需要数据库式 join 时使用 `join`、awk、数据库或数据处理框架。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]` |
| 主要对象 | 多个行/NUL 记录序列与循环分隔符 |

```bash
type -a paste
env paste --version
env paste --help
```

## 2. 完整语法与全部参数

```text
paste [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-d LIST` | `--delimiters=LIST` | 按顺序循环使用 LIST 中的分隔字符，默认 TAB |
| `-s` | `--serial` | 一次处理一个文件，把其记录串成一条输出记录 |
| `-z` | `--zero-terminated` | 使用 NUL 而不是 LF 切分输入输出记录 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件时读取标准输入；`FILE=-` 在对应位置读取标准输入。

## 3. 默认并行模式

```bash
printf '1\n2\n' > numbers
printf 'a\nb\nc\n' > letters
paste numbers letters
```

输出：

```text
1<TAB>a
2<TAB>b
<TAB>c
```

输入长度不等时，已经 EOF 的输入提供空字段，直到最长输入结束。`paste` 不会报“行数不一致”；生产合并前应主动验证：

```bash
wc -l -- numbers letters
```

但无末尾 LF 时 `wc -l` 也要谨慎，可同时验证数据生产协议。

## 4. 串行模式 `-s`

```bash
paste -s numbers letters
```

每个文件各输出一行：

```text
1<TAB>2
a<TAB>b<TAB>c
```

```bash
seq 4 | paste -s -d ',' -
# 1,2,3,4
```

这不是 CSV 编码：字段中的逗号、引号、换行都不会转义。

## 5. 标准输入与多个 `-`

```bash
seq 6 | paste - - -
```

三个 `-` 依次从同一个标准输入取记录，得到三列：

```text
1<TAB>2<TAB>3
4<TAB>5<TAB>6
```

标准输入不会复制，也不能倒带。若行数不是列数的整数倍，最后一行用空字段补齐。

## 6. 分隔符列表与循环

```bash
paste -d '%_' one two three four
```

第一列与第二列间用 `%`，第二与第三列间用 `_`，列表耗尽后从头循环。

支持的转义：

| 写法 | 含义 |
|---|---|
| `\0` | 空字符串，不是 NUL 字节 |
| `\n` | 换行 |
| `\t` | TAB |
| `\\` | 反斜杠 |
| `\b` | 退格，GNU 扩展 |
| `\f` | 换页，GNU 扩展 |
| `\r` | 回车，GNU 扩展 |
| `\v` | 垂直 TAB，GNU 扩展 |

未转义反斜杠后没有字符是错误；GNU 对未知 `\X` 通常把它解释为 `X`。必须用单引号保护转义：

```bash
paste -d '\t,\0' a b c d
```

## 7. `\0` 与 `-z` 完全不同

- `-d '\0'`：列之间不输出任何分隔字节。
- `-z`：输入和输出记录以真正 NUL 分隔。

```bash
paste -z -d ':' -- left.nul right.nul | od -An -tx1 -c
```

NUL 记录适合任意文件名，但字段之间仍由 `-d` 决定。若字段内容可包含该分隔符，输出仍不是无歧义结构；可使用长度前缀、双层协议或语言数据结构。

## 8. 按位置连接与按 key 连接

假设两文件行顺序不同：

```text
# left             # right
u1 Alice           u2 20
u2 Bob             u1 10
```

`paste` 会把第一行配第一行，产生错误关联。按 key 合并应：

- 先验证/排序后使用 `join`。
- 使用 awk 哈希表。
- 使用 Python/pandas、SQL 或大数据框架。

`paste` 适合已经由同一顺序和相同记录数保证对齐的流。

## 9. 行尾和空记录

- 默认以 LF 为记录边界，CRLF 的 CR 会保留在字段尾部。
- 最后一条无 LF 仍可成为记录，但多工具组合的边界需实验验证。
- 空行是空字段值，不等于输入 EOF。
- 不等长输入用空字段补齐，视觉上可能与真实空字段无法区分。

诊断：

```bash
cat -A -- left right
od -An -tx1 -c -- left right
```

## 10. 生产场景

### 10.1 为编号和内容临时并列展示

```bash
paste <(seq 1 "$(wc -l < file)") file
```

无末尾 LF 时编号可能少一行，生产展示更直接使用 `nl -ba`。

### 10.2 将固定数量记录分成列

```bash
seq 12 | paste - - - -
```

### 10.3 合并同源指标列

```bash
paste -d $'\t' timestamps cpu_usage gpu_usage
```

前提是三文件由相同采样序号生成，并已经验证记录数、时间范围和缺失值策略。仅“行数相同”也不能证明时间对齐。

## 11. 流式、背压和资源

默认并行模式按轮次从各输入读取一条记录，内存通常与当前记录长度相关。超长单行仍可能占用大量内存。FIFO 输入若某一路迟迟不给下一条，整个对齐输出会等待；这不是死锁证明，而是位置同步的自然背压。

多个命名管道还可能因打开顺序互相等待。生产流合并最好使用明确支持超时、watermark、key 和缺失值的流处理系统。

## 12. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取或写入失败。

| 现象 | 检查方向 |
|---|---|
| 列错位 | 输入记录数/顺序不同，paste 不按 key |
| 行尾出现 `^M` | CRLF 的 CR 被保留 |
| `\t` 原样或参数异常 | Shell 引用和反斜杠转义 |
| 以为 `\0` 是 NUL | 它是空分隔；真正 NUL 记录用 `-z` |
| 管道一直等待 | 某输入未提供下一条或未关闭 |
| CSV 导入失败 | paste 不转义 delimiter、quote、newline |
| 缺失与真实空值无法区分 | 不等长补空字段，协议缺少 presence 标记 |

## 13. 动手实验

1. 合并 2 行与 3 行文件，观察空字段补齐。
2. 比较默认并行与 `-s`。
3. 用一个标准输入和多个 `-` 组成 3 列。
4. 测试多字符 delimiter list 的循环。
5. 逐个验证所有转义和 `\0`。
6. 用 NUL 记录验证 `-z`，再与 `-d '\0'` 比较字节。
7. 构造顺序错位的 key 文件，证明 paste 不是 join。
8. 用 FIFO 模拟一路变慢，观察背压。

## 14. 掌握标准

- 能列出 `paste` 全部参数和分隔符转义全集。
- 能解释并行、串行和多个 `-` 的消费方式。
- 能预测不等长输入、空记录和 CRLF 的输出。
- 能区分空分隔符与 NUL 记录。
- 能识别按位置连接的前提，并在按 key 场景选择正确工具。

## 官方参考

- [GNU coreutils 9.11：paste invocation](https://www.gnu.org/software/coreutils/manual/html_node/paste-invocation.html)
- [POSIX paste](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/paste.html)

上一篇：[`cut` 命令详解](./07-cut命令详解.md)

下一篇：[`sort` 命令详解](./09-sort命令详解.md)
