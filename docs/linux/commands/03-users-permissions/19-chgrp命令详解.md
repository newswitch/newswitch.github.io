---
title: chgrp 命令详解：组所有权、共享目录与递归边界
sidebar_position: 19
description: 完整讲解 GNU coreutils chgrp 9.11 参数、组名/GID、条件修改、reference、递归 symlink 策略、setgid 目录与共享存储。
tags: [Linux, chgrp, GID, 共享目录, 文件权限]
---

# `chgrp` 命令详解：组所有权、共享目录与递归边界

`chgrp` 只修改文件 group owner，等价于 `chown :GROUP`。它常用于团队共享目录和 GID 迁移，但不会自动让当前会话加入该组，也不会给 group 增加 `rwx` 权限。

## 1. 语法与 GNU 9.11 全部参数

```text
chgrp [OPTION]... GROUP FILE...
chgrp [OPTION]... --reference=RFILE FILE...
```

| 参数 | 作用 |
|---|---|
| `-c`, `--changes` | 只报告发生变化的对象 |
| `-f`, `--silent`, `--quiet` | 抑制大多数错误 |
| `-v`, `--verbose` | 报告每个对象 |
| `--dereference` | 改 symlink 目标；默认 |
| `-h`, `--no-dereference` | 改 symlink 自身（若系统支持） |
| `--from=OWNER:GROUP` | 只在当前 owner/group 匹配时修改 |
| `--no-preserve-root` | 不保护 `/`；默认 |
| `--preserve-root` | 拒绝递归操作 `/` |
| `--reference=RFILE` | 复制参考对象 group；RFILE 总解引用 |
| `-R`, `--recursive` | 递归处理 |
| `-H` | 跟随命令行参数中的目录 symlink |
| `-L` | 跟随所有遇到的目录 symlink |
| `-P` | 不遍历 symlink；递归默认 |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

## 2. 基本使用与权限条件

```bash
chgrp platform -- report
chgrp 2200 -- report
chgrp --reference=template -- report
```

普通用户通常只能修改自己拥有的文件，并且目标组必须属于其当前进程组集合；“账户数据库刚加入组”不代表旧 shell 已取得该组。用无参数 `id` 验证进程凭据。

## 3. 共享目录的完整模型

只改 group 不足以建立团队目录，通常还需要 setgid 继承组、合适 mode、umask 或默认 ACL：

```bash
sudo install -d -o root -g platform -m 2770 /srv/platform
sudo setfacl -d -m u::rwx,g::rwx,m::rwx,o::--- /srv/platform
getfacl -p /srv/platform
```

setgid 使新对象继承目录 GID，但应用显式 chown、文件系统挂载策略和 ACL 仍可能改变结果。多人可写目录若对非互信主体开放，还需考虑 sticky、文件替换、symlink/hardlink 与应用原子写入模型。

## 4. GID 迁移与条件变更

```bash
chgrp --from=:2001 2101 -- file
chgrp --preserve-root -R -P --from=:2001 2101 -- /srv/project
```

先按旧数字 GID 生成跨文件系统清单并停写；`--from` 防止覆盖不匹配对象，但不是分布式事务。NFS/CephFS 和容器节点需要独立验证数字映射，完成后持续扫描旧 GID并设置防复用期。

`chgrp` 可能导致普通文件 setgid 位被内核清除；操作后检查 `stat`。它不会重写 ACL 内命名组条目。

## 5. 退出状态、排障与实验

全部成功通常返回 `0`；任一失败返回非 `0`。常见失败包括目标组不在当前组集合、文件非调用者所有、只读/root-squash、symlink/递归边界或目录服务解析失败。

实验：普通用户向所属/非所属组变更；旧会话新增组；setgid 目录继承；`--from` GID 迁移；`-H/-L/-P` 和 reference。掌握标准是能列出全部参数，并说明“组所有权、组成员、group mode、ACL mask”是四个独立变量。

## 官方参考

- [GNU coreutils 9.11：chgrp(1)](https://man7.org/linux/man-pages/man1/chgrp.1.html)
- [Linux chown(2)](https://man7.org/linux/man-pages/man2/chown.2.html)

上一篇：[`chown` 命令详解](./18-chown命令详解.md)

下一篇：[`umask` 命令详解](./20-umask命令详解.md)
