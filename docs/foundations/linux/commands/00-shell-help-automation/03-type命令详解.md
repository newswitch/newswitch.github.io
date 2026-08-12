---
title: type 命令详解：识别 Alias、Function、Builtin 与可执行文件
sidebar_position: 3
description: 完整讲解 Bash type 的 -a/-f/-P/-p/-t、PATH 查找、hash 与同名命令排障。
tags: [Linux, Bash, type, PATH, 命令查找]
---

# `type` 命令详解：证明一个名称到底执行什么

`type` 使用 Bash 自己的命令查找规则，能识别 alias、keyword、function、builtin、hashed file 和 PATH executable，是排查“同名命令行为不一样”的第一步。

## 1. 全部参数

```text
type [-afptP] NAME [NAME ...]
```

| 参数 | 含义 |
|---|---|
| `-a` | 显示所有可能位置/类型，不只第一个 |
| `-f` | 配合 `-a` 时不查 shell function |
| `-p` | 若最终解析为磁盘文件，打印路径；否则无输出 |
| `-P` | 强制按 PATH 查找可执行文件，即使同名 builtin/function |
| `-t` | 只输出 `alias/keyword/function/builtin/file` 类型词 |

```bash
type -a test printf python
type -t cd
type -P printf
```

## 2. 查找顺序与缓存

Alias 展开发生在命令执行前；随后 function、builtin、PATH/hashed executable 等参与解析。Bash 会 hash 外部命令路径，安装/替换程序后可用 `hash -r` 清缓存。

`type -P` 证明 PATH 中有什么，不代表普通调用一定会执行它。要绕开 function/alias 调 builtin 可用 `builtin name`，绕开 function 调常规解析可用 `command name`，执行精确外部文件则写绝对路径。

## 3. 自动化边界

```bash
if type -P jq >/dev/null; then
  jq --version
fi
```

检查存在后到执行之间仍可能发生 PATH/文件变化（TOCTOU）。安全脚本使用受控 PATH、绝对路径或容器镜像固定版本，并验证版本，不只验证“有这个名字”。

## 4. 验收与参考

能解释 alias/function/builtin/file 同名时谁生效，能区分 `-p` 与 `-P`，能处理 hashed PATH 造成的旧路径。

- [Bash Builtins：type](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[command 命令详解](./04-command命令详解.md)。
