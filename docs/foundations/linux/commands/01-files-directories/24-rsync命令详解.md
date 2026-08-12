---
title: rsync 命令详解：增量同步、元数据、过滤、删除与可恢复传输
sidebar_position: 24
description: 系统讲解 rsync archive、ACL/xattr/hardlink、dry-run/itemize、delete、filter、SSH、checksum、partial、bwlimit 与路径斜杠语义。
tags: [Linux, rsync, 同步, 备份, SSH]
---

# `rsync` 命令详解：源路径末尾斜杠决定结果

`rsync` 在本地或远端比较文件列表并传输差异，传输后还会校验重建文件。它可以镜像、同步和作为备份组件，但双端即时同步不等于历史备份；`--delete` 会让误删同步到目标。

## 1. 三种传输模式

```text
rsync [OPTIONS] SRC... DEST
rsync [OPTIONS] SRC... [USER@]HOST:DEST
rsync [OPTIONS] [USER@]HOST:SRC... DEST
rsync [OPTIONS] HOST::MODULE/SRC DEST
```

单冒号使用 remote shell（通常 SSH），双冒号/`rsync://` 使用 daemon。远端需兼容 rsync。

## 2. 生产参数族

| 类别 | 参数 | 含义 |
|---|---|---|
| 基础 | `-a, --archive` | `-rlptgoD`，不包含 ACL/xattr/hardlink/atime/crtime |
| 元数据 | `-A` ACL、`-X` xattr、`-H` hardlinks、`--numeric-ids`、`--chown` | 额外保留/映射身份 |
| 审核 | `-n, --dry-run`、`-i, --itemize-changes`、`--stats`、`--info=FLAGS` | 预演与变更证据 |
| 选择 | `--include/--exclude/--filter`、`--files-from`、`--from0`、`-x` | 规则/清单/NUL/单文件系统 |
| 删除 | `--delete-before/during/delay/after`、`--delete-excluded`、`--max-delete=N` | 镜像删除时机与上限 |
| 比较 | `-c, --checksum`、`-I, --ignore-times`、`-u, --update`、`--size-only` | 判断是否需要传输 |
| 恢复 | `--partial`、`--partial-dir=DIR`、`--delay-updates`、`--append-verify` | 中断恢复与延迟落盘 |
| 传输 | `-z`、`--compress-choice`、`--bwlimit=RATE`、`--timeout=SEC`、`--contimeout=SEC` | 压缩、限速和超时 |
| remote | `-e, --rsh=COMMAND`、`-s, --secluded-args`、`--rsync-path=PROGRAM` | SSH 与参数保护 |
| backup | `-b`、`--backup-dir=DIR`、`--suffix=SUFFIX` | 覆盖/删除前保留版本 |

## 3. 末尾斜杠

```bash
rsync -a src/ dest/   # 复制 src 的内容到 dest
rsync -a src  dest/   # 在 dest 下创建/更新 src 目录
```

这是最常见的生产事故来源。执行任何写入，尤其删除前：

```bash
rsync -aHAXnvi --delete-delay --max-delete=100 src/ dest/
```

人工审查 itemized output、精确源/目标、mount 与排除规则，再移除 `-n`。

## 4. checksum 与一致性

`--checksum` 改变“传不传”的预比较方式，需要双方读取所有文件，可能非常慢；它不同于 rsync 传输后对重建文件的内部验证。正在写入的数据库/模型文件仍可能跨时点变化，需应用快照或不可变版本目录。

## 5. 远端与删除安全

使用 `-s/--secluded-args` 减少远端 Shell 对文件参数再解释，但双方版本要支持。SSH host key、远端命令权限、daemon module、symlink 和接收端 path 都是信任边界。不要使用 `--trust-sender` 除非明确接受恶意文件列表风险。

## 6. 验收与参考

能解释斜杠、archive 包含/不包含什么，先 dry-run/itemize 再 delete，限制删除量/带宽/时间，并完成目标端抽样读取和恢复演练。

- [rsync 3.4 man page](https://rsync.samba.org/ftp/rsync/rsync.1.html)

文件与目录 v1 完成。返回 [Linux 命令参考库](../../00-Linux命令参考库学习路线.md)。
