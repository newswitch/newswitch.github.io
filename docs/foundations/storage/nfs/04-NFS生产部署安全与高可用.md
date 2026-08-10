---
title: "NFS 生产部署、安全与高可用"
sidebar_position: 4
tags: [NFS, Linux, 高可用, Kerberos, root_squash, 备份, 容灾]
description: "从需求、磁盘与网络规划开始部署 NFSv4，治理 exports、身份权限，并设计 VIP、状态恢复、备份和故障切换验收。"
---

# NFS 生产部署、安全与高可用

生产 NFS 的难点不是 `exportfs -a`，而是数据、身份、网络、状态和故障切换：

```text
客户端路径可访问
≠ 权限模型安全
≠ 后端数据有冗余
≠ NFS 服务高可用
≠ 故障切换后锁与文件句柄正确
≠ 有可恢复备份
```

本文使用通用 Linux NFS Server 讲方法。具体包名、服务单元、配置路径和高可用组件以发行版/存储厂商文档为准。

## 1. 需求清单

部署前明确：

- 客户端数量、节点网段和峰值并发；
- 模型大文件、训练小文件、Checkpoint 的比例；
- 读写、同步与锁语义；
- 容量、inode、增长和保留；
- NFSv3/v4.1、认证方式；
- 带宽和尾延迟 SLO；
- 单服务、双机 HA 还是存储设备集群；
- RPO/RTO、备份和恢复；
- Kubernetes CSI/静态挂载；
- 维护、升级和监控负责人。

## 2. 分层架构

```text
Clients / Kubernetes Nodes
  → client network + DNS/VIP
  → NFS service / HA nodes
  → server VFS + filesystem
  → RAID/LVM/volume
  → local disks or shared backend
  → backup/replication target
```

每层有不同故障：VIP 正常而后端卷只读；nfsd 正常而磁盘延迟高；共享后端正常而锁状态未恢复。

## 3. 服务端资源规划

### CPU

RPC/XDR、权限、元数据、校验/加密会消耗 CPU。多客户端和小 I/O 更容易 CPU/线程受限。

### 内存

服务端 page cache 可提高热读，但不能把缓存吞吐当后端能力。内存压力会改变冷启动。

### 网络

规划速率、bond/LACP、VLAN、MTU、交换机冗余和故障域。多客户端聚合带宽不能超过服务端 NIC 与交换网络。

### 存储

模型读、大量元数据和 Checkpoint 写应按负载选 RAID/文件系统/共享后端。同步写的持久化能力与掉电保护必须验证。

## 4. 基础部署流程

不同发行版使用 `nfs-utils` 或等价包。通用阶段：

1. 固定 OS、内核、nfs-utils 和文件系统版本；
2. 准备独立数据卷和挂载；
3. 规划服务端目录、UID/GID、quota；
4. 写入 `/etc/exports`；
5. 校验导出配置；
6. 启动服务并检查监听/RPC；
7. 从授权客户端挂载；
8. 验证权限、读写、锁、同步和故障；
9. 接入监控、备份和变更管理。

只读检查：

```bash
exportfs -v
rpcinfo -p localhost
ss -lntup
findmnt
nfsstat -s
```

不要直接把未评审的目录对 `*` 导出。

## 5. exports 设计

示例方向：

```exports
/srv/nfs/models 10.20.0.0/16(ro,root_squash,sync,sec=sys)
/srv/nfs/checkpoints 10.30.0.0/16(rw,root_squash,sync,sec=sys)
```

具体选项必须以当前 `exports(5)` 为准。

原则：

- 按用途和信任域拆分导出；
- 客户端限制到精确网段/主机；
- 模型目录默认只读；
- 保留 `root_squash`；
- `sync/async` 依据数据语义评估，不为跑分牺牲正确性；
- NFSv4 伪根与 `fsid` 设计清楚；
- 子目录导出、crossmnt/nohide 等需理解跨文件系统边界；
- 所有变更进入配置管理和审计。

## 6. 身份与权限

### 6.1 数字 UID/GID

AUTH_SYS 下服务端看到客户端发送的 UID/GID。必须统一目录服务、镜像用户和 Pod securityContext，避免同一 UID 在不同租户代表不同人。

### 6.2 root_squash

