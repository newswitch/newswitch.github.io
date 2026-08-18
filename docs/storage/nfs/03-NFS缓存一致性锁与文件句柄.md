---
title: "NFS 缓存、一致性、锁与文件句柄"
sidebar_label: "03. NFS 缓存、一致性、锁与文件句柄"
sidebar_position: 3
description: "系统理解 NFS 数据/属性/目录缓存、close-to-open、一致性窗口、文件锁、delegation、lease 和 stale file handle。"
tags: [NFS, 缓存一致性, 文件锁, delegation, stale file handle, close-to-open]
---

# NFS 缓存、一致性、锁与文件句柄

NFS 如果每次 `read()`、`stat()` 和目录查询都访问服务端，会被网络往返限制；如果长期缓存，又可能看不到其他客户端的更新。NFS 的核心权衡是：

```text
性能与可扩展性 ←→ 跨客户端可见性与一致性
```

本篇建立数据缓存、属性缓存、目录项缓存、close-to-open、锁、delegation 和文件句柄之间的完整模型。

## 1. 缓存不止一层

```text
应用缓存
→ libc/framework/model loader
→ Linux page cache
→ NFS 属性/目录缓存
→ RPC/network
→ 服务端 page cache
→ 服务端文件系统/设备缓存
```

排查“另一个节点看不到新文件”时，不能只说“清缓存”，要先判断是数据页、属性、目录项、应用索引还是发布协议。

## 2. 数据页缓存

NFS 客户端把远程文件内容缓存到本地 page cache。后续读取可直接命中内存。

好处：

- 降低网络和服务端负载；
- 顺序 readahead 隐藏 RTT；
- 多次模型加载可复用节点缓存；
- mmap 可使用相同页缓存。

风险：

- 其他客户端修改后，本地旧页何时失效；
- 节点内存压力导致热模型被回收；
- 冷/热压测结果差异巨大；
- 多客户端写同一文件产生复杂语义。

## 3. 属性缓存

`stat()` 需要大小、mtime、mode、UID/GID 等属性。每次都发 GETATTR 代价高，客户端会在一定时间内缓存属性。

常见 mount 参数族包括 `ac`/`noac`、`actimeo`、`acregmin/max`、`acdirmin/max`。实际默认与语义以当前 `nfs(5)`、内核和服务端为准。

关键点：

- 延长属性缓存可减少 RPC，但变化可见更慢；
- `noac` 可能显著降低性能，并不等于所有缓存彻底关闭；
- 不应为一个错误发布流程全局禁用缓存；
- 不同客户端的计时和访问模式使观察到的窗口不同。

## 4. dentry/目录缓存

目录查找和文件是否存在也会缓存。一个客户端创建文件后，另一个客户端可能在短暂窗口仍使用先前的目录/属性缓存。

对模型发布，可靠做法不是不断轮询“目录里文件数够不够”，而是：

1. 使用不可变 revision 目录；
2. 所有文件写入并校验；
3. 最后原子发布 manifest/完成标记；
4. 消费者打开固定 revision 并验证 manifest。

## 5. Close-to-open 一致性

经典 NFS 客户端语义可以简化为：

- 写入客户端在 close 前后将修改推向服务端；
- 另一个客户端 open 时重新验证属性；
- 若检测到变化，使旧缓存失效并读取新数据。

这使“写完整、关闭；另一个客户端随后打开”通常能看到更新，但它不是通用强一致事务：

- 已经打开并持续读取的客户端可能保留缓存；
- 多进程同时写一个文件仍需同步；
- 目录中的多个文件没有原子整体提交；
- 应用缓存可能不重新 open；
- 服务端和挂载参数会影响行为。

因此模型权重应不可变，不应多个节点原地覆盖同一文件。

## 6. `sync`、`fsync` 与 NFS

客户端 write 可先进入本地 dirty page，再发送 WRITE/COMMIT。`fsync()` 请求将修改同步到服务端稳定存储语义，但最终保证取决于 NFS 协议、服务端文件系统、设备缓存和后端复制。

```text
application write
→ client dirty page
→ WRITE RPC
→ server cache/backend
→ COMMIT/stable write
→ fsync completion
```

对 Checkpoint：

- 每个分片写临时名；
- 按框架要求同步；
- 所有 rank/分片完成；
- 写 manifest 和 checksum；
- 最后提交完成标记；
- 恢复端只加载完整提交。

只调用 rank 0 `close()` 不一定覆盖分布式 Checkpoint 的全部状态。

## 7. 文件锁

### 7.1 advisory locks

