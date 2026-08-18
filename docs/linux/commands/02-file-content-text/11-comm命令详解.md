---
title: "comm 命令详解：比较两个有序集合"
sidebar_label: "11. comm 命令详解：比较两个有序集合"
sidebar_position: 11
description: "完整讲解 GNU coreutils 9.11 comm 的全部参数、三列集合语义、列抑制、顺序校验、locale、输出分隔与计数、NUL 记录和退出码边界。"
tags: [Linux, comm, GNU coreutils, 集合比较, 排序]
---

# comm 命令详解：比较两个有序集合

`comm` 对两个已经按相同规则排序的记录流执行集合式比较：只在文件 1、只在文件 2、两边共有。它保留重复记录的多重性，因此更接近有序 multiset 归并，而不是自动去重后的数学集合。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]` |
| 主要对象 | 两个按相同比较规则有序的记录序列 |

```bash
type -a comm
env comm --version
env comm --help
```

## 2. 完整语法与全部参数

```text
comm [OPTION]... FILE1 FILE2
```

| 参数 | 作用 |
|---|---|
| `-1` | 不输出“只在 FILE1”列 |
| `-2` | 不输出“只在 FILE2”列 |
| `-3` | 不输出“两边共有”列 |
| `--check-order` | 任一输入失序立即报错并失败 |
| `--nocheck-order` | 从不检查顺序；错误排序时结果不保证 |
| `--output-delimiter=STR` | 使用 STR 分隔相邻输出列；空 STR 表示 NUL |
| `--total` | 在末尾输出三类数量和 `total` |
| `-z`、`--zero-terminated` | 使用 NUL 而不是 LF 分隔记录 |
| `--help` | 显示帮助并退出 |
| `--version` | 显示版本并退出 |

两个操作数中最多一个可以是 `-` 标准输入，因为同一标准输入无法独立表示两条流。

## 3. 默认三列

```text
column 1: 只在 FILE1
column 2: 只在 FILE2
column 3: 两边共有
```

默认用 TAB 做列缩进：第一列无前缀，第二列一个 TAB，第三列两个 TAB。

```bash
LC_ALL=C comm old.sorted new.sorted
```

输出给人看很方便，但用 TAB 数量解析类别很脆弱。机器消费优先通过列抑制分别获取需要的集合。

## 4. 列抑制组合

| 需求 | 命令 |
|---|---|
| 只在 FILE1，即 `FILE1 - FILE2` | `comm -23 FILE1 FILE2` |
| 只在 FILE2，即 `FILE2 - FILE1` | `comm -13 FILE1 FILE2` |
| 交集 | `comm -12 FILE1 FILE2` |
| 对称差 | `comm -3 FILE1 FILE2` |
| 不输出普通记录，只要统计 | `comm -123 --total FILE1 FILE2` |

```bash
LC_ALL=C comm -13 baseline current
```

选项可以合并成 `-13`，含义仍是抑制第 1、3 列。

## 5. 预排序契约

```bash
LC_ALL=C sort -u -o old.sorted -- old
LC_ALL=C sort -u -o new.sorted -- new
LC_ALL=C sort -C -- old.sorted
LC_ALL=C sort -C -- new.sorted
LC_ALL=C comm --check-order old.sorted new.sorted
```

三阶段必须完全一致：

- 同一个 `LC_ALL`。
- 同一个记录分隔模式。
- 同一个大小写、数字或版本比较规则。
- 如需集合而非 multiset，先按同一等价关系去重。

`--nocheck-order` 只关闭诊断，不会让无序输入产生正确结果。默认检查也不是全量保证：某些失序只有出现不可配对行时才诊断，生产应显式 `--check-order`。

## 6. 重复记录的多重性

```text
FILE1: a a a
FILE2: a a
```

归并会匹配两对共有 `a`，剩余一个属于 FILE1。若业务想判断“名称是否存在过”而不关心次数，先 `sort -u`；若次数本身有意义，保留重复并理解输出是 multiset 差异。

## 7. `--output-delimiter`

```bash
comm --output-delimiter='|' one two
```

它改变列间分隔，不转义记录内容。若记录可包含 `|`，输出仍有歧义。空字符串特别表示真正 NUL 列分隔：

```bash
comm --output-delimiter='' one two | od -An -tx1 -c
```

这与 `-z` 不同：前者分隔列，后者分隔记录。复杂机器协议最好分三次用列抑制输出，而不是同时解析二维无 schema 流。

## 8. `--total`

```bash
comm -123 --total old.sorted new.sorted
```

输出顺序：只在 1 的数量、只在 2 的数量、共有数量、`total`。即使抑制普通列，统计仍包含三类。它是 GNU 扩展；可移植方案分别使用 `comm` 与 `wc`。

正常完成的退出状态不反映“是否有差异”。所以：

```bash
comm -3 old.sorted new.sorted
```

即使输出差异，退出状态仍是 0。若 CI 需要差异即失败，应显式判断输出是否为空。

## 9. NUL 记录

```bash
find old -type f -printf '%P\0' | LC_ALL=C sort -zu > old.nul
find new -type f -printf '%P\0' | LC_ALL=C sort -zu > new.nul
LC_ALL=C comm -z -13 --check-order old.nul new.nul
```

这样能安全比较含空格、TAB、换行的相对文件名。下游继续以 NUL 读取。

## 10. 生产场景

### 10.1 比较发布清单

先规范化路径格式、排序和去重，再分别输出新增、删除、共有；不要直接比较 `ls` 的人类格式输出。

### 10.2 比较节点名单

```bash
LC_ALL=C sort -u desired > desired.sorted
LC_ALL=C sort -u actual > actual.sorted
missing=$(LC_ALL=C comm -23 desired.sorted actual.sorted)
extra=$(LC_ALL=C comm -13 desired.sorted actual.sorted)
```

命令替换不适合含换行名称；节点名协议通常禁止换行，否则使用 NUL/临时文件。

### 10.3 配置漂移计数

```bash
LC_ALL=C comm -123 --total desired.sorted actual.sorted
```

统计是数量证据，仍需保留具体差异列表用于定位。

## 11. 退出状态与排查

| 状态 | 含义 |
|---|---|
| `0` | 比较正常完成，无论是否存在差异 |
| 非 `0` | 参数、读取、顺序校验或写入错误 |

| 现象 | 检查方向 |
|---|---|
| 明明相同却分到不同列 | locale、CRLF、尾空格、大小写、规范化方式 |
| 输出顺序混乱 | 输入未排序或排序规则不同 |
| 重复数量异常 | comm 保留 multiset 计数 |
| CI 有差异仍成功 | 退出码不表示是否相同 |
| 空 output delimiter 难解析 | 它产生 NUL 列分隔；与 `-z` 区分 |

## 12. 动手实验

1. 构造三类记录，观察默认 TAB 三列。
2. 验证所有常用 `-1/-2/-3` 组合。
3. 故意打乱输入，比较默认、check、nocheck。
4. 用不同 locale 预排序，观察契约破坏。
5. 构造重复记录，验证 multiset 行为。
6. 测试普通、空 output delimiter 和 `-z`。
7. 编写“有差异则退出 1”的 CI 包装。

## 13. 掌握标准

- 能列出 `comm` 全部参数并解释三列。
- 能用列抑制表达差集、交集和对称差。
- 能建立并验证完全一致的预排序契约。
- 能解释重复记录与退出码语义。
- 能安全比较任意文件名清单。

## 14. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：comm invocation](https://www.gnu.org/software/coreutils/manual/html_node/comm-invocation.html)
- [POSIX comm](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/comm.html)

上一篇：[`uniq` 命令详解](./10-uniq命令详解.md)

下一篇：[`join` 命令详解](./12-join命令详解.md)
