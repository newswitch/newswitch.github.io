---
title: chown 命令详解：所有者迁移、条件变更与符号链接安全
sidebar_position: 18
description: 完整讲解 GNU coreutils chown 9.11 参数、OWNER:GROUP 语法、--from 条件迁移、递归与 symlink 策略、特殊位和分布式存储风险。
tags: [Linux, chown, UID, GID, 文件所有权]
---

# `chown` 命令详解：所有者迁移、条件变更与符号链接安全

`chown` 修改 inode 的数字 owner UID 和/或 group GID。名称只是 NSS 解析入口；共享存储、容器和跨节点迁移必须以数字映射为契约。

## 1. 语法与 GNU 9.11 全部参数

```text
chown [OPTION]... [OWNER][:[GROUP]] FILE...
chown [OPTION]... --reference=RFILE FILE...
```

| 参数 | 作用 |
|---|---|
| `-c`, `--changes` | 只报告发生变化的对象 |
| `-f`, `--silent`, `--quiet` | 抑制大多数错误 |
| `-v`, `--verbose` | 报告每个对象 |
| `--dereference` | 操作 symlink 指向对象；默认 |
| `-h`, `--no-dereference` | 操作 symlink 自身而非目标 |
| `--from=OWNER:GROUP` | 仅当前 owner/group 匹配时修改；任一字段可省略 |
| `--no-preserve-root` | 不保护 `/`；默认，危险 |
| `--preserve-root` | 拒绝递归操作 `/` |
| `--reference=RFILE` | 复制参考对象 owner/group；RFILE 总被解引用 |
| `-R`, `--recursive` | 递归操作 |
| `-H` | 跟随命令行参数中的目录 symlink |
| `-L` | 跟随遍历中所有目录 symlink |
| `-P` | 不遍历任何 symlink；GNU chown 递归默认 |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

## 2. OWNER:GROUP 的精确语义

```bash
chown alice -- file          # 只改 owner
chown alice:platform -- file # 同时改 owner/group
chown alice: -- file         # owner 改为 alice，group 改为 alice 的登录主组
chown :platform -- file      # 只改 group
chown --reference=golden -- file
```

owner/group 可以是名称或数字。纯数字名称存在歧义；跨节点自动化应显式验证 `getent` 与预期数字，并记录变更前后的 `stat -c '%u:%g %U:%G'`。

普通用户通常只能把自己拥有的文件改到自己所属的组，不能随意转移 owner；root 或有 `CAP_CHOWN` 的进程可扩大操作。

## 3. 条件迁移 `--from`

UID/GID 迁移时使用条件可防止覆盖已被其他流程接管的对象：

```bash
chown --from=1001:2001 1101:2101 -- file
chown --from=:2001 :2101 -- file
```

这不是完整事务：检查与变更仍可能面对并发，递归过程中状态可变化。关键系统应停写、按文件系统原生能力快照/迁移，并在完成后扫描旧 ID。

## 4. 递归与符号链接

```bash
chown --preserve-root -R -P --from=olduser:oldgroup newuser:newgroup -- /srv/app
```

`-P` 控制是否遍历 symlink 目录；`-h` 控制最终改链接自身还是目标，是两个不同维度。`-L` 可能越出预期目录树。bind mount 不是 symlink，`chown -R` 也没有 `-xdev`；需要文件系统边界时先用 `find -xdev -exec chown ...` 并验证并发/路径安全。

## 5. 特殊位、ACL 与分布式存储

更改 owner/group 可能清除普通文件 setuid/setgid 位，具体受内核、权限和文件系统影响；操作后必须 `stat` 验证。ACL 命名条目不会因用户名/GID 迁移自动重写；NFS root squash 可能让 root chown 被拒绝，CephFS/NFS/容器 user namespace 还涉及客户端 ID 映射。

```bash
stat -c '%A %a %u:%g %n' -- file
getfacl -n -p -- file
findmnt -T file
```

## 6. 退出状态、故障与实验

全部成功通常返回 `0`，任一目标失败返回非 `0`。`-f` 会降低可观测性，不应在迁移中使用。

| 现象 | 检查 |
|---|---|
| 显示 `nobody`/数字 | NSS/ID mapping、root squash、user namespace |
| root 也不能 chown | NFS export、只读挂载、immutable、LSM、capability bounding |
| 改完 setuid 消失 | 内核安全清除，重新评审而非盲目恢复 |
| 跨节点名字不同 | 比较数字 UID/GID 和目录服务一致性 |

实验：覆盖全部 OWNER:GROUP 形式、`--from`、reference、symlink 参数、setgid 清除与 NFS/容器映射。掌握标准是能完整列出参数，并完成带旧 ID 扫描、条件变更、文件系统边界和回滚的所有权迁移。

## 官方参考

- [GNU coreutils 9.11：chown(1)](https://man7.org/linux/man-pages/man1/chown.1.html)
- [Linux chown(2)](https://man7.org/linux/man-pages/man2/chown.2.html)

上一篇：[`chmod` 命令详解](./17-chmod命令详解.md)

下一篇：[`chgrp` 命令详解](./19-chgrp命令详解.md)