`flock()`/`fcntl()` 常见是 advisory：只有遵守协议的进程才会互斥。NFS 上具体支持和映射受版本、客户端、服务端和应用 API 影响。

### 7.2 NFSv3 锁

通常由 Network Lock Manager（NLM/lockd）与 NSM/statd 辅助处理。防火墙、服务重启和 HA 都要覆盖这些状态。

### 7.3 NFSv4 锁

锁整合进 v4 状态模型，使用 stateid、lease 和恢复。服务端故障后客户端在 grace period reclaim。

### 7.4 锁不适合作为模型发布唯一机制

模型分发更适合不可变 revision + manifest。长时间跨节点锁会引入服务端状态、故障恢复和死锁风险。

## 8. Delegation

NFSv4 服务端可以把某些文件的读/写管理权临时委托给客户端，使其减少 OPEN/GETATTR 等 RPC。当另一个客户端产生冲突访问时，服务端 recall delegation，原客户端需归还。

好处：单客户端访问性能提高。

需要理解：

- delegation 由服务端决定，不是客户端保证获得；
- recall 延迟影响冲突访问；
- 网络分区/客户端失联需要 lease 超时；
- 抓包时 RPC 减少不一定是没有访问，可能在本地 delegation/cache 完成。

## 9. Lease、grace 与 state reclaim

NFSv4 客户端需在 lease 期间续租。服务端重启后：

```text
server enters grace period
→ known clients reconnect
→ reclaim OPEN/LOCK state
→ grace ends
→ normal new state operations
```

如果 HA 节点没有共享/恢复必要状态，客户端可能丢锁、等待或收到错误。VIP 漂移成功仅证明 IP 可达，不证明 NFSv4 状态正确恢复。

## 10. 文件句柄为什么会 stale

客户端使用 file handle 标识远端对象。`ESTALE` 常见原因：

- 服务端文件/目录被删除后重新创建；
- 导出路径或底层挂载改变；
- 服务端切换到不一致后端；
- 文件系统恢复/重建改变对象标识；
- 容器化 NFS 服务重启后导出视图变化；
- 快照/克隆切换没有保持 handle 稳定；
- 客户端长期保留旧 dentry/inode。

错误路径：遇到 stale 就反复 `umount -f`。正确做法先确认服务端对象、导出、后端和 HA 是否一致，再在控制影响后重挂载。

## 11. 删除后仍被打开

POSIX 中打开文件被 unlink 后，进程可继续通过 fd 访问，直到最后关闭。NFS 为实现类似语义，客户端可能使用 `.nfs...` 临时名称保存对象。若进程仍打开，删除该临时文件可能失败或重新出现。

排查：

```bash
lsof +L1 <mountpoint>
find <mountpoint> -name '.nfs*' -maxdepth <controlled-depth>
```

大目录 `find/lsof` 可能昂贵，应限制范围。解决打开者而不是反复强删 `.nfs` 文件。

## 12. 多客户端写同一文件

需要警惕：

- write offset 是否重叠；
- append 是否满足应用预期的原子性；
- Buffered Write 和 flush 时序；
- 锁是否所有客户端都遵守；
- 客户端/服务端崩溃后的恢复；
- 应用是否把 rename 当跨目录/跨文件系统事务。

对训练：每个 rank 独立分片文件，最后统一 manifest，通常比所有 rank 写同一大文件更容易保证正确与并行。

## 13. 模型目录的正确发布

错误方式：

```text
/models/production/model.bin  # 原地覆盖
```

客户端可能同时读到旧缓存、部分新文件或配置/权重不匹配。

推荐：

```text
/models/revisions/<revision>/...
/models/channels/production -> ../revisions/<revision>
```

步骤：

1. revision 目录只写一次；
2. 文件 size/checksum 校验；
3. manifest 最后提交；
4. canary 加载；
5. 切换小的 channel/发布配置；
6. 工作负载解析并固定 revision；
7. 旧 revision 保留到回滚窗口结束。

符号链接切换、rename 和跨客户端缓存语义仍需在目标 NFS 实现测试；最稳妥是把解析出的不可变 revision 直接传给新 Pod。

## 14. mount 参数的正确理解

### 14.1 `actimeo`

统一设置属性缓存时间方向，降低值增加 GETATTR，增大值延长变化可见窗口。应从应用发布语义解决正确性，再基于 RPC 与延迟调整。

### 14.2 `lookupcache`

影响目录项查找缓存策略，具体值/支持见当前 `nfs(5)`。降低缓存可能缓解某些创建可见性需求，但会增加 LOOKUP。

### 14.3 `noac`

