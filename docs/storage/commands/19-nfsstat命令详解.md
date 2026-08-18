---
title: "nfsstat 命令详解：客户端、服务端、RPC 重传与操作分布"
sidebar_label: "19. nfsstat 命令详解：客户端、服务端、RPC 重传与操作分布"
sidebar_position: 19
description: "讲解 nfsstat 的 client/server、NFS/RPC、版本、mount options、增量采样、零计数器、输出字段和 NFS 性能故障证据链。"
tags: [Linux, NFS, nfsstat, RPC, 性能]
---

# nfsstat 命令详解：客户端、服务端、RPC 重传与操作分布

`nfsstat` 读取内核 NFS client/server 的累计计数器。它能说明调用量、RPC retransmission、不同 NFS 版本和 operation 分布，但累计平均会掩盖当前尖峰，必须使用时间窗采样。

## 1. 参数

```bash
nfsstat --version
nfsstat
```

| 参数 | 作用 |
|---|---|
| `-c, --client` | 只显示 client |
| `-s, --server` | 只显示 server |
| `-n, --nfs` | NFS protocol 统计 |
| `-r, --rpc` | RPC 统计 |
| `-2/-3/-4` | 限定 NFS version |
| `-m, --mounts` | 显示每个 NFS client mount 的 options/能力 |
| `-l, --list` | 列表格式 |
| `-o, --output-descriptor NAME` | 选择 facility（版本相关） |
| `-v, --verbose` | verbose；配 `-m` 显示更多 |
| `-a, --auto` | 自动选择 client/server |
| `-Z, --sleep` | 在增量模式前暂停 |
| `-z, --zero` | 显示后清零 server 统计；属于写状态操作 |
| `--since FILE` | 与保存快照比较增量 |
| `--version/--help` | 版本/帮助 |

许多版本支持尾部 `[interval [count]]`：

```bash
nfsstat -rc 1 10
nfsstat -s 1 10
```

以本机 `nfsstat --help` 确认增量和 `--since` 支持。

## 2. Client RPC 字段

常见：

- calls：RPC 调用；
- retrans：RPC 层重传，不等于 TCP packet retrans 的同一指标；
- authrefrsh：认证信息刷新；
- badcalls/badxids/timeouts 等依 client/server/版本出现。

retrans 增加可能来自 server 延迟、网络丢包、连接重建或超时配置。仅凭 retrans 不能断言网络故障。

## 3. Operation 分布

NFSv3 常见 READ/WRITE/GETATTR/LOOKUP/READDIR/COMMIT；NFSv4 还有 compound operation 和 open/lock/delegation/state。高 GETATTR/LOOKUP 可能说明 metadata-heavy workload 或 attribute cache 策略；高 COMMIT/fsync 可能限制写延迟；但必须同时看请求耗时和字节。

`nfsstat` 的百分比是调用数量比例，不是耗时比例或流量比例。

## 4. mount 视图

```bash
nfsstat -m
findmnt -t nfs,nfs4 -o TARGET,SOURCE,FSTYPE,OPTIONS
```

重点核对 `vers`、`proto`、`hard/soft`、`timeo/retrans`、`rsize/wsize`、`nconnect`、`sec`、cache options 和 server address。effective negotiated 值与 fstab 字符串可能不同。

## 5. 分层排障

```bash
date -Is
nfsstat -rc 1 10
nfsiostat 1 10
ss -tin dst 192.0.2.20:2049
sar -n DEV,TCP,ETCP 1 10
```

服务端同时采集：nfsstat、CPU、网卡、后端 iostat、线程池和导出文件系统。客户端延迟 = 本地排队 + 网络 + server nfsd/VFS + 后端存储 + 锁/状态恢复。

## 6. 风险与误区

- `-z` 清 server counters 会破坏监控基线，生产必须协调。
- 计数器可能自启动累计、wrap/reset；记录 boot ID 和采样时间。
- 没有 retrans 不代表无长尾；TCP 可自行重传，server 也可能慢但未超 RPC timeout。
- NFS mount 卡死时 nfsstat 本身未必能完成全部查询，结合 kernel log/进程 D 状态。

完成标准：能做增量采样，区分 RPC/NFS/TCP 重传，能把 operation 分布与 mount options、server 和后端盘串起来。

参考：[nfs-utils 上游](https://www.kernel.org/pub/linux/utils/nfs-utils/)与本机 `man nfsstat`。
