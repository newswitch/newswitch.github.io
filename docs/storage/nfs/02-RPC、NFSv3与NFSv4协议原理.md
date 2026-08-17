---
title: "RPC、NFSv3 与 NFSv4 协议原理"
sidebar_label: "02. RPC、NFSv3 与 NFSv4 协议原理"
sidebar_position: 2
tags: [NFS, RPC, NFSv3, NFSv4, Linux, 网络文件系统]
description: "从 ONC RPC、XDR、文件句柄和客户端调用链理解 NFSv3/NFSv4 的端口、状态、会话、锁与故障恢复差异。"
---

# RPC、NFSv3 与 NFSv4 协议原理

NFS 客户端让远程目录看起来像本地文件系统，但 `read()` 缓存未命中后，不会进入本地 ext4 的块层，而会构造 NFS 操作，经 RPC、TCP 和网络发送到服务端。

```text
应用 open/read
→ VFS
→ NFS Client
→ RPC/XDR
→ TCP/IP
→ NFS Server
→ 服务端 VFS/文件系统
→ 服务端存储
```

理解 RPC、文件句柄和版本状态模型，是分析挂载、锁、超时、重传和故障切换的基础。

## 1. NFS 不是“远程执行 POSIX 系统调用”

客户端不会把原始 Linux `read(fd, buf, count)` 直接发给服务端。它将 VFS 操作转换为对应 NFS 协议操作，并使用远程文件句柄、偏移、长度和认证信息。

```text
local fd
→ client inode/dentry/file state
→ NFS protocol operation + file handle
→ server resolves handle
→ server filesystem operation
→ result/status/data
```

客户端还会缓存数据和属性，因此一次应用调用可能不产生 RPC，一次 RPC 也可能服务预读或合并后的多个应用访问。

## 2. ONC RPC 与 XDR

NFS 传统上建立在 ONC RPC 之上：

- Program number 标识远程程序；
- Version 标识协议版本；
- Procedure 标识操作；
- XID 关联请求与响应；
- XDR 规定跨架构数据编码；
- TCP/UDP 负责传输（现代部署常用 TCP）；
- 认证 flavor 携带身份，如 AUTH_SYS 或 RPCSEC_GSS。

简化请求：

```text
RPC header: XID, program=NFS, version, procedure=READ, auth
NFS args: file handle, offset, count
```

响应包含相同 XID、状态、属性和数据。RPC 层负责重试、超时、连接和统计；NFS 层负责文件操作语义。

## 3. rpcbind 的角色

在传统 NFSv3 生态中，多个 RPC 程序可能使用动态端口，rpcbind/portmapper 维护“program/version → port”映射。相关程序可能包括：

- nfsd；
- mountd；
- lockd/NLM；
- status/NSM；
- rquotad。

查看服务端 RPC 注册：

```bash
rpcinfo -p <nfs-server>
```

NFSv4 将核心协议集中到 TCP 2049，挂载与锁能力更多整合进协议，防火墙设计通常更简单。但实际服务仍可能运行其他管理程序，不能只凭端口表判断所有功能。

## 4. 文件句柄

NFS 使用服务端生成的 opaque file handle 标识文件系统对象。客户端不需要理解其内部格式。

```text
pathname lookup
→ server returns file handle
→ later READ/GETATTR/WRITE uses handle
```

文件句柄使后续操作无需每次传完整路径，但如果服务端文件系统、导出、inode 世代或对象发生不兼容变化，旧 handle 可能变成 stale，客户端收到 `ESTALE`。

不要假定文件句柄就是 inode number。格式、稳定性和持久性由服务端文件系统与 NFS 实现决定。

## 5. NFSv3 的基本模型

NFSv3 核心文件操作相对无状态：服务端可根据每个请求携带的 handle、offset 等执行 READ/WRITE/GETATTR。挂载协议用于获得初始导出句柄，锁由 NLM 等辅助协议处理。

### 5.1 “无状态”不等于服务端没有任何状态

- 锁服务有状态；
- 客户端/服务端有连接、缓存和统计；
- 服务端文件系统本身有状态；
- 写入稳定性和 verifier 涉及重启恢复；
- HA 仍需处理锁、地址和后端存储。

“NFSv3 无状态”主要描述核心文件操作的协议设计，不能推导出故障切换无需设计。

### 5.2 挂载路径

```text
client → rpcbind 查询 mountd
→ mountd 检查 export 与客户端权限
→ 返回导出根 file handle
→ client 使用 NFS program 访问
```

`showmount -e` 主要查询 mountd 视图。在纯 NFSv4 或某些实现中，它不能作为导出是否可用的唯一证据。

## 6. NFSv4 的有状态模型

NFSv4 引入/整合：

