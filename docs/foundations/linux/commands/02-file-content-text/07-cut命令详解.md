---
title: cut 命令详解：选择字节、字符与字段
sidebar_position: 7
description: 完整讲解 GNU coreutils 9.11 cut 的全部参数、范围语法、字节与字符、字段/空白分隔、补集、输入输出分隔符、NUL 记录和 CSV 陷阱。
tags: [Linux, cut, GNU coreutils, 字段处理, 文本解析]
---

# `cut` 命令详解：选择字节、字符与字段

`cut` 从每条输入记录选择指定的字节、字符或字段，并按原输入顺序输出。它是位置选择器，不是正则提取器，也不是完整 CSV、JSON、日志或 Unicode 字形解析器。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]` |
| 主要对象 | 记录内的字节位置、字符位置或分隔字段 |

```bash
type -a cut
env cut --version
env cut --help
```

GNU 9.11 新增/扩展了部分空白字段兼容选项；旧发行版可能没有 `-F/-w/-O`，部署脚本必须检查版本。

## 2. 完整语法

```text
cut OPTION... [FILE]...
```

必须选择且只选择一个主要模式：`-b`、`-c`、`-f` 或 `-F`。无文件或 `FILE=-` 时读取标准输入。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-b LIST` | `--bytes=LIST` | 选择字节位置 |
| `-c LIST` | `--characters=LIST` | 选择字符位置 |
| 无 | `--complement` | 选择 LIST 的补集 |
| `-d CHAR` | `--delimiter=CHAR` | `-f` 输入字段分隔符，默认 TAB；空值表示 NUL |
| `-f LIST` | `--fields=LIST` | 选择字段 |
| `-F LIST` | 无 | 字段模式，隐含 `-w` 与 `--output-delimiter=' '` |
| `-n` | `--no-partial` | `-b` 时避免输出不完整多字节字符 |
| `-O STRING` | `--output-delimiter=STRING` | 指定输出字段/范围之间的字符串 |
| `-s` | `--only-delimited` | `-f` 时不输出不含字段分隔符的记录 |
| `-w` | `--whitespace-delimited[=trimmed]` | `-f` 时用连续空白分字段；`trimmed` 忽略首尾空白作为分隔 |
| `-z` | `--zero-terminated` | 使用 NUL 而不是 LF 切分输入输出记录 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

## 4. LIST 完整语法

位置从 1 开始：

| 写法 | 含义 |
|---|---|
| `N` | 第 N 项 |
| `N-M` | N 到 M |
| `-M` | 第 1 到 M |
| `N-` | 第 N 到末尾 |
| `A,B,C-D` | 多个列表项，以逗号分隔 |

列表可以乱序、重复、重叠，但输出始终按输入中的自然顺序，每个位置只输出一次：

```bash
printf 'abcdef\n' | cut -c 5,1,3-6,3
# acdef
```

因此 `cut -f 2,1` 不能交换字段；字段重排使用 `awk`、专用解析器或其他工具。

## 5. 字节 `-b` 与字符 `-c`

```bash
printf 'A中B\n' | cut -b 1-2
printf 'A中B\n' | cut -c 1-2
```

- `-b` 按原始字节，可能切开 UTF-8 字符。
- `-c` 按当前 locale 解码后的字符；组合字符仍分开计。
- TAB 和退格在字节/字符模式都只占对应一个位置，不按屏幕列展开。
- Unicode grapheme cluster 可能由多个字符构成，`-c` 仍可能截开用户感知字形。

`-n/--no-partial` 配合 `-b`，要求选择范围至少覆盖一个多字节字符的结尾才选择该字符，可避免输出残缺编码；不同 locale 和非法字节仍要实验验证。

```bash
LC_ALL=en_US.UTF-8 cut -b 1-2 -n -- utf8.txt
```

## 6. 字段 `-f` 与输入分隔符

```bash
cut -f 1,3 -- table.tsv
cut -d ':' -f 1,3 -- /etc/passwd
```

`-d` 必须表示一个输入分隔字符；GNU 空 delimiter 表示 ASCII NUL。字段保留其原始内容，输出默认使用输入分隔符。

没有分隔符的行默认原样输出：

```bash
printf 'a:b\nplain\n' | cut -d: -f1
```

加 `-s` 才抑制 `plain`：

```bash
printf 'a:b\nplain\n' | cut -s -d: -f1
```

连续分隔符表示中间有空字段；与 awk 默认按空白 runs 分隔不同。

## 7. 空白字段 `-w/-F`

```bash
cut -w -f 2 -- aligned.txt
cut --whitespace-delimited=trimmed -f 2 -- aligned.txt
cut -F 2-4 -- aligned.txt
```

