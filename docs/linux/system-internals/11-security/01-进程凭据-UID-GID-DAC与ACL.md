---
title: "进程凭据、UID/GID、DAC 与 ACL：一次文件访问先检查什么"
sidebar_label: "01. 凭据、DAC 与 ACL"
sidebar_position: 1
description: "解释 real/effective/saved/fs ID、补充组、mode bits、目录权限、umask 和 POSIX ACL。"
tags: [Linux, Credentials, DAC, POSIX ACL, UID]
---

# 进程凭据、UID/GID、DAC 与 ACL：一次文件访问先检查什么

文件权限判断使用进程当前 credential 与 inode 元数据，不是只比较登录用户名。setuid、补充组、User Namespace、ACL 和 capability 都会改变结果。

## 1. 进程身份

| 字段 | 常见意义 |
|---|---|
| real UID/GID | 调用者来源身份 |
| effective UID/GID | 多数权限检查使用的身份 |
| saved set-ID | 受控切换回特权身份 |
| fsuid/fsgid | Linux 文件系统访问检查使用，通常跟随 effective ID |
| supplementary groups | 额外组成员集合 |

```bash
id
grep -E '^(Uid|Gid|Groups):' /proc/<PID>/status
```

线程 credential 在内核中按规则管理；用户态通常把进程视为统一身份，但调试低层行为时要确认具体 task。

## 2. 文件与目录 mode

普通文件的 `r/w/x` 是读内容、修改内容、执行；目录的含义不同：

- `r`：列出目录项名字。
- `x`：搜索/穿越目录并访问已知名字。
- `w`：配合 `x` 创建、删除或重命名目录项。

删除文件主要检查父目录权限，不要求对文件本身有写权限。sticky bit 让共享目录中的删除/重命名受 owner 约束。

## 3. POSIX ACL 顺序

ACL 在 owner、named user、group class、other 之间按规则匹配；mask 限制 named user 和 group class 的有效权限。`getfacl` 显示的 `effective:` 才可能是最终结果。

```bash
namei -om /path/to/file
getfacl -p /path/to/file
getfacl -p /path/to/parent
```

路径上每级目录都需要搜索权限。只看目标文件 `ls -l` 经常误判。

## 4. umask 与默认 ACL

创建权限来自应用请求 mode，再受到 umask/默认 ACL 计算；umask 不是事后 `chmod`。目录默认 ACL 会继承到新对象，并产生 access ACL 与 mask。

## 5. setuid/setgid

setuid 可让可执行文件运行时取得文件 owner 的 effective UID；脚本通常不采用传统 setuid 语义。目录 setgid 常用于让新文件继承目录 group。某些写操作、文件系统和挂载选项会清除 set-ID 位。

## 6. 练习与答案

**问题：文件 mode 为 `000`，root 是否永远能读？**

答案：传统 root 常凭 capability 绕过 DAC，但仍可能受 LSM、加密、挂载、文件系统错误和 User Namespace 作用域限制，不能概括为永远。

**问题：有目录 `r` 没有 `x`，能否读取其中已知文件？**

答案：通常不能穿越目录完成路径解析；目录 `x` 是关键搜索权限。

下一篇：[Linux Capability 与特权拆分](./02-Linux-Capability与特权拆分.md)
