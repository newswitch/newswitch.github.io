---
title: "rclone 命令详解：多后端 Copy、Sync、Check、Bisync 与 Mount"
sidebar_label: "27. rclone 命令详解：多后端 Copy、Sync、Check、Bisync 与 Mount"
sidebar_position: 27
description: "讲解 rclone remote:path 模型、config/credential、全局参数族、copy/sync/move/check/bisync/mount、过滤、checksum、并发、重试、日志和删除安全。"
tags: [rclone, S3, Cloud Storage, 同步, 数据迁移]
---

# rclone 命令详解：多后端 Copy、Sync、Check、Bisync 与 Mount

`rclone` 统一操作 S3、对象存储、云盘、SFTP 和本地文件系统。统一 CLI 不代表后端语义相同：mtime、checksum、rename、case、symlink、version、metadata 和 consistency 都可能不同。

## 1. 地址和配置

```text
local path:  /data/models
remote:      prod-s3:bucket/prefix
```

```bash
rclone version
rclone config file
rclone listremotes
rclone backend features prod-s3:
```

配置文件可能含可解密 credential/token，权限至少 0600，并优先 workload identity/外部 secret provider。不要把 config dump 上传博客。

## 2. 核心命令语义

| 命令 | 语义 | 风险 |
|---|---|---|
| `copy` | 把 source 新增/变化对象复制到 dest，不删除 dest 额外项 | `[W]` |
| `copyto` | 单个 source 到精确 dest path | `[W]` |
| `sync` | 让 dest 与 source 一致，会删除 dest 额外项 | `[D]` |
| `move/moveto` | copy 后删除 source，跨后端非原子 | `[D]` |
| `check` | 比较 source/dest，不传输 | `[R]` 但请求量大 |
| `checksum` | 用外部 checksum list 验证 |
| `bisync` | 双向同步，需要历史 listing/state，冲突治理复杂 | `[D]` |
| `ls/lsl/lsjson/size/about` | 列表、元数据、容量/配额 |
| `delete/deletefile/purge/rmdirs` | 删除对象/目录/bucket 内容 | `[D]` |
| `mount/serve` | 通过 VFS/FUSE 或协议暴露 remote | 语义/缓存需评估 |

## 3. 全局参数族

rclone 全局/backend flags 数百个，按稳定职责学习：

| 参数族 | 代表选项 |
|---|---|
| 配置 | `--config`, `--password-command`, `--ask-password` |
| 并发 | `--transfers`, `--checkers`, `--multi-thread-streams`, `--buffer-size` |
| 重试 | `--retries`, `--low-level-retries`, `--retries-sleep` |
| 限速 | `--bwlimit`, `--tpslimit`, `--tpslimit-burst` |
| 比较 | `--checksum`, `--size-only`, `--ignore-size`, `--ignore-times`, `--update` |
| 过滤 | `--include`, `--exclude`, `--filter`, `--files-from`, `--min/max-age/size` |
| 删除保护 | `--dry-run`, `--max-delete`, `--immutable`, `--backup-dir`, `--suffix` |
| 日志 | `-v/-vv`, `--log-file`, `--log-format`, `--stats`, `--use-json-log` |
| metadata | `--metadata`, `--metadata-mapper`, backend-specific flags |
| TLS/network | `--ca-cert`, `--client-cert/key`, `--timeout`, `--contimeout` |

完整当前集合使用：

```bash
rclone help flags
rclone help backend s3
rclone copy --help
```

## 4. Copy 与 Sync 的路径陷阱

```bash
rclone copy /data/models prod:bucket/models --dry-run -vv
rclone sync /data/models prod:bucket/models --dry-run -vv --max-delete 10
```

rclone 通常复制“目录内容”而不是源目录名本身；但不同命令和 trailing path 理解必须用小样本确认。真正 sync 前保存 source/dest listing、启用 destination versioning 或 `--backup-dir`，并设置 `--max-delete`。

## 5. Check 与完整性

```bash
rclone check /data/models prod:bucket/models --one-way --combined check.txt
rclone hashsum sha256 /data/models > local.sha256
```

`check` 可能按共同 hash、size 或下载比较；后端未暴露相同 checksum 时会降级/无法验证。S3 multipart ETag 不是稳定 MD5。关键模型使用显式 SHA-256 manifest 和抽样/全量读取校验。

## 6. Bisync

bisync 依赖上次两边 listing 判断变更。首次运行、state 丢失、两侧同时修改、时钟/精度和 filter 变化都可能产生冲突或删除。启用前做 `--resync` 流程演练、备份、dry-run、conflict 策略和 lock/单实例保证。它不是无需设计的双活文件系统。

## 7. Mount/VFS

```bash
rclone mount prod:bucket/models /mnt/models --read-only --vfs-cache-mode off
```

对象存储不具备 POSIX rename/locking/随机写全部语义。`--vfs-cache-mode`、cache max age/size、poll interval、dir cache、read chunk 会改变一致性和本地空间；生产推理服务要验证 open/read/seek/rename/fsync/故障恢复，而不是“能 ls”即可。

## 8. 生产任务模板

```bash
rclone copy /data/release prod:models/releases/sha256-... \
  --dry-run -vv --log-file dry-run.log
rclone copy /data/release prod:models/releases/sha256-... \
  --transfers 8 --checkers 16 --use-json-log --log-file run.jsonl
rclone check /data/release prod:models/releases/sha256-... \
  --one-way --combined check.txt
```

完成标准：能明确 copy/sync/move/bisync 的删除方向，能查询 backend feature，任何同步先 dry-run + max-delete/version/backup-dir，并用可解释 checksum 验证。

参考：[rclone 官方命令索引](https://rclone.org/commands/)与对应 backend 文档。
