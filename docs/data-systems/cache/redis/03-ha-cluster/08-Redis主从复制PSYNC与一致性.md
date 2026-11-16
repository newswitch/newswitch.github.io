---
title: "主从复制、PSYNC、Replication Backlog 与一致性"
sidebar_label: "08. 主从复制、PSYNC、Replication Backlog 与一致性"
sidebar_position: 8
description: "以 Redis 8.6 推演 PSYNC 身份与位点、Backlog 覆盖窗口、全量同步和故障切换，结合 INFO、WAIT、WAITAOF 与拒写阈值解释一致性边界。"
tags: [Redis, Replication, PSYNC, Backlog]
---

# 主从复制、PSYNC、Replication Backlog 与一致性

Redis 默认使用异步复制：主节点执行写入、客户端收到成功、副本应用写入、副本持久化，是不同事件。复制能增加数据副本，但不会自动把它们变成同步提交的共识系统。

本文以 **Redis Open Source 8.6** 为基线；`WAIT` 从 3.0 提供，`WAITAOF` 从 7.2 提供。示例使用隔离实例的 `16379/16380` 端口，认证与 TLS 按实际环境配置，不把凭据写进命令历史。数值输出均为教学示意。

## 1. 建链 {/* #建链 */}

```text
副本建立连接并完成认证、能力协商
→ PSYNC：询问能否继续某段复制历史
  ├─ 身份可接受，所需字节仍有覆盖 → 部分同步 → 补增量
  └─ 身份不可接受或所需字节已丢失 → 全量同步
       → 传输并加载数据快照 → 衔接同步期间增量 → 持续复制
```

### 1.1 replid 与 offset 各回答什么

Replication ID，简称 replid，标识一段复制历史；offset 标识该历史中的复制流位置。**offset 不是业务消息数，也不是事务 ID**，不能把两个不同 replid 下的相同数字当作同一状态。

故障提升后，新主会建立新的当前 replid，并可在受限的截止位点内识别旧 replid，即 secondary ID。因此“主从切换一定要全量同步”也不正确；是否可继续，取决于身份、截止位点和现存复制流。

### 1.2 Backlog 覆盖怎样手算

假设当前复制流最后字节 offset 为 `1000000`，实际保留的字节范围为 `800001..1000000`，共 `200000` 字节。还需假设副本的 replid 能被接受：

| 副本最后已处理 offset | 下一字节位置 | 判断 |
| ---: | ---: | --- |
| `950000` | `950001` | 缺少后面的 50000 字节，仍在覆盖范围，可尝试部分同步 |
| `750000` | `750001` | 所需起点早于 800001，缺口无法只靠现有 Backlog 补齐 |
| `1000000` | `1000001` | 已追到当前末尾，此刻没有待补字节；不是因为超出末尾一个位置就必须全量 |

即使第一行的字节范围满足，身份不兼容仍可能需要全量。不能只看 `master_repl_offset` 大小，也不能仅凭“网络只断了几秒”判断安全。[复制历史与部分同步](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)

### 1.3 全量同步的成本

全量同步需要生成/传输快照、加载数据，并衔接快照期间产生的增量，才算追平；收到 RDB 不等于后续写入已经全部应用。基于磁盘的路径会经过中间 RDB 文件，Diskless 路径可以直接流式传输，但仍有 fork、CPU、内存和网络成本。

具体版本可采用不同的快照/增量传输与缓冲方式。无论在哪一侧缓冲，若追赶速度长期低于新增复制流速度，副本就难以收敛；重复全量同步可能继续放大资源压力。[RDB 与 COW](../02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md)

## 2. 读副本 {/* #读副本 */}

副本读可扩展读取，却可能陈旧。例如客户端写主节点后立刻读副本，副本尚未应用这条写，返回旧值并不矛盾。