- `-w` 用一段空白作为字段分隔。
- `trimmed` 不把首尾空白当分隔符，避免意外产生首尾空字段。
- `-F LIST` 隐含空白分隔，并把输出字段统一用单个 ASCII 空格连接。

这是 GNU 新接口，不宜默认在老服务器、BusyBox、BSD/macOS 存在。复杂空白语义、字段重排或条件选择通常使用 awk 更清晰。

## 8. 输出分隔符 `-O`

```bash
cut -d: -f1,3 -O $'\t' -- /etc/passwd
```

字段模式下，它替代输入 delimiter 连接选中字段。字节/字符模式下，若 LIST 形成多个不重叠范围，输出分隔字符串插在范围之间：

```bash
printf 'abcdef\n' | cut -c 1-2,5-6 -O ':'
# ab:ef
```

`--output-delimiter` 不负责转义字段内容；若正文包含同样字符串，输出仍可能歧义。

## 9. 补集 `--complement`

```bash
cut -d: -f2,4 --complement -- /etc/passwd
```

表示输出除第 2、4 字段外的所有字段。对字段很多且只想删除少数列时方便；输出顺序仍是原顺序。

## 10. NUL 的两个不同维度

### 10.1 `-z`：记录以 NUL 分隔

```bash
cut -z -d: -f1 -- records.nul
```

### 10.2 `-d ''`：字段以 NUL 分隔

这是字段分隔符维度。记录也用 NUL 时，字段与记录边界可能相同，通常无法表达多字段记录。设计协议时必须分别定义记录和字段边界，而不是机械堆叠选项。

文件名流通常每个 NUL 项就是一个完整路径；对路径本身做 basename/dirname，不应擅自用 `/` 作为“不可信数据表”的字段协议。

## 11. 为什么不能通用解析 CSV

```text
name,comment
alice,"hello,world"
```

`cut -d, -f2` 会把引号内逗号也当分隔符。CSV 还允许引号转义和字段内换行；必须使用理解 RFC/业务方言的 CSV 库。类似地：

- JSON 用 `jq` 或语言 JSON 库。
- YAML 用 YAML 解析器。
- `/etc/passwd` 才适合明确的单字符 `:` 字段模型。
- 结构化日志优先保留原始 schema。

## 12. locale、非法编码与性能

- `-b` 不需要字符解码，语义最稳定但可能切字。
- `-c/-n/-w` 受 `LC_CTYPE` 和非法序列影响。
- 需要 ASCII 字段协议时可显式 `LC_ALL=C`。
- `cut` 流式逐记录处理，通常内存小；单条超长记录仍需持有解析状态并可能造成输出压力。
- 多次 cut 扫同一大文件不如一次选择全部所需范围。

## 13. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取、解码或写入失败。

| 现象 | 检查方向 |
|---|---|
| 字段顺序没有按 LIST 重排 | cut 固定原输入顺序 |
| 无分隔行仍出现 | 默认行为；加 `-s` |
| 中文损坏 | 使用了 `-b` 或 locale 不匹配 |
| 连续空格字段与预期不同 | `-d ' '` 是单字符，考虑 `-w/trimmed` |
| CSV 字段错位 | cut 不理解引号和字段内换行 |
| 老机器 unknown option | `-F/-w/-O` 版本差异 |
| 输出仍有歧义 | output delimiter 未转义正文 |

## 14. 动手实验

1. 测试所有 LIST 形式、乱序、重复和重叠。
2. 对 ASCII、中文、组合字符比较 `-b/-b -n/-c`。
3. 对 TSV、冒号字段、无分隔行和连续分隔符测试 `-f/-s`。
4. 比较 `-d ' '`、`-w`、`trimmed` 与 `-F`。
5. 使用 `--complement` 删除少数列。
6. 在多个字符/字节范围间使用 `-O`。
7. 构造合法 CSV，证明简单 `-d,` 的边界。
8. 用 NUL 记录验证 `-z`。

## 15. 掌握标准

- 能列出 GNU 9.11 `cut` 全部参数和 LIST 全部形式。
- 能区分 byte、character、grapheme 和 display column。
- 能解释无分隔行、空字段、空白 runs 与 `-s`。
- 能正确使用补集和独立输出分隔符。
- 能识别版本差异，并拒绝用 cut 解析通用 CSV/JSON。

## 官方参考

- [GNU coreutils 9.11：cut invocation](https://www.gnu.org/software/coreutils/manual/html_node/cut-invocation.html)
- [POSIX cut](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/cut.html)

上一篇：[`wc` 命令详解](./06-wc命令详解.md)

下一篇：[`paste` 命令详解](./08-paste命令详解.md)

