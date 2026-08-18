---
title: "umask 命令详解：新建文件权限、进程继承与默认 ACL"
sidebar_label: "20. umask 命令详解：新建文件权限、进程继承与默认 ACL"
sidebar_position: 20
description: "完整讲解 Bash umask 的参数、八进制与符号掩码、文件和目录创建 mode、进程继承、systemd/container 配置及默认 ACL 覆盖关系。"
tags: [Linux, umask, 文件权限, 默认ACL, Bash]
---

# umask 命令详解：新建文件权限、进程继承与默认 ACL

`umask` 是当前进程的文件创建 mode 掩码。它影响之后创建的对象，不追溯修改已有文件；子进程继承它，每个进程都可再修改。Bash 的 `umask` 是 shell builtin，不能通过执行一个外部子进程永久改变父 shell。

## 1. Bash 语法与全部参数

```text
umask [-p] [-S] [mode]
```

| 参数 | 作用 |
|---|---|
| 无参数 | 以八进制显示当前掩码 |
| `-p` | 输出可作为 shell 输入复用的 `umask NNNN` 形式 |
| `-S` | 以符号“最终允许权限”形式显示/接受 mode |
| `mode` | 八进制掩码或符号权限表达式，修改当前 shell |

```bash
type umask
help umask
umask
umask -p
umask -S
```

不同 shell 的参数和符号语义可能不同；脚本必须知道解释器，而不是假设 `/bin/sh` 等于 Bash。

## 2. 计算公式不是简单十进制减法

应用把请求 mode 传给 `open/mkdir`，内核按位清除 umask：

```text
最终 mode = 请求 mode & ~umask
```

常见程序请求普通文件 `0666`（默认无执行位），目录 `0777`：

| umask | 普通文件常见结果 | 目录常见结果 |
|---:|---:|---:|
| `0022` | `0644` | `0755` |
| `0002` | `0664` | `0775` |
| `0027` | `0640` | `0750` |
| `0077` | `0600` | `0700` |

```bash
old=$(umask)
umask 0027
touch file
mkdir dir
stat -c '%a %n' file dir
umask "$old"
```

程序可以请求更窄 mode，例如 secret 创建时直接请求 `0600`；umask 只能清除位，不能增加程序未请求的权限。之后的 `chmod` 可再次改变权限。

## 3. 符号形式的易错点

```bash
umask -S
umask u=rwx,g=rx,o=
```

`umask -S` 展示的是掩码取反后允许的权限视图，不是直接输出“要屏蔽的位”。为避免 shell 实现差异，生产脚本常用带前导零的四位八进制，并用实际创建测试验证。

## 4. 默认 ACL 会改变简单模型

若父目录有 default ACL，Linux 创建算法先继承/构造 ACL，再受应用请求 mode 限制；简单的 `0666 & ~umask` 结果可能不再完全描述最终 ACL。

```bash
getfacl -p /srv/team
umask 0077
touch /srv/team/new-file
getfacl -p /srv/team/new-file
stat -c '%a %n' /srv/team/new-file
```

这不是 umask “失效”，而是 default ACL 参与了创建规则。共享目录应明确选择 setgid + default ACL，并测试不同应用实际请求的 mode。

## 5. 服务、容器与线程边界

- systemd unit 可用 `UMask=0027`，不要依赖管理员登录 shell profile。
- 容器 entrypoint、runtime 和应用本身可覆盖 umask；Kubernetes `securityContext` 没有通用 umask 字段。
- umask 是进程属性，在线程共享文件系统属性的模型中并发临时修改会产生竞态；多线程程序应直接请求精确 mode，并在必要时使用安全 API。
- `/proc/PID/status` 的 `Umask` 字段可在支持的内核上观察目标进程。

```bash
grep '^Umask:' /proc/self/status
systemctl show myagent -p UMask
```

## 6. 退出状态、常见误区与实验

作为 Bash builtin，合法查询或成功设置返回 `0`；选项或 mode 非法返回非 `0`，且当前掩码不应被当作已成功更新。脚本中不要用 `umask` 的输出作为退出状态，二者是独立通道：

```bash
if ! umask 0027; then
  printf '%s\n' '无法设置 umask' >&2
  exit 1
fi
```

| 误区 | 正确理解 |
|---|---|
| `umask 022` 会修改已有文件 | 只影响之后创建 |
| `0777-0022=0755` 是通用公式 | 应做 bit clear，且程序请求 mode/ACL 会参与 |
| 文件自动得到执行位 | 常见创建请求是 `0666`，没有 `x` 可保留 |
| 在脚本中运行 umask 改变父 shell | 子进程不能反向修改父进程属性 |
| shell umask 能控制 systemd 服务 | 服务管理器/进程有自己的继承链和 `UMask=` |

实验：对四种掩码创建文件/目录；让程序显式请求 `0600`；创建 default ACL 目录；比较交互 shell、子 shell、systemd service 和容器；观察 `/proc/PID/status`。

掌握标准：能列出 Bash 全部参数；能用按位公式计算且解释例外；能沿父进程→服务→应用追踪 umask，并在 default ACL 下计算实际结果。

## 7. 官方参考 {/* #官方参考 */}

- [GNU Bash：Bourne Shell Builtins](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)
- [Linux umask(2)](https://man7.org/linux/man-pages/man2/umask.2.html)
- [systemd.exec：UMask](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)

上一篇：[`chgrp` 命令详解](./19-chgrp命令详解.md)

下一篇：[`getfacl` 命令详解](./21-getfacl命令详解.md)