`replica-read-only yes` 的含义是拒绝普通业务写入，不是“数据始终最新”。`replica-serve-stale-data` 决定某些断链/同步状态下是否继续提供陈旧数据，也不是一致性协议。需要最新结果的请求应根据业务选择读主、版本校验或其他明确机制，不把随机副本读取当作自动 read-after-write。

允许陈旧数据也不表示所有加载阶段都能正常读；还要区分副本保留旧数据、正在替换数据集以及返回 `LOADING` 等状态。

复制位点接近也不代表已经 fsync。内存应用、复制 ACK 与稳定存储，是三个需要分开的证据。

## 3. `WAIT` 边界 {/* #wait-边界 */}

### 3.1 必须使用同一连接

`WAIT numreplicas timeout` 检查**当前连接此前写入**对应的复制确认位置；超时单位为毫秒，`0` 表示无限等待。它返回已确认的副本数，调用方必须比较是否达到目标。

先进入一个交互式客户端，再在这个连接中依次执行：

```bash
redis-cli -h 127.0.0.1 -p 16379
```

```text
127.0.0.1:16379> SET lab:order:42 accepted
OK
127.0.0.1:16379> WAIT 1 1000
(integer) 1
```

不要写成两次独立启动 `redis-cli` 的 SET 与 WAIT，也不要从连接池释放写连接后随意借另一条连接等待；后一个连接并不代表前一个连接的写入位置。

