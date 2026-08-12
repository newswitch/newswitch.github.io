---
title: readonly 与 unset 命令详解：不可重赋值、变量删除与函数边界
sidebar_position: 10
description: 完整讲解 Bash readonly 的 -a/-A/-f/-p 与 unset 的 -f/-v/-n，以及动态作用域、nameref、数组和不可逆属性。
tags: [Linux, Bash, readonly, unset, 变量]
---

# `readonly` 与 `unset`：变量生命周期的两端

`readonly` 使当前 Shell 中的变量或函数不能再赋值/删除；`unset` 删除变量或函数。二者高度耦合：readonly 是当前 Shell 生命周期内不可逆属性，但不能保护子进程、文件或其他配置源。

## 1. readonly 参数

```text
readonly [-aAf] [NAME[=VALUE] ...]
readonly -p
```

| 参数 | 含义 |
|---|---|
| `-a`、`-A` | indexed / associative array |
| `-f` | 函数名 |
| `-p` | 显示全部 readonly name |

## 2. unset 参数

```text
unset [-fnv] [NAME ...]
```

| 参数 | 含义 |
|---|---|
| `-v` | 只按变量处理 |
| `-f` | 只按函数处理 |
| `-n` | NAME 是 nameref 时，只删除 nameref 本身而非目标 |

未给 `-f/-v` 时，名称解析可能先变量后函数；安全脚本显式选择类型。

## 3. 数组、作用域与陷阱

```bash
readonly CONFIG_DIR=/etc/myapp
unset -v optional_value
unset -v 'arr[2]'
unset -n ref
```

数组下标可能参与算术或关联数组解析，引用整个 `arr[index]` 参数，避免 glob。动态作用域下 `unset` 可能暴露外层同名变量，函数库避免通用变量名。

`unset PATH` 不会“恢复默认值”，而是让 PATH 不存在；恢复需要显式设置受控值。清除变量也不保证敏感字节已从进程内存、日志或子进程环境消失。

## 4. 验收与参考

能区分不可重赋值与安全配置，显式删除变量/函数/nameref，预测局部变量删除后的外层可见性。

- [Bash Bourne Shell Builtins](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)

下一篇：[set 命令详解](./11-set命令详解.md)。
