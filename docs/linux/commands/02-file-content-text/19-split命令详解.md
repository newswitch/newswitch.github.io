---
title: split 命令详解：按行、字节、记录和分片数量切分文件
sidebar_position: 19
description: 完整讲解 GNU coreutils split 的全部参数、后缀命名、按行/大小/line-bytes/数量切分、NUL 记录、轮询分发、Filter 与重组校验。
tags: [Linux, split, GNU coreutils, 文件切分, 数据分片]
---

# `split` 命令详解：按行、字节、记录和分片数量切分文件

`split` 按固定行数、字节数、最大 Line Bytes 或指定分片数量，把输入写成连续或轮询的输出文件。默认每 1000 行一片，文件名为 `xaa`、`xab`……。切分单位决定能否直接拼回原数据。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | 创建/覆盖分片 `[W]`；Filter 可执行任意 Shell 命令 `[D]` |
| 主要对象 | 字节流、LF/NUL/自定义记录、分区和输出名称 |

```bash
type -a split
env split --version
env split --help
```

## 2. 完整语法

```text
split [OPTION]... [INPUT [PREFIX]]
```

无 INPUT 或 `INPUT=-` 时读取标准输入；默认 Prefix 为 `x`。已存在的同名分片会被覆盖/截断，执行前必须使用隔离的空目录和唯一 Prefix。

## 3. 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-l N` | `--lines=N` | 每 N 条记录一个文件，默认 1000 行 |
| `-b SIZE` | `--bytes=SIZE` | 每 SIZE 字节一片，可从多字节字符/记录中间切开 |
| `-C SIZE` | `--line-bytes=SIZE` | 每片至多 SIZE 字节，尽量在记录边界切；超长记录仍拆分 |
| `-n CHUNKS` | `--number=CHUNKS` | 按指定模式生成/选择 N 个分片 |
| `-t SEP` | `--separator=SEP` | 用 SEP 代替 LF；`'\0'` 表示 NUL |
| `-a N` | `--suffix-length=N` | 生成后缀长度；默认 2，必要时 GNU 会自动扩展 |
| `-d[FROM]` | `--numeric-suffixes[=FROM]` | 使用十进制后缀，可指定起始数 |
| `-x[FROM]` | `--hex-suffixes[=FROM]` | 使用十六进制后缀，可指定起始数 |
| 无 | `--additional-suffix=SUFFIX` | 名称末尾再附加后缀，不允许含 `/` |
| `-e` | `--elide-empty-files` | 不生成空分片，编号仍连续 |
| `-u` | `--unbuffered` | `-n r/...` 轮询模式立即写出，明显更慢 |
| 无 | `--filter=COMMAND` | 每个分片经 Shell Command 写出，以 `$FILE` 表示目标名 |
| 无 | `--verbose` | 打开每个输出文件前打印诊断 |
| 无 | `--help`、`--version` | 帮助与版本 |

短选项 `-d/-x` 的 FROM 为可选参数时容易歧义，脚本优先 `--numeric-suffixes=100`。

## 4. SIZE 语法

SIZE 是整数，可跟倍数后缀。常用：`b=512`、`KB=1000`、`K/KiB=1024`、`MB=1000²`、`M/MiB=1024²`，再向上有 G/T/P/E/Z/Y/R/Q。网络/对象存储配额先确认使用十进制还是二进制单位。

```bash
split --bytes=100MB --additional-suffix=.part image.bin image-
split --bytes=100MiB --additional-suffix=.part image.bin image-
```

这两条的片大小不同。

## 5. 按行、字节和最大 Line Bytes

```bash
split --lines=100000 --numeric-suffixes=0 --suffix-length=4 \
  --additional-suffix=.jsonl events.jsonl events-

split --bytes=1GiB archive.tar archive.tar.part-

split --line-bytes=100MiB huge-records.txt chunk-
```

- `-l` 保持记录完整，适合已知分隔协议。
- `-b` 保持精确片大小，不保持 UTF-8 字符/记录完整；按名称排序 `cat` 可还原。
- `-C` 限制片大小并优先记录边界，但单条记录超过限制时仍会切开。

若记录是 CRLF，默认分隔只认 LF，CR 留在记录内容中。

## 6. `--number` 的五种模式

| CHUNKS | 含义 |
|---|---|
| `N` | 按字节尽量均分成 N 片，可能切断行 |
| `K/N` | 只把第 K 片写到标准输出，不创建完整 N 片集合 |
| `l/N` | 约 N 片且不拆行；大小/行数可能不均，甚至有空片 |
| `l/K/N` | 只把 Line-Aware 的第 K/N 片写到标准输出 |
| `r/N` | 按记录轮询分配到 N 个输出文件 |

