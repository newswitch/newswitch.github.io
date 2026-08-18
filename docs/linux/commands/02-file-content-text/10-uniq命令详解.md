---
title: "uniq 命令详解：相邻去重、计数与分组输出"
sidebar_label: "10. uniq 命令详解：相邻去重、计数与分组输出"
sidebar_position: 10
description: "完整讲解 GNU coreutils 9.11 uniq 的全部参数、相邻重复、字段字符跳过、计数、重复与唯一筛选、分组分隔、NUL 记录、locale 和 sort -u 差异。"
tags: [Linux, uniq, GNU coreutils, 去重, 分组]
---

# uniq 命令详解：相邻去重、计数与分组输出

`uniq` 只识别相邻的重复记录。它不负责把全文件相同内容聚到一起，因此“全局去重”通常要先用完全相同规则排序，再运行 uniq；或者直接使用能表达所需比较键的 `sort -u`。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | 默认 `[R]`；显式 OUTPUT 会创建或覆盖文件 |
| 主要对象 | 相邻比较相等的记录组 |

```bash
type -a uniq
env uniq --version
env uniq --help
```

## 2. 完整语法

```text
uniq [OPTION]... [INPUT [OUTPUT]]
```

无 INPUT 或 `INPUT=-` 时读取标准输入；无 OUTPUT 时写标准输出。OUTPUT 是位置操作数，不是 `-o` 参数。

不要让 INPUT 和 OUTPUT 指向同一文件，Shell/程序打开顺序可能破坏输入。用临时文件验证后 rename。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-c` | `--count` | 在每个输出代表记录前打印该组出现次数 |
| `-d` | `--repeated` | 只输出重复组，每组第一条 |
| `-D` | `--all-repeated[=METHOD]` | 输出重复组的所有记录，可指定组分隔方式 |
| `-f N` | `--skip-fields=N` | 比较前跳过 N 个字段 |
| 无 | `--group[=METHOD]` | 输出所有记录并给每个唯一组增加分隔 |
| `-i` | `--ignore-case` | 比较时忽略大小写 |
| `-s N` | `--skip-chars=N` | 跳过字段后再跳过 N 个字符 |
| `-u` | `--unique` | 只输出只出现一次的组 |
| `-w N` | `--check-chars=N` | 跳过后最多比较 N 个字符 |
| `-z` | `--zero-terminated` | 使用 NUL 而不是 LF 分隔记录；LF 可参与字段切分 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

## 4. 默认相邻去重

```bash
printf '%s\n' a a b a | uniq
```

输出：

```text
a
b
a
```

最后一个 `a` 与前一行不相邻，所以不会合并。全局按整行去重：

```bash
LC_ALL=C sort -- input | LC_ALL=C uniq
LC_ALL=C sort -u -- input
```

若需要保持第一次出现的原始全局顺序，不能简单排序；可用 awk 哈希或语言工具，并考虑内存规模。

## 5. 输出选择

| 参数 | 单次组 | 重复组 |
|---|---|---|
| 默认 | 输出 | 输出第一条 |
| `-c` | 输出并计 1 | 输出第一条并计组大小 |
| `-d` | 丢弃 | 输出第一条 |
| `-D` | 丢弃 | 输出全部 |
| `-u` | 输出 | 丢弃 |

```bash
sort input | uniq -c
sort input | uniq -d
sort input | uniq -u
```

`uniq -c | sort -nr` 是常见频次统计，但计数字段前有填充空格；后续应按数值键解析。

## 6. `-D` 分隔模式

`--all-repeated=METHOD`：

| METHOD | 行为 |
|---|---|
| `none` | 不增加组分隔；等价 `-D` |
| `prepend` | 每个重复组前增加一个记录分隔符 |
| `separate` | 组之间增加一个分隔符，首组前不增加 |

```bash
uniq --all-repeated=separate -- sorted
```

`-z` 时分隔符改为 NUL。若输入本来允许空记录，额外空记录与真实数据可能无法区分，因此这种展示协议不适合无 schema 的机器消费。

## 7. `--group` 分隔模式

`--group[=METHOD]` 输出所有记录：

| METHOD | 行为 |
|---|---|
| `separate` | 组之间增加分隔，默认 |
| `prepend` | 每组前增加分隔 |
| `append` | 每组后增加分隔 |
| `both` | 每组前后均增加分隔 |

它适合人类检查相邻组，不等于结构化 group-by。空记录造成的分隔歧义同样存在。

## 8. 比较范围：field、char、width

执行顺序：先 `-f` 跳字段，再 `-s` 跳字符，最后 `-w` 限制比较长度。

```bash
uniq -f 1 -s 2 -w 8 -- sorted.log
```

`uniq` 的 field 是“一段 blank 后跟一段 non-blank”的结构，和 `sort -t`、cut `-f`、awk 默认字段都不完全相同。字段编号的语义是跳过多少个，而不是从 1 指定某列。

例：忽略时间戳字段，比较后续内容：

```bash
uniq -f 1 -- time-sorted.log
```

前提仍是相同比较结果已经相邻。若先 sort，应确保 sort 的键切分和 uniq 的跳过语义一致；更稳妥是先显式提取键。

## 9. 大小写与 locale

`-i` 的折叠和默认比较受 locale 影响。预排序也必须使用同样规则：

```bash
LC_ALL=C sort -f -- input | LC_ALL=C uniq -i
```

若用普通 sort 再 uniq -i，大小写等价记录可能没有相邻。Unicode 大小写折叠还可能存在一对多或语言特有规则，核心工具的行为不等于完整 Unicode case folding。

## 10. NUL 记录

```bash
find . -type f -print0 | LC_ALL=C sort -z | uniq -z |
while IFS= read -r -d '' path; do
  printf '%q\n' "$path"