返回 `1` 表示至少一个副本确认了相应复制进度，不证明副本已经 fsync，也不保证它一定是之后被提升的副本。`WAIT` 不是 Raft/Paxos 提交协议。[WAIT 的连接语义](https://redis.io/docs/latest/commands/wait/)

### 3.2 超时不是回滚

若同样的 `WAIT 1 1000` 返回 `0`，前面的 SET 不会因此撤销。应用应把“写入已执行、复制保证未达标”与“写入没有执行”分开处理。

连接中断则还可能让客户端不知道 SET 或 WAIT 的实际结果。盲目重试 `INCR`、扣减等非幂等动作，会把复制风险换成重复副作用；需要业务 ID、幂等和对账。把 WAIT 放进不允许阻塞的事务/脚本上下文，也不能期待它像普通命令那样阻塞等待。

### 3.3 WAITAOF 等待的是持久化确认

需要 AOF 刷盘确认时，可在支持版本使用 `WAITAOF numlocal numreplicas timeout`，超时同样以毫秒计，0 表示无限等待。例如主节点及目标副本都启用 AOF，在写入的同一连接继续执行，可能得到：

```text
127.0.0.1:16379> WAITAOF 1 1 1000
1) (integer) 1
2) (integer) 1
```

两项分别表示达到该连接写入位置的本地 AOF 同步确认数和副本 AOF 同步确认数，不是“本次写了两条数据”。本地目标只能为 0 或 1；本地未启用 AOF 时不能请求本地 fsync，命令也不能在副本上这样使用。

应用同样要检查两项返回值；超时不会回滚已有写入。WAITAOF 增强的是相应持久化确认，不把故障选主、网络分区和业务事务一并改造成强一致协议。[WAITAOF](https://redis.io/docs/latest/commands/waitaof/)

## 4. 监控与容量 {/* #监控与容量 */}

### 4.1 从 INFO 读取证据

只读查询如下，分别在对应实例执行：

```bash
redis-cli -h 127.0.0.1 -p 16379 INFO replication
redis-cli -h 127.0.0.1 -p 16380 INFO replication
redis-cli -h 127.0.0.1 -p 16379 INFO stats
redis-cli -h 127.0.0.1 -p 16379 CONFIG GET repl-backlog-size repl-backlog-ttl min-replicas-to-write min-replicas-max-lag
```

为对应前面的位点算例，主节点的部分字段可示意为：

```text
role:master
connected_slaves:1
master_replid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
master_repl_offset:1000000
repl_backlog_active:1
repl_backlog_size:200000
repl_backlog_first_byte_offset:800001
repl_backlog_histlen:200000
slave0:ip=192.0.2.12,port=16380,state=online,offset=950000,lag=1
```

兼容性字段仍可能包含 `slave`，不要把它擅自改成另一字段名。这里主端最新位置与最近收到的副本确认相差 `50000`，它是复制流的字节位置差，不是 50000 个 Key；观测时间和 ACK 周期也会影响差值。

`lag=1` 主要反映最近通信/确认的时间，不等于差值只有“一秒业务数据”；`lag=0` 更不证明已经落盘。副本端还应关注 `master_link_status`、`master_sync_in_progress`、`slave_repl_offset` 和加载状态；是否频繁全量/部分同步，可看主端 `sync_full`、`sync_partial_ok`、`sync_partial_err` 的窗口增量及日志。[INFO](https://redis.io/docs/latest/commands/info/)

### 4.2 Backlog 怎样估算

```text
规划 Backlog ≈ 峰值复制流字节率 × 允许断连时长 × 余量系数
```

例如复制流峰值为 2 MiB/s，希望覆盖 30 秒断连，先算出 60 MiB；采用教学余量系数 2，则需求为 120 MiB，可用 128 MiB 作为实验起点。这里用的是复制流字节率，不是业务请求数；也不是所有负载都应固定乘 2。

`repl-backlog-size` 决定规划大小，是否覆盖仍应看实际 `first_byte_offset/histlen`。复制缓冲、连接输出及引用保留还会占内存，配置大小不是进程 RSS 硬上限。

`repl-backlog-ttl` 则控制主节点在**所有副本都断开后**，多久可以释放 Backlog；`0` 表示不因该超时释放，不表示无限保留全部历史。即使不释放，有限窗口仍会被新复制流推进。

### 4.3 拒写保护不是每笔同步确认

先对照 8.6 示例配置的常见基线，再区分下面的实验选值：

| 参数 | 单位或类型 | 示例配置基线 | 作用 |
| --- | --- | --- | --- |
| `repl-backlog-size` | 字节，可带 `mb` 等后缀 | `1mb`，即 1 MiB | 规划复制流保留窗口的大小 |
| `repl-backlog-ttl` | 秒 | `3600` | 所有副本断开后的超时释放条件，0 不因超时释放 |
| `min-replicas-to-write` | 副本数 | `0` | 0 表示不启用该拒写门槛 |
| `min-replicas-max-lag` | 秒 | `10` | 判定足够健康副本时使用的最近 ACK 时间条件 |
| `replica-read-only` | 布尔值 | `yes` | 副本拒绝普通业务写入，不代表强一致读 |
| `replica-serve-stale-data` | 布尔值 | `yes` | 特定断链/同步状态下允许继续提供陈旧数据 |

下面是主节点配置片段，不是完整部署文件：

```text
repl-backlog-size 128mb
repl-backlog-ttl 3600
min-replicas-to-write 1
min-replicas-max-lag 5
```

这与前面的 200000 字节手算输出是两个不同示例。这里要求至少一个满足相应在线与最近 ACK 时间条件的副本；不足时可拒绝写入，典型错误为 `NOREPLICAS`。它没有承诺每条新写入都已经被这个副本处理。

在 8.6 示例配置中，`min-replicas-to-write` 默认 0、`min-replicas-max-lag` 默认 10 秒；任一为 0 会关闭这项保护。即使保护打开，副本刚被判定健康后仍可能断链，因此它与同连接 WAIT 的逐写位置检查不同，仍有风险窗口。提高要求还会降低故障期间的写可用性。[固定版本配置](https://github.com/redis/redis/blob/8.6.0/redis.conf)

## 5. 演练 {/* #演练 */}

只在隔离实验拓扑中进行，先固定版本、持久化配置、身份、Backlog 大小及客户端幂等方式。不要在生产直接断网或提升副本。

先记录客户端实际收到成功的业务 ID 集合，再观察三个场景：

1. 短断连：所需起点仍在保留范围，确认日志出现部分同步，副本位点追平。
2. 长断连或高写入：所需字节被推进出窗口，确认进入全量同步，记录 fork、网络、加载和追平耗时。
3. 主节点故障：按已规划的故障转移机制接入新主，对照确认集合与恢复集合，说明丢失、重复及未知结果。

“最终位点一样”与“切换过程中没有丢过已确认写入”不是同一个验收条件，需要保留切换前客户端证据。

## 6. 故障实验：量化而不是宣称“零丢失” {/* #故障实验量化而不是宣称零丢失 */}

| 现象 | 核对证据 | 判断与下一步 |
| --- | --- | --- |
| 反复进入 full sync | replid、所需起点、Backlog 范围、断链与超时日志 | 区分历史不兼容、窗口不足、缓冲释放和传输失败，不能只加内存 |
| 位点差持续增大 | 复制流增长率、网络吞吐、CPU、加载/持久化状态 | 判断副本是否具备长期追赶能力 |
| lag 很小但差值大 | ACK 时间、offset 时间点与字节率 | 时间新鲜不代表处理了全部数据；持续采样而不是看一帧 |
| WAIT 超时或返回较小值 | 同一连接、目标数、链路与副本进度 | 写入可能已执行，按业务语义处理，不能自动视为回滚 |
| NOREPLICAS | 两个 min-replicas 参数、在线副本和 ACK | 先恢复必要副本或明确接受降级风险，不默认关闭保护 |

副本跟随误删并不会提供一个独立历史恢复点；对它执行重新同步，也可能覆盖原本希望保留的数据。完整备份、故障隔离和数据校验见 [持久化备份与 Cluster 恢复专项](../04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md)。Sentinel 的选主机制另见 [监控与故障转移](./09-Redis-Sentinel监控与故障转移.md)。

## 7. 验收题 {/* #验收题 */}

### 7.1 PSYNC 何时退化为全量同步？

答案：不能识别请求的复制历史、旧历史超过允许截止位置、所需字节不在 Backlog，或没有可继续使用的同步状态时，都可能需要全量。身份可接受和字节范围足够必须同时考虑。

### 7.2 副本 lag 为 0 是否证明已落盘？

答案：不证明。它主要反映最近通信/ACK 时间，不是 AOF 刷盘状态；还要区分复制位点、内存应用和 fsync 确认。

### 7.3 WAIT 为什么不是强一致事务？

答案：它等待当前连接此前写入的复制确认，既不撤销超时前的写入，也不规定故障转移一定提升哪个副本，且不代表副本 fsync。它没有提供完整的共识提交和事务协议。

### 7.4 如何根据写流量估算 Backlog？

答案：使用峰值复制流字节率乘以目标断连时间并留余量，例如 `2 MiB/s × 30 s × 2 = 120 MiB`。再用实际保留范围、断链分布、内存和追赶能力验证，而不是用 QPS 直接替换字节率。

### 7.5 写入后换一个连接执行 WAIT，可以检查原写入吗？

答案：不能这样保证。WAIT 按当前连接的写入位置检查；连接池应让相关写入与等待使用同一物理连接，并处理断开后的未知结果。

### 7.6 min-replicas-to-write=1 是否等于每条写入都有一个副本确认？

答案：不是。它是基于在线副本及最近 ACK 条件的写入门槛，不是对当前写入位点逐条同步确认。配套 max-lag 也不是零数据丢失承诺。

### 7.7 WAITAOF 返回两个 1，是否可以不用备份？

答案：不可以。它说明相应本地与副本 AOF 确认条件达到，但误删、逻辑错误和共同故障仍可能影响这些副本；历史恢复点需要独立保留。

## 8. 参考资料 {/* #参考资料 */}

- [Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Redis 8.6.0 配置](https://github.com/redis/redis/blob/8.6.0/redis.conf)
- [WAIT](https://redis.io/docs/latest/commands/wait/)
- [WAITAOF](https://redis.io/docs/latest/commands/waitaof/)
- [INFO](https://redis.io/docs/latest/commands/info/)
