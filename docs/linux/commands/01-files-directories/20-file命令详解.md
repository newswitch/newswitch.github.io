---
title: "file 命令详解：文件类型、MIME、magic 与安全检测"
sidebar_label: "20. file 命令详解：文件类型、MIME、magic 与安全检测"
sidebar_position: 20
description: "完整讲解 file 5.46 的全部参数、检测阶段、MIME、magic 数据库、压缩内容、特殊设备、NUL 输出、资源限制、退出状态和不可信文件安全边界。"
tags: [Linux, file, libmagic, MIME, 文件格式]
---

# file 命令详解：文件类型、MIME、magic 与安全检测

`file` 根据文件系统元数据、magic 规则和文本/语言启发式判断文件类型。它提供的是“基于当前规则和已读取字节的识别结果”，不是可信身份、扩展名校验、恶意代码扫描或内容安全证明。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | file/libmagic 项目 |
| 文档基线 | `file` 5.46 manual page |
| 常见软件包 | `file`、`libmagic`、`libmagic-mgc`（名称依发行版） |
| 安全级别 | 常规 `[R]`；`-s` 读取设备、`-z` 解压、`-S` 关闭沙箱会提升风险 |
| 主要对象 | 文件系统类型、文件头、magic 数据库、文本编码与结构启发式 |

```bash
type -a file
file --version
file --help
```

magic 数据库随发行版更新，同一文件在不同版本可能得到不同但更准确的描述；自动化应优先消费稳定的 MIME 字段并允许未知类型。

## 2. 检测流水线

`file` 依次进行：

1. **文件系统测试**：`stat(2)` 判断目录、空文件、符号链接、FIFO、Socket、设备等。
2. **magic 测试**：检查固定偏移、字节序、结构和值关系，匹配 magic 数据库。
3. **文本与语言测试**：识别编码、换行风格和部分语言特征。

通常第一项成功的分类会停止后续测试；`-k` 可继续展示更多 magic 匹配。

## 3. 完整语法

```text
file [OPTION]... FILE...
file -C [-m MAGICFILES]
file --help
```

`FILE` 为 `-` 时读取标准输入。若需要识别多个来自管道的对象，应分别传递有边界的文件或使用清单，而不是把多个内容直接拼到同一标准输入。

## 4. file 5.46 全部参数

### 4.1 输出与批量控制

| 参数 | 作用 |
|---|---|
| `--apple` | 输出旧 MacOS 使用的 type/creator code |
| `-b`、`--brief` | 不在结果前输出文件名 |
| `--extension` | 输出该类型可能的扩展名，以 `/` 分隔 |
| `-F SEP`、`--separator=SEP` | 设置文件名与描述之间的分隔符，默认 `:` |
| `-f NAMEFILE`、`--files-from=NAMEFILE` | 从文本文件逐行读取待检测文件名 |
| `-i`、`--mime` | 输出 MIME type 与 charset |
| `--mime-type` | 只输出 MIME type |
| `--mime-encoding` | 只输出字符编码 |
| `-N`、`--no-pad` | 不填充文件名列对齐 |
| `-n`、`--no-buffer` | 每检查一个文件就刷新 stdout |
| `-r`、`--raw` | 不把不可打印字符转义为八进制形式 |
| `-0`、`--print0` | 文件名后输出 NUL；重复两次则文件名和描述后都输出 NUL |

`-f` 的名称清单按换行分隔，不能无歧义表示含换行的文件名；而 `-0` 只改变输出，不改变 `-f` 输入协议。最安全的批量方式通常是参数数组或逐个由 NUL 消费循环调用。

### 4.2 检测行为与诊断

| 参数 | 作用 |
|---|---|
| `-d` | 向 stderr 输出内部调试信息 |
| `-E` | 文件系统错误时立即以错误退出，而不是把错误当普通结果继续 |
| `-e TEST`、`--exclude=TEST` | 排除指定检测 |
| `--exclude-quiet=TEST` | 排除检测；当前版本不认识时忽略，便于兼容旧版本 |
| `-h`、`--no-dereference` | 不跟随符号链接；未设置 `POSIXLY_CORRECT` 时通常为默认 |
| `-k`、`--keep-going` | magic 首次匹配后继续，输出更多匹配 |
| `-L`、`--dereference` | 跟随符号链接；设置 `POSIXLY_CORRECT` 时通常为默认 |
| `-p`、`--preserve-date` | 尝试恢复读取造成的 atime 变化 |
| `-s`、`--special-files` | 读取块/字符特殊文件，并忽略 stat 报告的大小 |
| `-z`、`--uncompress` | 尝试查看压缩文件内部，同时报告外层压缩信息 |
| `-Z`、`--uncompress-noreport` | 查看压缩内容，只报告内部类型 |
| `-S`、`--no-sandbox` | 在支持 libseccomp 的系统关闭默认沙箱 |

