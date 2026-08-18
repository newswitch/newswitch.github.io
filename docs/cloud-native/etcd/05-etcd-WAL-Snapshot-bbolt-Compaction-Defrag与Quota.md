---
title: "WAL、Snapshot、bbolt、Compaction、Defrag 与 Quota"
sidebar_label: "05. WAL、Snapshot、bbolt、Compaction、Defrag 与 Quota"
sidebar_position: 5
description: "理解 etcd Raft WAL、快照、MVCC Backend、历史压缩、物理碎片和 NOSPACE。"
tags: [etcd, WAL, Snapshot, Compaction, Defrag]
---

# WAL、Snapshot、bbolt、Compaction、Defrag 与 Quota

> 本文以 etcd 3.6 为基线。示例中的 Endpoint、证书路径和 Revision 必须替换成真实值；所有维护操作都应先在测试集群演练。

理解空间问题之前，先把两条持久化链路分开：

```text
客户端写入
  → Raft proposal
  → WAL 持久化 Raft 日志
  → 多数派确认并 commit
  → apply 到 MVCC
  → bbolt backend 保存当前数据与历史 Revision

Raft WAL / Raft snapshot：让成员重启后恢复共识进度
bbolt backend db：保存用户看到的 Key、Revision、Lease 等状态
```

典型数据目录中，`member/wal/` 保存 WAL，`member/snap/db` 是 Backend 文件。两者都叫“快照”的场景容易混淆：Raft snapshot 用于截断已经应用的 Raft 日志；`etcdctl snapshot save` 导出的数据库快照用于灾难恢复。

在线执行 `etcdctl snapshot save` 会从健康 Endpoint 获取一致的 Backend 快照。停机复制 `member/snap/db` 也能用于恢复，但它可能不包含尚留在 WAL、还未写入 Backend 的更新，所以不能把运行中直接复制 DB 文件当成标准备份流程。

## 1. 先判断空间到底去了哪里 {/* #先判断空间到底去了哪里 */}

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint status --cluster -w table
etcdctl --endpoints="$ETCD_ENDPOINTS" alarm list
```

重点比较两个指标：

| 指标 | 表示什么 | 如何判断 |
| --- | --- | --- |
| `etcd_mvcc_db_total_size_in_use_in_bytes` | 有效数据和仍保留的 MVCC 历史实际占用 | 持续上涨通常是业务数据或历史窗口在增长 |
| `etcd_mvcc_db_total_size_in_bytes` | Backend 文件总大小，包含内部可复用空闲页 | 明显大于 in-use，说明碎片多，Defrag 才可能归还文件系统空间 |

主机磁盘占用还包含 WAL、日志、快照和其他进程文件，不能只看 Backend 指标。先用操作系统工具定位目录，再决定是删日志、收紧历史窗口，还是维护 Backend。

## 2. Compaction：删除不可再查询的历史 {/* #compaction删除不可再查询的历史 */}

同一个 Key 每次写入都会产生新 Revision。Compaction 删除目标 Revision 之前的 MVCC 历史版本，使这些页可以在 Backend 内部复用。它不会删除 Key 的当前值，也不保证 DB 文件立即变小。

```bash
# 先读取当前 Revision，人工决定要保留的历史窗口
etcdctl --endpoints="$ETCD_ENDPOINT" endpoint status -w json

# 示例：压缩到已经确认安全的 Revision；不要照抄数字
etcdctl --endpoints="$ETCD_ENDPOINT" compact 123456
```

压缩点是业务语义，不是“越新越好”。仍从旧 Revision 恢复的 Watch、增量同步或审计程序会收到 `required revision has been compacted`，它们必须重新 List/Range，再从新 Revision 建立 Watch。生产集群应按时间或 Revision 配置自动 Compaction，并让保留窗口覆盖客户端最长离线时间和故障恢复时间。

验收时至少确认：普通读写正常、Watcher 能重新建立、in-use 增长趋势回落、没有新的 Alarm。

## 3. Defrag：把内部空闲页归还文件系统 {/* #defrag把内部空闲页归还文件系统 */}

删除 Key 或 Compaction 只会产生可复用页；Defrag 重建单个成员的 Backend，才会缩小该成员的 DB 文件。Defrag 不经 Raft 复制，而且在线 Defrag 期间目标成员的读写会被阻塞，因此必须逐成员执行。

```bash
# 每次只指定一个 Endpoint
etcdctl --endpoints="https://etcd-2.example.com:2379" defrag

