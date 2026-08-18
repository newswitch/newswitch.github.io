---
title: "rmdir 命令详解：安全删除空目录与父目录链"
sidebar_label: "04. rmdir 命令详解：安全删除空目录与父目录链"
sidebar_position: 4
description: "完整讲解 GNU coreutils rmdir 的全部长短参数、空目录判断、parents 行为、忽略非空失败、退出状态和生产安全边界。"
tags: [Linux, rmdir, GNU coreutils, 文件系统, 删除目录]
---

# rmdir 命令详解：安全删除空目录与父目录链

`rmdir` 只删除空目录。与 `rm -r` 相比，它把“目录必须为空”作为安全条件，因此很适合清理已经确认没有内容的目录结构。但 `-p` 会沿父路径继续删除，仍然需要谨慎。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `rmdir` |
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[D]` 删除目录项 |
| 安全边界 | 只能删除空目录；除非使用 `-p`，否则不继续处理父目录 |

```bash
type -a rmdir
rmdir --version
rmdir --help
```

## 2. 完整语法

```text
rmdir [OPTION]... DIRECTORY...
```

可以提供多个目录。任何目标不存在、不是目录或不为空，默认都会产生错误。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 是否带值 | 作用 |
|---|---|---:|---|
| 无 | `--ignore-fail-on-non-empty` | 否 | 忽略“目录非空”导致的删除失败 |
| `-p` | `--parents` | 否 | 删除目标后，继续逐级尝试删除父目录 |
| `-v` | `--verbose` | 否 | 为每个成功删除的目录输出信息 |
| 无 | `--help` | 否 | 显示帮助并退出 |
| 无 | `--version` | 否 | 显示版本并退出 |

这就是 GNU `rmdir` 的完整选项集合。

## 4. 默认行为

```bash
mkdir empty-dir
rmdir empty-dir
```

目录中只要还存在一个目录项就不能删除，包括隐藏文件：

```bash
mkdir demo
touch demo/.keep
rmdir demo
```

此时会报告目录非空。`.` 和 `..` 是目录结构的一部分，但不阻止一个没有其他目录项的目录被视为空目录。

## 5. 参数逐项详解

### 5.1 `--ignore-fail-on-non-empty`

```bash
rmdir --ignore-fail-on-non-empty cache
```

只忽略“目标非空”这一类失败，不会忽略：

- 权限不足。
- 目标不存在。
- 目标不是目录。
- 文件系统只读。
- 其他系统调用错误。

它适合“目录为空就清理，不为空就保留”的流程，但可能掩盖本应发现的残留文件。需要审计残留时不要使用。

### 5.2 `-p` / `--parents`

```bash
mkdir -p a/b/c
rmdir -p a/b/c
```

行为近似依次执行：

```text
rmdir a/b/c
rmdir a/b
rmdir a
```

如果某一级非空，命令在该处失败并停止继续删除更高父目录。

`-p` 的风险在于调用者可能只想删除最末级，却删除了整个空父目录链。对绝对路径执行前尤其要先逐级确认。

### 5.3 `-v` / `--verbose`

```bash
rmdir -pv a/b/c
```

输出每个成功删除的目录，适合人工确认和变更记录。不要依赖输出文本代替退出状态。

### 5.4 `-p` 与忽略非空失败组合

```bash
rmdir -p --ignore-fail-on-non-empty a/b/c
```

当父目录仍包含其他内容时，不输出相应非空错误，也不因该非空失败返回失败。自动化使用前必须明确是否允许残留。

## 6. 符号链接与挂载点

`rmdir` 作用于目录，不会把指向目录的符号链接当作目录删除：

```bash
mkdir real-dir
ln -s real-dir link-dir
rmdir link-dir    # 失败：link-dir 是符号链接
```

删除符号链接应使用 `unlink` 或 `rm`，但必须先确认对象类型。

挂载点即使看起来为空，也可能返回 `Device or resource busy`。先检查：

```bash
findmnt -T /target/path
mountpoint /target/path
```

不要把卸载和删除目录混成一个未经验证的操作。

## 7. 路径安全

名称以 `-` 开头：

```bash
rmdir -- -old-dir
```

变量必须引用：

```bash
target='/srv/app/old cache'
rmdir -- "$target"
```

高风险反例：

```bash
# target 为空、包含空格或通配符时可能偏离预期
rmdir -p $target
```

执行 `-p` 前建议解析并展示目标：

```bash
target=/srv/app/releases/empty
resolved=$(realpath -e -- "$target") || exit 1
printf '将删除：%s 以及可能为空的父目录\n' "$resolved"
```

仍要设置允许删除的边界，不能只因为 `realpath` 成功就认为安全。

## 8. 退出状态与部分成功

| 状态 | 含义 |
|---:|---|
| `0` | 所有目标按选项要求成功处理 |
| 非 `0` | 至少一个目标失败 |

多个目标或 `-p` 操作可能先删除一部分，再在后续目录失败。`rmdir` 不是事务，不会自动恢复已经删除的空目录。

```bash
rmdir -pv a/b/c
status=$?
printf 'exit=%d\n' "$status"
```

## 9. 常见错误与排查

### 9.1 `Directory not empty`

```bash
ls -la -- target
find target -mindepth 1 -maxdepth 1 -printf '%P\n'
```

注意隐藏文件、挂载内容和并发写入。

### 9.2 `Permission denied`

删除目录需要对其父目录具备写和执行权限，不只是目标目录本身：

```bash
namei -l /path/to/target
getfacl /path/to
```

### 9.3 `Device or resource busy`

```bash
findmnt -T /path/to/target
fuser -vm /path/to/target
```

确认是否为挂载点、其他进程工作目录或内核正在使用的路径。

### 9.4 删除后目录“又出现”

可能是控制器、systemd tmpfiles、应用进程、Kubernetes HostPath 或自动化配置持续重建。建立时间线，查创建者，而不是反复删除。

## 10. 与 `rm -d`、`rm -r` 的区别

| 命令 | 删除非空目录 | 典型风险 |
|---|---:|---|
| `rmdir dir` | 否 | 最安全的空目录删除 |
| `rm -d dir` | 通常仅用于空目录 | 语义不如 `rmdir` 清晰 |
| `rm -r dir` | 是 | 递归删除全部内容，风险高 |
| `rm -rf dir` | 是且压制大量确认 | 极高风险 |

能用 `rmdir` 时优先使用它，因为“非空就失败”是一道有价值的保护。

## 11. 动手实验

1. 创建空目录并删除。
2. 在目录中放置 `.keep`，观察默认失败和忽略选项。
3. 创建 `a/b/c`，使用 `-p -v` 观察删除顺序。
4. 在 `a` 中增加另一个文件，观察父链在哪里停止。
5. 创建指向目录的符号链接，验证 `rmdir` 不删除该链接。

## 12. 掌握标准

- 能列出 GNU `rmdir` 的全部选项。
- 能解释 `--ignore-fail-on-non-empty` 只忽略哪类错误。
- 能预判 `-p` 会尝试删除哪些父目录。
- 能区分目录、符号链接与挂载点。
- 能解释为什么删除权限取决于父目录。

## 13. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：rmdir invocation](https://www.gnu.org/software/coreutils/manual/html_node/rmdir-invocation.html)

上一篇：[`mkdir` 命令详解](./03-mkdir命令详解.md)

下一篇：[`touch` 命令详解](./05-touch命令详解.md)
