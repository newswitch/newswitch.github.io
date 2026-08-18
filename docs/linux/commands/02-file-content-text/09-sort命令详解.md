---
title: "sort 命令详解：排序键、locale、外部归并与稳定性"
sidebar_label: "09. sort 命令详解：排序键、locale、外部归并与稳定性"
sidebar_position: 9
description: "完整讲解 GNU coreutils 9.11 sort 的全部参数、比较模式、键范围、字段分隔、稳定去重、检查与归并、NUL 记录、临时文件、内存并行和生产一致性。"
tags: [Linux, sort, GNU coreutils, 排序, 外部归并]
---

# sort 命令详解：排序键、locale、外部归并与稳定性

`sort` 对记录进行排序、归并或顺序校验。它的结果由记录边界、locale、字段定义、键范围、比较类型和最终 tie-break 共同决定。生产中最常见的错误不是命令失败，而是双方使用了不同排序规则却仍得到“看起来合理”的输出。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；`-o` 会创建或替换输出，属于 `[W]/[D]` |
| 资源 | 可能大量使用 CPU、内存和临时磁盘 |

```bash
type -a sort
env sort --version
env sort --help
```

## 2. 完整语法与三种模式

```text
sort [OPTION]... [FILE]...
```

无文件或 `FILE=-` 时读取标准输入。GNU `sort` 有三种运行模式：

| 模式 | 参数 | 行为 |
|---|---|---|
| 排序 | 默认 | 读取所有记录，按比较规则输出有序结果 |
| 归并 | `-m/--merge` | 快速合并已经分别有序的输入 |
| 校验 | `-c/-C` | 检查一个输入是否有序，不输出排序结果 |

输入最后没有 LF 时，GNU `sort` 会为输出补一个 LF；`-z` 模式对应 NUL 记录。

## 3. GNU coreutils 9.11 全部参数

### 3.1 运行模式

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-c` | `--check`、`--check=diagnose-first` | 校验顺序；第一处失序输出诊断，失序状态为 1 |
| `-C` | `--check=quiet`、`--check=silent` | 静默校验顺序 |
| `-m` | `--merge` | 归并已分别排序的输入 |

`-c/-C` 最多一个输入。配合 `-u` 时还要求相邻记录的比较键不能相等。

### 3.2 比较和顺序

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-b` | `--ignore-leading-blanks` | 确定键位置和比较时忽略前导 blank |
| `-d` | `--dictionary-order` | 只比较字母、数字和 blank |
| `-f` | `--ignore-case` | 比较时折叠大小写 |
| `-g` | `--general-numeric-sort`、`--sort=general-numeric` | 解析一般浮点、指数、NaN、无穷值；较慢且可能受浮点表示影响 |
| `-h` | `--human-numeric-sort`、`--sort=human-numeric` | 比较 `2K`、`1G` 等人类可读数值 |
| `-i` | `--ignore-nonprinting` | 忽略非打印字符；与 `-d` 同用时无额外作用 |
| `-M` | `--month-sort`、`--sort=month` | 按 locale 月份缩写顺序 |
| `-n` | `--numeric-sort`、`--sort=numeric` | 精确比较常规十进制前缀，不识别前导 `+` 和指数 |
| `-R` | `--random-sort`、`--sort=random` | 对键做随机哈希排序；相同键保持分组，不等于独立洗牌每条记录 |
| `-r` | `--reverse` | 反转比较结果 |
| `-V` | `--version-sort`、`--sort=version` | 数字片段按版本序排列 |

