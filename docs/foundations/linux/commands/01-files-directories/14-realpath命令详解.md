---
title: realpath 命令详解：规范化、相对路径与符号链接策略
sidebar_position: 14
description: 完整讲解 GNU coreutils realpath 的全部长短参数、存在性模式、逻辑与物理解析、相对路径输出、NUL 分隔和安全边界。
tags: [Linux, realpath, GNU coreutils, 路径解析, 符号链接]
---

# `realpath` 命令详解：规范化、相对路径与符号链接策略

`realpath` 把路径转换为规范形式，并能控制分量是否必须存在、是否解析符号链接以及输出绝对还是相对路径。它是路径计算工具，不是权限授权工具，也不是并发安全的文件打开操作。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[R]`；解析可能访问远端目录或触发 automount |
| 主要对象 | 路径字符串、目录项、符号链接 |

```bash
type -a realpath
env realpath --version
env realpath --help
```

## 2. 完整语法与默认行为

```text
realpath [OPTION]... FILE...
```

GNU 默认相当于 `-E -P`：最后一个路径分量可以不存在，其他分量必须存在；在处理 `..` 前解析符号链接。为了跨实现可读性，脚本应显式写出需要的模式。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-E` | `--canonicalize` | 除最后分量外均须存在；GNU 默认模式 |
| `-e` | `--canonicalize-existing` | 所有路径分量都必须存在 |
| `-m` | `--canonicalize-missing` | 路径分量允许不存在 |
| `-L` | `--logical` | 先按文本处理 `..`，再处理之前可能遇到的符号链接 |
| `-P` | `--physical` | 先解析符号链接，再处理后续 `..`；默认 |
| `-q` | `--quiet` | 抑制大多数错误诊断 |
| 无 | `--relative-to=DIR` | 相对于 `DIR` 输出结果 |
| 无 | `--relative-base=DIR` | 仅当结果位于 `DIR` 内时输出相对路径，否则输出绝对路径 |
| `-s` | `--strip` | 不展开符号链接 |
| `-s` | `--no-symlinks` | `--strip` 的同义长参数 |
| `-z` | `--zero` | 以 NUL 终止每条结果 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

存在性参数 `-E/-e/-m`、链接策略 `-L/-P/-s` 是两个不同维度，不要混为一谈。

## 4. `-E`、`-e`、`-m`

```bash
realpath -e -- existing/file
realpath -E -- existing/new-file
realpath -m -- missing/parents/new-file
```

| 需求 | 选择 |
|---|---|
| 读取前确认整个对象当前存在 | `-e` |
| 为已存在目录下的新文件计算路径 | `-E` |
| 生成未来布局或只做字符串规范化 | `-m` |

`-m` 输出成功不表示任何父目录存在，更不表示有权创建它们。

## 5. `-P` 与 `-L` 的关键区别

构造：

```text
/lab/link -> /srv/releases/v2
/lab/link/.. 
```

- `-P` 先把 `link` 解析为 `/srv/releases/v2`，再处理 `..`，结果趋向 `/srv/releases`。
- `-L` 按逻辑路径先消除 `link/..`，结果趋向 `/lab`。

```bash
realpath -P -- /lab/link/..
realpath -L -- /lab/link/..
```

Shell 的逻辑工作目录、应用自身的路径处理和内核逐级解析可能采用不同语义。故障复现必须记录原始路径和模式。

## 6. `-s`：只规范化字符串

```bash
realpath -s -m -- ./a/../link/config
```

`-s` 不展开符号链接，适合展示或对路径字符串去除 `.`、重复斜杠等。它不能判断链接实际指向，也不能作为“路径未逃逸”的安全证明。

## 7. 相对输出

### 7.1 `--relative-to`

```bash
realpath --relative-to=/srv/app -- /srv/app/releases/v2/bin/server
```

输出类似：

```text
releases/v2/bin/server
```

如果目标不在基准目录内，结果可能包含 `..`：

```bash
realpath --relative-to=/srv/app -- /var/log/app.log
```

