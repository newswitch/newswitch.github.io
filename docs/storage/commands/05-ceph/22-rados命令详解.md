---
title: "rados 命令详解：Pool、Namespace、Object、xattr、omap 与基准"
sidebar_label: "22. rados 命令详解：Pool、Namespace、Object、xattr、omap 与基准"
sidebar_position: 22
description: "讲解 rados 全局参数、pool/PG/namespace 选择、对象 get/put/rm/stat、xattr/omap、watch/notify/lock、snapshot、bench/load-gen 和数据破坏边界。"
tags: [Ceph, rados, RADOS, Object, OMAP, 性能测试]
---

# rados 命令详解：Pool、Namespace、Object、xattr、omap 与基准

`rados` 直接操作 Ceph 底层 object store。它绕过 RBD/CephFS/RGW 的上层语义：手工修改或删除其内部对象可能破坏 image、文件系统或 bucket index。

## 1. 地址空间

```text
cluster → pool → namespace → object name
                      ├─ data
                      ├─ xattr
                      └─ omap header/keys
```

```bash
rados --version
rados lspools
rados df
```

## 2. 全局参数

| 参数 | 作用 |
|---|---|
| `-p, --pool POOL` | 指定 pool，多数操作必需 |
| `-N, --namespace NS` | 指定 namespace |
| `--all/--default` | `ls` 时全 namespace/默认 namespace |
| `--pgid PGID` | 按 PG 限定支持的操作 |
| `-s, --snap SNAP` | 从 pool snapshot 读取 |
| `--target-pool/--target-nspace/--target-locator` | copy 目标定位 |
| `--object-locator LOCATOR` | 对象 locator key |
| `-b, --block-size SIZE` | put/get/bench block size |
| `-O, --object-size SIZE` | 对象大小 |
| `--striper` | 使用 striping API；对象语义不同 |
| `-c/--conf`, `--id`, `-n/--name`, `--cluster`, `-m` | Ceph 连接与身份 |
| `--format` | 结构化输出（命令支持时） |

## 3. 只读对象证据

```bash
rados -p POOL ls | head
rados -p POOL stat OBJECT
rados -p POOL get OBJECT /tmp/object.bin
rados -p POOL listxattr OBJECT
rados -p POOL getxattr OBJECT ATTR
rados -p POOL listomapkeys OBJECT
rados -p POOL listomapvals OBJECT
rados -p POOL listwatchers OBJECT
```

`ls` 在大 pool 会扫描大量对象；避免无上限输出，优先使用业务已知 object/PG/namespace。object name 和内容可能敏感。

## 4. 写入与删除

```bash
rados -p lab put probe ./probe.bin
rados -p lab get probe ./probe.out
rados -p lab rm probe
```

只在独立测试 pool/namespace。`put` 创建单个对象，不提供 S3 multipart、RBD striping 或 CephFS 文件语义。还有 `append`, `truncate`, `setxattr`, `rmxattr`, `setomapval`, `rmomapkey`, `clearomap`, `setomapheader`, `cp` 等写操作。

对未知 pool 的对象执行它们属于 `[D]`。即使能够 `get` 备份单个 object，也未必足以恢复上层一致性。

## 5. 不一致对象

```bash
rados list-inconsistent-pg POOL
rados list-inconsistent-obj PGID --format json-pretty
rados list-inconsistent-snapset PGID --format json-pretty
```

保存 shard error、size/digest/omap discrepancies 后，再结合 `ceph pg map`、OSD logs、device health 判断。不要看到 inconsistent 就立即 `ceph pg repair`。

## 6. Snapshot、watch/notify 与 lock

Pool snapshot 命令 `lssnap/mksnap/rmsnap` 只适用于支持的 pool 模式，并非 RBD snapshot。`watch/notify` 和 advisory `lock get/list/break` 面向应用协调；break lock 必须确认 client/cookie 和应用所有权。

## 7. Bench 与 load-gen

```bash
rados -p bench-lab bench 60 write --no-cleanup --run-name lab01
rados -p bench-lab bench 60 seq --run-name lab01
rados -p bench-lab cleanup --run-name lab01
```

常见 bench 参数：`-t/--concurrent-ios`、`-b`、`--object-size`、`--max-objects`、`--no-cleanup`、`--no-verify`、`--run-name`、`--show-time`。load-gen 还能配置对象数、op length、read percent、throughput 和 run length。

风险：bench 直接消耗 OSD 网络/CPU/盘/PG，cleanup 必须只删本次 run objects；生产 cluster 需要专用 pool、配额、时间窗和停止阈值。

## 8. 完成标准

能精确说明 pool/namespace/object，区分 data/xattr/omap，能从 inconsistent object 形成证据，且不会在 RBD/CephFS/RGW pool 手工修改内部对象。

参考：[Ceph 官方 `rados` 手册](https://docs.ceph.com/en/latest/man/8/rados/)。
