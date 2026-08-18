---
title: "join 命令详解：按有序字段连接两个文件"
sidebar_label: "12. join 命令详解：按有序字段连接两个文件"
sidebar_position: 12
description: "完整讲解 GNU coreutils 9.11 join 的全部参数、连接键、预排序、内外连接、差集、输出字段、缺失值、header、大小写、NUL 记录、重复键笛卡尔组合和数据边界。"
tags: [Linux, join, GNU coreutils, 数据连接, 排序]
---

# join 命令详解：按有序字段连接两个文件

`join` 对两个按连接键有序的文本流执行 merge join。默认输出键相等的配对行；它不是通用 CSV/JSON 解析器，也不会自动排序或验证 schema。重复键还会产生两组记录的笛卡尔组合，可能放大输出规模。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；输出规模可能因重复键显著膨胀 |
| 主要对象 | 两个有序输入、连接字段、配对和未配对记录 |

```bash
type -a join
env join --version
env join --help
```

## 2. 完整语法与默认行为

```text
join [OPTION]... FILE1 FILE2
```

两个文件中恰好最多一个可以是 `-` 标准输入。默认：

- 两边都用第 1 字段连接。
- 一段或多段 blank 分隔字段，忽略行首 blank。
- 只输出匹配行，即 inner join。
- 输出为连接键、FILE1 其余字段、FILE2 其余字段，以单个空格分隔。

```bash
LC_ALL=C join file1.sorted file2.sorted
```

## 3. GNU coreutils 9.11 全部参数

| 参数 | 作用 |
|---|---|
| `-a 1`、`-a 2` | 除匹配外，也输出指定文件的未配对行；可同时给两边形成 full outer 风格 |
| `--check-order` | 发现任一输入未按连接键排序时失败 |
| `--nocheck-order` | 不检查顺序；无序输入结果不保证 |
| `-e STRING` | 对 `-o` 等请求但输入中缺失的字段输出 STRING |
| `--header` | 把各文件第一行作为 header 连接并先输出，不参与顺序检查 |
| `-i`、`--ignore-case` | 连接键比较忽略大小写；输入也必须按相同规则排序 |
| `-1 FIELD` | FILE1 使用正整数 FIELD 作为连接键 |
| `-2 FIELD` | FILE2 使用正整数 FIELD 作为连接键 |
| `-j FIELD` | 等价于 `-1 FIELD -2 FIELD` |
| `-o FIELD-LIST` | 指定输出字段；元素为 `0`、`1.N`、`2.N` |
| `-o auto` | 根据两文件首行推断固定输出列数，缺失用 `-e`，多余字段丢弃 |
| `-t CHAR` | 指定输入和输出字段分隔字符；空值把整行视为一个字段，`'\0'` 表示 NUL 字段分隔 |
| `-v 1`、`-v 2` | 只输出指定文件的未配对行，抑制正常匹配 |
| `-z`、`--zero-terminated` | 使用 NUL 而不是 LF 分隔记录；LF 可成为字段分隔 blank |
| `--help` | 显示帮助并退出 |
| `--version` | 显示版本并退出 |

## 4. 连接键和字段语义

```bash
join -1 2 -2 1 --check-order users.by-id usage.by-id
join -j 3 file1 file2
```

默认 blank 分隔会折叠一段空格/TAB并忽略行首 blank。指定 `-t ':'` 后，每个冒号都重要，连续冒号产生空字段：

```bash
join -t: -1 3 -2 1 /etc/passwd data.by-uid
```

`-t ''` 把整行视为唯一字段；`-t '\0'` 则把 NUL 作为字段分隔字节，两者完全不同。

`join` 的字段语义不理解 CSV 引号、字段内 delimiter 或字段内 LF。结构化格式必须使用专用解析器。

## 5. 预排序是硬契约

若 FILE1 按第 2 字段、FILE2 按第 1 字段连接：

```bash
LC_ALL=C sort -k2,2 -o file1.sorted -- file1
LC_ALL=C sort -k1,1 -o file2.sorted -- file2
LC_ALL=C sort -C -k2,2 -- file1.sorted
LC_ALL=C sort -C -k1,1 -- file2.sorted
LC_ALL=C join --check-order -1 2 -2 1 file1.sorted file2.sorted
```

如果 `join -i`，预排序必须使用 `sort -f`；若用 `-t`，sort 也要使用相同 separator 且通常不能额外 `-b`：

```bash
LC_ALL=C sort -f -t: -k2,2 -- input > sorted
LC_ALL=C join -i -t: -1 2 -2 1 --check-order sorted other.sorted
```

`--nocheck-order` 只关闭诊断。强行处理无序输入不会退化成哈希连接，输出没有保证。

## 6. inner、left、right、full 和 anti join

| 目标 | 参数 |
|---|---|
| inner | 默认 |
| left outer 风格 | `-a1` |
| right outer 风格 | `-a2` |
| full outer 风格 | `-a1 -a2` |
| left anti | `-v1` |
| right anti | `-v2` |
| 两边所有未配对 | `-v1 -v2` |

```bash
join -a1 -a2 -e NA -o 0,1.2,2.2 file1 file2
join -v1 file1 file2
```