- COMPOUND 操作；
- OPEN/CLOSE 状态；
- stateid；
- lease；
- 文件锁；
- delegation；
- 单一命名空间和伪文件系统；
- 更统一的安全机制。

客户端与服务端需要在 lease 期间维护和续租状态。服务端重启或故障切换后存在 grace period，让客户端 reclaim 先前状态/锁。

### 6.1 COMPOUND

多个操作可组成一个 RPC：

```text
PUTROOTFH → LOOKUP models → LOOKUP revision → GETATTR → OPEN
```

减少往返并使操作链更紧凑，但服务端仍按规则逐项返回状态；某一步失败会影响后续结果。

### 6.2 伪文件系统

NFSv4 客户端通常从服务端 NFSv4 根进入导出命名空间。服务端 `fsid=0`/伪根配置和实际路径关系会影响挂载。客户端挂载路径未必等同服务端本地绝对路径。

## 7. NFSv4.1 Session

NFSv4.1 引入 session 与 slot 概念，帮助服务端和客户端关联、排序并安全重放请求。简化理解：

```text
client/session
  slot 0 → sequence 101 → request
  slot 1 → sequence 205 → request
```

它改善并行 RPC、重连和 exactly-once 风格的请求缓存语义，但不表示应用获得跨多个文件的事务。

NFSv4.1 还为 pNFS 提供基础，使客户端可从元数据服务获得布局后直接访问多个数据服务器。普通单服务端 NFSv4.1 不自动成为 pNFS。

## 8. NFSv3 与 v4 的关键差异

| 维度 | NFSv3 | NFSv4.x |
|---|---|---|
| 核心文件操作 | 相对无状态 | OPEN/锁/lease 有状态 |
| 端口 | NFS + 多个辅助 RPC 可能动态 | 核心通常 TCP 2049 |
| 挂载 | mount protocol | 协议内命名空间 |
| 锁 | NLM/NSM | 协议内整合 |
| 操作组合 | 单独过程为主 | COMPOUND |
| 身份/安全 | 常见 AUTH_SYS | 支持更整合的 RPCSEC_GSS |
| 故障恢复 | 核心请求易重发，锁另处理 | lease/state reclaim/grace |
| 扩展 | 成熟兼容 | 4.1 session、pNFS；4.2 更多操作 |

选择必须基于客户端/服务端支持、认证、HA、性能和厂商矩阵。版本高不保证某个实现/设备一定更快。

## 9. AUTH_SYS 与 RPCSEC_GSS

### 9.1 AUTH_SYS

客户端在 RPC 中发送数字 UID/GID 等身份，服务端据此检查权限。它依赖客户端和服务端信任关系以及一致 UID/GID；在不可信客户端场景安全性有限。

`root_squash` 将客户端 root 映射为匿名身份，降低远端 root 直接拥有服务端 root 权限的风险。

### 9.2 RPCSEC_GSS/Kerberos

可提供身份认证、完整性或隐私保护，例如常见 `sec=krb5/krb5i/krb5p` 方向。它需要 KDC、principal、keytab、DNS/时间同步和运维体系，CPU 与故障面也增加。

不要为省事使用全网 `no_root_squash` 和宽泛网段。安全设计见后续部署文章。

## 10. 一次 NFS READ

缓存未命中的简化路径：

```text
应用 read(fd, 1 MiB)
→ VFS/NFS address_space
→ readahead 可能扩大范围
→ RPC client 分成一个或多个 READ
→ TCP send
→ server nfsd worker
→ 验证 export/auth/file handle/state
→ server VFS read
→ 服务端 page cache/后端 I/O
→ RPC reply
→ 客户端 page cache
→ copy_to_user
```

`rsize` 影响单个读 RPC 的最大数据量，但还受协商上限、传输和实现限制。应用 1 MiB read 不保证正好一个 1 MiB RPC。

## 11. 一次 NFS WRITE 与 COMMIT

NFS 客户端可能发送稳定或不稳定写。简化：

```text
应用 write
→ 客户端 dirty page
→ WRITE RPC (UNSTABLE 可能)
→ 服务端接受/缓存
→ COMMIT 请求稳定化
→ write verifier 验证服务端是否重启
```

应用 `fsync()` 要求的持久化最终需要映射到 NFS WRITE/COMMIT 和服务端后端语义。客户端看到写成功不应简单等于跨副本/跨站点持久化。

## 12. UDP 与 TCP

历史 NFS 可运行在 UDP；现代大多数生产环境使用 TCP：

- 可靠、有序传输；
- 适合较大请求与现代网络；
- 避免应用层处理 IP 分片丢失的一些问题；
- 但 TCP 重传、拥塞和 head-of-line 仍影响尾延迟。

实际传输可从挂载信息确认：

```bash
nfsstat -m
findmnt -t nfs,nfs4 -o TARGET,SOURCE,FSTYPE,OPTIONS
```

