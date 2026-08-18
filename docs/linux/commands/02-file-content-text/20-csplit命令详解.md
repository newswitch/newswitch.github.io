---
title: "csplit 命令详解：按行号、正则上下文与边界切分文件"
sidebar_label: "20. csplit 命令详解：按行号、正则上下文与边界切分文件"
sidebar_position: 20
description: "完整讲解 GNU coreutils csplit 的全部参数、行号与正则模式、偏移、重复、跳过区间、边界抑制、输出命名和错误清理。"
tags: [Linux, csplit, GNU coreutils, 正则表达式, 文件切分]
---

# csplit 命令详解：按行号、正则上下文与边界切分文件

`csplit` 按内容上下文切分输入：边界可以是绝对行号，也可以是下一次匹配基本正则表达式的行，并可加正负偏移、重复规则或跳过区间。它适合按章节、记录头和分隔行切文件，但模式参数是一个有状态的顺序程序。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | 创建/覆盖分片 `[W]`；错误默认清理本轮已创建文件 |
| 主要对象 | 当前输入位置、行号、BRE 正则、偏移和输出序列 |

```bash
type -a csplit
env csplit --version
env csplit --help
```

## 2. 完整语法与全部参数

```text
csplit [OPTION]... INPUT PATTERN...
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-f PREFIX` | `--prefix=PREFIX` | 输出名前缀，默认 `xx` |
| `-b FORMAT` | `--suffix-format=FORMAT` | 用恰好一个无符号整数 printf 转换生成后缀 |
| `-n DIGITS` | `--digits=DIGITS` | 数字后缀位数，默认 2；使用 `-b` 时忽略 |
| `-k` | `--keep-files` | 出错或收到部分信号时保留已生成文件 |
| 无 | `--suppress-matched` | 不把匹配边界行写入后续分片 |
| `-z` | `--elide-empty-files` | 不生成零字节分片，编号仍从 0 连续 |
| `-s`、`-q` | `--silent`、`--quiet` | 不输出每个分片的字节数 |
| 无 | `--help`、`--version` | 帮助与版本 |

INPUT 必填，使用 `-` 表示标准输入。默认分片名为 `xx00`～`xx99`，已有同名文件会被覆盖；在隔离空目录使用唯一 Prefix。

## 3. 四类 Pattern

| 模式 | 语义 |
|---|---|
| `N` | 当前输入位置切到绝对第 N 行之前；N 为正整数 |
| `/REGEXP/[OFFSET]` | 搜索下一匹配行，在匹配位置加 OFFSET 后切分并生成文件 |
| `%REGEXP%[OFFSET]` | 同样搜索和移动边界，但跳过该区间，不生成文件 |
| `{COUNT}` 或 `{*}` | 前一 Pattern 再重复 COUNT 次，或尽可能重复到输入结束 |

每个 Pattern 从当前扫描位置继续，匹配不是每次从文件开头开始。所有 Pattern 完成后，剩余输入写入最后一个文件。

## 4. 行号模式

```bash
seq 20 > input.txt
csplit --prefix=part- --digits=3 -- input.txt 6 11 16
```

结果是第 1～5、6～10、11～15、16～20 行。行号表示“该行成为下一片第一行”，不是每 N 行。重复可表达等长行块：

```bash
csplit --prefix=part- -- input.txt 6 '{2}'
```

第一次切到第 6 行，后续重复数值模式的行为应通过小样本确认；对于简单固定行数，`split -l` 更直观。

## 5. 正则模式与引用

```bash
csplit --prefix=chapter- --digits=3 -- book.txt '/^CHAPTER [0-9][0-9]*$/' '{*}'
```

`csplit` 使用系统/实现支持的基本正则表达式（BRE），不是 PCRE：`+ ? | ()` 的转义规则不同。Pattern 同时经过 Shell 和 csplit 解析，始终用单引号保护 `$`、`*`、`[`、反斜杠；动态正则必须先验证，不能拼接不可信输入。

若边界行是第一行，会产生空的首片；使用 `-z` 可省略它。

## 6. Offset：边界前后移动

```bash
# 匹配行前两行作为下一片起点
csplit log.txt '/^BEGIN$/-2' '{*}'

# 匹配行后一个位置切分
csplit log.txt '/^END$/+1' '{*}'
```

Offset 是行偏移，可带 `+/-`。边界超出当前有效范围或回退到不允许位置会失败。负偏移附近的行不会被后续正则重新匹配，避免扫描倒退；复杂正负偏移必须画出行号并用小样本验收。

## 7. `%REGEXP%` 跳过区间

```bash
csplit --prefix=record- -- input.txt '%^IGNORE-BEGIN$%' '/^DATA-BEGIN$/' '{*}'
```

