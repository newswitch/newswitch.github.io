---
title: "readlink 命令详解：读取符号链接与规范化路径"
sidebar_label: "13. readlink 命令详解：读取符号链接与规范化路径"
sidebar_position: 13
description: "完整讲解 GNU coreutils readlink 的全部长短参数、三种规范化模式、NUL 分隔输出、符号链接边界、退出状态与脚本安全用法。"
tags: [Linux, readlink, GNU coreutils, 符号链接, 路径]
---

# readlink 命令详解：读取符号链接与规范化路径

`readlink` 有两个容易混淆的用途：默认读取符号链接 inode 中保存的目标字符串；指定 `-f`、`-e` 或 `-m` 后，则逐级解析路径并输出规范化结果。它不等同于“查询文件最终存放位置”，因为挂载、bind mount、overlay 和进程 Mount Namespace 仍会改变路径所见对象。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[R]`，只读；路径解析可能触发 automount 或远端元数据访问 |
| 主要对象 | 符号链接保存的字符串、路径中的目录项和链接 |

```bash
type -a readlink
env readlink --version
env readlink --help
```

## 2. 完整语法

```text
readlink [OPTION]... FILE...
```

不使用规范化选项时，每个 `FILE` 都应是符号链接。输出的是链接中原样保存的文本，可能是相对路径、绝对路径，也可能指向不存在的对象。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-f` | `--canonicalize` | 规范化路径；除最后一个分量外都必须存在，最后一个分量允许不存在 |
| `-e` | `--canonicalize-existing` | 规范化路径；所有分量都必须存在 |
| `-m` | `--canonicalize-missing` | 规范化路径；所有分量都可以不存在 |
| `-n` | `--no-newline` | 单个操作数时不输出末尾换行；多个操作数会产生警告 |
| `-q` | `--quiet` | 抑制大多数错误诊断 |
| `-s` | `--silent` | `--quiet` 的同义词 |
| `-v` | `--verbose` | 输出错误诊断 |
| `-z` | `--zero` | 每条结果以 NUL 而不是换行结束 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

`POSIXLY_CORRECT` 会影响默认诊断行为。脚本若依赖错误文本是否显示，应显式选择 `-q` 或 `-v`，更重要的是检查退出码。

## 4. 默认模式：读出链接文本

```bash
ln -s ../releases/current app
readlink -- app
```

输出：

```text
../releases/current
```

这里没有验证目标是否存在，也没有把相对目标转换成相对于当前目录的路径。相对链接是相对于“链接所在目录”解析，而不是相对于执行命令的当前目录解析。

```bash
link=/opt/service/app
target=$(readlink -- "$link") || exit 1
case $target in
  /*) resolved=$target ;;
  *)  resolved=$(dirname -- "$link")/$target ;;
esac
```

若目标中包含换行，命令替换还会删除末尾换行，因此机器间传递任意文件名优先使用 `-z` 和支持 NUL 的消费者。

## 5. 三种规范化模式

假设 `/srv/app/current -> releases/v2`：

| 模式 | 中间分量 | 最后分量 | 典型用途 |
|---|---|---|---|
| `-e` | 必须存在 | 必须存在 | 验证一个当前可访问的真实对象 |
| `-f` | 必须存在 | 可不存在 | 解析即将创建的最后一级文件 |
| `-m` | 可不存在 | 可不存在 | 纯路径计算；不能证明对象存在 |

```bash
readlink -e -- /srv/app/current/config.yaml
readlink -f -- /srv/app/current/new.yaml
readlink -m -- /srv/missing/../future/config.yaml
```

规范化会：

1. 将相对路径锚定到当前工作目录。
2. 消除多余 `/`、`.` 和可解析的 `..`。
3. 按选定存在性规则逐级解析符号链接。
4. 输出绝对路径。

它不会证明结果位于你期望的安全边界内，也无法消除检查后到使用前的 TOCTOU 竞态。

