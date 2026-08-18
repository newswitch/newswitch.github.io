---
title: "cat 命令详解：连接文件、显示控制字符与流式复制"
sidebar_label: "01. cat 命令详解：连接文件、显示控制字符与流式复制"
sidebar_position: 1
description: "完整讲解 GNU coreutils cat 的全部长短参数、标准输入、行号、空行压缩、不可见字符、二进制复制、SIGPIPE 和生产排障边界。"
tags: [Linux, cat, GNU coreutils, 标准输入, 文本处理]
---

# cat 命令详解：连接文件、显示控制字符与流式复制

`cat` 按操作数顺序把输入复制到标准输出。它的名字来自 concatenate，但在生产中更重要的是理解：它默认不解析内容，只搬运字节；一旦启用编号或可见化参数，就会转换输出。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`；重定向目标由 Shell 负责，可能成为 `[D]` |
| 输入 | 文件或标准输入 |
| 输出 | 标准输出 |

```bash
type -a cat
env cat --version
env cat --help
```

## 2. 完整语法

```text
cat [OPTION]... [FILE]...
```

- 没有 `FILE` 时读取标准输入。
- `FILE` 为 `-` 时在该位置读取标准输入。
- 多个 `-` 继续消费同一个标准输入，不会倒带。

```bash
cat first.txt - last.txt
```

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-A` | `--show-all` | 等价于 `-vET` |
| `-b` | `--number-nonblank` | 只给非空输出行编号，从 1 开始；覆盖 `-n` |
| `-e` | 无 | 等价于 `-vE` |
| `-E` | `--show-ends` | 每个行尾显示 `$`；CRLF 显示为 `^M$` |
| `-n` | `--number` | 给所有输出行编号，从 1 开始 |
| `-s` | `--squeeze-blank` | 连续空行压缩为一条空行 |
| `-t` | 无 | 等价于 `-vT` |
| `-T` | `--show-tabs` | TAB 显示为 `^I` |
| `-u` | 无 | 为 POSIX 兼容保留，GNU 忽略 |
| `-v` | `--show-nonprinting` | 用 `^`、`M-` 等记号显示除 LF/TAB 外的非打印字符 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

## 4. 默认拼接与标准输入

```bash
cat -- header body footer > combined
```

`>` 在 `cat` 启动前由 Shell 打开并截断目标。以下写法会先清空 `file`，再让 `cat` 读取空文件：

```bash
# 错误：不要执行
cat file > file
```

安全做法是输出到同目录临时文件，检查成功后再 rename，或使用明确支持原地编辑的工具。追加使用 `>>`，同样由 Shell 控制。

## 5. 行号和空行

```bash
cat -n -- app.conf
cat -b -- app.conf
cat -s -- noisy.txt
```

- `-n` 把空行也编号。
- `-b` 只编号非空行，并使 `-n` 失效。
- “空行”是不含任何字符的行；只有空格或 TAB 的行不是空行。
- 多文件被视为一个连续输出流，编号和连续空行状态跨文件边界延续。

`cat -n` 适合临时观察，不适合生成稳定源代码行号；文件更新后编号会改变。

## 6. 显示不可见字符

```bash
cat -A -- suspicious.txt
```

常见观察：

| 显示 | 可能含义 |
|---|---|
| `$` | 行尾位置，不是原文件新增字符 |
| `^I` | TAB |
| `^M$` | CRLF 中的 CR 与行尾 |
| `^@` | NUL |
| `M-...` | 高位字节的可见化表示 |

`-v` 的显示是字节/控制字符诊断格式，不是 Unicode 解码器。UTF-8 中文可能显示成难读组合；编码判断应结合 `file`、`iconv`、`od`。

## 7. 二进制与终端安全

默认 `cat` 可以复制二进制数据：

```bash
cat part1 part2 > image.bin
cmp -- image.bin expected.bin
```

