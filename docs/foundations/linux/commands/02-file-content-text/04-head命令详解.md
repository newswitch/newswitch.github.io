---
title: head 命令详解：按行、字节与 NUL 记录截取前部
sidebar_position: 4
description: 完整讲解 GNU coreutils head 的全部参数、正负计数、单位后缀、多文件头、NUL 记录、不可 seek 输入、SIGPIPE 和多字节字符风险。
tags: [Linux, head, GNU coreutils, 流式处理, 日志]
---

# `head` 命令详解：按行、字节与 NUL 记录截取前部

`head` 默认输出每个输入的前 10 行。它既能输出前 N 条，也能输出“除最后 N 条以外的全部内容”；后者往往必须保留尾部缓冲，不能误认为永远只读开头。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]` |
| 主要对象 | 行、字节或 NUL 记录序列的前部 |

```bash
type -a head
env head --version
env head --help
```

## 2. 完整语法与默认输出

```text
head [OPTION]... [FILE]...
```

无文件或 `FILE=-` 时读取标准输入。多个文件默认在各自输出前显示：

```text
==> filename <==
```

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-c [-]N` | `--bytes=[-]N` | 输出前 N 字节；`-N` 表示除最后 N 字节外全部输出 |
| `-n [-]N` | `--lines=[-]N` | 输出前 N 行；`-N` 表示除最后 N 行外全部输出 |
| `-q` | `--quiet`、`--silent` | 从不显示文件名头 |
| `-v` | `--verbose` | 即使只有一个输入也显示文件名头 |
| `-z` | `--zero-terminated` | 用 NUL 而非 LF 切分和结束记录 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

不要混淆 `head -n -5` 与 `tail -n +5`：前者排除末尾 5 行；后者从第 5 行开始。

## 4. 计数单位全集

`-c` 与 `-n` 支持数字后缀：

| 后缀 | 倍数 |
|---|---:|
| `b` | 512 |
| `KB` | 1000 |
| `K`、`KiB` | 1024 |
| `MB` | 1000² |
| `M`、`MiB` | 1024² |
| `GB/G/GiB` | 分别为 1000³/1024³/1024³ |
| `T/P/E/Z/Y/R/Q` 及十进制/二进制长形式 | 继续按相应幂扩展 |

行数也接受这些倍数，但 `head -n 1M` 表示 1,048,576 行，不是字节。

## 5. 前 N 条与排除末尾 N 条

```bash
head -n 20 -- app.log
head -c 4096 -- packet.bin
head -n -5 -- records.txt
head -c -16 -- signed.payload
```

对普通文件，工具可结合文件大小优化。对管道/FIFO，`head -n -5` 必须一直读取到 EOF，同时保留足够尾部记录；若输入无限增长，它永远无法确认“最后 5 行”。

## 6. 行、字节和字符边界

```bash
head -c 4 -- utf8.txt
```

`-c` 按字节，可能截断 UTF-8 字符、压缩流、图像头或协议帧。需要“前 N 个 Unicode 字符”时选择了解编码的工具；需要有效结构时使用格式解析器。

`-n` 保留记录原始字节，但如果第 N 行没有末尾 LF，输出也不会凭空添加换行。

## 7. NUL 记录

```bash
find /data -type f -print0 | head -z -n 10 |
while IFS= read -r -d '' path; do
  printf '%q\n' "$path"
done
```

这里 N 表示 NUL 记录数量。全链路必须保持 NUL；命令替换不能保存 NUL。

## 8. 多文件头控制

```bash
head -n 3 -- one two
head -q -n 3 -- one two
head -v -n 3 -- one
```

机器处理多文件结果时，默认 header 会污染数据流。使用 `-q`，或分别处理并自行增加结构化来源字段。

## 9. 管道、提前退出与 SIGPIPE

```bash
producer | head -n 100
```

`head` 读够 100 行后通常退出并关闭管道，上游继续写时收到 SIGPIPE。这是有限采样的正常机制，但会影响 `pipefail`：

```bash
set -o pipefail
producer | head -n 100
rc=$?
stages=("${PIPESTATUS[@]}")
```

对于会产生副作用的 producer，不能假定它只因下游停止就完成清理或提交；应查看该程序的 SIGPIPE 行为。

## 10. 旧语法与兼容性

GNU 仍兼容首参数形式 `-NUM[bkm][cqv]`，例如历史上的 `head -5`，但解析可能与文件名或现代选项冲突。新脚本统一写：

```bash
head -n 5 -- file
```

BSD/BusyBox 参数集合不同，特别是 `-z` 和负计数；部署脚本应检测实现。

## 11. 生产场景

### 11.1 低成本查看日志开头

```bash
head -n 100 -- app.log
```

普通前 N 行可以很早停止；适合确认版本头、CSV header、启动阶段日志。

### 11.2 检查文件头字节

```bash
head -c 64 -- artifact | od -An -tx1 -c
```

### 11.3 去掉尾部校验行

```bash
head -n -1 -- export.txt
```

对无限流和超大非 seek 输入仍需读到 EOF；若是结构化文件，优先由解析器识别 trailer。

## 12. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取或写入失败。

| 现象 | 检查方向 |
|---|---|
| 命令一直不结束 | 使用负计数且输入未 EOF/无限流 |
| 中文末尾乱码 | `-c` 截断多字节字符 |
| 多文件输出多出文本 | 默认文件名 header，使用 `-q` |
| 下游只收到部分最后行 | 原输入没有末尾分隔符或上游失败 |
| pipefail 报错 | 上游预期 SIGPIPE 与真实失败的区分 |
| `head -5` 跨平台异常 | 改用 `-n 5` |

## 13. 动手实验

1. 比较默认、`-n 0`、`-n 1`、`-n -1`。
2. 对有/无末尾 LF 的文件观察原始字节。
3. 用 UTF-8 中文比较 `-c 1..6`。
4. 在两个文件上比较默认、`-q/-v`。
5. 用 NUL 文件名流验证 `-z`。
6. 对有限管道和持续 FIFO 比较正计数与负计数。
7. 开启 pipefail 记录上下游退出状态。

## 14. 掌握标准

- 能列出 `head` 全部参数和计数后缀规则。
- 能解释正计数与负计数的读取需求。
- 能区分行、字节、字符和 NUL 记录。
- 能处理多文件 header 和上游 SIGPIPE。
- 能说明为什么 `head -c` 不能保证有效字符或文件格式。

## 官方参考

- [GNU coreutils 9.11：head invocation](https://www.gnu.org/software/coreutils/manual/html_node/head-invocation.html)
- [Linux pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)

上一篇：[`nl` 命令详解](./03-nl命令详解.md)

下一篇：[`tail` 命令详解](./05-tail命令详解.md)