## 6. `-n` 与 `-z`

```bash
printf '<'
readlink -n -- app
printf '>\n'
```

`-n` 适合人类格式拼接，但只适用于一个操作数。批量脚本使用：

```bash
readlink -z -- link1 link2 |
while IFS= read -r -d '' target; do
  printf 'target=%q\n' "$target"
done
```

NUL 是 Unix 路径中不能出现的字节，因此可以无歧义分隔含空格、制表符和换行的名称。

## 7. 退出状态与错误定位

| 状态 | 含义 |
|---|---|
| `0` | 所有操作数均成功输出 |
| 非 `0` | 至少一个操作数读取或规范化失败 |

常见失败：操作数不是链接、父目录没有搜索权限、链接循环、存在性规则不满足、路径分量不是目录、链接展开过深。

```bash
if resolved=$(readlink -e -- "$candidate"); then
  printf '%s\n' "$resolved"
else
  rc=$?
  printf 'cannot resolve %q, rc=%d\n' "$candidate" "$rc" >&2
fi
```

不要使用“输出为空”替代退出码判断；空链接目标本身通常无法创建，但诊断被 `-q` 抑制时更容易误判。

## 8. 生产场景

### 8.1 检查 alternatives 或版本链接

```bash
name=/usr/bin/python3
readlink -- "$name"
readlink -e -- "$name"
```

第一条回答“链接保存了什么”，第二条回答“当前 Namespace 中最终解析到了哪里”。

### 8.2 判断路径是否位于受控目录

```bash
root=$(readlink -e -- /srv/uploads) || exit 1
candidate=$(readlink -e -- "$1") || exit 1
case $candidate in
  "$root"|"$root"/*) printf 'inside\n' ;;
  *) printf 'outside\n' >&2; exit 1 ;;
esac
```

这只适合只读审计或低风险预检。高安全写入应让应用使用 `openat2(2)` 的解析约束、目录文件描述符等内核级机制，避免随后链接被替换。

### 8.3 容器内外结果不同

```bash
readlink -e /proc/1/root
readlink -e /proc/self/ns/mnt
```

Mount Namespace、chroot 和挂载传播会使相同字符串看到不同对象；排障必须记录命令在哪个进程环境中执行。

## 9. `readlink`、`realpath` 与 `stat`

| 问题 | 命令 |
|---|---|
| 链接 inode 中保存了什么文本 | `readlink link` |
| 规范化路径并控制存在性 | 优先 `realpath`，也可 `readlink -e/-f/-m` |
| 链接自身的 inode、权限、时间 | `stat link` |
| 链接目标的元数据 | `stat -L link` |

GNU 手册建议一般路径规范化优先使用功能更完整的 `realpath`。

## 10. 动手实验

1. 创建绝对链接、相对链接、悬空链接和两级链接链。
2. 对它们分别运行默认、`-e`、`-f`、`-m`，记录退出码。
3. 从不同当前目录读取同一相对链接，验证输出文本不变而自行拼接容易出错。
4. 创建链接循环，观察诊断。
5. 创建带空格和换行的链接名，用 `-z` 安全读取多条结果。
6. 在容器和宿主机比较 `/proc/1/root` 的解析结果。

## 11. 掌握标准

- 能解释“链接文本”和“规范化路径”的区别。
- 能准确选择 `-e`、`-f`、`-m`。
- 能说明相对链接以链接所在目录为基准。
- 能使用 NUL 分隔批量结果。
- 能解释规范化为什么不能消除 TOCTOU 和 Namespace 差异。

## 12. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：readlink invocation](https://www.gnu.org/software/coreutils/manual/html_node/readlink-invocation.html)
- [Linux symlink(7)](https://man7.org/linux/man-pages/man7/symlink.7.html)
- [Linux path_resolution(7)](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

上一篇：[`stat` 命令详解](./12-stat命令详解.md)

下一篇：[`realpath` 命令详解](./14-realpath命令详解.md)
