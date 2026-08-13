---
title: chmod 命令详解：符号权限、八进制、特殊位与递归安全
sidebar_position: 17
description: 完整讲解 GNU coreutils chmod 9.11 参数、符号与数字 mode、目录权限、setuid/setgid/sticky、ACL 交互、符号链接遍历和生产回滚。
tags: [Linux, chmod, 文件权限, setuid, sticky]
---

# `chmod` 命令详解：符号权限、八进制、特殊位与递归安全

`chmod` 修改 inode 的 mode bits。它不改变 owner/group，也不直接管理 SELinux、AppArmor、capabilities、mount flags 或 NFSv4 ACL；存在 POSIX ACL 时，group mode 位对应 ACL mask，结果不能只看 `ls -l`。

## 1. 语法与 GNU 9.11 全部参数

```text
chmod [OPTION]... MODE[,MODE]... FILE...
chmod [OPTION]... OCTAL-MODE FILE...
chmod [OPTION]... --reference=RFILE FILE...
```

| 参数 | 作用 |
|---|---|
| `-c`, `--changes` | 只报告实际变化 |
| `-f`, `--silent`, `--quiet` | 抑制大多数错误；自动化慎用 |
| `-v`, `--verbose` | 报告每个处理对象 |
| `--dereference` | 操作符号链接目标 |
| `-h`, `--no-dereference` | 尝试操作链接自身；多数 Linux 文件系统不支持 symlink mode |
| `--no-preserve-root` | 递归时不特殊保护 `/`；GNU 默认，危险 |
| `--preserve-root` | 拒绝对 `/` 递归操作 |
| `--reference=RFILE` | 复制参考文件的 mode；RFILE 总被解引用 |
| `-R`, `--recursive` | 递归修改目录树 |
| `-H` | 递归时跟随命令行参数中的目录 symlink；GNU chmod 默认遍历策略 |
| `-L` | 递归时跟随遇到的所有目录 symlink；风险最高 |
| `-P` | 不遍历任何目录 symlink |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

GNU 9.11 新旧发行版在 symlink 选项支持上可能不同，必须检查本机 `chmod --help`。

## 2. 文件与目录的 `rwx`

| 位 | 普通文件 | 目录 |
|---|---|---|
| `r` | 读取内容 | 读取目录项名字列表 |
| `w` | 修改内容 | 创建、删除、重命名目录项，通常还需 `x` |
| `x` | 作为程序执行（还受格式/挂载等约束） | 搜索/穿过目录并访问已知名字 |

删除一个文件主要检查父目录 `w+x`，不是文件自身 `w`。无父目录 `x` 时，即使文件是 `777` 也无法沿路径访问：

```bash
namei -l -- /srv/team/report
stat -c '%A %a %U:%G %n' -- /srv/team/report
```

## 3. 符号 mode 完整语法

```text
[ugoa]*([-+=]([rwxXst]*|[ugo]))+
```

- 目标：`u` owner、`g` group、`o` others、`a` all；省略时类似 `a`，但受 umask 限制。
- 运算：`+` 增加，`-` 删除，`=` 精确设置并清除未提及的普通位。
- 权限：`rwx`；`X` 只对目录或已有任一执行位的文件加 `x`；`s` 是 setuid/setgid；`t` 是 sticky。
- 复制：权限位置可用单个 `u/g/o`，例如 `g=u`。

```bash
chmod u=rw,g=r,o= -- report
chmod g=u,o-rwx -- report
chmod -R u=rwX,g=rX,o= -- tree
```

递归目录树优先使用 `X`，避免把所有普通数据文件误设为可执行。

## 4. 八进制与特殊位

```text
特殊位  owner  group  other
  4/2/1  4+2+1 4+2+1 4+2+1
```

```bash
chmod 0640 report
chmod 0750 script
chmod 2770 shared-dir
chmod 1777 scratch-dir
```

- setuid `4xxx`：可执行文件运行时获得文件 owner 的有效 UID；脚本通常被内核忽略。
- setgid `2xxx`：程序获得文件 group；目录中新对象通常继承目录 group。
- sticky `1xxx`：共享可写目录中，限制非特权用户删除/改名不属于自己的条目。

数值 mode 对目录的特殊位清除有 GNU/系统调用细节；明确用 `u-s,g-s,-t`，再用 `stat` 验证，不要假设三位 `755` 一定按预想清除全部特殊位。

## 5. ACL 与 mode 的相互影响

```bash
getfacl -p -- report
chmod g-w -- report
getfacl -p -- report
```

扩展 ACL 存在时，`chmod` 会更新 ACL 中的 base entries/mask，使 `ls -l` 的 group 三位反映 mask。命名用户条目可能仍显示 `rwx`，但 `#effective` 被 mask 限制。排障必须同时看 `stat` 与 `getfacl`。

## 6. 递归变更安全模型

不要运行来源不明的 `chmod -R 777`。推荐：

```bash
root=/srv/myapp
test -d "$root" || exit 1
findmnt -T "$root"
find "$root" -xdev -printf '%m %u:%g %y %p\n' > /root/myapp-mode.before
chmod --preserve-root -R -P u=rwX,g=rX,o= -- "$root"
```

先验证绝对目标、文件系统边界、symlink 策略、预期文件类型和回滚数据。目录与文件需求不同可用两条受限 `find -type d/-type f -exec chmod ...`，但仍要处理并发创建和 TOCTOU。

## 7. 退出状态、故障与实验

全部目标成功通常返回 `0`；任一解析/权限/文件系统错误返回非 `0`。`-f` 只隐藏信息，不让失败变成功；必须检查退出码。

| 现象 | 检查 |
|---|---|
| `chmod 777` 仍拒绝 | 父目录、ACL、LSM、只读挂载、immutable、NFS root squash |
| 目录能列名字却打不开文件 | 有 `r` 无 `x` |
| ACL 用户权限意外减少 | ACL mask 被 mode 更新 |
| setuid/setgid 消失 | chown/chgrp、文件系统策略、nosuid、用户权限限制 |
| 递归跑到树外 | symlink 选项、bind mount 与 mount 边界 |

实验应覆盖文件/目录 `rwx`、`X`、四位八进制、三个特殊位、ACL mask、`-H/-L/-P` 和受限递归回滚。

掌握标准：能列出全部参数；能从 inode/路径/ACL/LSM 多层解释 EACCES；能设计不跨文件系统、不追随意外 symlink、可审计回滚的递归变更。

## 官方参考

- [GNU coreutils 9.11：chmod(1)](https://man7.org/linux/man-pages/man1/chmod.1.html)
- [Linux chmod(2)](https://man7.org/linux/man-pages/man2/chmod.2.html)
- [Linux path_resolution(7)](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

上一篇：[`visudo` 命令详解](./16-visudo命令详解.md)

下一篇：[`chown` 命令详解](./18-chown命令详解.md)
