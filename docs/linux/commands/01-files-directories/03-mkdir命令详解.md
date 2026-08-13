---
title: mkdir 命令详解：目录创建、父目录、权限与安全上下文
sidebar_position: 3
description: 完整讲解 GNU coreutils mkdir 的全部长短参数、递归创建、mode 与 umask、SELinux/SMACK 上下文、错误处理和安全实验。
tags: [Linux, mkdir, GNU coreutils, 文件系统, 权限]
---

# `mkdir` 命令详解：目录创建、父目录、权限与安全上下文

`mkdir` 用于创建目录。它改变文件系统目录项，属于 `[W]` 操作。生产脚本中的关键不只是“目录能创建”，还要确保父目录、权限、所有者、安全上下文和并发行为符合预期。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `mkdir` |
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[W]` 创建目录 |
| 主要对象 | 父目录中的目录项、新目录 inode、权限和安全上下文 |

```bash
type -a mkdir
mkdir --version
mkdir --help
```

## 2. 完整语法

```text
mkdir [OPTION]... NAME...
```

可以一次创建多个 `NAME`，GNU `mkdir` 按参数顺序处理。默认情况下，目标已存在会报错。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 是否带值 | 作用 |
|---|---|---:|---|
| `-m MODE` | `--mode=MODE` | 是 | 按 `chmod` 语法设置命令行目标目录的权限模式 |
| `-p` | `--parents` | 否 | 创建缺失的父目录；已存在的目录不报错 |
| `-v` | `--verbose` | 否 | 为每个成功创建的目录输出信息 |
| `-Z` | `--context[=CONTEXT]` | 可选 | 设置 SELinux/SMACK 安全上下文；无值时按默认类型调整 |
| 无 | `--help` | 否 | 显示帮助并退出 |
| 无 | `--version` | 否 | 显示版本并退出 |

这就是 GNU `mkdir` 的完整选项集合。

## 4. 默认创建行为与 umask

程序创建目录时通常请求 `0777`，内核再应用进程 `umask`：

```text
最终普通权限 ≈ 请求权限 & ~umask
```

查看当前值：

```bash
umask
umask -S
```

例如 `umask 0022` 下：

```bash
mkdir demo
stat -c '%A %a %n' demo
```

通常得到 `755`。默认 ACL、SELinux、父目录 setgid 等机制还可能影响最终结果，不能只用公式解释所有环境。

## 5. 参数逐项详解

### 5.1 `-m MODE` / `--mode=MODE`

支持八进制和符号模式：

```bash
# [W]
mkdir -m 0750 private-data
mkdir --mode=u=rwx,g=rx,o= shared-read
```

`MODE` 采用 `chmod` 语法，但以 `a=rwx` 作为修改起点。指定 `-m` 时，目标目录通常按要求模式创建，而不是简单套用当前 umask。

和 `-p` 同时使用时，`-m` 只作用于命令行最终指定的目录，不作用于自动创建的中间父目录：

```bash
mkdir -p -m 0700 a/b/c
stat -c '%a %n' a a/b a/b/c
```

若要控制父目录权限，应在受控子 Shell 中设置 umask，或创建后逐级验证和调整。

### 5.2 `-p` / `--parents`

```bash
# [W]
mkdir -p /srv/app/{config,data,logs}
```

作用：

- 创建缺失父目录。
- 目标已经是目录时不报错。
- 不修改已存在父目录的权限。
- 如果某个路径组件是普通文件，仍会失败。

Brace Expansion `{...}` 是 Shell 功能，不是 `mkdir` 参数；不支持该语法的 Shell 会表现不同。

### 5.3 `-v` / `--verbose`

```bash
mkdir -pv /srv/app/data/cache
```

适合在人工操作或安装日志中记录实际创建了哪些目录。自动化不能只解析文本，还应检查退出码和最终状态。

### 5.4 `-Z` / `--context[=CONTEXT]`

```bash
# [W] 按系统默认类型设置
mkdir -Z /srv/app/data