不要把未知二进制直接输出到交互终端；控制序列可能清屏、修改标题、伪造显示甚至触发终端功能。先使用：

```bash
file -E -- unknown
od -An -tx1 -N256 -- unknown
cat -v -- unknown | head -n 20
```

最后一条仍只是有限可视化，不是恶意内容隔离。

## 8. `cat` 与多余管道

```bash
cat file | grep pattern
grep pattern file
```

第二种少一个进程，且 `grep` 能直接报告文件错误。但 `cat` 并非总是多余：它可以明确连接多个输入、在中间插入标准输入、统一转换可见字符或让某些只读 stdin 的程序接收文件。

优化前先保证语义清楚；大文件性能通常受存储、缓存和下游速度限制。

## 9. SIGPIPE 与退出状态

```bash
cat huge.log | head -n 10
```

`head` 获取足够内容后关闭管道，`cat` 继续写会收到 `SIGPIPE`。在启用 `pipefail` 的脚本中，整个管道可能显示非零，即使“只取前 10 行”达成预期。

```bash
set -o pipefail
cat huge.log | head -n 10
printf 'pipeline=%d stages=%s\n' "$?" "${PIPESTATUS[*]}"
```

不要一概忽略错误；要区分预期的下游提前关闭与真实读取失败。能直接用 `head huge.log` 时，优先避免这条管道。

单独 `cat`：`0` 成功，非 `0` 表示至少一个输入读取或输出写入失败。输出设备满、下游关闭、权限或 I/O 错误都可能失败。

## 10. 生产排障场景

### 10.1 检查 CRLF、TAB 和尾部空格线索

```bash
cat -A -- script.sh | head -n 30
```

### 10.2 查看 procfs/sysfs 小文件

```bash
cat -- /proc/meminfo
cat -- /sys/class/net/eth0/operstate
```

这些是内核生成的动态视图，前后两次读取可能不同；部分 sysfs 文件读取还可能触发驱动逻辑。

### 10.3 合并分片前后校验

```bash
cat -- shard-* > artifact.tmp &&
sha256sum --check artifact.sha256 &&
mv -- artifact.tmp artifact
```

Shell glob 排序受 locale 和名称设计影响；分片名应零填充，并在合并前列出展开顺序。

## 11. 常见错误

| 现象 | 检查方向 |
|---|---|
| 输出乱码 | 编码不匹配、二进制内容、终端 locale |
| 每行出现 `^M` | CRLF |
| 文件被清空 | 输入和 `>` 目标是同一文件 |
| 大量内容卡住 | 下游慢、管道背压、网络文件系统、设备文件 |
| 多文件边界分不清 | cat 默认不加文件名或分隔符 |
| `-s` 没压缩“空白行” | 行内含空格或 TAB，不是真空行 |

## 12. 动手实验

1. 用两个文件和一个 `-` 验证连接顺序。
2. 比较 `-n/-b/-s` 在文件边界的状态。
3. 制作 LF、CRLF、TAB、NUL 和无末尾换行文件，观察所有可见化选项。
4. 复制随机二进制并用 `cmp` 校验。
5. 在临时目录复现“输入与重定向目标相同”的截断原因。
6. 开启 `pipefail`，观察 `cat large | head` 的阶段状态。

## 13. 掌握标准

- 能列出 `cat` 全部参数和组合参数的等价关系。
- 能解释 `-b` 对 `-n` 的覆盖以及跨文件状态。
- 能识别 CRLF、TAB、NUL 和无末尾换行。
- 能说明 Shell 重定向为何可能先截断源文件。
- 能解释背压、SIGPIPE 和二进制终端风险。

## 14. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：cat invocation](https://www.gnu.org/software/coreutils/manual/html_node/cat-invocation.html)
- [Linux pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)

上一篇：[文件内容与文本处理命令导读](./00-文件内容与文本处理命令导读.md)

下一篇：[`tac` 命令详解](./02-tac命令详解.md)