### 7.2 `--relative-base`

```bash
realpath --relative-to=/srv/app --relative-base=/srv -- /srv/app/config
realpath --relative-to=/srv/app --relative-base=/srv -- /etc/hosts
```

只有规范结果位于 `--relative-base` 内才输出相对路径；否则保留绝对路径。`--relative-to` 的默认值是当前目录，`--relative-base` 不应被误认为安全沙箱。

## 8. 批量与 NUL 分隔

```bash
printf '%s\0' 'a b' $'line\nbreak' |
while IFS= read -r -d '' path; do
  realpath -z -m -- "$path"
done
```

普通换行输出无法无歧义表示含换行的文件名。使用 `-z` 后，下游也必须以 NUL 读取，不能再用普通 `for x in $(...)`。

## 9. 退出状态与诊断

| 状态 | 含义 |
|---|---|
| `0` | 所有操作数均成功规范化并输出 |
| `1` | 至少一个操作数失败 |

常见原因：父目录不存在、权限不足、符号链接循环、路径分量不是目录、`-e` 目标不存在。

```bash
if canonical=$(realpath -e -- "$path"); then
  printf '%s\n' "$canonical"
else
  printf 'cannot canonicalize: %q\n' "$path" >&2
fi
```

## 10. 生产安全模型

错误模式：

```bash
resolved=$(realpath -e -- "$user_path") || exit 1
# 此处攻击者可替换链接
rm -- "$resolved"
```

`realpath` 和后续 `rm/open/chown` 是两个系统调用序列，期间目录项可变化。对不可信可写目录的高风险操作，应使用目录文件描述符、`openat(2)`/`openat2(2)`、`O_NOFOLLOW`、`RESOLVE_BENEATH` 等机制，并最小化权限。

另外还要考虑：

- Mount Namespace：不同容器解析到不同挂载树。
- bind mount：规范路径相同不代表底层设备布局直观。
- NFS/CephFS：元数据缓存和网络错误会改变观察时延。
- 大小写：Linux 常见文件系统大小写敏感，但不是所有挂载都如此。
- 双斜杠 `//`：某些平台允许实现定义的特殊语义。

## 11. 常见错误

| 误区 | 正确理解 |
|---|---|
| 结果是绝对路径，所以一定存在 | `-E/-m` 可以输出不存在的最终对象或分量 |
| 结果位于前缀下，所以后续操作安全 | 字符串检查挡不住竞态和挂载变化 |
| `-L` 表示跟随全部链接 | 这里表示逻辑处理顺序；不要与 `find -L` 的含义混用 |
| 相对结果不含 `..` | 目标在基准外时可能出现 `..` |
| `-q` 表示忽略失败 | 它只抑制诊断，退出码仍需检查 |

## 12. 动手实验

1. 创建真实目录、绝对链接、相对链接、悬空链接和循环链接。
2. 对不存在的最后分量和不存在的中间分量比较 `-E/-e/-m`。
3. 用 `link/..` 比较 `-L` 与 `-P`。
4. 用 `-s` 证明只做字符串规范化时链接没有展开。
5. 对基准目录内外的对象比较两个 relative 参数。
6. 用带换行文件名验证 `-z`。

## 13. 掌握标准

- 能把存在性策略与链接解析策略分开选择。
- 能解释 `-L/-P` 在 `link/..` 上的差异。
- 能正确使用 `--relative-to` 和 `--relative-base`。
- 能说明规范路径不是授权、隔离或无竞态打开。
- 能在批量脚本中使用 NUL 分隔。

## 官方参考

- [GNU coreutils 9.11：realpath invocation](https://www.gnu.org/software/coreutils/manual/html_node/realpath-invocation.html)
- [Linux path_resolution(7)](https://man7.org/linux/man-pages/man7/path_resolution.7.html)
- [Linux openat2(2)](https://man7.org/linux/man-pages/man2/openat2.2.html)

上一篇：[`readlink` 命令详解](./13-readlink命令详解.md)

下一篇：[`basename` 命令详解](./15-basename命令详解.md)

