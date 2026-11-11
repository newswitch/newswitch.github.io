---
title: "cephfs-shell 命令详解：无需挂载访问 CephFS、批处理与诊断"
sidebar_label: "24. cephfs-shell 命令详解：无需挂载访问 CephFS、批处理与诊断"
sidebar_position: 24
description: "讲解 cephfs-shell 交互/非交互模式、配置、参数、路径模型、文件/目录/快照/xattr/配额命令、批处理、退出码和生产安全。"
tags: [Ceph, CephFS, cephfs-shell, MDS, 文件系统]
---

# cephfs-shell 命令详解：无需挂载访问 CephFS、批处理与诊断

`cephfs-shell` 通过 Ceph client library 直接访问 CephFS，不需要先把文件系统挂载到 Linux VFS。它适合受控管理、验证 MDS/权限和批处理，但不能复现 kernel/FUSE mount、page cache、应用 syscall 的全部行为。

## 1. 调用与版本

```bash
cephfs-shell --help
cephfs-shell [options] [command]
cephfs-shell [options] -- [command, command, ...]
```

| 参数 | 作用 |
|---|---|
| `-c, --config FILE` | cephfs-shell.conf |
| `-b, --batch FILE` | 批处理文件 |
| `-t, --test FILE` | transcript 测试 |
| 其他 | 部分继承 Python cmd2，随版本变化 |

shell 自身配置通常从 `CEPHFS_SHELL_CONF` 或 `~/.cephfs-shell.conf` 读取。Ceph cluster 的 conf/keyring/identity 还受 Ceph 环境和命令设置影响，执行前用最小权限 client。

## 2. 两个文件系统视图

```text
local filesystem: 上传来源、下载目标、batch/config
remote CephFS:     shell 中的 /、cwd、文件与目录
```

`put local remote` 与 `get remote local` 最容易写反。批量操作前用 `pwd`、`ls` 和本地绝对路径确认。

## 3. 交互与非交互

```bash
cephfs-shell
cephfs-shell -c shell.conf "ls /models"
```

交互模式可用 `help`、`help COMMAND`、`history`、`quit/exit`（能力随 cmd2 版本）。自动化使用非交互/batch，并检查最后命令退出码。

## 4. 命令族

| 类别 | 命令示例 |
|---|---|
| 导航/查询 | `pwd`, `cd`, `ls`, `stat`, `df` |
| 目录 | `mkdir`, `rmdir`, `tree` |
| 数据 | `put`, `get`, `cat`, `rm` |
| 元数据 | `chmod`, `chown`, `ln`, `mv`, `setxattr`, `getxattr`, `listxattr` |
| 快照 | `snap create`, `snap delete`, `snap ls`（版本语法复核） |
| 配额/布局 | quota/layout 相关命令，以 `help` 为准 |

```text
mkdir [-m MODE] [-p|--parent] DIR...
put [-f|--force] LOCAL REMOTE
get [-f|--force] REMOTE LOCAL
```

CephFS extended attribute、layout、quota 和 snapshot 受 MDS、subvolume、权限与版本约束。不要把任意 `setxattr` 当无害标签修改。

## 5. Batch

```text
pwd
ls /models
stat /models/model-a
get /models/model-a/manifest.json /tmp/manifest.json
```

```bash
cephfs-shell --batch verify.cephfs
rc=$?
printf 'cephfs_shell_rc=%d\n' "$rc"
```

不同版本可能在遇错继续/停止、最后退出码和命令分隔上有差异，先在 lab 注入一个不存在路径验证。官方定义了一组 errno 映射退出码，如 permission denied、ENOENT、I/O、ENOSPC、EDQUOT 等；自动化应保存 stderr 和 rc。

## 6. 与 mount 客户端的差异

cephfs-shell 成功证明：Mon/MDS 可达、CephX/路径权限和 librados/libcephfs 操作成功。它不证明：

- kernel ceph module 或 ceph-fuse 可用；
- mount options、namespace/propagation 正确；
- 应用 UID/GID/ACL/SELinux 环境相同；
- page cache、readahead、客户端延迟与吞吐正常。

联合检查：

```bash
ceph fs status
ceph health detail
ceph auth get client.reader
cephfs-shell "stat /models/model-a"
findmnt -t ceph,fuse.ceph
```

## 7. 安全

- `rm/rmdir/mv/put --force` 会修改共享命名空间；CephFS 不自动等同于有 snapshot/备份。
- client capability 应限制 fs name 和 path；不要用 client.admin 跑普通脚本。
- 下载/上传保留权限、xattr、稀疏性和原子性是否满足业务，必须单独验证。
- 大目录 `tree/ls` 和大文件 put/get 会占用 MDS/网络/OSD，设置范围和时间窗。

完成标准：能区分 local/remote path，能用非交互命令验证 MDS/CephX/文件存在，同时知道它不能替代真实 mount 数据路径测试。

参考：[CephFS Shell 官方文档](https://docs.ceph.com/en/latest/cephfs/cephfs-shell/)。