## 13. 幂等、重传与重复请求

网络超时时，客户端可能重传。只读 GETATTR/READ 通常容易重复执行；创建、重命名等非幂等操作需要协议机制避免重复副作用。NFSv4.1 session slot/sequence 提供更强的重放缓存基础。

看到 RPC retrans 不等于应用数据一定重复，但表明请求未在预期时间完成，需查网络、服务端负载和 timeout 口径。

## 14. 客户端与服务端线程

客户端有 RPC transport、任务和缓存管理；服务端 `nfsd` worker 处理请求。服务端线程数不足可能形成队列，过多则增加 CPU/锁争用。

查看：

```bash
nfsstat -c
nfsstat -s
cat /proc/net/rpc/nfs
cat /proc/net/rpc/nfsd
```

字段随内核和 nfs-utils 版本变化，应结合 man page 和 `/proc` 实际内容。

## 15. 端口与防火墙设计

### NFSv4

核心通常允许客户端到 TCP 2049，同时考虑 Kerberos、DNS、监控和 HA 健康检查。

### NFSv3

除了 2049，还可能需要 rpcbind、mountd、lockd/statd 等。生产可固定辅助服务端口，再按最小客户端网段放行。

防火墙只验证 `nc -vz server 2049` 不足以证明完整 NFSv3 挂载/锁可用。

## 16. 协议观测

### 16.1 当前挂载

```bash
nfsstat -m
mountstats <mountpoint>
```

### 16.2 RPC 统计

```bash
nfsstat -c
nfsstat -s
nfsiostat 1 <mountpoint>
```

### 16.3 网络

```bash
ss -tan | grep ':2049'
ip -s link show dev <nic>
```

### 16.4 抓包

在获得授权、控制时长并保护文件名/身份信息的前提下，可用 tcpdump/Wireshark 观察 RPC/NFS。NFS 流量可能包含敏感路径和数据；使用 `krb5p` 或 TLS/RPC-with-TLS 时内容不可直接解析。

## 17. 故障时的版本差异

### 17.1 服务端短暂不可用

hard mount 通常持续重试，应用可能阻塞；soft 类行为可能向应用返回错误，需要评估数据正确性。恢复后客户端继续。

### 17.2 服务端重启

- v3 核心读写可重发，但锁状态要恢复；
- v4 客户端需要重建 client/session 并 reclaim state；
- grace period 期间新锁/打开可能受限制；
- 后端、VIP 和文件句柄必须一致。

### 17.3 网络分区

客户端不能确定请求是否已被服务端执行，会等待、重传或最终失败。应用层要区分请求超时与操作确定未发生。

## 18. 常见误区

1. **NFS 就是把系统调用发到服务端。**实际是 VFS 操作到 NFS 协议转换和缓存。
2. **NFSv3 无状态，所以 HA 很简单。**锁、后端、文件句柄和 VIP 仍有状态。
3. **NFSv4 只有 2049，所以没有状态恢复问题。**恰恰有 lease/state/session。
4. **`showmount -e` 空就没有 NFSv4 导出。**它不是 v4 可用性的唯一判断。
5. **一次 read 对应一次 READ RPC。**缓存、预读、rsize 和拆分会改变。
6. **RPC retrans 等于网络丢包。**也可能是服务端或后端响应太慢。
7. **AUTH_SYS 能证明用户身份。**它依赖客户端可信和 UID/GID 治理。

## 19. 实验

在隔离实验环境分别挂载 v3 与 v4.1：

1. 用 `nfsstat -m` 验证版本和传输；
2. 用大文件冷读观察 READ RPC；
3. 第二次读取验证客户端缓存使 RPC 减少；
4. 创建/锁文件，观察版本相关统计；
5. 短暂停止测试服务，记录 hard mount、D 状态和恢复时间；
6. 服务恢复后验证文件内容与锁，而不只看 mount 仍存在；
7. 比较 `rpcinfo`/`showmount` 对 v3/v4 的可见性边界。

## 20. 掌握标准

应能画出 VFS—NFS Client—RPC—TCP—nfsd—服务端文件系统路径，并解释：文件句柄、XID、v3 mount/lock 辅助协议、v4 stateid/lease/session、READ/WRITE/COMMIT、重传和服务端重启恢复。

下一篇：[NFS 缓存、一致性、锁与文件句柄](./03-NFS缓存一致性锁与文件句柄.md)。

## 参考资料

- [RFC 1813: NFS Version 3](https://www.rfc-editor.org/rfc/rfc1813)
- [RFC 7530: NFS Version 4](https://www.rfc-editor.org/rfc/rfc7530)
- [RFC 8881: NFS Version 4.1](https://www.rfc-editor.org/rfc/rfc8881)
- [Linux NFS documentation](https://docs.kernel.org/filesystems/nfs/index.html)
- [nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
