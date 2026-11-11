---
title: "blkid 命令详解：文件系统签名、UUID、LABEL 与安全探测"
sidebar_label: "02. blkid 命令详解：文件系统签名、UUID、LABEL 与安全探测"
sidebar_position: 2
description: "讲解 blkid 的 libblkid 探测、缓存与低级 probe、标签查询、输出格式、冲突签名、PARTUUID，以及格式化和挂载故障排查。"
tags: [Linux, blkid, UUID, 文件系统, util-linux]
---

# blkid 命令详解：文件系统签名、UUID、LABEL 与安全探测

`blkid` 识别块设备上的文件系统、swap、RAID、LVM 和分区表签名，并输出 `UUID`、`LABEL`、`TYPE`、`PARTUUID` 等 token。它识别的是介质元数据，不代表设备已经挂载或数据可正常读取。

## 1. 模式和数据来源

```bash
blkid --version
blkid
blkid /dev/sdb1
```

普通用户可能只读取缓存，root 才能直接探测所有设备。低级 probe `-p` 绕过常规缓存并报告更多签名细节，适合诊断但会读取目标设备。

```text
UUID      文件系统实例标识
LABEL     人类设置的文件系统标签
TYPE      ext4/xfs/swap/LVM2_member/linux_raid_member...
PARTUUID  分区表中的分区 UUID，不是文件系统 UUID
PTTYPE    gpt/dos 等分区表类型
```

## 2. 参数族

| 参数 | 作用 |
|---|---|
| `-c, --cache-file file` | 指定 cache；`/dev/null` 可避免读写缓存 |
| `-d, --no-encoding` | 不对非打印字符做 `^`/`M-` 编码 |
| `-g, --garbage-collect` | 从缓存删除已不存在设备 |
| `-i, --info` | 输出 I/O limits/topology；等价于特定 probe 视图 |
| `-k, --list-filesystems` | 列出 libblkid 已知文件系统类型 |
| `-l, --list-one` | 与 `--match-token` 配合只返回一个设备 |
| `-L, --label label` | 把 LABEL 解析为设备；等价于 `-l -o device -t LABEL=...` |
| `-o, --output format` | `full/value/list/device/udev/export/json` 等格式，以本机帮助为准 |
| `-p, --probe` | 低级超级块探测，不使用缓存 |
| `-s, --match-tag tag` | 只输出指定 token，可重复 |
| `-t, --match-token NAME=value` | 只匹配指定 token |
| `-U, --uuid uuid` | 把 UUID 解析为设备 |
| `-u, --usages list` | probe 时按 filesystem/raid/crypto/other 过滤 usage |
| `-w, --wipe-cache` | 清除旧 cache |
| `-V, --version` | 显示版本 |
| `-h, --help` | 显示本机完整选项 |

低级 probe 还可能提供 `--offset`、`--size`、`--hint`、`--match-types`、`--no-part-details` 等版本相关选项，使用前以 `blkid -p --help` 为准。

## 3. 稳定引用

```bash
blkid -s UUID -s TYPE -o export /dev/sdb1
blkid -U 11111111-2222-3333-4444-555555555555
blkid -L model-cache
findmnt --fstab --evaluate
```

`/dev/sdb1` 会因探测顺序变化；fstab 通常优先 `UUID=`。但克隆磁盘可能复制文件系统 UUID，导致两个设备冲突。部署克隆盘后必须重新生成 UUID 或明确选择设备。

## 4. 签名冲突与退出码

旧 LVM/RAID/文件系统签名可能残留在同一设备。安全检查：

```bash
blkid -p -o udev /dev/sdb
wipefs --noheadings --output OFFSET,TYPE,UUID,LABEL /dev/sdb
```

`wipefs` 才用于删除签名，属于破坏性操作；`blkid` 只观察。不要因为看到旧签名就直接 `wipefs -a`，先确认设备、阵列成员关系和数据归属。

常见退出语义需以本机 man page 为准：成功找到/识别、未找到 token 或发生使用错误会产生不同非零码。脚本不能只看 stdout 是否为空。

## 5. 生产排障

- fstab 启动失败：比较 `blkid`、`findmnt --verify --verbose` 和 initramfs 是否包含驱动。
- UUID 重复：`blkid -t UUID=... -o device` 找出所有匹配，核对克隆链路。
- `TYPE` 与预期不同：低级 probe + `wipefs -n` 检查多签名，不要先格式化。
- LUKS/LVM：外层只显示 `crypto_LUKS`/`LVM2_member`；解锁或激活后再查 mapper 设备。
- PARTUUID 存在但 UUID 不存在：分区存在但可能未创建文件系统。

## 6. 实验与标准

```bash
dev="$(findmnt -n -o SOURCE /)"
blkid "$dev"
blkid -p -o export "$dev"
blkid -s UUID -o value "$dev"
```

完成标准：能区分 UUID、PARTUUID、LABEL 和设备路径，能识别缓存、权限和残留签名造成的假象，并且不会用探测结果替代备份与设备归属确认。

参考：[util-linux/libblkid 上游](https://github.com/util-linux/util-linux)与本机 `man blkid`。
