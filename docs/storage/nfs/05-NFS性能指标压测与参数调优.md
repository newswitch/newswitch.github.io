---
title: "NFS 性能指标、压测与参数调优"
sidebar_position: 5
tags: [NFS, nfsstat, nfsiostat, fio, rsize, wsize, nconnect, 性能调优]
description: "按应用、客户端 RPC、网络、服务端和后端五层测量 NFS，并基于证据调整 rsize、wsize、nconnect、缓存和并发。"
---

# NFS 性能指标、压测与参数调优

NFS 性能是端到端结果：

```text
应用访问模式
→ 客户端页/属性缓存
→ RPC 并发和挂载参数
→ 网络
→ nfsd/服务端缓存与文件系统
→ RAID/NVMe/共享后端
```

只在客户端跑一次 `dd`，不能说明瓶颈；直接复制 `rsize=1M,wsize=1M,nconnect=8` 也不是调优。

## 1. 先定义业务指标

### 模型加载

- 单模型冷/热完成时间；
- 多 Pod P50/P95/P99；
- 首字节与持续带宽；
- 校验、反序列化和 H2D 分段；
- 源端聚合带宽。

### 训练数据

- samples/s；
- DataLoader wait；
- GPU data stall；
- 文件大小分布和 open/stat rate；
- 多节点公平性。

### Checkpoint

- 每次完整提交时间；
- write/fsync/rename/manifest；
- 对训练 step 的暂停；
- 恢复读取时间；
- 多租户尾延迟。

## 2. 基线必须记录

- 客户端/服务端 OS、内核、nfs-utils；
- NFS version、transport、mount options；
- 客户端数、CPU/内存/NIC；
- 服务端线程、CPU/内存/NIC；
- 后端文件系统、RAID/卷/设备；
- 文件大小、目录数、读写比例；
- Buffered/Direct、冷/热缓存；
- 测试并发、时长和原始 job；
- 后台备份、恢复、Scrub、其他租户。

## 3. 客户端工具

### 3.1 挂载事实

```bash
findmnt -t nfs,nfs4 -o TARGET,SOURCE,FSTYPE,OPTIONS
nfsstat -m
```

不要只看 `/etc/fstab`，实际协商可能不同。

### 3.2 nfsstat

```bash
nfsstat -c
nfsstat -s
nfsstat -m
```

查看客户端/服务端 RPC 与 NFS operation 计数。比较时间窗口最好采集增量，系统启动以来累计值不能直接归因当前事件。

### 3.3 nfsiostat

```bash
nfsiostat 1 <mountpoint>
```

常见概念：

- ops/s；
- kB/s；
- RPC backlog；
- retrans；
- avg RTT：RPC 发送到响应；
- avg execute：调用在客户端排队到完成。

若 execute 明显高于 RTT，客户端排队/slot/RPC 调度可能占比大；若 RTT 同时高，继续查网络、服务端和后端。字段以本机工具版本为准。

### 3.4 mountstats

```bash
mountstats <mountpoint>
```

可提供 per-op 调用、传输和事件细节，适合建立 READ/WRITE/GETATTR 差异。

## 4. 服务端工具

```bash
nfsstat -s
cat /proc/net/rpc/nfsd
ss -tan | grep ':2049'
pidstat -u 1
iostat -xz 1
```

还应监控：

- nfsd worker/queue；
- per export 读写（若平台支持）；
- 文件系统容量/inode；
- page cache/Dirty/Writeback；
- 后端设备/存储集群；
- NIC 与交换机。

## 5. 网络先验收

### 5.1 接口

```bash
ip -s link show dev <nic>
ethtool <nic>
ethtool -S <nic>
```

检查速率、drop/error、FEC/驱动计数。Bond 每个 flow 的分布受哈希影响，单 TCP 流不一定跨所有成员。

### 5.2 iperf3

在受控端口和窗口测试单流/多流：

```bash
iperf3 -c <server> -P 1
iperf3 -c <server> -P 4
```

iperf 证明网络 TCP 能力，不证明 NFS 后端与元数据。压测共享网络需审批和限速。

### 5.3 TCP 证据

观察重传、拥塞、RTT、socket buffer；不要看到 NFS `retrans` 就直接认定物理丢包，服务端超时也会导致 RPC 重试。