这里“outer 风格”是文本输出语义；没有 SQL 类型、NULL、schema 和事务。

## 7. `-o` 输出字段

FIELD-LIST 元素：

| 元素 | 含义 |
|---|---|
| `0` | 连接键；外连接两边都有未配对行时必须用它才能统一输出键 |
| `1.N` | FILE1 第 N 字段 |
| `2.N` | FILE2 第 N 字段 |

```bash
join -o 0,1.2,2.3 file1 file2
join -o '0 1.2 2.3' file1 file2
```

逗号或 blank 都可分隔 FIELD-LIST；含 blank 时必须引用。所有正常和 `-a/-v` 输出都遵循同一个格式。

`-e NA` 只填补“被输出格式请求但对应输入缺失”的字段，不会把原文件中的空字段自动改成 NA。

## 8. `-o auto` 与 header

```bash
join --header -o auto -e NA -a1 -a2 file1 file2
```

- `--header` 连接首行并先输出；即使两边连接标题不同，也采用 FILE1 的连接字段标题。
- header 不参与 `--check-order`。
- `-o auto` 用首行推断列数，确保每条输出字段数一致；少字段填 `-e`，多字段丢弃。
- 推断不是 schema 校验，正文列数异常仍可能被静默填补或截断。

如果文件没有 header 却误加 `--header`，第一条业务记录会被当标题并绕过排序检查。

## 9. 重复键和输出膨胀

若 FILE1 一个键有 M 行，FILE2 同键有 N 行，join 输出 M×N 个配对：

```text
file1: k A1, k A2
file2: k B1, k B2, k B3
output: 6 lines
```

生产前统计键基数和最大重复度：

```bash
cut -d: -f1 file1 | uniq -c | sort -nr | head
cut -d: -f1 file2 | uniq -c | sort -nr | head
```

前提仍是键已相邻。若预期一对一，发现重复应先失败，而不是让 join 放大数据。

## 10. 大小写与 locale

```bash
LC_ALL=C sort -f -k1,1 file1 > file1.sorted
LC_ALL=C sort -f -k1,1 file2 > file2.sorted
LC_ALL=C join -i --check-order file1.sorted file2.sorted
```

大小写折叠可能让多个原始拼写成为同一键，触发笛卡尔组合。Unicode 大小写规则也不等同数据库 collation；跨系统连接最好先生成规范化、明确编码的键。

## 11. NUL 记录

```bash
join -z -t: -1 1 -2 1 left.nul right.nul
```

`-z` 保护记录内换行，但 `-t:` 仍无法保护字段内冒号。二维任意数据需要更强的编码协议，不能只靠 NUL 解决所有字段边界。

## 12. 与 `paste`、`comm`、数据库的区别

| 工具 | 关系 |
|---|---|
| `paste` | 按记录序号横向拼接，不看 key |
| `comm` | 整条有序记录的交集/差集 |
| `join` | 按一个有序字段做 merge join |
| awk/Python/SQL | 可处理无序输入、复杂字段、类型、多个键和更强 schema |

数据大且已按键有序时 join 很高效；输入无序或语义复杂时，不要为了使用它而制造脆弱文本协议。

## 13. 退出状态与排查

`0` 正常完成，非 `0` 表示参数、读取、排序校验或写入失败。没有匹配行不是错误。

| 现象 | 检查方向 |
|---|---|
| 没有匹配 | 字段号、separator、locale、CRLF、空白和大小写 |
| 结果漏行/乱序 | 输入未按连接键排序 |
| 输出突然爆炸 | 两边同键重复造成 M×N |
| outer 输出键为空 | `-o` 应使用字段 `0` |
| 首条数据消失 | 错误使用 `--header` |
| 列数看似正常但数据被截断 | `-o auto` 按首行推断 |
| CSV 连接错误 | 单字符分隔不理解 quoted field |

## 14. 动手实验

1. 建立默认第 1 字段 inner join。
2. 使用不同字段号和 `-t`，写出对应 sort 命令。
3. 验证 inner、两种 outer、full 和 anti 组合。
4. 用 `-o 0,1.N,2.N` 和 `-e` 控制输出。
5. 测试 header 与 auto，故意制造正文列数异常。
6. 构造 2×3 重复键验证 6 条输出。
7. 故意破坏顺序比较 check/nocheck。
8. 在 NUL 记录中包含换行，验证 `-z`。

## 15. 掌握标准

- 能列出 `join` 全部参数和默认字段语义。
- 能为任意连接字段生成完全一致的预排序命令。
- 能表达 inner、outer 和 anti 需求。
- 能用 `-o/0/-e` 设计稳定输出。
- 能预判重复键笛卡尔放大、header 推断和结构化格式边界。

## 16. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：join invocation](https://www.gnu.org/software/coreutils/manual/html_node/join-invocation.html)
- [GNU coreutils：Pre-sorting](https://www.gnu.org/software/coreutils/manual/html_node/Pre_002dsorting.html)
- [POSIX join](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/join.html)

上一篇：[`comm` 命令详解](./11-comm命令详解.md)

下一篇：[`tr` 命令详解](./13-tr命令详解.md)