# [W] 长参数可显式提供上下文；具体值由安全策略决定
mkdir --context=<security-context> /srv/app/secure
```

无参数的 `-Z` 类似按照默认策略调整新对象类型。显式上下文只应在理解 SELinux/SMACK 策略时使用；通常优先通过策略和 `restorecon` 管理持久标签，而不是把固定上下文散落在脚本中。

`--context=CONTEXT` 是长参数形式；短参数 `-Z` 不应直接拼接一个任意上下文值。

## 6. 路径与特殊名称

名称以 `-` 开头时用 `--` 结束选项解析：

```bash
mkdir -- -cache
```

包含空格或通配字符时引用变量：

```bash
name='model cache'
mkdir -- "$name"
```

不要写成 `mkdir $name`，否则 Shell 可能把一个名称拆成多个参数。

## 7. 并发与幂等

多个进程同时执行：

```bash
mkdir -p /srv/app/cache
```

通常可作为“保证目录存在”的幂等操作，但它不保证目录的所有者、权限、安全上下文或挂载点正确。生产脚本应继续验证：

```bash
test -d /srv/app/cache || exit 1
stat -c '%U:%G %a %n' /srv/app/cache
findmnt -T /srv/app/cache
```

目录可能是符号链接或错误挂载点，仅 `-d` 也不能覆盖全部安全要求。

## 8. 常见错误与排查

### 8.1 `File exists`

目标已存在但没有使用 `-p`，或者目标是普通文件：

```bash
ls -ld -- target
stat -- target
```

### 8.2 `Permission denied`

检查每一级父目录搜索权限、挂载只读状态、ACL 和安全上下文：

```bash
namei -l /srv/app/data
getfacl /srv/app
findmnt -T /srv/app
ls -Zd /srv/app
```

### 8.3 `Read-only file system`

```bash
findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS -T /target/path
dmesg -T | tail -n 50
```

文件系统可能因错误被内核重新挂载为只读，不能用修改权限解决。

### 8.4 `No space left on device`

既可能是数据块满，也可能是 inode、配额或底层存储问题：

```bash
df -hT /target/path
df -ih /target/path
```

## 9. 退出状态

| 状态 | 含义 |
|---:|---|
| `0` | 所有请求目录均成功处理 |
| 非 `0` | 至少一个目录创建失败或参数无效 |

一次创建多个目录时可能部分成功、部分失败。非零退出后不能假设“什么都没创建”，应检查每个目标。

## 10. 生产示例

### 10.1 安全建立应用目录

```bash
install_root=/srv/myapp
umask 0027
mkdir -p -- "$install_root"/{config,data,logs}
stat -c '%A %U:%G %n' "$install_root"/*
```

如果还需要设置所有者和精确模式，`install -d` 往往比 `mkdir` 后接多个命令更直接，后续会单独介绍。

### 10.2 创建 Kubernetes HostPath 前验证

```bash
target=/var/lib/myapp/models
mkdir -p -- "$target"
findmnt -T "$target"
stat -c '%a %U:%G %n' "$target"
```

必须确认目录位于预期磁盘，而不是误落到根分区。

## 11. 动手实验

1. 分别在 `umask 0022` 和 `0077` 下创建目录，比较权限。
2. 使用 `-p -m 0700` 创建三级目录，比较父目录和最终目录。
3. 创建普通文件占用中间路径，观察 `mkdir -p` 失败。
4. 创建名为 `-cache` 的目录，理解 `--`。
5. 在启用 SELinux 的测试机比较 `mkdir`、`mkdir -Z` 和 `restorecon`。

## 12. 掌握标准

- 能列出 GNU `mkdir` 的全部选项。
- 能解释 `-p` 的幂等边界。
- 能解释 `-m`、umask、默认 ACL 与父目录权限的关系。
- 能处理以 `-` 开头或含空格的目录名。
- 能从权限、挂载、inode和安全上下文定位创建失败。

## 官方参考

- [GNU coreutils 9.11：mkdir invocation](https://www.gnu.org/software/coreutils/manual/html_node/mkdir-invocation.html)

上一篇：[`ls` 命令详解](./02-ls命令详解.md)

下一篇：[`rmdir` 命令详解](./04-rmdir命令详解.md)