`-e/--exclude` 的有效 `TEST`：

| TEST | 含义 |
|---|---|
| `apptype` | EMX 应用类型，仅相关平台 |
| `ascii`、`text` | 文本和字符集相关测试；二者同义 |
| `encoding` | soft magic 的文本编码测试 |
| `tokens` | 为兼容保留，忽略 |
| `cdf` | Compound Document File 细节 |
| `compress` | 压缩格式和内部检查 |
| `csv` | CSV 结构检查 |
| `elf` | ELF 细节 |
| `json` | JSON 解析与合规检查 |
| `soft` | magic 文件规则 |
| `simh` | SIMH tape 检查 |
| `tar` | 校验 tar 头；排除后有时 soft magic 会给更细描述 |

### 4.3 magic 数据库开发

| 参数 | 作用 |
|---|---|
| `-C`、`--compile` | 把 magic 源文件/目录编译为 `.mgc` |
| `-c`、`--checking-printout` | 打印解析后的 magic，常与 `-m` 调试规则 |
| `-l`、`--list` | 按 strength 降序列出 magic 模式 |
| `-m MAGICFILES`、`--magic-file=MAGICFILES` | 使用指定文件/目录；多个值通常以冒号分隔 |

```bash
file -c -m ./my.magic
file -C -m ./my.magic
file -m ./my.magic -- sample.bin
```

规则开发应在隔离环境测试，并记录 `file` 与数据库版本；自定义 magic 可能覆盖或改变系统结果。

### 4.4 资源限制、版本和帮助

| 参数 | 作用 |
|---|---|
| `-P NAME=VALUE`、`--parameter=NAME=VALUE` | 设置资源限制 |
| `-v`、`--version` | 显示版本和 magic 路径后退出 |
| `--help` | 显示帮助并退出 |

5.46 文档参数：

| NAME | 默认值 | 限制对象 |
|---|---:|---|
| `bytes` | `1M` | 从文件读取的最大字节数 |
| `elf_notes` | `256` | 处理的 ELF notes 数 |
| `elf_phnum` | `2K` | 处理的 ELF program headers 数 |
| `elf_shnum` | `32K` | 处理的 ELF sections 数 |
| `elf_shsize` | `128MB` | 处理的 ELF section 最大尺寸 |
| `encoding` | `65K` | 用于判断编码的最大字节数 |
| `indir` | `50` | 间接 magic 递归上限 |
| `name` | `150` | name/use magic 使用次数上限 |
| `regex` | `8K` | 正则搜索长度上限 |

本机版本可能增加或调整参数，自动化前用 `file --help` 和对应手册核实。

## 5. MIME 与传统描述

```bash
file -- image.png
file --mime -- image.png
file --mime-type -- image.png
file --mime-encoding -- notes.txt
```

| 输出 | 适用场景 |
|---|---|
| 人类描述 | 排障、探索未知文件 |
| MIME type | 程序路由、HTTP 元数据的候选值 |
| MIME encoding | 文本解码提示 |
| extension | 建议扩展名，不是可信原扩展名 |

任何结果都只是候选分类。上传安全还需要大小限制、内容解析器隔离、恶意代码扫描、业务允许列表以及重新编码等措施。

## 6. 符号链接、FIFO 与设备

```bash
file -h -- link
file -L -- link
```

第一条识别链接本身，第二条识别目标。悬空链接、循环和权限不足会导致不同诊断。

`-s` 可读取块设备或字符设备，具有明显风险：

- 设备读取可能阻塞、改变设备状态或造成大量 IO。
- 错误目标可能是终端、随机设备、原始磁盘或驱动接口。
- 容器设备映射与宿主机不同。

执行前用 `stat`、`lsblk`、`findmnt` 确认精确对象，并优先在只读、隔离环境操作。

## 7. 压缩文件与沙箱

```bash
file -z -- archive.gz
file -Z -- archive.gz
```

解压检测可能遭遇压缩炸弹、深层嵌套、恶意解析输入和外部解压程序。`-S` 会关闭可用的 seccomp 沙箱，只应在理解当前构建为什么需要外部解压程序、输入是否可信、进程权限和资源限制后使用。

对不可信文件建议：

1. 在无网络、低权限的隔离进程或容器执行。
2. 设置 CPU、内存、文件大小、进程数和超时限制。
3. 保持沙箱启用，避免 `-S`。
4. 显式限制 `-P bytes=...` 等读取范围。
5. 不把描述文本直接拼入 Shell 命令或 HTML。

## 8. NUL 输出的精确语义

一次 `-0`：

```text
filename NUL description newline
```

重复两次：

```text
filename NUL description NUL
```

```bash
file -0 -0 -- "$path"
```