# 每个成员完成后重新验收整个集群
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint health --cluster
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint status --cluster -w table
```

三节点集群通常先处理 follower，观察业务 P99、Leader、Raft index 和 Alarm，确认恢复稳定后再处理下一个，Leader 放在最后。不要同时 Defrag 多数成员，也不要把 `defrag --cluster` 当成无风险的日常命令。若某成员已停机，可用 `etcdutl defrag --data-dir <path>` 离线处理，但必须确认进程真的停止、目录与成员一一对应。

## 4. Quota 与 NOSPACE：保护 Backend，而不是扩容方案 {/* #quota-与-nospace保护-backend而不是扩容方案 */}

`--quota-backend-bytes` 限制 Backend 大小。任一成员越过配额后，会触发集群级 `NOSPACE` Alarm，集群进入维护模式，主要允许读和删除。客户端收到 `mvcc: database space exceeded` 时，不应盲目重试写入；官方文档还指出，配额在 API 层和 Apply 层都会检查，因此报错的那次请求仍可能已经落入 Backend，业务必须按幂等方式核对结果。

### 4.1 NOSPACE 恢复 Runbook {/* #nospace-恢复-runbook */}

1. **止血**：暂停异常写入方或降低写速率，确认主机磁盘仍有维护空间。
2. **留证**：记录 `endpoint status`、Alarm、DB total/in-use、磁盘占用和异常写入来源；若条件允许，生成并校验快照。
3. **删除无用当前数据**：由业务方确认可删除的 Key。Compaction 只能清历史，不能替代业务数据治理。
4. **选择 Compaction 点**：保留足够的 Watch/恢复窗口，再压缩历史。
5. **逐成员 Defrag**：一次一个成员，每次都验证 quorum、Leader 和业务延迟。
6. **复核容量**：只有 DB total 和 in-use 都已回到安全水位，且异常增长已停止，才解除 Alarm。
7. **解除并试写**：

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" alarm list
etcdctl --endpoints="$ETCD_ENDPOINTS" alarm disarm
etcdctl --endpoints="$ETCD_ENDPOINT" put /healthcheck/nospace-recovery "$(date +%s)"
etcdctl --endpoints="$ETCD_ENDPOINT" get /healthcheck/nospace-recovery
etcdctl --endpoints="$ETCD_ENDPOINT" del /healthcheck/nospace-recovery
```

直接调大 quota 只能临时扩大边界；如果写入模型、历史窗口或碎片问题不改，故障会再次发生。调整 quota 前还要核对磁盘、内存、快照时间和恢复 RTO 是否承受更大的 Backend。

## 5. 如何从现象定位动作 {/* #如何从现象定位动作 */}

| 现象 | 更可能的原因 | 先做什么 |
| --- | --- | --- |
| total 与 in-use 一起涨 | 当前数据或保留历史增长 | 找写入 Prefix、写速率和历史窗口 |
| total 高、in-use 明显低 | Backend 内部碎片 | 评估维护窗口，逐成员 Defrag |
| 主机磁盘高、Backend 不高 | WAL、日志、旧备份或其他目录 | 从文件系统定位，不要误做 Compaction |
| Compaction 后 Watch 大量报错 | 客户端仍请求旧 Revision | 检查客户端是否具备重新 List/Watch 逻辑 |
| Defrag 时 P99 飙升 | 请求仍打到阻塞中的成员 | 摘除该 Endpoint 或降低流量，等待完成后验收 |

长期监控至少应覆盖 DB total/in-use 与增长率、quota 比例、主机剩余空间、WAL fsync、Backend commit、proposal pending、Leader changes、Compaction/Defrag 维护记录、快照结果和 Alarm。

## 6. 实验：亲眼看见“逻辑释放”和“物理回收” {/* #实验亲眼看见逻辑释放和物理回收 */}

在隔离的三节点测试集群写入并反复更新一批 Key，记录 total/in-use；删除 Key 后再次记录；执行 Compaction 再记录；最后逐成员 Defrag。你应该观察到：删除/Compaction 主要改变有效占用与可复用页，Defrag 后 DB 文件总大小才明显下降。把每一步的 Revision、耗时、P99 和指标截图保存，才算完成实验。

## 7. 验收题 {/* #验收题 */}

- Compaction 与 Defrag 分别释放什么？
- 为什么 Defrag 要逐成员？
- NOSPACE 时为何先止住异常写？
- 在线快照与复制 db 文件有何差异？
- total 很高而 in-use 很低时，为什么继续删 Key 未必能释放主机磁盘？

## 8. 参考资料 {/* #参考资料 */}

- [Maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
- [Disaster recovery](https://etcd.io/docs/v3.6/op-guide/recovery/)
