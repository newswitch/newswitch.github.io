---
title: unexpand 命令详解：按制表位把空白压缩成 TAB
sidebar_position: 15
description: 完整讲解 GNU coreutils unexpand 的全部参数、行首与全行转换、自定义制表位、tabs 隐含 all、first-only 覆盖、blank 与 locale、退格和格式语义风险。
tags: [Linux, unexpand, GNU coreutils, TAB, 文本格式]
---

# `unexpand` 命令详解：按制表位把空白压缩成 TAB

`unexpand` 把能够到达相同制表位的空白序列改写成尽量多的 TAB。默认只转换每行开头的 blanks；它优化的是表示方式和视觉对齐，不保留“原来是几个空格还是 TAB”的字节信息。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；覆盖输出由 Shell 负责 |
| 主要对象 | blank 序列、显示列和制表位 |

```bash
type -a unexpand
env unexpand --version
env unexpand --help
```

## 2. 完整语法与全部参数

```text
unexpand [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--all` | 行内也转换：到 tab stop 前至少两个 blanks 的序列可转换 |
| 无 | `--first-only` | 只转换行首 blanks，并覆盖之前的 `-a` |
| `-t LIST` | `--tabs=LIST` | 自定义制表位；同时隐含 `-a` |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件或 `FILE=-` 时读取标准输入。默认制表位每 8 列，并只转换第一个 non-blank 字符前的空白。

## 3. blank 与 space 的区别

在 C/POSIX locale，blank 通常包括空格和 TAB；其他 locale 可能定义更多 blank 字符。unexpand 可以重写已有 TAB 和空格的组合，以得到到达同一列的较短表示。

```bash
LC_ALL=C unexpand -- input | cat -T
```

它不会简单地“每 8 个空格换一个 TAB”，因为转换取决于当前列、已有 TAB 和后续制表位。

## 4. 默认、`-a` 与 `--first-only`

```bash
printf '        indent    middle\n' | unexpand | cat -T
printf '        indent    middle\n' | unexpand -a | cat -T
```

- 默认只改 `indent` 前的初始空白。
- `-a` 还可改 `indent` 后、恰好通向 tab stop 的连续 blanks。
- 单个空格通常不会改为 TAB；行内需要两个或更多合适 blanks。

`-t` 自动隐含 `-a`。如果只想自定义 tab stops 但仍仅转换行首，必须把覆盖意图写清：

```bash
unexpand -t 4 --first-only -- input
```

为避免依赖选项解析顺序，显式把 `--first-only` 放在最终配置位置，并在目标版本测试。

## 5. `-t` 制表位语法

与 expand 相同：

| LIST | 行为 |
|---|---|
| `N` | 每 N 列一个 tab stop，默认 8 |
| `A,B,C` | 明确绝对位置；之后空白不再转换 |
| `A,B,/N` | 之后使用 N 的绝对倍数 |
| `A,+N` | 从最后明确位置起每隔 N |

```bash
unexpand --tabs=2,4,/8 -- input
unexpand --tabs=1,+8 -- diff.txt
```

多位置可用逗号或 blank；`/N/+N` 是 GNU 扩展。

## 6. 退格和控制字符

GNU unexpand 保留 backspace，并让它减少列计数，从而影响后续 tab stop。CR、控制序列、宽字符和组合字符可能使工具列模型与实际终端显示不同。

不要把 unexpand 当作终端内容净化器；未知内容先用 `od`/`cat -v` 检查，结构化数据使用对应解析器。

## 7. 对源码和数据格式的影响

- Python：混合 TAB/space 可能改变缩进块或触发 TabError。
- Makefile：recipe 开头 TAB 具有语义，但行内空白也可能重要。
- YAML：缩进必须为空格，转成 TAB 可能使文件非法。
- TSV：TAB 是字段分隔，行内转换会制造新字段边界。
- 固定宽度文件：视觉列可能保持，但字节偏移变化。

因此 `-a` 不应批量运行于未知格式。代码优先使用语言 formatter，数据优先保留 schema。

## 8. 旧语法

GNU 兼容 `-4`、`-4,8` 等历史形式，但它不隐含 `-a`，和现代 `-t` 不同。新脚本只写：

```bash
unexpand --first-only -t 4 -- input
```

避免 `_POSIX2_VERSION`、文件名和选项解析歧义。

## 9. 安全转换流程

```bash
tmp=$(mktemp) || exit 1
if unexpand --first-only -t 4 -- input > "$tmp" &&
   diff -u -- input "$tmp"; then
  printf 'no change\n'
fi
```

若准备发布转换结果，还要执行格式/语法检查、权限复制和同文件系统原子替换。不要把 input 与重定向目标设为同一文件。

## 10. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取或写入失败。

| 现象 | 检查方向 |
|---|---|
| 只转换了行首 | 默认行为；需要 `-a` |
| 加 `-t` 后行内也变化 | `-t` 隐含 `-a` |
| 明确 tab stop 后不再转换 | 多位置列表结束且没有 `/N/+N` |
| YAML/TSV 损坏 | TAB 具有格式语义 |
| 往返字节不同 | expand/unexpand 不保证可逆 |
| 视觉列不同 | locale、宽字符、控制字符、终端模型 |

## 11. 动手实验

1. 在不同列制造 1～8 个空格，观察哪些转换为 TAB。
2. 比较默认、`-a`、`-t 4`、`-t 4 --first-only`。
3. 验证绝对列表、`/N`、`+N`。
4. 混合已有 TAB、空格和 backspace。
5. 对 YAML、TSV、Makefile、Python 副本运行并用专用工具检查。
6. 与 expand 往返后比较视觉结果和字节结果。

## 12. 掌握标准

- 能列出 `unexpand` 全部参数。
- 能解释默认只处理行首、`-a` 和 `-t` 隐含关系。
- 能使用全部制表位形式。
- 能说明 blank、显示列、退格和 Unicode 边界。
- 能识别 TAB 对源码和数据 schema 的破坏风险。

## 官方参考

- [GNU coreutils 9.11：unexpand invocation](https://www.gnu.org/software/coreutils/manual/html_node/unexpand-invocation.html)
- [POSIX unexpand](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/unexpand.html)

上一篇：[`expand` 命令详解](./14-expand命令详解.md)

下一篇：[`fold` 命令详解](./16-fold命令详解.md)