明显改变缓存与同步行为，性能代价可能很大；不是通用“强一致开关”。

### 14.4 `cto`/`nocto`

控制 close-to-open 相关缓存验证方向。`nocto` 只适合文件从不改变等明确只读场景，并要求应用保证数据不可变。

不要在不了解业务写入模式时使用 `nocto` 加速共享模型目录。

## 15. 观察缓存与一致性

### 15.1 系统调用与时间

```bash
strace -ttT -e trace=openat,statx,read,write,fsync,close <command>
```

### 15.2 NFS 操作

```bash
nfsstat -c
nfsiostat 1 <mountpoint>
mountstats <mountpoint>
```

### 15.3 页错误与内存

```bash
pidstat -r -p <pid> 1
grep -E 'Cached|Dirty|Writeback' /proc/meminfo
```

### 15.4 多客户端实验

在客户端 A 写临时文件、`fsync`/close/rename；客户端 B 以不同时间间隔 open/stat/read，记录调用和 RPC。不要用睡眠猜一致性保证，应明确当前挂载和实现的实际行为。

## 16. 常见故障模式

### 16.1 看到旧内容

检查：应用是否复用 fd/内存缓存、文件是否原地覆盖、属性/数据缓存、是否 `nocto`、服务端是否真正更新、两端是否同一导出/后端。

### 16.2 新文件短时不可见

检查目录缓存、负 dentry、客户端是否查询同一目录、发布是否完成。使用 immutable revision + commit manifest。

### 16.3 lock 卡住

检查协议版本、lockd/statd 或 v4 state、客户端 lease、服务端 grace、HA 切换与防火墙。不要只杀应用。

### 16.4 stale file handle

确认文件/目录是否被重建，导出/后端是否变化，是否只有单客户端。保存 `findmnt`、服务端 export 和故障切换时间线，再有序重挂载。

### 16.5 `.nfs*` 无法删除

查找打开文件的进程，优雅关闭或重启对应应用；强删会被客户端机制阻止/重建。

## 17. 一致性需求分级

| 数据 | 推荐语义 |
|---|---|
| 不可变模型权重 | revision 固定、只读、checksum，可使用较积极缓存 |
| Tokenizer/config | 与模型同 manifest，避免独立覆盖 |
| 训练数据分片 | 不可变、版本化；索引原子发布 |
| Checkpoint | 分片+manifest+完整提交，恢复只读完整点 |
| 日志 | 多写者避免共享单文件，使用日志系统 |
| 临时锁文件 | 明确锁恢复，不作为跨集群唯一协调器 |

## 18. 课后实验

1. 客户端 A/B 读取同一不可变文件，观察第二次 RPC 与页缓存。
2. A 原地覆盖，B 持续打开 fd，记录何时看到变化；说明这种发布为何危险。
3. 改为新 revision + manifest，验证 B 只看到完整版本。
4. 使用 advisory lock，验证遵守锁与不遵守锁的进程差异。
5. 在测试服务重启期间观察 v4 grace/reclaim。
6. 删除并重建测试文件，复现并分析 stale handle（仅隔离测试）。
7. 打开后 unlink 测试文件，观察 `.nfs` 临时对象。

## 19. 常见误区

1. **NFS cache 只有数据页。**还有属性、目录项和应用缓存。
2. **close-to-open 等于强一致。**它只是特定访问模式下的验证语义。
3. **禁用缓存能解决所有正确性。**会显著降性能且不能提供多文件事务。
4. **flock 强制所有写者互斥。**通常是 advisory。
5. **VIP 切换后锁自动正确。**还需 lease/state/grace 与共享后端。
6. **stale handle 是客户端缓存坏。**常由服务端对象/导出/后端身份变化。
7. **模型目录可原地覆盖。**容易产生配置与权重混合版本。

## 20. 掌握标准

应能区分数据、属性、目录和应用缓存；解释 close-to-open、v3/v4 锁、delegation、lease/grace；设计不可变模型和 Checkpoint 提交；使用证据定位旧内容、锁卡住、`.nfs` 与 stale handle。

下一篇：[NFS 生产部署、安全与高可用](./04-NFS生产部署安全与高可用.md)。

## 21. 参考资料 {/* #参考资料 */}

- [Linux NFS client documentation](https://docs.kernel.org/filesystems/nfs/client-identifier.html)
- [nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
- [exports(5)](https://man7.org/linux/man-pages/man5/exports.5.html)
- [RFC 7530: NFSv4](https://www.rfc-editor.org/rfc/rfc7530)
- [RFC 8881: NFSv4.1](https://www.rfc-editor.org/rfc/rfc8881)
