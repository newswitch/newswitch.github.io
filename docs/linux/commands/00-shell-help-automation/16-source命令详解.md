---
title: "source 与点命令详解：当前 Shell 执行、参数和信任边界"
sidebar_label: "16. source 与点命令详解：当前 Shell 执行、参数和信任边界"
sidebar_position: 16
description: "讲清 source/. 的 PATH 搜索、-p/-T、位置参数、return/trap、配置加载与代码执行风险。"
tags: [Linux, Bash, source, Shell, 安全]
---

# source 与点命令详解：当前 Shell 执行、参数和信任边界

`source FILE [ARGS]` 和 `. FILE [ARGS]` 在**当前 Shell 环境**读取并执行文件，所以其中的变量、函数、cwd、options、trap 和 FD 可能持续影响调用者。它不是安全的 `.env` 解析器。

## 1. 语法与参数

```text
source FILENAME [ARGUMENTS]
. [-p PATH] FILENAME [ARGUMENTS]
```

Bash 的 `source` 支持 `-p PATH` 指定冒号分隔搜索路径和 `-T` 让 DEBUG trap 继承（版本相关）；点命令更接近 POSIX。若 filename 不含斜杠，默认搜索 PATH；Bash 非 POSIX 模式可能在 PATH 找不到后搜索当前目录，受 `sourcepath` shopt 影响。

给 ARGUMENTS 时，source 文件执行期间成为位置参数，返回后恢复；文件可用 `return` 提前返回。返回状态是最后命令状态，找不到/不可读则非零。

## 2. 安全加载模式

```bash
source /opt/myapp/lib/common.sh
```

使用受控绝对路径、固定所有者和不可被低权限用户写的父目录。加载前可检查 `stat`，但检查与打开之间仍有竞态；更强边界应把库随只读镜像部署。

不要这样加载不可信数据：

```bash
source .env
```

文件中 `$(command)`、重定向、function 和任意 Shell 语法都会执行。dotenv/YAML/JSON 用相应解析器和 schema/allowlist。

## 3. 状态污染与库纪律

Shell 库应命名空间化函数/变量，避免 `exit`，谨慎设置 `set/shopt/trap/IFS/cd/umask`；若必须改变，保存并恢复。调用者检查 source 的返回状态。

## 4. 验收与参考

能解释 source 与子进程执行的区别，固定加载路径，识别配置即代码风险，并设计不污染调用者的库。

- [Bash Bourne Shell Builtins：`.`](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)
- [Bash Builtins：source](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[exec 命令详解](./17-exec命令详解.md)。