如果程序同时需要名称和描述，双 NUL 能避免两者中的换行造成歧义。但人类终端会看不到 NUL，应交给明确支持 NUL 的消费者。

## 9. atime 与 `-p`

读取文件可能更新 atime，实际是否变化受 `noatime/relatime/strictatime`、缓存和文件系统实现影响。`-p` 尝试恢复 atime，但恢复本身会改变 ctime，且并发访问、权限和远端文件系统会使结果不完全可控。对取证或严格审计，不要假定 `file -p` 完全无痕。

## 10. 环境变量与数据库来源

- `MAGIC` 可指定默认 magic 文件。
- `POSIXLY_CORRECT` 影响默认是否跟随符号链接。
- 用户 magic 与系统 magic 的搜索优先级取决于构建和环境。

```bash
file --version
printf 'MAGIC=%q\n' "${MAGIC-}"
```

排障报告应记录 `file --version` 输出中的 magic 路径，避免“同一文件结果不同”无法复现。

## 11. 退出状态陷阱

成功操作返回 `0`，错误返回大于 `0`。但为符合 POSIX，默认情况下“文件不存在、无权读取、无法判断类型”等可能作为普通结果输出而不改变退出码；使用 `-E` 才让这些文件系统错误成为失败。

```bash
if kind=$(file -E --brief --mime-type -- "$path"); then
  printf 'type=%s\n' "$kind"
else
  printf 'detection failed: %q\n' "$path" >&2
fi
```

机器校验通常应带 `-E`，并同时校验输出是否属于允许集合。

## 12. 生产场景

### 12.1 上传文件初筛

```bash
mime=$(file -E -b --mime-type -- "$upload") || exit 1
case $mime in
  image/png|image/jpeg) ;;
  *) printf 'unsupported MIME: %s\n' "$mime" >&2; exit 1 ;;
esac
```

这只是第一层；仍需用安全图像库完整解码、限制像素和重新编码。

### 12.2 排查“脚本不能执行”

```bash
file -- script
file --mime-encoding -- script
od -An -tx1 -N16 -- script
```

检查 shebang、CRLF、UTF-8 BOM、解释器路径、架构和动态链接问题。

### 12.3 二进制架构核对

```bash
file -E -- ./server
```

它可提示 ELF 架构、字节序、动态链接和是否 stripped；更深分析使用 `readelf`、`objdump`、`ldd`（对不可信二进制避免直接执行式工具链）。

## 13. 常见错误与排查

| 现象 | 方向 |
|---|---|
| 只显示 `data` | 文件头不足、加密/随机数据、规则库缺失、读取上限过小 |
| 同一文件结果不同 | file/magic 版本、用户 MAGIC、排除测试、读取字节数 |
| 链接与预期不同 | `-h/-L`、`POSIXLY_CORRECT`、悬空链接 |
| 文件不存在但退出码 0 | 默认 POSIX 行为；使用 `-E` |
| `-z` 很慢或失败 | 压缩嵌套、外部解压、沙箱、资源限制 |
| MIME 看似正确但解析器拒绝 | 启发式只识别前部特征，不保证完整结构有效 |
| atime/ctime 变化 | 读取与 `-p` 恢复语义、挂载策略、并发访问 |

## 14. 动手实验

1. 对目录、空文件、文本、ELF、图片、归档、链接、FIFO 分别运行默认检测。
2. 比较 `-h/-L` 和设置/取消 `POSIXLY_CORRECT`。
3. 比较传统描述、`--mime`、两个单独 MIME 选项和 `--extension`。
4. 对不存在文件比较有无 `-E` 的输出与退出码。
5. 用单次与双次 `-0` 编写正确解析器。
6. 用 `-e` 逐类关闭测试，观察判断流水线变化。
7. 在隔离环境测试小型压缩嵌套，设置资源限制并比较 `-z/-Z`。
8. 编写一条自定义 magic，先 `-c` 检查，再 `-C` 编译。

## 15. 掌握标准

- 能解释文件系统、magic、文本/语言三阶段检测。
- 能列出 file 5.46 全部参数及 `-e/-P` 的全部值。
- 能选择人类描述、MIME type、encoding 和 extension。
- 能正确处理链接、NUL 输出和默认退出码陷阱。
- 能说明 `file` 为什么不是安全扫描器，并为不可信输入建立隔离和资源限制。

## 16. 官方参考 {/* #官方参考 */}

- [file 5.46 manual page](https://man7.org/linux/man-pages/man1/file.1.html)
- [file/libmagic project](https://www.darwinsys.com/file/)
- [magic(4)](https://man7.org/linux/man-pages/man4/magic.4.html)

上一篇：[`unlink` 命令详解](./19-unlink命令详解.md)

返回：[Linux 命令参考库学习路线](../../00-Linux命令参考库学习路线.md)