### 3.3 键、字段和输出

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-k KEYDEF` | `--key=KEYDEF` | 指定一个排序键，可重复形成主键、次键 |
| `-t SEP` | `--field-separator=SEP` | 使用一个字符作为字段分隔符；`'\0'` 表示 NUL 字段分隔符 |
| `-o FILE` | `--output=FILE` | 写入 FILE 而非标准输出 |
| `-s` | `--stable` | 禁用全行最终比较，键相等时保留输入相对顺序 |
| `-u` | `--unique` | 对比较键相等的记录只输出第一条，并禁用全行最终比较 |
| `-z` | `--zero-terminated` | 使用 NUL 而不是 LF 分隔记录 |
| 无 | `--debug` | 高亮实际排序键，并在 stderr 给出可疑用法警告 |

### 3.4 资源和外部排序

| 参数 | 作用 |
|---|---|
| `--batch-size=NMERGE` | 一次最多归并 NMERGE 个输入；受文件描述符限制 |
| `--compress-program=PROG` | 用 PROG 压缩临时文件；PROG 无参数压缩，`-d` 解压 |
| `--files0-from=FILE` | 从 NUL 清单读取输入文件名；不能再给命令行文件 |
| `--parallel=N` | 并行运行 N 个排序；默认为可用 CPU 数但上限通常 8 |
| `--random-source=FILE` | 为 `-R` 的哈希选择提供随机源 |
| `-S SIZE`、`--buffer-size=SIZE` | 初始内存缓冲大小；支持 `%`、`b`、`K/M/G/...` |
| `-T DIR`、`--temporary-directory=DIR` | 临时目录；可重复以分散到多个文件系统 |
| `--help` | 显示帮助并退出 |
| `--version` | 显示版本并退出 |

## 4. 默认比较与 locale

未指定键时比较整行。`LC_COLLATE` 决定字符排序，`LC_CTYPE` 决定 blank、字母、大小写和打印字符，`LC_NUMERIC` 决定十进制和千位符，`LC_TIME` 决定月份名称。

```bash
LC_ALL=C sort -- names
LC_ALL=zh_CN.UTF-8 sort -- names
```

两者可能得到不同结果。供 `comm/join` 或分布式系统复用的排序产物，应记录并固定同一个完整 locale，常见为：

```bash
LC_ALL=C sort -o output.sorted -- input
LC_ALL=C sort -C -- output.sorted
```

只设置 `LC_COLLATE` 但保留不兼容的 `LC_CTYPE` 可能形成未定义组合，优先设置 `LC_ALL`。

## 5. 字段与 KEYDEF

```text
F[.C][OPTS][,F[.C][OPTS]]
```

- 字段和字符位置从 1 开始。
- 起点省略 `.C` 时从字段首字符开始。
- 终点省略 `.C` 时到终止字段末尾；终点字符 `0` 也表示字段末尾。
- 省略终点时，键会从起点一直延伸到行尾，这是大量误排序的来源。
- `OPTS` 可用 `MbdfghinRrV`，只改变该键；`b` 可分别附在起止位置。

```bash
sort -t: -k3,3n -k1,1 -- /etc/passwd
sort -t, -k2,2 -k5.3,5.6n -- data.csv
```

第二个例子仍不代表通用 CSV 解析，因为引号内逗号会被当字段分隔符。

默认没有 `-t` 时，字段边界是“非 blank 与 blank 之间”，blank 会成为后一个字段的一部分；它和 awk 的空白字段语义不同。遇到不确定结果先运行：

```bash
sort --debug -k2,2 -- sample
```

## 6. 数值比较模式

| 模式 | 适合 | 不适合 |
|---|---|---|
| `-n` | 精确普通十进制、很长整数 | `+1`、`1e6`、NaN、单位后缀 |
| `-g` | 科学计数、浮点、NaN/Inf | 要求十进制任意精度或完全可移植顺序 |
| `-h` | `df -h/du -h` 风格单位 | 原始字节精确计算、任意单位协议 |
| `-V` | `v1.9`、`v1.10`、IPv4 数字片段等自然版本 | SemVer 全部优先级规则或软件包管理器版本规则 |

```bash
printf '%s\n' 2 10 1 | sort -n
printf '%s\n' 900M 2G 10K | sort -h
printf '%s\n' v1.10 v1.2 v1.9 | sort -V
```

## 7. 稳定性、tie-break 与去重

默认键相等时，GNU `sort` 还会用整行做最终比较，所以只写主键不等于保持输入顺序。`-s` 禁用最终比较：

```bash
sort -s -k1,1 -- events
```

`-u` 同样禁用最终比较，并只保留每组键相等记录中的第一条：

```bash
sort -s -k1,1 -u -- events
```

先稳定排序再 `-u` 可表达“按输入优先级保留第一条”。但：

```bash
sort -n -u
sort -n | uniq
```

并不总等价。前者按数值键判重，后者按排序后完整相邻行判重。

## 8. 排序、归并与检查

### 8.1 先排序分片

```bash
LC_ALL=C sort -T /fast/tmp -S 1G -o part1.sorted -- part1
LC_ALL=C sort -T /fast/tmp -S 1G -o part2.sorted -- part2
```

### 8.2 校验每个分片

```bash
LC_ALL=C sort -C -- part1.sorted
LC_ALL=C sort -C -- part2.sorted
```

### 8.3 快速归并

```bash
LC_ALL=C sort -m -o all.sorted -- part1.sorted part2.sorted
```

若任一输入未按完全相同规则排序，`-m` 不会替你重新正确排序。

## 9. 临时文件、内存和并行

输入超出内存时，sort 生成有序 run 再外部归并：

```bash
sort --parallel=4 -S 2G -T /nvme0/tmp -T /nvme1/tmp -- huge.log
```

调优原则：

- `-S` 是初始缓冲，不是严格内存上限；超长单行可让缓冲增长。
- 并行增加 CPU 和约 `log N` 级额外内存，不是线程越多越快。
- `-T` 可分散临时 IO，但临时数据敏感性、空间、inode、配额和清理必须评估。
- `--compress-program` 以 CPU 换临时磁盘/IO；压缩程序失败会让 sort 失败，找不到程序可能警告后不压缩继续。
- `--batch-size` 过大会撞文件描述符上限，过小增加归并轮次。

观察：

```bash
df -h -- /tmp /nvme0/tmp
df -i -- /tmp /nvme0/tmp
ulimit -n
```

## 10. 输出文件安全

GNU 常能安全执行：

```bash
sort -o F -- F
```

它通常先读完输入再打开输出，但崩溃和 I/O 故障仍可能丢失数据；`-m` 的输入输出重叠尤其危险。更安全的发布：

```bash
tmp=$(mktemp "${TMPDIR:-/tmp}/sorted.XXXXXX") || exit 1
if LC_ALL=C sort -- input > "$tmp" && LC_ALL=C sort -C -- "$tmp"; then
  mv -- "$tmp" output
