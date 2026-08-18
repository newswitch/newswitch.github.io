---
title: "fold 命令详解：按显示列、字符或字节折行"
sidebar_label: "16. fold 命令详解：按显示列、字符或字节折行"
sidebar_position: 16
description: "完整讲解 GNU coreutils fold 的全部参数、显示列/字符/字节宽度、空白边界、TAB/退格/回车、Unicode 宽字符、超长记录和日志展示边界。"
tags: [Linux, fold, GNU coreutils, 折行, Unicode]
---

# fold 命令详解：按显示列、字符或字节折行

`fold` 把过长输入行切成多行。默认按屏幕列宽计算：TAB 可占多列，backspace 减少列计数，CR 把列位置重置为 0。它改变记录边界，所以只能用于展示或明确允许折行的文本，不能随意处理日志、JSON、签名和机器协议。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；转换会改变输出行结构 |
| 主要对象 | 输入行、显示列、字符或字节宽度 |

```bash
type -a fold
env fold --version
env fold --help
```

## 2. 完整语法与全部参数

```text
fold [OPTION]... [FILE]...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-b` | `--bytes` | 按字节数计宽；TAB/backspace/CR 都按普通单字节计 |
| `-c` | `--characters` | 按字符数计宽，不考虑宽字符显示占多列 |
| `-s` | `--spaces` | 尽量在最大宽度前最后一个 blank 之后折行 |
| `-w N` | `--width=N` | 最大宽度 N，默认 80 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

无文件或 `FILE=-` 时读取标准输入。`-b` 与 `-c` 表示不同计量模式，应选其一。

## 3. 三种宽度

| 模式 | 计数对象 | 主要风险 |
|---|---|---|
| 默认 | screen columns | 受 TAB、控制字符、locale 和宽字符影响 |
| `-c` | 解码后的字符 | 宽字符可能一字符两列，组合字符可能多字符一字形 |
| `-b` | 原始字节 | 可能切断 UTF-8 字符或二进制帧 |

```bash
printf 'A中文B\n' | fold -w 4
printf 'A中文B\n' | fold -c -w 4
printf 'A中文B\n' | fold -b -w 4
```

使用 `od -c` 检查结果字节，不要只看终端。

## 4. 默认显示列模型

- 普通窄字符通常增加 1 列。
- TAB 前进到下一个 tab stop，通常每 8 列。
- backspace 将列计数减 1。
- carriage return 把当前列重置为 0。
- 宽字符和零宽/组合字符按 locale 宽度函数判断。

终端、浏览器、编辑器对 emoji、East Asian Ambiguous 和组合序列的渲染可能不同。因此 fold 的 80 列不保证所有界面视觉上恰好 80。

## 5. `-s/--spaces`

```bash
fold -s -w 40 -- paragraph.txt
```

它在最大宽度前寻找最后一个 blank，并在该 blank 之后折行；若没有 blank，仍在最大宽度处强制折。这里不是完整段落重排：

- 不会像 `fmt` 那样合并短行。
- 可能保留折点 blank。
- 不理解 URL、CJK 分词、Markdown code span 或 ANSI escape。
- 单个超长 token 仍会被切断。

自然语言排版优先 `fmt` 或渲染器；机器日志不要擅自折行。

## 6. 改变记录边界的后果

```bash
fold -w 120 -- app.jsonl
```

JSON Lines 的“一行一个对象”会被破坏，后续 jq/日志采集器可能解析失败。同样不适合：

- 多行堆栈需要特定 continuation 协议的日志。
- CSV quoted field 中的换行。
- 校验和、签名、base64 或 PEM 内容。
- 固定宽度/长度前缀协议。
- Shell 命令或代码文件。

展示副本与原始数据必须分离。

## 7. ANSI 控制序列

彩色日志中的 escape sequence 会作为字节/非打印字符参与处理，但终端显示宽度可能为 0；折行可能切开控制序列，造成颜色泄漏或异常显示。

先安全去色或由支持 ANSI 的渲染器换行。不要用 `tr -d` 粗暴删除 escape 字节而保留序列正文。

## 8. 超长行和流式处理

fold 可流式输出，不必保存整个文件，但单个多字节字符、折点查找和输出背压仍影响资源。`-s` 为寻找当前宽度内最后 blank 需要一定缓冲。面对数百 MB 单行：

- 先确认它是合法数据还是上游缺少分隔符。
- 限制输入、CPU、输出和运行时间。
- 不要直接把巨型行输出到交互终端。
- 如果只是采样，使用 `head -c`+`od`，同时接受字节截断边界。

## 9. 旧语法

GNU 兼容 `fold -80`，但可能与选项/文件名混淆。新脚本统一：

```bash
fold -w 80 -- file
```

不同平台对 `-c`、宽字符和控制字符的支持可能不同。

## 10. 生产场景

### 10.1 生成人类审阅副本

```bash
fold -s -w 100 -- notes.txt > notes.wrapped.txt
```

保留原始 notes 用于机器消费。

### 10.2 检查哪个模式符合需求

```bash
wc -L -- input
fold -w 80 -- input > by-columns
fold -c -w 80 -- input > by-chars
fold -b -w 80 -- input > by-bytes
```

比较不是为了选“唯一正确”，而是明确下游协议按什么计量。

### 10.3 安全显示未知长行

先 `file -E` 和 `od` 判断内容，再对可信文本副本 fold；未知二进制或含控制字符内容不要直送终端。

## 11. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取、解码或写入失败。

| 现象 | 检查方向 |
|---|---|
| 中文行视觉超过 N | 使用 `-c` 或终端宽度规则不同 |
| 中文乱码 | `-b` 从 UTF-8 字符中间折断 |
| `-s` 仍切单词 | 最大宽度内没有 blank |
| JSON/日志解析失败 | fold 增加了新行边界 |
| 彩色输出异常 | ANSI 序列被计数或切断 |
| TAB 前后宽度意外 | 默认按 tab stop 计算 |

## 12. 动手实验

1. 用 ASCII、TAB、backspace、CR 比较默认列模型。
2. 用中文、组合字符、emoji 比较默认、`-c/-b`。
3. 对有 blank 和单个超长 token 比较 `-s`。
4. 折一个 JSONL 副本并让 jq 验证失败，理解记录边界。
5. 在彩色 ANSI 文本上观察控制序列风险。
6. 输入一个超长单行，观察流式输出和资源。

## 13. 掌握标准

- 能列出 `fold` 全部参数。
- 能区分 screen column、character、byte 和 grapheme。
- 能解释 TAB/backspace/CR 对默认宽度的影响。
- 能说明 `-s` 不是段落排版器。
- 能识别任何依赖原行边界的格式都不能直接 fold。

## 14. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：fold invocation](https://www.gnu.org/software/coreutils/manual/html_node/fold-invocation.html)
- [POSIX fold](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/fold.html)

上一篇：[`unexpand` 命令详解](./15-unexpand命令详解.md)

返回：[Linux 命令参考库学习路线](../../00-Linux命令参考库学习路线.md)
