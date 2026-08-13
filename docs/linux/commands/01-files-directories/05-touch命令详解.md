---
title: touch 命令详解：atime、mtime、时间格式与符号链接
sidebar_position: 5
description: 完整讲解 GNU coreutils touch 的全部长短参数、文件创建、atime/mtime/ctime、日期解析、参考文件、符号链接和生产风险。
tags: [Linux, touch, GNU coreutils, 时间戳, 文件系统]
---

# `touch` 命令详解：atime、mtime、时间格式与符号链接

`touch` 用于修改文件的访问时间和修改时间；目标不存在时默认还会创建空文件。它属于 `[W]` 操作，因为时间戳变化可能影响增量构建、同步、备份、缓存和数据处理任务。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `touch` |
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[W]` 创建文件或修改元数据 |
| 主要对象 | atime、mtime、ctime 的间接变化、符号链接时间戳 |

```bash
type -a touch
touch --version
touch --help
```

## 2. 先理解四类时间

| 名称 | 含义 | `touch` 能否指定 |
|---|---|---:|
| atime | 最后访问时间 | 是 |
| mtime | 文件内容最后修改时间 | 是 |
| ctime | inode 状态最后变化时间 | 否；操作通常会把它更新为当前时间 |
| birth/creation time | 文件创建时间 | 否；还依赖文件系统支持 |

查看：

```bash
stat file
stat -c 'atime=%x%nmtime=%y%nctime=%z%nbirth=%w' file
```

`ctime` 不是 creation time。它记录 inode 元数据变化，修改权限、owner、链接数或显式修改 atime/mtime 都可能更新 ctime。

## 3. 完整语法

```text
touch [OPTION]... FILE...
```

默认行为：

- 已存在：把 atime 和 mtime 设置为当前时间。
- 不存在：创建空文件，再设置时间。
- 多个文件按操作数从左到右处理，因此使用“当前时间”时，各文件时间可能存在细微差异。
- 文件名为单个 `-` 时，处理与标准输出关联的文件，而不是名为 `-` 的普通文件。

若确实要处理名为 `-` 的文件，应使用 `./-` 等明确路径。

## 4. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 是否带值 | 作用 |
|---|---|---:|---|
| `-a` | `--time=atime` / `--time=access` / `--time=use` | 否 | 只修改 atime |
| `-c` | `--no-create` | 否 | 目标不存在时不创建，也不警告 |
| `-d TIME` | `--date=TIME` | 是 | 使用可读日期时间字符串 |
| `-f` | 无 | 否 | 忽略；仅用于兼容 BSD 版本 |
| `-h` | `--no-dereference` | 否 | 修改符号链接本身而不是目标；不会创建不存在对象 |
| `-m` | `--time=mtime` / `--time=modify` | 否 | 只修改 mtime |
| `-r FILE` | `--reference=FILE` | 是 | 使用参考文件的时间 |
| `-t STAMP` | 无 | 是 | 使用 `[[CC]YY]MMDDhhmm[.ss]` 格式时间 |
| 无 | `--time=WORD` | 关键字 | 选择 `atime/access/use` 或 `mtime/modify`；可多次指定 |
| 无 | `--help` | 否 | 显示帮助并退出 |
| 无 | `--version` | 否 | 显示版本并退出 |

这就是 GNU `touch` 的完整选项集合。

## 5. 参数逐项详解

### 5.1 `-a`：只改 atime

```bash
# [W]
touch -a file
touch --time=access file
```

mtime 保持不变，但 ctime 通常更新为操作发生时刻。某些文件系统挂载使用 `relatime`、`noatime` 等策略，它们影响普通读取如何自动更新 atime；显式 `touch -a` 仍是主动设置请求。

### 5.2 `-m`：只改 mtime

```bash
# [W]
touch -m file
touch --time=modify file
```

构建系统、同步器和调度任务常用 mtime 判断文件是否变化。人为修改可能触发不必要重建，或掩盖真实数据时间。

### 5.3 同时选择 atime 与 mtime

默认两者都改，也可以显式多次使用：

```bash
touch --time=atime --time=mtime file
```

如果只给 `-a`，只改 atime；只给 `-m`，只改 mtime；两者同时给出则都改。

### 5.4 `-c` / `--no-create`

```bash
# [W] 已存在就更新时间，不存在则无动作
touch -c possible-file
```

目标不存在时不创建且不警告，命令可以返回成功。脚本不能据此断言文件一定存在：

```bash
touch -c -- "$path"
test -e "$path" || printf '目标原本不存在\n' >&2
```

### 5.5 `-d TIME` / `--date=TIME`

GNU 日期解析器支持绝对时间、时区和相对表达式：

```bash
# [W] 推荐生产脚本使用明确的 ISO 风格和时区
touch -d '2026-08-11 10:30:00 UTC' file

