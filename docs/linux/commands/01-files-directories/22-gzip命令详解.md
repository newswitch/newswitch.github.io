---
title: "gzip/gunzip/zcat 命令详解：流压缩、级别、完整性与多成员"
sidebar_label: "22. gzip/gunzip/zcat 命令详解：流压缩、级别、完整性与多成员"
sidebar_position: 22
description: "完整讲解 gzip 的 -c/-d/-k/-f/-l/-r/-t/-n/-N/-1..-9、suffix、stdout、CRC 和多成员语义。"
tags: [Linux, gzip, gunzip, zcat, 压缩]
---

# gzip/gunzip/zcat 命令详解：流压缩、级别、完整性与多成员

gzip 格式压缩字节流并保存 CRC/长度；它不保存目录树、ACL 或多文件边界，多个文件通常先用 tar 归档。`gunzip` 等价 `gzip -d`，`zcat` 等价解压到 stdout。

## 1. 参数

```text
gzip [OPTION]... [FILE]...
```

| 参数 | 含义 |
|---|---|
| `-c, --stdout, --to-stdout` | 写 stdout，不替换输入 |
| `-d, --decompress, --uncompress` | 解压 |
| `-k, --keep` | 保留输入文件 |
| `-f, --force` | 强制覆盖/特殊情况下压缩，谨慎 |
| `-l, --list` | 列压缩大小、原始大小、ratio/name |
| `-t, --test` | 校验压缩流完整性 |
| `-r, --recursive` | 递归目录 |
| `-1, --fast` 到 `-9, --best` | 速度与压缩率；默认 6 |
| `-n, --no-name` | 不保存/恢复原始名与时间 |
| `-N, --name` | 保存/恢复原始名与时间 |
| `-S, --suffix=SUF` | 后缀，默认 `.gz` |
| `-q, --quiet`、`-v, --verbose` | 安静/详细 |
| `--rsyncable` | 改变 block 边界以利 rsync（版本支持） |
| `-h, --help`、`-V, --version`、`-L, --license` | 帮助等 |

## 2. 安全流式模式

```bash
gzip -c -6 input >input.gz.tmp
gzip -t input.gz.tmp
mv input.gz.tmp input.gz

gzip -dc input.gz | command
```

默认 `gzip file` 成功后用 `.gz` 替换原文件；需要保留源使用 `-k` 或 `-c`。重定向目标会在 gzip 启动前被 Shell 截断，使用临时文件和原子 rename。

## 3. 多成员与完整性

多个 `.gz` 可以直接拼接，解压时各 member 顺序输出；`gzip -l` 对多成员显示的原始大小/CRC 口径有限，完整总大小可流式 `gzip -dc | wc -c`。`gzip -t` 证明格式和 CRC 可读，不证明内容可信、来源真实或语义正确；分发还要加 SHA-256/签名。

## 4. 压缩炸弹与资源

解压前检查来源、压缩大小和预计上限，在受限目录/文件系统/cgroup 中执行。压缩比很高的恶意流可能耗尽磁盘/CPU。处理不可信 tar.gz 时先隔离列成员并应用 tar 安全规则。

## 5. 验收与参考

能选择 stdout/keep、完成 CRC 检测、解释多成员，并将压缩、归档、checksum、signature 四个概念分开。

- [GNU Gzip manual](https://www.gnu.org/software/gzip/manual/gzip.html)

下一篇：[sha256sum 命令详解](./23-sha256sum命令详解.md)。
