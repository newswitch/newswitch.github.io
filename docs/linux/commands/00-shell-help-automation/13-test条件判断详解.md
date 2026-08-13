---
title: test、[ ] 与 [[ ]] 条件判断详解：文件、字符串、整数和正则
sidebar_position: 13
description: 系统讲解 test/[ 的全部常用一元二元操作符、Bash [[ ]] pattern/regex、短路、引用与 -a/-o 歧义。
tags: [Linux, Bash, test, 条件判断, 正则]
---

# `test`、`[ ]` 与 `[[ ]]`：条件表达式不是普通文本

`test EXPRESSION` 和 `[ EXPRESSION ]` 是同一语义（`[` 需要最后一个 `]` 参数）；Bash `[[ EXPRESSION ]]` 是关键字语法，支持 pattern/regex 且不会对普通展开结果做 word splitting 和 filename expansion。

## 1. 一元操作符

| 类别 | 操作符 |
|---|---|
| 文件存在/类型 | `-e/-a` 存在、`-f` 普通、`-d` 目录、`-b/-c` 设备、`-p` FIFO、`-S` socket、`-L/-h` symlink |
| 权限/属性 | `-r/-w/-x`、`-u` setuid、`-g` setgid、`-k` sticky、`-s` size>0、`-O/-G` effective owner/group、`-N` 自上次读后修改 |
| FD/终端 | `-t FD` |
| Shell | `-o OPTNAME`、`-v VARNAME`、`-R VARNAME` nameref |
| 字符串 | `-n STRING` 非空、`-z STRING` 为空 |

文件二元：`FILE1 -nt/-ot FILE2` 更新/更旧，`FILE1 -ef FILE2` 同 device+inode。字符串：`=`, `==`, `!=`, `<`, `>`；整数：`-eq/-ne/-lt/-le/-gt/-ge`。

## 2. 组合与引用

```bash
if [[ -f $path && -r $path ]]; then ...; fi
if [[ $name == node-* ]]; then ...; fi
if [[ $value =~ ^[0-9]+$ ]]; then ...; fi
```

在 `[[ ]]` 中，`==` 右侧未整体引用时是 glob pattern；`=~` 右侧是 POSIX ERE，引用会改变正则字符是否生效。匹配捕获在 `BASH_REMATCH`。

可移植 `[ ]` 中始终引用变量：`[ -n "$x" ]`。不要使用歧义大的 `-a`/`-o` 组合，改为多个 `test` 配 Shell `&&/||`。

## 3. 安全与竞态

“先 test 再写/删”存在 TOCTOU：两步间对象可被替换。安全程序应使用原子创建、FD 相对操作或目标程序自己的 no-clobber 接口。symlink 检查也受跟随规则和路径父目录影响。

## 4. 退出状态与验收

真为 0，假为 1，语法错误通常大于 1。能区分空字符串、未设置变量、glob pattern 和 regex；能解释文件检查为何不能当授权边界。

## 5. 官方参考

- [Bash Conditional Expressions](https://www.gnu.org/software/bash/manual/html_node/Bash-Conditional-Expressions.html)
- [Bash Conditional Constructs](https://www.gnu.org/software/bash/manual/html_node/Conditional-Constructs.html)

下一篇：[getopts 与 shift 命令详解](./14-getopts-shift命令详解.md)。
