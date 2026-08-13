---
title: tac 命令详解：按记录逆序输出文件
sidebar_position: 2
description: 完整讲解 GNU coreutils tac 的全部参数、分隔符归属、正则记录、NUL 记录、普通文件与管道缓冲、临时空间和大文件风险。
tags: [Linux, tac, GNU coreutils, 记录逆序, 文本处理]
---

# `tac` 命令详解：按记录逆序输出文件

`tac` 对每个输入文件分别逆序输出记录，默认记录就是以换行结束的行。它不是逐字符反转，也不会把多个文件先合成一个整体再逆序。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；不可 seek 输入可能消耗大量临时磁盘 |
| 主要对象 | 由字符串或正则分隔的记录 |

```bash
type -a tac
env tac --version
env tac --help
```

## 2. 完整语法与全部参数

```text
tac [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-b` | `--before` | 分隔符属于它后面的记录，而非前面的记录 |
| `-r` | `--regex` | 把分隔字符串当正则表达式 |
| `-s SEP` | `--separator=SEP` | 使用 SEP 代替换行；空 SEP 表示 NUL |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件或 `FILE=-` 时读取标准输入。每个输入单独逆序：

```bash
tac one two
```

结果是 `one` 的记录倒序，随后是 `two` 的记录倒序，不等于 `cat one two | tac`。

## 3. 默认行逆序

```bash
printf '1\n2\n3\n' | tac
```

输出：

```text
3
2
1
```

如果最后一行没有换行，分隔符归属会影响边界显示；用 `od -c` 观察原始输出，不要只看终端视觉结果。

## 4. 自定义分隔符与 `-b`

```bash
printf 'a::b::c::' | tac -s '::'
```

默认分隔符附着于前一条记录。`-b` 改为附着于后一条记录：

```bash
printf '::a::b::c' | tac -b -s '::'
```

选择取决于协议：如果分隔字符串实际上是下一段的“开始标记”，使用 `-b` 更自然；如果是前一段的“结束标记”，保持默认。

## 5. 正则分隔符

```bash
tac -r -s '^---+$' -- sections.txt
```

`-r` 使用 GNU 正则语义；locale、换行匹配和 BRE 语法会影响结果。必须引用正则，防止 Shell 展开。

风险：能匹配空字符串的正则、极端回溯或巨型记录可能造成异常输出、CPU 或内存/临时 IO 压力。先在小样本验证记录边界：

```bash
grep -n -- '^---\+$' sections.txt
```

## 6. NUL 记录

空分隔符表示 NUL：

```bash
printf 'a\0b c\0d\ne\0' | tac -s '' | od -An -tx1 -c
```

这适合逆序 `find -print0` 之类的任意文件名流。下游仍必须支持 NUL；不要再通过命令替换或普通行循环消费。

## 7. seek、管道与临时文件

普通文件可随机定位，`tac` 能从尾部查找记录。管道、FIFO、Socket 等不可 seek 输入必须先完整读完，GNU `tac` 会缓冲到 `$TMPDIR`，未设置或不可用时通常使用 `/tmp`。

```bash
TMPDIR=/var/tmp tac < huge.stream > reversed.stream
```

生产前检查：

- 临时目录可用空间、inode 和配额。
- 输入是否无限；无限流永远不会进入完整逆序输出阶段。
- 临时目录权限和挂载选项。
- 输入是否敏感，临时存储是否符合数据保护要求。
- 中断后的临时文件清理是否由实现可靠完成。

`tac` 不适合实时日志持续倒序。对有限日志尾部，先 `tail -n N` 再 `tac`：

```bash
tail -n 200 -- app.log | tac
```

## 8. 与 `sort -r`、`tail -r` 区别

| 命令 | 语义 |
|---|---|
| `tac` | 保持记录内容不变，反转原始顺序 |
| `sort -r` | 按比较规则降序重新排序 |
| BSD `tail -r` | 非 GNU 接口且实现限制不同 |

要复现“事件发生顺序反向”，用 `tac`；要按时间字段或数值排序，先解析字段再 `sort`。

## 9. 退出状态与排查

`0` 成功，非 `0` 表示读取、正则、临时文件或输出失败。

| 现象 | 检查方向 |
|---|---|
| 管道长时间无输出 | 必须先读完整个不可 seek 输入 |
| `/tmp` 爆满 | 输入过大、TMPDIR 选择、配额 |
| 记录边界错位 | SEP 是否为文本/正则、`-b`、缺少尾分隔符 |
| 两文件整体顺序不对 | 每个文件单独逆序；需要时先 cat 成一个流 |
| 正则没有匹配 | BRE 语法、locale、引用、CRLF |
| 输出损坏多字节字符 | tac 按记录搬运，不应改记录；检查分隔正则是否切入字节序列 |

## 10. 生产场景

### 10.1 查看最近事件并从新到旧排列

```bash
tail -n 1000 -- app.log | tac | head -n 100
```

它按物理行处理，多行堆栈会被拆散；结构化日志应按事件协议解析。

### 10.2 逆序 NUL 文件名列表

```bash
find /data -type f -print0 | tac -s '' |
while IFS= read -r -d '' path; do
  printf '%q\n' "$path"
done
```

### 10.3 按块标记逆序配置段

先证明分隔符不会出现在内容中，再选择默认或 `-b` 的归属；对 YAML/JSON 等结构化格式优先使用专用解析器。

## 11. 动手实验

1. 比较有/无末尾换行的三行文件。
2. 用双字符分隔符比较默认与 `-b`。
3. 使用正则分隔多个不同长度的标记。
4. 用空 SEP 逆序包含空格和换行的 NUL 记录。
5. 比较 `tac one two` 与 `cat one two | tac`。
6. 给普通文件与管道输入同样的大数据，观察临时空间和首次输出时间。

## 12. 掌握标准

- 能列出 `tac` 的全部参数。
- 能解释分隔符默认属于前一记录以及 `-b` 的改变。
- 能区分反转顺序与排序。
- 能使用 NUL 记录且保持全链路安全。
- 能预判不可 seek 输入的完整缓冲、空间与无限流问题。

## 官方参考

- [GNU coreutils 9.11：tac invocation](https://www.gnu.org/software/coreutils/manual/html_node/tac-invocation.html)
- [Linux lseek(2)](https://man7.org/linux/man-pages/man2/lseek.2.html)

上一篇：[`cat` 命令详解](./01-cat命令详解.md)

下一篇：[`nl` 命令详解](./03-nl命令详解.md)