客户端 root 映射到匿名身份，避免远程 root 任意拥有服务端文件。权限问题应通过正确 owner/group/ACL/工作负载身份解决，不是关闭 root squash。

### 6.3 Kerberos/RPCSEC_GSS

需要强身份时可设计 `sec=krb5`、完整性或隐私保护模式。依赖：

- DNS 和时钟同步；
- KDC 高可用；
- principal/keytab 生命周期；
- 服务端/客户端配置；
- 性能与故障演练；
- Kubernetes 中凭证获取与续期。

## 7. 网络与防火墙

NFSv4 核心常使用 TCP 2049；v3 还涉及 rpcbind/mountd/lockd/statd。安全组和防火墙需按真实版本固定端口并限制来源。

验证顺序：

```text
DNS/VIP
→ TCP port
→ RPC program/version
→ export/path
→ auth/UID/GID
→ file operation/lock
```

`ping` 通不证明 NFS 可挂载，2049 通也不证明 v3 辅助协议可用。

## 8. 客户端挂载基线

使用 `/etc/fstab`、systemd mount/automount 或配置管理。示例：

```fstab
<vip>:/models /models nfs4 ro,hard,_netdev,nfsvers=4.1 0 0
```

需要评审：

- `hard` 与超时/重传；
- `timeo`/`retrans`；
- `rsize/wsize`；
- `nconnect` 支持；
- 属性缓存；
- `_netdev` 和启动顺序；
- automount 是否适合；
- 中断与应用错误语义。

不要使用 `soft` 只为避免进程 D 状态而忽略 I/O 错误风险。选择应按应用容错与官方建议验证。

## 9. 单机 NFS 的边界

单机可通过 RAID、双电源、双 NIC 提高部件可靠性，但仍有：

- 主板/OS/内核单点；
- nfsd 配置和升级中断；
- 整机维护；
- VIP/DNS 单点；
- 数据只在本机；
- 灾难恢复不足。

它可用于实验、缓存或接受中断的场景；关键训练数据的唯一副本需要更强设计。

## 10. 双机主动/被动 HA

简化架构：

```text
Clients → VIP
          ├─ Active NFS node
          └─ Standby NFS node
                ↓
          Shared/replicated storage
```

成功切换需要同时保证：

- VIP 只有一个节点持有，防 split-brain；
- 两节点导出配置一致；
- 后端卷同一时刻只有安全的写入者；
- 文件系统和 file handle 稳定；
- NFSv4 state/lease/grace 可恢复；
- v3 locks/statd 状态可处理；
- fencing 能隔离失控旧节点；
- DNS/ARP/ND/路由及时收敛；
- 客户端 hard mount 能在 RTO 内恢复。

没有 fencing 的共享块存储双主风险可能直接损坏文件系统。

## 11. 数据后端选择

### 共享块存储

两个 NFS 节点访问同一 SAN/云盘，HA 管理文件系统单主挂载。需处理卷 fencing、路径多路和后端单点。

### 块复制

DRBD 等复制本地块，切换时提升副本并挂载。需明确同步/异步、网络分区、split-brain 与 RPO。

### 分布式文件/存储后端

NFS Gateway 运行在分布式后端之上，后端提供冗余。网关状态和入口仍需 HA；不要双重缓存/协议后就忽略一致性和性能。

### 专用 NAS

由设备提供双控制器、NFS 状态和后端 RAID，但仍需验证实际 RTO、升级、容量与客户端行为。

## 12. NFS-Ganesha 与内核 nfsd

内核 nfsd 与用户态 NFS-Ganesha 适用场景不同。Ganesha 常用于对接 CephFS、对象或其他 FSAL，并可由存储系统集成 HA。选型考虑：

- 后端支持与厂商矩阵；
- NFSv4 状态数据库；
- 性能/CPU；
- HA 编排；
- 监控和团队经验。

不要仅因“用户态更灵活”替换稳定内核 nfsd，也不要假定两者命令和状态完全相同。

## 13. Fencing 与 split-brain

HA 最危险场景：网络分区后两个节点都认为自己 Active，并同时写共享/复制后端。

必须有：

- quorum/仲裁；
- STONITH/fencing；
- 资源启动顺序；
- 后端单写者保护；
- 人工恢复 Runbook；
- 故障演练。

“VIP 只会漂移”不是 fencing。

## 14. 备份与恢复

