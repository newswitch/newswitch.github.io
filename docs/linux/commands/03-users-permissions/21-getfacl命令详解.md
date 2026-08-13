---
title: getfacl 命令详解：访问 ACL、默认 ACL 与有效权限
sidebar_position: 21
description: 完整讲解 getfacl 的全部参数、base/named entries、ACL mask、effective 权限、default ACL、递归符号链接、数字 ID 和备份格式。
tags: [Linux, getfacl, POSIX ACL, 权限排障, ACL mask]
---

# `getfacl` 命令详解：访问 ACL、默认 ACL 与有效权限

`getfacl` 读取文件访问 ACL 和目录 default ACL。它是解释“`ls -l` 看起来允许却 EACCES”或“某个命名用户为什么只有部分权限”的核心工具。

## 1. 语法与全部参数

```text
getfacl [-aceEsRLPtpndvh] file ...
getfacl [-aceEsRLPtpndvh] -
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--access` | 只显示 access ACL |
| `-d` | `--default` | 只显示 default ACL；仅目录可有 |
| `-c` | `--omit-header` | 不输出 file/owner/group 头部 |
| `-e` | `--all-effective` | 所有受 mask 影响的条目都显示 effective 注释 |
| `-E` | `--no-effective` | 不显示 effective 注释 |
| `-s` | `--skip-base` | 跳过只有 owner/group/other base ACL 的对象 |
| `-R` | `--recursive` | 递归列出 |
| `-L` | `--logical` | 递归时跟随目录 symlink |
| `-P` | `--physical` | 不跟随目录 symlink，且跳过 symlink 参数 |
| `-t` | `--tabular` | access/default 并排表格；受 mask 限制的位大写 |
| `-p` | `--absolute-names` | 保留绝对路径开头的 `/` |
| `-n` | `--numeric` | 显示数字 UID/GID，便于迁移证据 |
| `-v` | `--version` | 显示版本 |
| `-h` | `--help` | 显示帮助 |
| `--` | 无 | 结束选项 |
| 文件名 `-` | 无 | 从 stdin 按行读取文件名列表；不是 NUL 安全协议 |

默认对命令行 symlink 参数解引用，递归中跳过遇到的 symlink；`-L/-P` 只在递归时改变遍历。

## 2. ACL 条目和判定顺序

```text
user::rwx                 # owner
user:alice:rwx            # named user
group::r-x                # owning group
group:platform:rwx        # named group
mask::r-x                 # group class 的上限
other::---
```

访问时大致依次匹配 owner、命名用户、匹配的组集合、other。mask 限制命名用户、owning group 和命名组，不限制 owner 与 other。多个匹配组的权限先取并集，再与 mask 相交。

```bash
getfacl -e -p -- report
```

若条目写 `rwx #effective:r-x`，真正生效的是 `r-x`。`ls -l` 出现尾随 `+` 表示存在扩展 ACL（具体标记受实现影响），group 三位通常反映 ACL mask，而不只是 `group::` 条目。

## 3. access ACL 与 default ACL

- access ACL 决定当前对象访问。
- default ACL 只存在于目录，作为创建子对象时的继承模板；不直接给目录本身额外访问权。

```bash
getfacl -a -p -- /srv/team
getfacl -d -p -- /srv/team
touch /srv/team/new
getfacl -p -- /srv/team/new
```

继承结果仍会受创建程序请求 mode 限制。父目录 default ACL 修改不会追溯改变已有子对象。

## 4. 备份、递归与身份稳定性

```bash
getfacl -R -n -p -- /srv/team > team.acl.backup
```

输出可交给 `setfacl --restore`，头部还可携带 owner/group 与特殊位。为可恢复性应使用 `-p` 保留绝对/明确路径，并评审恢复目录；使用 `-n` 可避免 NSS 名称在迁移时变化，但目标系统数字映射必须一致。

递归 `-L` 可能越出目录树；大目录会产生大量 metadata I/O。在 CephFS/NFS 等网络文件系统上，应限速、分批并观察 MDS/server 负载。POSIX ACL 与 NFSv4 ACL 模型不同，不能用此工具假设完全互通。

## 5. 权限排障证据链

```bash
id
namei -l -- /srv/team/report
stat -c '%A %a %u:%g %n' -- /srv/team/report
getfacl -e -n -p -- /srv/team/report
findmnt -T /srv/team/report
```

若 DAC/ACL 看似允许，继续查 LSM、安全上下文、capabilities、只读挂载、immutable、NFS 映射和应用打开方式。getfacl 只能回答 ACL 层。

## 6. 退出状态、环境与实验

全部成功通常返回 `0`，至少一个对象失败返回非 `0`。设置 `POSIXLY_CORRECT` 会改变默认输出（例如 default ACL 需显式 `-d`），脚本必须控制环境。

实验：创建 named user/group 和 mask；制造 `#effective` 差异；比较 access/default 继承；验证 `-s/-t/-n/-p/-R/-L/-P`；备份一棵测试树供下一篇恢复。

掌握标准：能列出全部参数；能手算组集合与 mask；能区分 access/default；能生成数字 ID 稳定、路径明确、可验证恢复的 ACL 清单。

## 官方参考

- [ACL tools：getfacl(1)](https://man7.org/linux/man-pages/man1/getfacl.1.html)
- [Linux acl(5)](https://man7.org/linux/man-pages/man5/acl.5.html)

上一篇：[`umask` 命令详解](./20-umask命令详解.md)

下一篇：[`setfacl` 命令详解](./22-setfacl命令详解.md)