## 6. 分层压测矩阵

| 层 | 测试 | 回答的问题 |
|---|---|---|
| 网络 | iperf3 单/多流 | TCP 上限与丢包 |
| 服务端本地 FS | 服务端本地 fio | 后端/文件系统能力 |
| NFS 单客户端 | fio 冷/热，大/小 I/O | 单客户端路径 |
| NFS 多客户端 | 同步启动相同 job | 聚合、尾延迟、公平性 |
| 元数据 | mdtest/真实文件树 | open/stat/create 极限 |
| 应用 | 模型/DataLoader/Checkpoint | 最终业务 SLI |

只有上层慢时，逐层对比能缩小故障域。

## 7. fio 的正确使用

大文件顺序读取示例：

```bash
fio --name=nfs-model-read \
  --directory=<dedicated-test-directory> \
  --rw=read --bs=1M --direct=1 \
  --ioengine=libaio --iodepth=16 --numjobs=1 \
  --size=<validated-size> --time_based=1 \
  --runtime=120 --ramp_time=20 --group_reporting
```

注意：

- 某些 NFS/内核组合的异步/Direct 行为需验证；
- `direct=1` 不代表模型 loader 的 Buffered 路径；
- 测试目录不得含业务数据；
- 多客户端聚合可能压满服务；
- 写测试需明确持久化和容量风险。

完整方法见[存储性能指标与 fio](../linux-io/03-存储性能指标与fio压测方法.md)。

## 8. 冷缓存、热缓存与服务端缓存

至少报告：

```text
client-hot
client-cold/server-hot
client-cold/server-cold（专用环境才可控）
direct/buffered
```

第二次快通常是客户端缓存；客户端冷后仍快可能是服务端缓存。生产不要全局 drop caches。

## 9. rsize 与 wsize

它们控制 NFS READ/WRITE 单次传输的协商最大尺寸方向。较大值通常减少 RPC 数和协议开销，适合大文件；但：

- 实际值由客户端/服务端协商；
- 网络/传输会分段；
- 小随机 I/O 未必受益；
- 大请求可能增加单次重试量和 head-of-line；
- 需要结合 CPU、RTT 和内存。

用 `nfsstat -m` 查看实际值。扫描当前默认与候选值，保持其他变量不变。

## 10. nconnect

支持的 Linux NFS 客户端可为同一 server 建立多个 TCP 连接，帮助：

- 多核并行；
- 多流利用 bond/ECMP；
- 减少单连接 head-of-line；
- 提高高带宽场景吞吐。

风险/边界：

- 支持取决于客户端内核和协议；
- 同一 server 的首次挂载参数可能影响后续共享连接；
- 连接数增加服务端、NAT/防火墙和监控压力；
- 并发已足够时收益有限；
- 更多连接不修复磁盘瓶颈。

逐级测试 1/2/4/8 等受支持值，观察吞吐、P99、CPU、连接和公平性。

## 11. timeo、retrans 与 hard/soft

这些参数主要影响故障行为，不应作为正常性能调优：

- `hard`：请求持续重试，恢复后可继续，但进程可能长期等待；
- `soft` 及变体：一定条件返回错误，应用必须正确处理，存在数据语义风险；
- `timeo`：RPC 重传计时方向；
- `retrans`：重试相关阈值。

任意缩短 timeout 可能在服务端短时尾延迟时制造重试风暴。应先修复后端和容量，再按应用错误语义设计。

## 12. 属性与目录缓存

`actimeo`、`acreg*`、`acdir*`、`lookupcache`、`cto/nocto` 会改变 GETATTR/LOOKUP 和可见性。

调优步骤：

1. 将数据设计为不可变 revision；
2. 从默认缓存开始；
3. 观察 GETATTR/LOOKUP 占比和业务发布需求；
4. 单变量改变；
5. 验证多客户端正确性和 RPC/延迟；
6. 记录到挂载基线。

不要以全局 `noac` 替代正确发布协议。

## 13. 服务端 nfsd 线程

线程太少可能排队，太多可能增加调度和锁竞争。调优需观察：

- 请求率和 backlog；
- CPU 每核利用；
- 后端 I/O；
- operation 类型；
- 多客户端 P99。

增加线程后如果后端盘已饱和，只会让更多 I/O 排队。变更方式依发行版和服务实现。