else
  rm -f -- "$tmp"
  exit 1
fi
```

要原子替换，临时文件需与目标位于同一文件系统，并结合权限、fsync 和并发读者需求设计。

## 11. NUL 记录和文件清单

```bash
find /data -type f -print0 | LC_ALL=C sort -z |
while IFS= read -r -d '' path; do
  printf '%q\n' "$path"
done
```

批量排序多个输入文件名：

```bash
find shards -type f -name '*.part' -print0 |
LC_ALL=C sort --files0-from=- -o merged.sorted
```

后者把 NUL 项当“输入文件名清单”，不是把文件名自身作为待排序记录；两种 `-z`/`--files0-from` 语义不要混淆。

## 12. 随机排序边界

`-R` 对键哈希后排序，相同键聚在一起；需要每条记录独立洗牌通常用 `shuf`。固定 `--random-source` 可以控制随机数据来源，但不应把 sort -R 当密码学抽签、公平调度或安全随机选择。

## 13. 退出状态

| 状态 | 含义 |
|---|---|
| `0` | 成功；校验模式下输入有序 |
| `1` | `-c/-C` 校验发现失序或 `-u` 条件不满足 |
| `2` | 参数、读取、临时文件、压缩或输出等错误 |

普通排序成功不证明下游语义正确；还要验证记录数、键范围和业务不变量。

## 14. 常见错误

| 现象 | 检查方向 |
|---|---|
| 开发和生产顺序不同 | locale 没固定 |
| `-k2` 排序范围太大 | 未写 `-k2,2`，键延伸到行尾 |
| 数字 `10` 在 `2` 前 | 缺少 `-n/-g/-h/-V` |
| 相等键内部顺序变化 | 默认全行 tie-break；需要 `-s` |
| `sort -u` 丢失意外记录 | 去重按排序比较键，不一定整行 |
| 归并结果乱序 | 分片没按完全相同规则预排序 |
| 临时盘爆满 | `-T/-S/parallel/compress` 与输入规模 |
| CSV 键错位 | sort 只认识单字符字段分隔，不理解 CSV 引号 |

## 15. 动手实验

1. 在 `C` 与 UTF-8 locale 比较大小写、重音和中文顺序。
2. 用 `--debug` 验证 `-k2` 与 `-k2,2`。
3. 比较 `-n/-g/-h/-V` 的边界输入。
4. 构造相同主键不同正文，比较默认、`-s`、`-u`。
5. 预排序两个分片，校验后 `-m`；再故意破坏一个分片。
6. 限制 `-S` 并指定临时目录，观察外部排序 IO。
7. 用含换行文件名验证 `-z`。
8. 比较 `sort -n -u` 与 `sort -n | uniq`。

## 16. 掌握标准

- 能列出 GNU `sort` 全部参数并解释三种运行模式。
- 能准确写 KEYDEF，并用 debug 验证实际键。
- 能说明 locale、稳定性、最终全行比较和去重关系。
- 能选择数值比较类型并识别其语义边界。
- 能设计外部排序的内存、临时盘、并行和归并流程。
- 能为 `comm/join` 生成并验证完全同规则的预排序输入。

## 17. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：sort invocation](https://www.gnu.org/software/coreutils/manual/html_node/sort-invocation.html)
- [GNU coreutils：Version sort ordering](https://www.gnu.org/software/coreutils/manual/html_node/Version-sort-ordering.html)
- [POSIX sort](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/sort.html)

上一篇：[`paste` 命令详解](./08-paste命令详解.md)

下一篇：[`uniq` 命令详解](./10-uniq命令详解.md)
