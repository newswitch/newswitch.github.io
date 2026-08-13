---
title: setfacl 命令详解：修改、继承、备份与恢复 POSIX ACL
sidebar_position: 22
description: 完整讲解 setfacl 的全部参数、ACL entry 语法、mask 自动计算、default ACL、递归 symlink、test、backup/restore 和生产变更流程。
tags: [Linux, setfacl, POSIX ACL, 默认ACL, 权限变更]
---

# `setfacl` 命令详解：修改、继承、备份与恢复 POSIX ACL

`setfacl` 修改 access/default POSIX ACL。最常见事故不是语法错误，而是自动重算 mask 改变了多条现有授权，或递归跟随 symlink/跨越大目录导致权限扩散。

## 1. 语法与全部参数

```text
setfacl [options] [{-m|-x} acl_spec] [{-M|-X} acl_file] file ...
setfacl --restore={file|-}
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-m ACL` | `--modify=ACL` | 增加/修改条目；需带 permissions |
| `-M FILE` | `--modify-file=FILE` | 从文件/stdin 读取并修改条目 |
| `-x ACL` | `--remove=ACL` | 删除指定条目；通常不写 permissions |
| `-X FILE` | `--remove-file=FILE` | 从文件/stdin 读取待删条目 |
| 无 | `--set=ACL` | 用完整 ACL 替换现有 ACL |
| 无 | `--set-file=FILE` | 从文件/stdin 读取完整替换 ACL |
| `-b` | `--remove-all` | 删除所有扩展 access ACL，保留 base entries |
| `-k` | `--remove-default` | 删除目录 default ACL |
| `-n` | `--no-mask` | 不自动重算 mask |
| 无 | `--mask` | 即使显式给了 mask 也强制重算 |
| `-d` | `--default` | 所有操作应用到 default ACL |
| 无 | `--restore=FILE` | 从 `getfacl -R` 备份恢复 ACL/owner/group/特殊位；只可与 `--test` 组合 |
| 无 | `--test` | 不落盘，只显示结果 ACL |
| `-R` | `--recursive` | 递归应用；不能与 restore 混用 |
| `-L` | `--logical` | 递归跟随目录 symlink |
| `-P` | `--physical` | 不跟随目录 symlink且跳过 symlink 参数 |
| `-v` | `--version` | 显示版本 |
| `-h` | `--help` | 显示帮助 |
| `--` | 无 | 结束选项 |
| 文件名 `-` | 无 | 从 stdin 按行读取目标名；无法无歧义处理含换行文件名 |

## 2. ACL entry 完整语法

```text
[default:]user:[name-or-uid]:perms
[default:]group:[name-or-gid]:perms
[default:]mask::perms
[default:]other::perms
```

缩写 `d/u/g/m/o` 可用；权限可写 `rwx`/`---`、`X` 或数字 `0-7`。修改/设置需 permissions，删除通常只写条目标识。

```bash
setfacl -m u:alice:r-x,g:platform:rwx -- report
setfacl -x u:alice -- report
setfacl -m m::r-x -- report
```

base entries `user::`、`group::`、`other::` 必须存在；有命名 user/group 时必须有 mask。工具可自动补齐必要条目。

## 3. mask 是最关键的变更面

默认情况下，`setfacl` 会把 owning group、所有命名 user/group 的权限并集写入 mask；若显式给 mask 则通常不重算。`--mask` 强制重算，`--no-mask` 保留现有 mask。

```bash
getfacl -e -p -- report
setfacl --test -m u:alice:rwx -- report
setfacl -m u:alice:rwx -- report
getfacl -e -p -- report
```

给 Alice 加 `rwx` 可能把 mask 扩大，从而使其他既有条目也获得更高 effective 权限。变更评审必须比较整份 ACL，而不是只看新增一行。

## 4. default ACL 与团队目录

```bash
setfacl -d -m u::rwx,g::rwx,m::rwx,o::--- -- /srv/team
setfacl -d -m g:platform:rwx -- /srv/team
getfacl -p -- /srv/team
```

default ACL 是新建子对象模板，不追溯修改已有对象。普通文件通常不会凭继承获得应用未请求的执行位；目录和文件要分别验证。删除默认模板：

```bash
setfacl -k -- /srv/team
```

`-b` 只删除扩展 access ACL，并不等于 `-k`；两者对象不同。

## 5. 备份、测试与恢复

```bash
getfacl -R -n -p -- /srv/team > /root/team.acl.backup
setfacl --test --restore=/root/team.acl.backup
setfacl --restore=/root/team.acl.backup
```

restore 输入中的 owner/group 注释会请求恢复所有权，flags 注释会恢复 setuid/setgid/sticky；缺少 flags 注释则清除这些特殊位。它不只是“恢复 ACL”，必须像所有权批量变更一样评审路径和数字映射。

复制单个 ACL：

```bash
getfacl --access -- source | setfacl --set-file=- -- target
```

## 6. 递归生产流程

1. 精确解析目标绝对路径与文件系统，冻结或控制并发创建。
2. `getfacl -R -n -p` 备份并另存对象计数/哈希。
3. 用 `--test` 查看结果，重点检查 mask、default 与特殊位。
4. 递归默认选 `-P`；明确评审后才使用 `-L`。
5. 分批执行并检查退出码、失败清单、metadata 负载。
6. 用目标用户真实会话执行 allow/deny 测试，再决定是否回滚。

POSIX ACL 工具不提供 `-xdev`。网络/分布式文件系统上递归会放大 metadata 负载；NFSv4 ACL 语义也不同，先确认协议和挂载实际能力。

## 7. 退出状态、故障与实验

全部操作成功返回 `0`；不支持 ACL、无权限、路径/entry 非法或部分对象失败返回大于 `0`。不支持 ACL 的文件系统上，工具可能尽量映射到 mode、输出错误并返回非零，不能把近似结果当成功。

| 现象 | 检查 |
|---|---|
| 新条目看似 rwx 但无写权限 | `getfacl -e` 检查 mask、父目录 `x` |
| 修改一人影响其他组 | mask 自动重算扩大/缩小 |
| 新文件没继承 | default ACL 是否在直接父目录、应用请求 mode |
| 远端挂载行为不同 | POSIX/NFSv4 ACL 协议、挂载与服务器支持 |
| restore 改了 owner/特殊位 | 备份头部 owner/group/flags 语义 |

实验：覆盖 `-m/-M/-x/-X/--set/--set-file/-b/-k/-n/--mask/-d/--test/--restore/-R/-L/-P`；验证 mask 扩散、默认继承和完整回滚。

掌握标准：能列出全部参数与 entry 语法；能预判 mask 对所有受控条目的影响；能执行经过 test、备份、限界、验证和恢复演练的 ACL 变更。

## 官方参考

- [ACL tools：setfacl(1)](https://man7.org/linux/man-pages/man1/setfacl.1.html)
- [Linux acl(5)](https://man7.org/linux/man-pages/man5/acl.5.html)
- [ACL tools：getfacl(1)](https://man7.org/linux/man-pages/man1/getfacl.1.html)

上一篇：[`getfacl` 命令详解](./21-getfacl命令详解.md)

下一步：[返回 Linux 命令参考库学习路线](../../00-Linux命令参考库学习路线.md)