RAID/复制/快照不等于备份。备份设计：

- 数据分类和保留；
- 全量/增量；
- crash-consistent 还是 application-consistent；
- Checkpoint/模型是否可从源重建；
- 异地/跨账号副本；
- 加密与密钥恢复；
- 防勒索不可变策略；
- 定期 restore 验证。

恢复测试必须打开文件、校验 checksum、启动模型/训练，而不是只看备份任务成功。

## 15. 升级与维护

1. 冻结配置和兼容矩阵；
2. 验证备用节点、fencing、备份；
3. 降低客户端/工作负载风险；
4. 先升级 standby；
5. 执行受控切换；
6. 验证挂载、锁、读写、性能和 state reclaim；
7. 观察窗口；
8. 再升级另一节点；
9. 保留回滚路径和证据。

滚动完成不代表无业务影响，需记录客户端 I/O stall、重传和模型服务 SLI。

## 16. 监控与告警

服务端：

- nfsd RPC rate、errors、thread utilization/queue；
- CPU、内存、page cache；
- NIC 带宽、drop/retrans；
- 文件系统容量/inode；
- 后端 IOPS、吞吐、P99；
- RAID/卷/复制/快照状态；
- HA role、VIP、fencing、state recovery。

客户端：

- RPC retrans、timeouts；
- per-op RTT/exe；
- D-state 和 blocked tasks；
- mount freshness；
- 应用模型加载/Checkpoint 时长。

告警优先描述用户影响，如“模型加载 P99 + RPC execute time 上升”，而不只“nfsd 线程数为 N”。

## 17. 故障演练矩阵

| 场景 | 验证 |
|---|---|
| nfsd 进程/节点故障 | VIP、客户端重试、RTO |
| Active 与网络隔离 | fencing、防双主 |
| 后端路径故障 | multipath/卷恢复、I/O stall |
| NFSv4 状态恢复 | OPEN/LOCK reclaim、grace |
| v3 lock 服务故障 | 锁恢复与应用行为 |
| 文件系统 90%/inode 高 | 水位、拒绝和清理 |
| 服务端升级 | 业务 SLI 与回滚 |
| 备份恢复 | checksum、模型加载、权限 |

生产演练先从测试导出和 canary 客户端开始，设置停止条件。

## 18. 验收清单

- [ ] 未授权客户端无法挂载；
- [ ] root_squash 和 UID/GID 符合设计；
- [ ] 模型只读、Checkpoint 按租户隔离；
- [ ] v3/v4 与端口符合基线；
- [ ] 单/多客户端性能达到 SLO；
- [ ] Active 故障后在 RTO 恢复；
- [ ] fencing 能阻止双主；
- [ ] 锁/file handle/数据在切换后正确；
- [ ] 容量/inode/后端/HA 有告警；
- [ ] 备份已执行真实恢复；
- [ ] 配置、升级和回滚可审计。

## 19. 常见误区

1. **双电源+RAID 就是 HA。**整机和服务仍单点。
2. **VIP 漂移等于切换完成。**锁、状态、文件句柄和后端还需恢复。
3. **共享盘两节点都挂载即可。**非集群文件系统双写会损坏。
4. **关闭 root_squash 解决 Kubernetes 权限。**扩大安全风险。
5. **复制等于备份。**误删和逻辑损坏也会复制。
6. **只备份不恢复测试。**无法证明 RTO/RPO。
7. **soft mount 能消除所有卡住。**可能把网络问题变成应用 I/O 错误。

## 20. 掌握标准

应能从负载设计服务端 CPU/内存/NIC/后端；写出最小权限 exports；解释 AUTH_SYS/Kerberos/root_squash；设计带 fencing 和状态恢复的 HA；执行切换、备份恢复和升级验收。

下一篇：[NFS 性能指标、压测与参数调优](./05-NFS性能指标压测与参数调优.md)。

## 参考资料

- [exports(5)](https://man7.org/linux/man-pages/man5/exports.5.html)
- [nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
- [Linux NFS server documentation](https://docs.kernel.org/filesystems/nfs/index.html)
- [NFS-Ganesha documentation](https://github.com/nfs-ganesha/nfs-ganesha/wiki)
- [RFC 7861: NFSv4 Multi-Domain Federation](https://www.rfc-editor.org/rfc/rfc7861)
