---
title: expand 命令详解：按制表位把 TAB 转为空格
sidebar_position: 14
description: 完整讲解 GNU coreutils expand 的全部参数、默认与自定义制表位、初始 TAB、绝对和相对重复规则、退格与显示列、编码边界和代码格式风险。
tags: [Linux, expand, GNU coreutils, TAB, 文本格式]
---

# `expand` 命令详解：按制表位把 TAB 转为空格

`expand` 把 TAB 转换成足够数量的空格，使后续文本到达相同制表位。它不是简单把每个 TAB 替换成固定 8 个空格：展开数量取决于 TAB 出现时的当前显示列。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；输出覆盖由 Shell 负责 |
| 主要对象 | TAB、显示列和制表位 |

```bash
type -a expand
env expand --version
env expand --help
```

## 2. 完整语法与全部参数

```text
expand [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-i` | `--initial` | 只转换每行第一个非空格/TAB 字符之前的 TAB |
| `-t LIST` | `--tabs=LIST` | 设置一个周期宽度或多个明确制表位 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件或 `FILE=-` 时读取标准输入。默认等价于 `-t 8`，转换所有 TAB。

## 3. 默认制表位模型

显示列从 0 计算，默认制表位位于 8、16、24……：

```bash
printf 'a\tb\n1234567\tb\n' | expand | cat -A
```

第一行 TAB 需要 7 个空格到列 8；第二行只需要 1 个。直接 `tr '\t' ' '` 无法保持对齐。

## 4. `-t` 三种形式

### 4.1 单个数字：固定周期

```bash
expand -t 4 -- source
```

制表位为 4、8、12……

### 4.2 多个绝对位置

```bash
expand --tabs=2,6,10 -- source
```

明确制表位是 2、6、10。超过最后位置的 TAB 被替换成一个空格，而不是继续按最后间距循环。

LIST 可用逗号或 blank 分隔；含 blank 时引用：

```bash
expand --tabs='2 6 10' -- source
```

### 4.3 GNU 剩余位置扩展

| 最后项 | 含义 | 示例 |
|---|---|---|
| `/N` | 之后使用 N 的绝对倍数 | `2,4,/8` → 2、4、8、16…… |
| `+N` | 从最后明确制表位起每隔 N | `1,+8` → 1、9、17…… |

这两个是 GNU 扩展，BusyBox/BSD/macOS 支持情况不同。

## 5. `-i/--initial`

```bash
printf '\tindent\tdata\n' | expand -i -t 4 | cat -A
```

只展开行首缩进区域中的 TAB；遇到第一个非空格/TAB 字符后，后续 TAB 原样保留。适合把代码缩进规范化但保留字符串/表格中的 TAB。然而：

- 语言可能允许 TAB 出现在语法敏感位置。
- heredoc、Makefile recipe、Go/Python 格式规则不同。
- 只靠文本位置不能理解字符串或注释。

修改代码前使用语言 formatter 和测试，而不是盲目全库 expand。

## 6. 退格、回车与显示宽度

GNU `expand` 保留 backspace，且它会让列计数减一，从而影响后续 TAB 展开。控制字符、宽字符、组合字符和终端实现还可能让“命令计算列”与实际渲染不同。

```bash
printf 'ab\b\tX\n' | expand -t 8 | od -An -tx1 -c
```

对安全展示，先决定控制字符是数据、格式还是非法输入，不能只用 expand 清洗。

## 7. 与 `unexpand` 不是严格可逆

```bash
expand -t 8 input > spaces
unexpand -t 8 spaces > tabs
```

视觉对齐可能恢复，但原来哪些空格、哪些 TAB 的信息已经丢失；unexpand 还会按自己的最短 TAB 表示重写。因此不能用往返结果证明字节一致。

## 8. 生产场景

### 8.1 查看真实缩进

```bash
cat -T -- source
expand -t 8 -- source | diff -u source -
```

第二条只是观察转换差异，不直接覆盖。

### 8.2 生成固定列的审阅副本

```bash
expand -t 4 -- report.tsv > report.expanded.txt
```

TSV 转空格后丢失机器字段边界，只用于人类展示，不应替代原 TSV。

### 8.3 只转换行首缩进

```bash
expand -i -t 4 -- legacy.txt > normalized.txt
```

校验语言语法、diff、测试和 formatter 后才可发布。

## 9. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取或写入失败。

| 现象 | 检查方向 |
|---|---|
| TAB 不是 8 个空格 | 展开到下一个制表位，不是固定替换 |
| 最后 tab stop 后只变 1 空格 | 明确位置列表没有 `/N/+N` 延续 |
| 中间 TAB 没变化 | 使用了 `-i` |
| 中文列仍错位 | locale、宽字符、终端渲染 |
| Makefile 失效 | recipe TAB 被转换，语义改变 |
| 文件被清空 | 输入与重定向输出是同一文件 |

## 10. 动手实验

1. 在列 0～9 分别放 TAB，计算默认展开空格数。
2. 比较单周期、多绝对位置、`/N`、`+N`。
3. 比较默认与 `-i` 的行内 TAB。
4. 加入 backspace、CR、中文和组合字符观察列计数。
5. 对 Makefile、Python、Go 文件只生成副本并运行语法/格式测试。
6. 与 unexpand 往返后用 `cmp` 证明不保证字节可逆。

## 11. 掌握标准

- 能列出 `expand` 全部参数。
- 能解释 TAB 到下一制表位而非固定替换。
- 能使用单周期、绝对列表、`/N` 和 `+N`。
- 能说明 `-i`、控制字符、宽字符和代码语义边界。
- 能把转换限定为可审阅、可测试的输出流程。

## 官方参考

- [GNU coreutils 9.11：expand invocation](https://www.gnu.org/software/coreutils/manual/html_node/expand-invocation.html)
- [POSIX expand](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/expand.html)

上一篇：[`tr` 命令详解](./13-tr命令详解.md)

下一篇：[`unexpand` 命令详解](./15-unexpand命令详解.md)