百分号模式移动输入位置但不为经过区间创建输出，因此拼接所有分片**不能恢复原文件**。它不是“仅删除匹配行”，而可能跳过从当前位置到边界的一整个区段。需要只去边界行时考虑 `--suppress-matched`。

## 8. `--suppress-matched`

```bash
csplit --suppress-matched --elide-empty-files \
  --prefix=section- -- input.txt '/^---$/' '{*}'
```

每次作为边界的匹配行不会进入输出。适合纯分隔行，但如果该行也是下一条记录的 Header，就会丢数据。行号 Pattern 不存在“匹配行”；选项主要作用于正则模式。

## 9. 重复模式

```bash
csplit input.txt '/^BEGIN$/' '{3}'
csplit input.txt '/^BEGIN$/' '{*}'
```

`{3}` 是在首次执行后额外重复三次，不是总共三次；`{*}` 一直执行到不再匹配/输入耗尽，正常终止语义与普通“找不到 Pattern 就报错”要结合官方实现验证。花括号必须引用，避免 Shell Brace Expansion：`'{*}'`。

## 10. 输出命名与 Suffix Format

```bash
csplit --prefix='chunk-' --suffix-format='%04u.part' input.txt 100 '{*}'
csplit --prefix='chunk-' --suffix-format='%03x' input.txt '/^BEGIN$/' '{*}'
```

Format 必须恰好含一个可转换无符号整数的 `printf(3)` 规格，可用 `u/o/x/X`，`d/i` 视为 `u` 别名，并允许 Flag、宽度和精度。不要允许用户控制 Format/Prefix；Slash、路径穿越、同名覆盖和巨大编号都需防护。

## 11. 错误清理与原子发布

默认 Pattern 不存在、读写失败或收到 HUP/INT/QUIT/TERM 时，`csplit` 删除本次创建的输出。`-k` 保留部分产物用于诊断，但部分集合不能当成功结果。

安全流程：在 `mktemp -d` 下切分 → 检查退出码和文件数 → 按协议验证每片 → 生成顺序/Hash Manifest → 原子发布目录。不要依赖当前目录中的旧同名文件判断本轮结果。

## 12. 可逆性

默认 `/REGEXP/` 和行号切分，在未使用 `%...%`、`--suppress-matched` 且文件顺序正确时，拼接可恢复原输入：

```bash
LC_ALL=C cat -- part-* > restored
cmp -- input.txt restored
sha256sum input.txt restored
```

`-z` 只消除空文件，不删除输入字节，本身不破坏可逆性。必须避免 Prefix 匹配旧文件。

## 13. 退出状态与排查

默认每生成一片向标准输出打印字节数；这不是文件内容。成功为 0，Pattern 无法满足、参数或 IO 失败为非 0。

| 现象 | 检查方向 |
|---|---|
| 开头多了空分片 | 首行就是边界；使用 `-z` 或重新设计边界 |
| 找不到 Pattern | BRE 语法、Shell 引用、当前扫描位置、CRLF/编码 |
| 边界偏一行 | `/REGEXP/` 默认匹配行进入下一片，检查 Offset/抑制选项 |
| 原文拼不回 | 使用了 `%...%`、`--suppress-matched`、缺片或排序错误 |
| 出错后文件消失 | 默认清理；仅诊断时使用 `-k` |
| `{*}` 被 Shell 展开 | 花括号 Pattern 没有单引号保护 |

## 14. 动手实验

1. 为 1～20 行输入用绝对行号切成四片。
2. 用 `BEGIN` Header 比较默认、`-z`、`--suppress-matched`。
3. 为正则加入 `-2/+1`，手工标出每片行号。
4. 用 `%REGEXP%` 跳过区段并证明不可逆。
5. 故意让最后一个 Pattern 不匹配，比较默认与 `-k`。
6. 设计空目录、Manifest、`cmp` 与 Hash 的发布流程。

## 15. 掌握标准

- 能列出 `csplit` 全部参数与四种 Pattern。
- 能解释正则搜索从当前输入位置继续，以及 Offset 如何改变边界。
- 能区分 `%REGEXP%` 和 `--suppress-matched` 的数据丢弃范围。
- 能安全引用 BRE、重复 Pattern、Prefix 和 Suffix Format。
- 能证明一组分片完整、可逆或明确说明为何不可逆。

## 16. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：csplit invocation](https://www.gnu.org/software/coreutils/manual/html_node/csplit-invocation.html)
- [POSIX csplit](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/csplit.html)

上一篇：[`split` 命令详解](./19-split命令详解.md)　下一篇：[`od` 命令详解](./21-od命令详解.md)

返回：[Linux 命令参考库学习路线](../../00-Linux命令参考库学习路线.md)
