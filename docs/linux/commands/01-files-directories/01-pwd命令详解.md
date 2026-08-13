---
title: pwd 命令详解：逻辑路径、物理路径与 Shell Builtin
sidebar_position: 1
description: 完整讲解 GNU coreutils pwd 的全部长短参数、Shell 内建命令差异、PWD 环境变量、符号链接路径和退出状态。
tags: [Linux, pwd, GNU coreutils, Shell Builtin, 路径]
---

# `pwd` 命令详解：逻辑路径、物理路径与 Shell Builtin

`pwd` 是 print working directory 的缩写，用于输出当前进程的工作目录。它看似简单，却包含逻辑路径、物理路径、`PWD` 环境变量和 Shell Builtin 优先级等重要概念。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `pwd` |
| 类型 | Bash 等 Shell 通常提供 Builtin；GNU coreutils 也提供外部程序 |
| 外部实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]` 只读 |
| 主要对象 | 当前进程的工作目录、`PWD` 环境变量、路径解析结果 |

确认当前实际执行哪个实现：

```bash
type -a pwd
command -V pwd
help pwd
env pwd --version
```

直接输入 `pwd` 通常执行 Shell Builtin。`env pwd` 会通过 `PATH` 查找外部程序，可避免 Alias、Function 和 Builtin 干扰；也可以使用发行版确认后的绝对路径，例如 `/usr/bin/pwd`。

## 2. 完整语法

GNU coreutils：

```text
pwd [OPTION]...
```

Bash Builtin：

```text
pwd [-LP]
```

`pwd` 不接收目录位置参数。它输出的是调用进程已经拥有的当前工作目录，不是查询某个任意路径。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 是否带值 | 作用 |
|---|---|---:|---|
| `-L` | `--logical` | 否 | 优先输出逻辑路径，允许保留符号链接组件 |
| `-P` | `--physical` | 否 | 输出解析所有符号链接后的物理路径 |
| 无 | `--help` | 否 | 显示帮助并退出 |
| 无 | `--version` | 否 | 显示版本并退出 |

这就是 GNU `pwd` 的完整选项集合。Bash Builtin 通常只接受 `-L`、`-P`，其帮助通过 `help pwd` 查看，不应假设它支持 GNU 长参数。

### 3.1 `-L` / `--logical`

如果环境变量 `PWD`：

1. 是绝对路径；
2. 不包含 `.` 或 `..` 路径组件；
3. 确实表示当前目录；

GNU `pwd -L` 可以直接输出它，因此结果可能保留符号链接名称。条件不成立时会退回物理路径处理。

### 3.2 `-P` / `--physical`

解析路径中的符号链接，输出真实目录组件。排查挂载、权限和文件落点时，物理路径通常更可靠。

### 3.3 参数覆盖顺序

`-L` 和 `-P` 互斥；同时出现时，最后一个生效：

```bash
pwd -L -P    # -P 生效
pwd -P -L    # -L 生效
```

GNU 外部 `pwd` 在没有参数时通常使用物理模式；设置 `POSIXLY_CORRECT` 时默认行为可能改变。Shell Builtin 的默认值由 Shell 语义决定，因此脚本需要确定行为时应显式写 `-L` 或 `-P`。

## 4. 逻辑路径与物理路径实验

```bash
lab_dir=$(mktemp -d) || exit 1
mkdir -p "$lab_dir/real/subdir"
ln -s "$lab_dir/real" "$lab_dir/link"
cd "$lab_dir/link/subdir" || exit 1

pwd -L
pwd -P
printf '%s\n' "$PWD"
```

预期关系：

```text
pwd -L  → .../link/subdir
pwd -P  → .../real/subdir
$PWD    → 通常与逻辑路径一致
```

`cd -P` 会让 Shell 采用物理路径进入目录，之后 `$PWD` 也可能变成真实路径。

## 5. `$PWD`、`pwd` 与 `/proc`

三者观察角度不同：

```bash
printf '%s\n' "$PWD"
pwd -P
readlink /proc/self/cwd
```

- `$PWD`：Shell 维护的环境变量，可以保留逻辑路径，也可能被人为篡改。
- `pwd -P`：命令解析后的物理路径。
- `/proc/<pid>/cwd`：内核暴露的某个进程当前工作目录符号链接。

查看其他进程：

```bash
readlink -e /proc/<pid>/cwd
```

需要对目标进程拥有足够权限。若目录已经删除，`/proc/<pid>/cwd` 可能显示 `(deleted)`，这说明进程仍引用该目录对象，但原目录项已经不存在。

## 6. 生产使用场景

### 6.1 脚本确认执行位置

```bash
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
printf '脚本目录：%s\n' "$script_dir"
```

脚本不应默认调用者一定在项目目录。先获得明确的脚本路径或配置路径，再操作文件。

### 6.2 Kubernetes 容器目录排查

```bash
kubectl exec -n <namespace> <pod> -- pwd -P
kubectl exec -n <namespace> <pod> -- readlink /proc/1/cwd
```

容器里的 `/` 和宿主机根目录不是同一个挂载视图。命令输出必须结合 Mount Namespace 理解。

### 6.3 符号链接发布目录

很多应用使用 `current -> releases/20260811`。在 `current` 下运行：

```bash
pwd -L
pwd -P
```

前者表示运维使用的稳定逻辑路径，后者表示实际发布版本，二者都可能有价值。

## 7. 退出状态与错误

| 状态 | 含义 |
|---:|---|
| `0` | 成功输出当前目录 |
| 非 `0` | 无法确定或输出当前目录、参数错误等 |

```bash
pwd -P
status=$?
printf 'exit=%d\n' "$status"
```

一种特殊情况是：进程进入目录后，该目录或父目录被删除/重命名。内核仍保存工作目录引用，但命令可能无法重建一条正常绝对路径。此时继续查看 `/proc/$$/cwd`、挂载和父目录变化。

## 8. 常见误区

### 8.1 把 `$PWD` 当成不可伪造事实

环境变量可以被修改。需要物理路径时使用显式 `pwd -P` 或 `/proc/<pid>/cwd` 交叉验证。

### 8.2 用 `which pwd` 判断实际实现

`which` 通常只搜索 `PATH`，不能可靠识别 Builtin、Function 和 Alias。优先使用：

```bash
type -a pwd
command -V pwd
```

### 8.3 忽略符号链接

逻辑路径适合展示稳定入口，物理路径适合确认真实位置。二者不同不代表某一个一定错误。

## 9. 动手实验

1. 创建真实目录和符号链接目录。
2. 通过符号链接进入子目录。
3. 比较 `$PWD`、`pwd -L`、`pwd -P` 和 `/proc/self/cwd`。
4. 分别执行 Bash Builtin 与 `env pwd`，比较帮助和版本能力。
5. 先记录路径，再从另一个终端重命名父目录，观察输出变化。

## 10. 掌握标准

- 能解释当前工作目录属于进程状态。
- 能区分逻辑路径、物理路径与 `PWD` 环境变量。
- 能证明当前调用的是 Shell Builtin 还是 GNU 外部程序。
- 能解释 `-L`、`-P` 同时出现时谁生效。
- 能通过 `/proc/<pid>/cwd` 排查其他进程的工作目录。

## 官方参考

- [GNU coreutils 9.11：pwd invocation](https://www.gnu.org/software/coreutils/manual/html_node/pwd-invocation.html)
- [Bash Builtin Commands](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

上一篇：[文件与目录命令导读](./00-文件与目录命令导读.md)

下一篇：[`ls` 命令详解](./02-ls命令详解.md)