# [W] 相对当前时间
touch -d '2 hours ago' file
```

`yesterday`、月份名称和夏令时边界容易产生歧义。自动化中优先使用 UTC、完整日期和明确偏移量。

文件系统时间精度有限时，超出部分会被静默舍入或截断。设置后应通过 `stat` 验证实际值。

### 5.6 `-f`

```bash
touch -f file
```

GNU 实现忽略该参数，只为兼容历史 BSD 调用。它不会强制突破权限，也不是 force 语义。不要因为看到 `-f` 就认为能覆盖错误。

### 5.7 `-h` / `--no-dereference`

默认操作符号链接目标：

```bash
ln -s target link
touch link       # 修改 target
```

修改链接自身：

```bash
# [W]
touch -h -m -d '2026-08-11 10:30:00 UTC' link
```

并非所有系统都支持设置符号链接时间；有些系统观察链接本身还会改变 atime。`-h` 不创建不存在的文件，但目标不存在时如果不想看到警告，还要同时使用 `-c`。

### 5.8 `-r FILE` / `--reference=FILE`

```bash
# [W] 复制参考文件的 atime 和 mtime
touch -r source target

# [W] 只复制参考文件 mtime
touch -m -r source target
```

参考是符号链接时默认读取其目标；配合 `-h` 时读取链接自身时间并修改目标链接自身。

与 `-d` 同时使用时，参考时间作为相对时间的起点：

```bash
# target 比 source 对应时间早 5 秒
touch -r source -d '-5 seconds' target
```

若 `-d` 给出绝对时间，参考文件时间被忽略。

### 5.9 `-t STAMP`

```text
[[CC]YY]MMDDhhmm[.ss]
```

| 字段 | 含义 |
|---|---|
| `CC` | 世纪 |
| `YY` | 两位年份 |
| `MM` | 月 |
| `DD` | 日 |
| `hh` | 小时 |
| `mm` | 分钟 |
| `ss` | 可选秒 |

示例：

```bash
# [W] 2026-08-11 10:30:45，按当前 TZ 解释
touch -t 202608111030.45 file
```

两位年份 `00..68` 按 2000..2068，`69..99` 按 1969..1999。没有年份时使用当前年份。为避免歧义，生产脚本优先写四位年份或使用带时区的 `-d`。

## 6. 废弃的数字时间语法

旧系统允许把第一个类似 `MMDDhhmmYY` 的操作数解释为时间。它会和纯数字文件名冲突：

```bash
# 含义可能依赖兼容模式，不要使用
touch 12312359 main.c
```

应显式写：

```bash
touch -t 12312359 main.c
touch ./12312359 main.c
```

`_POSIX2_VERSION` 可能影响旧兼容行为，便携脚本不要依赖它。

## 7. 权限要求

把时间设为当前时间时，文件 owner 或拥有文件写权限的用户通常可以执行。把时间设为任意指定值时，通常必须是文件 owner 或具有相应特权。

排查：

```bash
namei -l /path/to/file
stat -c '%A %U:%G %n' /path/to/file
getfacl /path/to/file
findmnt -T /path/to/file
```

对不存在文件执行默认 `touch` 还需要父目录写和执行权限。

## 8. 时间、时区和时钟问题

`-d`、`-t` 使用 `TZ` 环境变量或系统默认时区：

```bash
TZ=UTC touch -d '2026-08-11 10:30:00' file
TZ=Asia/Shanghai touch -d '2026-08-11 10:30:00' another-file
```

这两个时间点不同。跨主机自动化应统一 UTC，并检查 NTP/chrony 状态。未来时间可能让 `make`、增量同步和过期清理产生异常。

## 9. 退出状态与部分成功

| 状态 | 含义 |
|---:|---|
| `0` | 所有指定对象按要求处理成功 |
| 非 `0` | 至少一个对象失败或参数无效 |

多个文件按顺序处理，前面的文件可能已修改，后面的文件才失败。`touch` 不是事务。

特殊点：`touch -c missing-file` 对不存在文件无动作，并可以成功退出。

## 10. 生产场景

### 10.1 创建完成标记

```bash
# [W]
touch -- /data/partition/_SUCCESS
```

这只能证明某个进程创建了标记，不能自动证明数据完整。可靠流程还需原子提交、校验和、记录数或事务元数据。

### 10.2 生成 find 时间边界

```bash
marker=$(mktemp) || exit 1
touch -d '2026-08-01 00:00:00 UTC' "$marker"
find /data -type f -newer "$marker" -print
rm -- "$marker"
```

现代 GNU `find` 也支持 `-newermt`。临时文件方法适合需要复用同一精确边界的场景。

### 10.3 保持已有文件时间

某些部署流程需要复制内容后恢复参考时间：

```bash
touch -r reference deployed-file
```

这会影响依赖 mtime 的监控和构建，应在需求明确时使用。

## 11. 常见错误与排查

| 现象 | 原因方向 | 检查 |
|---|---|---|
| 文件意外被创建 | 忘记 `-c` | `stat`、调用脚本和审计日志 |
| 时间与预期差 8 小时 | 时区不同 | `date`、`timedatectl`、`TZ` |
| 纳秒不一致 | 文件系统精度限制 | `stat`、文件系统类型 |
| `Operation not permitted` | owner/权限/只读挂载/安全策略 | `namei`、`getfacl`、`findmnt`、SELinux 日志 |
| 修改链接却改变目标 | 忘记 `-h` | `ls -l`、`stat`、`stat -L` |
| 任务被意外重新触发 | mtime 被改变 | 调度/构建规则和变更时间线 |

## 12. 动手实验

1. 创建文件并记录四类时间。
2. 分别执行 `-a`、`-m`，观察 ctime。
3. 使用 UTC 绝对时间和相对时间，验证 `stat` 输出。
4. 用 `-r` 复制时间，再用 `-r -d '-5 seconds'` 偏移。
5. 建立符号链接，比较默认和 `-h`。
6. 对不存在文件执行默认、`-c`、`-h -c`，比较文件和退出码。

## 13. 掌握标准

- 能列出 GNU `touch` 的全部选项。
- 能区分 atime、mtime、ctime 和 birth time。
- 能解释 `-a`、`-m`、`-c`、`-h` 的组合。
- 能正确解析 `-t` 格式并避免两位年份问题。
- 能解释 `-r` 与相对 `-d` 的关系。
- 能评估修改时间戳对构建、同步、调度和审计的影响。

## 官方参考

- [GNU coreutils 9.11：touch invocation](https://www.gnu.org/software/coreutils/manual/html_node/touch-invocation.html)
- [GNU coreutils：File timestamps](https://www.gnu.org/software/coreutils/manual/html_node/File-timestamps.html)

上一篇：[`rmdir` 命令详解](./04-rmdir命令详解.md)

下一篇：[`mktemp` 命令详解](./06-mktemp命令详解.md)