```bash
split --number=4 dataset.bin part-
split --number=l/4 records.txt part-
split --number=r/4 --numeric-suffixes records.txt shard-
split --number=2/4 dataset.bin > second-quarter.bin
```

`r/N` 会交错记录，按文件名 `cat` 不能恢复原顺序；其余连续分片在没有跳过内容且排序正确时可拼回。

对 Pipe/特殊文件，除 `r` 外某些均分模式需要先复制输入到 `$TMPDIR` 或 `/tmp` 计算大小，可能突然消耗大量磁盘。执行前设置安全、容量充足的 `TMPDIR`。

## 7. NUL 与自定义记录

```bash
find /data -type f -print0 \
  | split --separator='\0' --lines=10000 \
      --numeric-suffixes --additional-suffix=.nul - file-list-
```

这能保护含换行文件名；消费端也必须使用 NUL 协议，例如 `xargs -0`。`--separator` 是一个字符/字节语义，不是多字符正则。内容内部若包含 Separator，就会成为边界。

## 8. 后缀、排序与重组

GNU 默认字母后缀在接近容量上限时自动扩长，以保持传统排序可拼回；显式固定过短 `-a` 可能耗尽名称并失败。数字后缀指定 FROM 后通常不会自动宽度扩展，需预估位数。

```bash
LC_ALL=C cat -- archive.tar.part-* > archive.restored.tar
sha256sum archive.tar archive.restored.tar
```

不要使用不稳定的自然排序或包含其他同前缀文件的通配符。更安全是生成 Manifest：文件名、顺序、大小、Hash、源文件 Hash和 split 命令。

## 9. Filter：每片流式加工

```bash
split --bytes=1GiB \
  --filter='gzip -c > "$FILE.gz"' \
  -- archive.tar archive.part-
```

Filter 由 Shell 执行，`$FILE` 是 split 为当前片生成的名称。风险：命令引用错误会覆盖文件；Prefix/环境若不可信会形成注入；并行性、退出失败和部分产物需验证。使用固定脚本、隔离目录、`set -o pipefail`、完整引用和每片 Hash，不拼接用户输入构造 Filter。

## 10. 原子性、并发和磁盘

`split` 逐片创建输出，不是事务；磁盘满、信号或 Filter 失败会留下部分集合。先写新目录，全部成功且 Manifest 校验通过后再发布目录。不要让两个任务使用同一 Prefix；不要在业务目录依赖覆盖行为。

估算：输出数据约等于输入，Filter 压缩除外；均分 Pipe 可能再占一份临时输入；inode 数量由分片数决定。

## 11. 退出状态与排查

成功为 0，读写、命名空间耗尽、参数或 Filter 失败为非 0。

| 现象 | 检查方向 |
|---|---|
| 分片从行中间断开 | 使用了 `-b` 或 `-n N`，需要 `-l/-C/-n l/N` |
| 分片大于设定大小 | `-C` 遇到边界/记录语义；检查是否超长记录 |
| 出现空片 | `-n` 分片多于可分内容；考虑 `-e` |
| 名称用尽 | `-a` 太短或数字 FROM 关闭自动扩展 |
| 管道突然占满 `/tmp` | 非轮询 `--number` 为计算大小缓存不可 Seek 输入 |
| 拼回 Hash 不同 | 轮询模式、排序/通配符错误、缺片或 Filter 改变内容 |

## 12. 动手实验

1. 用含中文和长行的文件比较 `-l/-b/-C`。
2. 对 1～20 行分别运行 `-n4`、`-nl/4`、`-nr/4`。
3. 用含换行文件名验证 `-t '\0'`。
4. 故意使用过短后缀观察安全失败。
5. 通过 gzip Filter 切分，再逐片解压和校验。
6. 模拟中途失败，设计临时目录与 Manifest 发布流程。

## 13. 掌握标准

- 能列出 `split` 全部参数和 SIZE 后缀差异。
- 能根据记录完整性选择 `-l/-b/-C/-n`。
- 能解释 `N/K/N/l/N/r/N` 以及哪些模式可直接拼回。
- 能安全处理 NUL 文件名列表、临时空间和后缀排序。
- 能识别 Filter 是 Shell 代码执行面，并验证部分失败。

## 官方参考

- [GNU coreutils 9.11：split invocation](https://www.gnu.org/software/coreutils/manual/html_node/split-invocation.html)
- [POSIX split](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/split.html)

上一篇：[`pr` 命令详解](./18-pr命令详解.md)　下一篇：[`csplit` 命令详解](./20-csplit命令详解.md)

返回：[Linux 命令参考库学习路线](../../00-Linux命令参考库学习路线.md)
