---
title: "fmt 命令详解：段落重排、目标宽度与前缀格式化"
sidebar_label: "17. fmt 命令详解：段落重排、目标宽度与前缀格式化"
sidebar_position: 17
description: "完整讲解 GNU coreutils fmt 的全部参数、段落识别、缩进、句子间距、crown/tagged 模式、注释前缀和 Markdown/代码边界。"
tags: [Linux, fmt, GNU coreutils, 文本排版, 段落]
---

# fmt 命令详解：段落重排、目标宽度与前缀格式化

`fmt` 读取完整段落，合并短行并重新选择换行点，使输出接近目标宽度且不超过最大宽度。它适合纯文本说明、邮件和特定注释，不是 Markdown、代码、日志或 Unicode 排版引擎。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；重排会改变空白和行边界，重定向覆盖源文件属于 `[W/D]` |
| 主要对象 | 段落、缩进、单词间空白、目标/最大字符宽度 |

```bash
type -a fmt
env fmt --version
env fmt --help
```

## 2. 完整语法与全部参数

```text
fmt [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-c` | `--crown-margin` | 保留段落前两行缩进，后续行对齐第二行 |
| `-t` | `--tagged-paragraph` | Tagged 模式；类似 Crown，但前两行同缩进时首行作为独立段落 |
| `-s` | `--split-only` | 只拆长行，不把短行连接成长行 |
| `-u` | `--uniform-spacing` | 单词间统一一个空格，句子间统一两个空格 |
| `-WIDTH` | 无 | 旧式最大宽度写法，例如 `-80` |
| `-w WIDTH` | `--width=WIDTH` | 最大输出宽度；默认 75，给定 Goal 时默认是 Goal+10 |
| `-g GOAL` | `--goal=GOAL` | 优先尝试达到的行宽；默认约比 Width 短 7% |
| `-p PREFIX` | `--prefix=PREFIX` | 只重排带指定前缀的行，并在输出每行重新附加前缀 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件或 `FILE=-` 时读取标准输入。新脚本使用 `-w 80`，不要使用容易和选项混淆的 `-80`。

## 3. 段落、缩进和空白模型

默认行为：空行分隔段落；不同缩进的相邻行不会连接；单词间已有空白和缩进尽量保留；输入 TAB 会展开，输出可能重新引入 TAB。`fmt` 会读完整段落后计算换行，不是严格的一行进一行出。

```bash
printf '%s\n' \
  'This is a short line.' \
  'This line belongs to the same paragraph.' \
  '' \
  '  This indentation starts another paragraph.' \
  | fmt -w 35
```

句子结束大致识别为以 `.?!` 结尾、忽略其后的括号/引号，并跟两个空格或行尾的单词。自然语言缩写、URL、中文标点和 Markdown 语法可能不符合该启发式。

## 4. Goal 与 Width

```bash
fmt --goal=60 --width=72 -- article.txt
```

`Goal` 是优化算法倾向的长度，`Width` 是最大长度；不是简单每到第 60 字符硬切。若单个单词本身超过 Width，它无法凭空拆词。宽度以字符模型计算，不等于终端显示列：全角字符、组合字符、Emoji 和 ANSI Escape 会让视觉宽度偏离。

## 5. Crown 与 Tagged Paragraph

```text
Term    first description line
        continuation line that should align here
        another continuation
```

```bash
fmt -c -w 60 -- glossary.txt
fmt -t -w 60 -- tagged.txt
```

- Crown 保留第一、第二行的不同缩进，第三行以后跟第二行。
- Tagged 在首两行同缩进时把第一行视为单独的一行段落；不同缩进时使用 Crown 逻辑。
- 段落缩进不符合预期时，先用 `od -c`/`sed -n l` 检查 TAB、NBSP 和 CRLF。

## 6. Split Only 与 Uniform Spacing

```bash
fmt --split-only --width=80 -- generated.txt
fmt --uniform-spacing --width=72 -- prose.txt
```

`-s` 保护已经分行的短内容不被拼接，但仍会拆长行；它不保证代码语义安全。`-u` 会主动改变空白，可能破坏 Markdown Hard Break、对齐表格、命令、协议或逐字证据。

## 7. Prefix：只格式化注释

```bash
fmt --prefix='# ' --width=88 -- script.sh
fmt --prefix='// ' --width=100 -- source.cc
```

Prefix 前可有缩进；匹配后会临时去掉 Prefix，重排并附回每一行。它只是文本前缀，不理解嵌套注释、字符串、Doc Comment Tag 或代码块。先在副本上 Diff，不能直接把结果覆盖源码。

## 8. 不适用的内容

- Markdown 列表、表格、Front Matter、Fenced Code、两个空格换行；
- JSONL、CSV、日志、堆栈和一行一条协议；
- Shell/C/Python 等代码和补丁；
- PEM、Base64、Hash、签名和固定宽度记录；
- 包含 ANSI 控制序列或未知编码的输入。

这些格式的换行属于语法或证据，重排会损坏数据。使用对应 Formatter/Parser。

## 9. 安全写回

不要这样做：

```bash
fmt file.txt > file.txt
```

Shell 会先截断目标，`fmt` 随后读到空文件。使用临时文件、检查退出码和结果，再原子替换：

```bash
tmp=$(mktemp --tmpdir="$(dirname -- "$file")" '.fmt.XXXXXX') || exit 1
if fmt -w 80 -- "$file" >"$tmp" && test -s "$tmp"; then
  diff -u -- "$file" "$tmp" || true
  # 人工确认后再保留权限/属主并替换
else
  rm -f -- "$tmp"
  exit 1
fi
```

自动替换还需处理 Mode、Owner、ACL、xattr、SELinux Context、备份和并发写入。

## 10. 退出状态与排查

成功为 0，参数、读取或写入失败为非 0。

| 现象 | 检查方向 |
|---|---|
| 短行没合并 | 缩进不同、空行、Prefix 不匹配或使用了 `-s` |
| 单词超过 Width | 单个 Token 无可用断点 |
| 中文视觉超宽 | 字符数与显示列/字形宽度不同 |
| 列表结构损坏 | fmt 不解析 Markdown/列表语法 |
| 句间空格改变 | `-u` 和句子结束启发式 |
| 源文件变空 | 错误地把输出重定向到输入本身 |

## 11. 动手实验

1. 比较默认、`-s`、`-u` 对同一段落的影响。
2. 用不同缩进验证段落边界。
3. 为 Definition List 比较 `-c` 与 `-t`。
4. 使用 `-p '# '` 只重排 Shell 注释并审阅 Diff。
5. 比较 ASCII、中文、Emoji 的字符宽度与视觉宽度。
6. 在 Markdown 副本上验证哪些语法会被破坏。

## 12. 掌握标准

- 能列出 `fmt` 全部专用参数和默认宽度。
- 能解释 Goal、Width 和完整段落算法，而非硬折行。
- 能区分 Crown、Tagged、Split Only 与 Prefix。
- 能判断何时应使用 `fold`、代码 Formatter 或结构化 Parser。
- 能在不截断源文件的情况下安全生成和审阅重排结果。

## 13. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：fmt invocation](https://www.gnu.org/software/coreutils/manual/html_node/fmt-invocation.html)

上一篇：[`fold` 命令详解](./16-fold命令详解.md)　下一篇：[`pr` 命令详解](./18-pr命令详解.md)

返回：[Linux 命令参考库学习路线](../../00-Linux命令参考库学习路线.md)
