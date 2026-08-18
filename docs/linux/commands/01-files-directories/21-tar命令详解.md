---
title: "tar 命令详解：归档、压缩、增量、权限与安全解包"
sidebar_label: "21. tar 命令详解：归档、压缩、增量、权限与安全解包"
sidebar_position: 21
description: "系统讲解 GNU tar 创建/列出/提取/追加/比较、压缩、路径、owner、xattr/ACL、增量、排除和解包安全。"
tags: [Linux, tar, 归档, 备份, coreutils]
---

# tar 命令详解：归档、压缩、增量、权限与安全解包

GNU `tar` 把目录树元数据和内容写入归档，也可通过 gzip/xz/zstd 等过滤压缩。一次 tar 文件不自动具备异地副本、保留策略、不可变性和恢复演练，因此不能仅凭“生成成功”宣称备份完成。

## 1. 五种主操作

```text
tar OPERATION [OPTIONS] [FILE...]
```

| 参数 | 含义 |
|---|---|
| `-c, --create` | 创建归档 |
| `-t, --list` | 列成员，提取不可信包前必做 |
| `-x, --extract, --get` | 提取 |
| `-r, --append` | 追加成员（压缩归档通常不支持） |
| `-u, --update` | 仅追加比归档新成员 |
| `-d, --diff, --compare` | 与文件系统比较 |
| `-A, --catenate` | 拼接 tar 归档 |
| `--delete` | 从归档删成员，受介质/压缩限制 |

## 2. 核心参数族

| 类别 | 参数 | 含义 |
|---|---|---|
| archive | `-f FILE`、`-C DIR`、`-v` | 归档文件、切目录、详细输出 |
| compression | `-z` gzip、`-j` bzip2、`-J` xz、`--zstd`、`-I PROG` | 压缩过滤器 |
| selection | `--exclude=PATTERN`、`--exclude-from=FILE`、`-T FILE`、`--null` | 排除/名称清单/NUL |
| path | `--strip-components=N`、`--transform=EXPR`、`--anchored`、`--wildcards` | 路径变换和 pattern |
| metadata | `-p, --preserve-permissions`、`--same-owner`、`--numeric-owner`、`--acls`、`--xattrs`、`--selinux` | 权限、身份和扩展元数据 |
| overwrite | `--keep-old-files`、`--skip-old-files`、`--keep-newer-files`、`--overwrite`、`--unlink-first` | 冲突策略 |
| filesystem | `--one-file-system`、`-h, --dereference`、`--hard-dereference` | mount/symlink/hardlink 边界 |
| incremental | `-g, --listed-incremental=SNAPSHOT`、`--level=N` | 增量元数据快照 |
| verification | `-W, --verify`、`--warning=KEYWORD`、`--totals` | 读回比较/告警/字节统计 |

GNU tar 参数非常多，完整全集以当前版本 `tar --help` 和官方手册为准；本文按生产语义覆盖稳定参数族。

## 3. 安全创建与恢复

```bash
tar --create --file backup.tar.zst --zstd \
  --one-file-system --acls --xattrs --selinux \
  --numeric-owner -C /srv data

tar --list --verbose --file backup.tar.zst
mkdir restore-test
tar --extract --file backup.tar.zst --directory restore-test \
  --no-same-owner --no-same-permissions
```

恢复生产前在隔离目录检查：绝对路径、`..`、symlink/hardlink 逃逸、device/FIFO、setuid、owner、ACL/xattr/SELinux。不要以 root 把不可信归档直接解到 `/`。

## 4. 重要边界

- `-C` 按出现位置影响后续名称，命令顺序有语义。
- `-h` 跟随 symlink，可能把目标目录外数据打入包并放大归档。
- `--one-file-system` 不等于不包含 bind mount 的所有风险，先用 `findmnt -R` 盘点。
- 增量 snapshot 是备份链元数据，丢失/损坏会影响恢复；全链必须一起测试。
- 一致性要求高的数据库/VM 应用快照、fs freeze 或应用备份接口，普通 tar 可能得到跨时点内容。

## 5. 验收与参考

能创建保留所需元数据的归档，安全审查并隔离提取，完成校验和恢复演练，并解释为何 archive 与 backup 不同。

- [GNU tar manual](https://www.gnu.org/software/tar/manual/tar.html)

下一篇：[gzip 命令详解](./22-gzip命令详解.md)。
