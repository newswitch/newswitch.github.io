---
title: rbd 命令详解：Image、Snapshot、Clone、Map、Trash 与 Mirror
sidebar_position: 23
description: 讲解 rbd image-spec、全局参数、创建/扩容、info/du/status、snapshot/clone/flatten、map/unmap、trash、锁、迁移、加密与镜像安全边界。
tags: [Ceph, RBD, Block Device, Snapshot, Mirroring]
---

# `rbd` 命令详解：Image、Snapshot、Clone、Map、Trash 与 Mirror

`rbd` 管理 RADOS Block Device image。RBD 是 thin-provisioned 虚拟块设备；image 内部还可能有分区、LVM、文件系统和数据库。删除或 rollback image 会影响完整上层数据栈。

## 1. 命名与连接

```text
pool[/namespace]/image[@snapshot]
```

```bash
rbd --version
rbd help
rbd pool init rbd
rbd ls -l rbd
```

全局常见 `-p/--pool`、`--namespace`、`--cluster`、`-c/--conf`、`--id/--name`、`--keyring`、`-m/--mon-host`、`--format/--pretty-format`、`--no-progress`。

## 2. 查询证据

```bash
rbd info rbd/model-cache --format json
rbd status rbd/model-cache
rbd du rbd/model-cache --merge-snapshots
rbd snap ls rbd/model-cache
rbd children rbd/base@golden
rbd lock list rbd/model-cache
rbd device list --format json
```

`size` 是逻辑容量，`provisioned/used` 受 object allocation、discard、snapshot 和 fast-diff/object-map 影响。`rbd du` 可能触发对象扫描，缺少 fast-diff 时成本更高。

## 3. Image 生命周期

| 命令族 | 用途 | 风险 |
|---|---|---|
| `create`, `resize` | 创建/修改逻辑容量 | 缩容可能截断数据；扩容后还要扩上层 |
| `rm` | 删除 image | `[D]`，有 snapshot/clients 时会失败或需额外处理 |
| `mv`, `cp`, `deep cp` | 重命名/复制 | 容量、snapshot 语义不同 |
| `export/import`, `export-diff/import-diff` | 全量/增量传输 | 需保证 snapshot chain 顺序和校验 |
| `feature enable/disable` | layering、exclusive-lock、object-map、fast-diff 等 | client/kernel 兼容性 |
| `sparsify` | 回收零区域 | scan/I/O 成本，discard 语义 |

创建示例只用于 lab：

```bash
rbd create lab/test --size 10G --image-feature layering,exclusive-lock,object-map,fast-diff
rbd info lab/test
```

## 4. Snapshot、Clone 与 Rollback

```bash
rbd snap create rbd/base@golden
rbd snap protect rbd/base@golden
rbd clone rbd/base@golden rbd/clone01
rbd children rbd/base@golden
```

clone 依赖 parent snapshot；flatten 会复制共享对象并增加 I/O/空间。snapshot rollback 会把整个 image 恢复到旧块状态，破坏之后所有文件系统/应用更新，并可能很慢。优先通过新 clone/恢复副本验证，而不是原地 rollback。

## 5. Map 与客户端

```bash
rbd device map rbd/model-cache
rbd device list
rbd device unmap /dev/rbd0
```

可能使用 krbd、rbd-nbd 或 ubbd。map 参数含 read-only、exclusive、options、device type、timeout/encryption 等，依实现不同。unmap 前：

```bash
findmnt -S /dev/rbd0
lsblk /dev/rbd0
lsof /dev/rbd0
rbd status rbd/model-cache
```

Kubernetes RBD 应由 CSI NodeUnstage/Unpublish 管理，手工 unmap 会与 kubelet/CSI 竞争。

## 6. Trash

```bash
rbd trash ls rbd
rbd trash info rbd/IMAGE_ID
```

`trash mv` 比直接 rm 更可恢复；`trash restore/rm/purge` 管理恢复和最终删除。deferment 时间不是备份，trash purge schedule 也可能自动删除。

## 7. 锁、迁移和镜像

- `lock add/remove/list` 是传统 advisory lock；exclusive-lock/watchers 由 librbd 协调，强制 break 前确认 client 是否存活。
- `migration prepare/execute/commit/abort/status` 是阶段状态机；每一步都核对 source/destination 和客户端停写要求。
- `mirror pool/image enable/disable/status/promote/demote/resync` 涉及双站点角色。force promote 可能产生 split-brain；resync 会选择数据方向并覆盖一侧。

```bash
rbd mirror pool status POOL --verbose
rbd mirror image status POOL/IMAGE
```

## 8. Encryption

RBD encryption format/load、passphrase file 与 map client 支持需保持一致。密钥文件使用严格权限，禁止出现在命令日志。加密无法恢复遗失 key，也不替代 CephX/传输安全。

## 9. 固定排障

```bash
rbd info POOL/IMAGE --format json
rbd status POOL/IMAGE
rbd snap ls POOL/IMAGE
rbd lock list POOL/IMAGE
rbd device list --format json
ceph rbd perf image stats POOL write_ops
```

完成标准：能区分逻辑/实际容量、snapshot/clone 依赖、watcher/lock 和 map 层；任何 rm/rollback/flatten/force promote/resync/unmap 都先确认客户端和恢复点。

参考：[Ceph RBD 官方文档](https://docs.ceph.com/en/latest/rbd/)和 `rbd help <command>`。
