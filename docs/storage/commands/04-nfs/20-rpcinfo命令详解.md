---
title: "rpcinfo 命令详解：rpcbind 注册、RPC 程序版本与传输验证"
sidebar_label: "20. rpcinfo 命令详解：rpcbind 注册、RPC 程序版本与传输验证"
sidebar_position: 20
description: "讲解 rpcinfo 的 dump、ping、broadcast、address、TCP/UDP/IPv6 netid 参数，NFS 程序号、动态端口、防火墙与 NFSv4 边界。"
tags: [Linux, RPC, rpcinfo, NFS, rpcbind]
---

# rpcinfo 命令详解：rpcbind 注册、RPC 程序版本与传输验证

`rpcinfo` 查询 rpcbind/portmapper 注册，或直接对某个 RPC program/version 发 NULL procedure 探测。它证明 RPC endpoint 能响应，不证明真实 NFS READ/WRITE、权限或后端存储健康。

## 1. 关键对象

```text
program number + version + netid/transport + universal address(port)
```

常见 program：100000 rpcbind、100003 nfs、100005 mountd、100021 nlockmgr、100024 status。具体以服务端 dump 为准。

## 2. 调用形式与参数

```bash
rpcinfo -p [host]
rpcinfo -s [host]
rpcinfo -T tcp host program [version]
```

| 参数 | 作用 |
|---|---|
| `-p` | 查询 portmapper v2 风格 program/vers/proto/port 列表 |
| `-s` | 紧凑 rpcbind 注册列表，含 netid/service/owner |
| `-m` | 显示 rpcbind operation statistics |
| `-u host program [vers]` | 用 UDP 探测程序 |
| `-t host program [vers]` | 用 TCP 探测程序 |
| `-T netid host program [vers]` | 指定 netid，如 tcp/tcp6/udp |
| `-a address -T netid program [vers]` | 直接探测 universal address，绕过注册查找 |
| `-b program version` | 广播查找 UDP 服务，噪声和安全风险较高 |
| `-d program version` | 从本机 rpcbind 取消注册，需要权限，`[W]` |
| `-n port` | 给旧式探测指定端口 |
| `-l` | 与特定查询配合显示条目（版本相关） |

程序可用名称或数字，脚本使用数字能避开 `/etc/rpc` 名称差异，但可读性较差。

## 3. NFS 分层验证

```bash
rpcinfo -p nfs-server
rpcinfo -T tcp nfs-server 100003 3
rpcinfo -T tcp nfs-server 100003 4
rpcinfo -T tcp nfs-server 100005 3
```

NFSv3 的 mountd/lock/statd 常使用动态或配置固定端口，防火墙必须与注册一致。NFSv4 核心通常走 TCP 2049，可在 rpcbind 查询受限时仍工作。

```bash
nc -vz -w 3 nfs-server 2049
rpcinfo -T tcp nfs-server nfs 4
```

TCP 建连、RPC NULL 成功、真实 mount/read/write 是三个递进层级。

## 4. 常见错误

- `Program not registered`：该 version/transport 未注册、服务未启动，或 NFSv4-only 不提供 mountd。
- `RPC: Timed out`：网络/ACL/firewall、服务拥塞、错误 address family。
- 本机 `-p` 有但远端无：rpcbind 只监听 loopback、防火墙或 NAT 返回错误地址。
- tcp 成功 udp 失败：传输与防火墙差异，NFS 实际是否需要 UDP 要看版本配置。

## 5. 安全

rpcbind dump 暴露主机服务面，broadcast 会向广播域主动发包，`-d` 会修改注册状态。生产默认使用精确 host/program/version/netid 的只读探测，并限制 111 和动态 RPC 端口访问范围。

## 6. 固定证据

```bash
rpcinfo -s nfs-server
rpcinfo -T tcp nfs-server nfs 4
showmount -e nfs-server
exportfs -v                 # 服务端
nfsstat -m                  # 客户端
```

完成标准：能从注册表定位 program/version/transport/port，能解释 NFSv3 与 NFSv4 的 rpcbind 依赖差异。

参考：[nfs-utils 2.9.1 上游](https://www.kernel.org/pub/linux/utils/nfs-utils/)与本机 `man rpcinfo`。