done
```

使用 `-z` 后 LF 不再是记录结束符，可以成为字段 blank；全链路必须保持 NUL。

## 11. `sort -u` 与 `sort | uniq`

```bash
sort -n -u -- input
sort -n -- input | uniq
```

第一条用 sort 的数值比较键决定相等，`01` 与 `1` 可能被视为同一键；第二条 sort 后，uniq 默认比较完整文本，仍可能保留二者。选择前先明确“重复”是完整字节相同、大小写等价、数值相等还是某字段相等。

## 12. 退出状态与排查

`0` 成功，非 `0` 表示参数、读取或写入失败；没有重复不是错误。

| 现象 | 检查方向 |
|---|---|
| 相同内容仍重复 | 没有相邻、CRLF、尾部空格、不可见字符 |
| 先 sort 后仍漏合并 | sort 与 uniq 的 locale/大小写/键规则不同 |
| `-f` 跳错列 | uniq field 是 blank+nonblank 结构 |
| 分组输出多空行 | METHOD 增加分隔，且输入可能有空记录 |
| 计数解析错 | `-c` 前导填充，需数值解析 |
| 原始顺序丢失 | 为全局去重进行了排序 |

## 13. 动手实验

1. 构造非相邻重复，比较 uniq、sort|uniq、sort -u。
2. 对四类组验证默认、`-c/-d/-D/-u`。
3. 验证 `-D` 和 `--group` 全部 METHOD。
4. 用前导空白、多空格和短行测试 `-f/-s/-w`。
5. 比较普通、ignore-case 及不同 locale 的预排序要求。
6. 对 `01/1/1.0` 比较 `sort -n -u` 与 `sort -n | uniq`。
7. 用含换行文件名验证 NUL 链路。

## 14. 掌握标准

- 能列出 `uniq` 全部参数和两组 METHOD 取值。
- 能解释为什么它只处理相邻重复。
- 能按需求选择重复组第一条、全部、计数或单次组。
- 能正确组合字段/字符跳过和比较宽度。
- 能让 sort 与 uniq 使用一致的 locale 和等价关系。

## 15. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：uniq invocation](https://www.gnu.org/software/coreutils/manual/html_node/uniq-invocation.html)
- [POSIX uniq](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/uniq.html)

上一篇：[`sort` 命令详解](./09-sort命令详解.md)

下一篇：[`comm` 命令详解](./11-comm命令详解.md)