## 14. 服务端文件系统和后端

### 大文件读

关注顺序吞吐、readahead、page cache、RAID 条带与 NIC。

### 小文件

关注 inode、目录布局、metadata locks、日志和 CPU。将百万小文件打包为训练分片可能比 NFS 参数调优收益大。

### Checkpoint 写

关注 Dirty/Writeback、fsync、设备 cache、RAID/复制和多个 rank 同步。Buffered 写峰值可能只是服务端内存。

### 后台任务

备份、快照、RAID rebuild、Scrub 和其他租户会制造周期性尖峰，必须进入时间线。

## 15. 性能症状决策树

### 单客户端慢，多客户端也慢

先查该客户端 CPU/NIC/挂载/缓存，再查服务端与后端。

### 单客户端正常，多客户端聚合不增长

查服务端 NIC、nfsd CPU、后端带宽、锁、连接数和交换网络。

### RTT 高

查网络拥塞/重传、服务端排队、后端 I/O。服务端慢也会体现为 RPC RTT 高。

### execute 高、RTT 相对低

查客户端 RPC queue/slot、并发、CPU 和应用提交。

### 读快写慢

查同步语义、服务端 writeback、RAID/复制、设备持续写和剩余空间。

### 大文件快、小文件慢

查 LOOKUP/GETATTR/open/stat、目录、服务端元数据和 DataLoader 格式。

## 16. AI 冷启动风暴

```text
模型大小 S × 未命中节点 N
→ 总回源 N×S
→ NFS server/NIC/backend 聚合上限
```

措施：

- 节点 NVMe 缓存；
- 分批预热；
- 限制同时加载副本；
- 旧副本在新副本 Ready 前保留；
- 用不可变 revision 复用缓存；
- 将大规模分发迁移到对象存储/分发层；
- 对模型与训练数据分开导出/服务池。

只调 `nconnect` 无法消除总数据量。

## 17. 调优实验模板

```text
假设：单连接未利用 2×100Gb bond
基线：nconnect=1，同模型/客户端/缓存，吞吐与P99
变量：只改 nconnect=4
证据：客户端连接、每成员端口流量、CPU、服务端、后端
验收：业务完成时间改善且P99/错误不恶化
回滚：恢复原挂载配置并重新挂载 canary
```

每项参数都使用这种假设驱动方式。

## 18. 容量与性能余量

NFS 规划要同时保留：

- 正常峰值；
- 发布/扩容模型下载；
- Checkpoint 峰值；
- 单 NIC/节点/盘故障；
- RAID rebuild/后端恢复；
- 未来增长。

目标不是实验室峰值，而是在一个故障域失效时仍满足关键负载 SLO。

## 19. 常见误区

1. **dd 的 GB/s 就是 NFS 性能。**可能命中缓存且无尾延迟。
2. **retrans 一定是网卡丢包。**服务端/后端慢也可触发。
3. **nconnect 越大越好。**增加服务端和网络压力。
4. **rsize/wsize 设最大一定最快。**取决于负载和链路。
5. **noac 解决一致性且无代价。**RPC 和延迟可能大增。
6. **服务端加线程能修复磁盘瓶颈。**会增加排队。
7. **Direct fio 等于模型加载。**缓存、校验、CPU、H2D 未覆盖。
8. **平均吞吐正常就无问题。**多客户端公平性和 P99 可能失控。

## 20. 掌握标准

应能从应用 SLI 开始，使用 mountstats/nfsiostat 区分 RPC RTT 与客户端 execute，结合网络/nfsd/后端定位；安全设计单/多客户端、冷/热、数据/元数据实验；有证据地调整 rsize/wsize/nconnect/缓存；最终用真实模型和 Checkpoint 验收。

下一篇：[NFS CSI、生产故障排查与 AI 冷启动](./06-NFS%20CSI生产故障排查与AI冷启动.md)。

## 参考资料

- [nfsstat(8)](https://man7.org/linux/man-pages/man8/nfsstat.8.html)
- [nfsiostat(8)](https://man7.org/linux/man-pages/man8/nfsiostat.8.html)
- [mountstats(8)](https://man7.org/linux/man-pages/man8/mountstats.8.html)
- [nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
- [fio documentation](https://fio.readthedocs.io/en/latest/fio_doc.html)
