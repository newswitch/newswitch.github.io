---
title: "Sentinel 监控、主观/客观下线与故障转移"
sidebar_label: "09. Sentinel 监控、主观/客观下线与故障转移"
sidebar_position: 9
description: "沿故障判定、选举授权、副本选择和客户端恢复理解 Sentinel，结合配置、查询输出与网络分区解释高可用边界。"
tags: [Redis, Sentinel, Failover]
---

# Sentinel 监控、主观/客观下线与故障转移

Sentinel 为不分片的 Redis 主从拓扑提供监控、通知、故障转移和客户端发现。它解决的是“主节点不可用后，谁来提升副本，以及应用如何找到新主”，不负责把请求代理到 Redis，也不存储业务数据。

先分清三类参与者：Redis 主从节点负责数据与复制；Sentinel 进程负责观察和协调；应用驱动负责发现、连接与重试。Sentinel 宣布切换完成，不等于所有应用连接都已恢复，更不等于已确认写入绝不丢失。

本文以 Redis Open Source 8.6 为核对基线，配置默认值来自 `8.6.0` 的配置文件。地址、位点和输出是教学示例，不是生产故障记录。实际部署、ACL 与端口规划见[Redis 单机、主从、Sentinel 与 Cluster 部署](./11-Redis-APT-RPM源码Docker-Sentinel-Cluster与Kubernetes部署.md)。

## 1. 状态机 {/* #状态机 */}

### 1.1 故障判定与选举授权不是同一轮计票

| 阶段 | 谁得出结论 | 结论允许做什么 |
| --- | --- | --- |
| SDOWN，主观下线 | 某一个 Sentinel | 本地认为目标持续没有正常响应；不是集群共同结论 |
| ODOWN，客观下线 | 某个 Sentinel 收集到足够同伴的判断 | 认为主节点故障达到该主配置的 quorum，进入故障转移协调 |
| 选举故障转移 leader | Sentinel 之间按选举轮次授权 | 选出本轮执行提升、重配置的 Sentinel，必须取得多数派授权 |
| 提升 Redis 副本 | 获授权的 Sentinel 协调 | 把一个合格副本提升为新主，再调整其余复制关系 |

SDOWN 不只是“某个 TCP 连接刚刚断了一次”。Sentinel 根据探测和正常响应时间判断是否持续达到 `down-after-milliseconds`；繁忙、网络隔离、进程暂停等都可能造成相似现象。ODOWN 是对故障主节点的联合判断，不是“Sentinel 检查业务读写完全正确”。

在成员视图稳定、已知 Sentinel 总数为 N 时，多数派数量为 `floor(N / 2) + 1`。quorum 用于 ODOWN；执行切换还需要选举授权。因此不能把“quorum 配为 2”理解成“永远只有两台 Sentinel 就能切主”，也不能只以当前可达的 Sentinel 数量重新计算分母。

以下把“可达数量”限定为同一侧能够互通、认定主故障并参与协调的 Sentinel，暂不考虑副本资格等其他条件：

| 已知总数 N | quorum | 这一侧可达数 | 能否达到 ODOWN 票数 | 能否完成多数派授权 |
| --- | --- | --- | --- | --- |
| 3 | 2 | 2 | 能 | 能，需要 2 票 |
| 3 | 2 | 1 | 不能 | 不能 |
| 5 | 2 | 2 | 能 | 不能，需要 3 票 |
| 5 | 4 | 3 | 不能 | 虽有 3 个成员，也不能跳过 ODOWN 条件 |

这些是计票条件，不是完整可用性证明：没有合格副本、Sentinel 到副本不通或客户端无法访问新地址，仍会失败。[官方 Sentinel 文档](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)分别定义了 quorum、授权多数派和选举过程。

### 1.2 从发现到恢复的两个分支

```text
持续探测异常
  → 某个 Sentinel 标记 SDOWN
  → 达到 quorum，判断主节点 ODOWN
  → 获取本轮多数派授权，选出执行切换的 Sentinel
  → 选择合格副本，确认其已提升为主
      ├─ 调整其他副本的复制上游
      └─ 客户端发现新地址，重建连接并恢复请求
```

后两个过程相关但不能画成严格的“全部副本同步完成后，客户端才能访问”。副本重配置可能仍在进行，应用也可能仍握着旧地址。应分别记录新主可写、拓扑收敛和应用恢复三个时刻。

### 1.3 为什么不是简单选择 offset 最大的副本

Sentinel 先排除不合格候选，例如已下线、长期失联、复制连接状态不满足要求的副本；`replica-priority 0` 表示永不参与提升。对合格候选，再按以下顺序比较：

1. `replica-priority` 数值更小的优先。
2. 优先级相同，复制 offset 更大的优先。
3. 两者相同，以 run ID 的字典序打破平局。

例如下面三个副本中，假设连接状态等条件均合格：

| 副本 | replica-priority | 已处理 offset | 能否被提升 |
| --- | --- | --- | --- |
| R1 | 100 | 9,950,000 | 可参与，但优先级排在 R2 后 |
| R2 | 10 | 9,900,000 | 按此表会优先选择 |
| R3 | 0 | 9,999,000 | 不参与提升 |

这说明优先级配置会影响数据新鲜度的取舍。offset 也不是脱离复制身份与历史就能通用比较的业务版本号；它的含义见[主从复制、PSYNC 与一致性](./08-Redis主从复制PSYNC与一致性.md)。

### 1.4 四个常用参数分别控制哪一段

| 参数 | 8.6.0 配置基线 | 含义与边界 |
| --- | --- | --- |
| `sentinel monitor mymaster <ip> <port> <quorum>` | 示例配置 quorum 为 2，不是所有部署固定为 2 | 声明逻辑主名、初始主地址和 ODOWN 票数 |
| `sentinel down-after-milliseconds mymaster 30000` | 30,000 毫秒 | 本地持续异常的判断阈值；不是一次请求的超时 |
| `sentinel failover-timeout mymaster 180000` | 180,000 毫秒 | 参与故障转移重试、推进与重配置阶段的超时控制；不是业务恢复时限承诺 |
| `sentinel parallel-syncs mymaster 1` | 1 | 切换后同时向新主重配置的副本数量；不是选举票数或客户端并发数 |

下面仅是隔离实验的配置片段，不是可直接投产的完整文件。它把检测阈值改为 5 秒、故障转移相关超时改为 60 秒，便于观察；真实环境必须依据暂停、抖动和业务容忍度确定：

```conf
sentinel monitor mymaster 127.0.0.1 16379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
```

三台 Sentinel 不能各把 `127.0.0.1` 当成同一台远程主机；这里的回环地址只表示同机端口实验。跨主机部署应使用各方都能访问的地址，并配置认证、访问控制和可写的 Sentinel 配置文件。Sentinel 会自动发现成员并重写配置，不能把运行配置仅当成永远不变的静态模板。[8.6.0 sentinel.conf](https://github.com/redis/redis/blob/8.6.0/sentinel.conf)解释了这些参数及重写要求。

## 2. 客户端 {/* #客户端 */}

应用通常配置多个 Sentinel 地址、逻辑主名 `mymaster`，以及必要的认证/TLS 信息，而不是把一个 Redis IP 当成永不变化的主地址。

一次恢复至少涉及四件事：

1. 从可达 Sentinel 查询当前主地址，并校验目标角色，避免使用过期视图。
2. 清理指向旧主的连接池，给新主建立经过认证的连接。
3. 根据业务语义重试失败请求；限制次数、总时长与并发，避免切换时形成重试风暴。
4. 核对未知结果：客户端超时之前的命令可能已经执行，不能把所有超时都当作未执行。

例如 `INCR` 已在旧主执行、响应未到客户端，盲目重试可能再次加一；也可能旧主的写尚未复制就被替换。连接恢复只解决“往哪里发”，业务幂等与对账解决“之前到底发生了什么”。

Sentinel 的认证与业务 Redis 的认证是两条连接路径，Redis 主从复制还有自己的认证。能查询 Sentinel 不代表能登录新主。SDK 不支持 Sentinel、容器暴露地址不可达、TLS 证书名称不匹配、连接池继续用旧连接，都可能造成“控制面切换成功，应用仍失败”。

## 3. 网络分区 {/* #网络分区 */}

假设主 M 与两个 Sentinel 隔离，却仍能被一部分应用访问；其余 Sentinel 能互通，也能访问副本 R。多数派提升 R 时，M 不一定知道自己已被替代，仍可能接受旧客户端写入。

此时存在两条历史：M 上的分区写入与 R 上的新写入。网络恢复后，M 通常会被重新配置为副本并跟随新主，不会自动把两边的业务修改合并。旧主分区期间确认过的写可能被覆盖。

| 措施 | 可以减少什么风险 | 不能保证什么 |
| --- | --- | --- |
| Sentinel 跨故障域 | 一台主机、一个机架故障同时带走所有观察者 | 不自动阻止旧主继续写 |
| `min-replicas-to-write` / `min-replicas-max-lag` | 主缺少足够健康副本时停止接受写 | 不是逐条同步提交协议，也不是绝对 fencing |
| 同连接 `WAIT` 或 `WAITAOF` | 检查指定范围的复制/落盘确认 | 不保证被确认的副本最终一定成为主 |
| 隔离旧写入口、可验证的写入 fencing | 限制旧拓扑继续产生修改 | 需要业务/平台真正实施，Sentinel 不替应用完成 |
| 业务幂等、流水与对账 | 降低重复效果，发现已确认写缺口 | 幂等本身不能找回已丢失的数据 |

`WAIT`/`WAITAOF` 的连接与超时边界见[复制确认](./08-Redis主从复制PSYNC与一致性.md)；进程、操作系统和主机故障下的落盘边界见[RDB、AOF 与 COW](../02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md)。不能把这些功能简单相加后宣称“强一致、零丢失”。

## 4. 演练证据 {/* #演练证据 */}

不要只保存一行 `+switch-master` 就结束调查。至少建立以下证据对应关系：

| 需要回答的问题 | 观察点 | 常见误判 |
| --- | --- | --- |
| 谁先发现异常 | 各 Sentinel 的 `+sdown`、`+odown` 事件与探测状态 | 把一台的 SDOWN 当成全部成员的结论 |
| 谁执行了切换 | `+try-failover`、`+elected-leader` 及选举轮次 | 只看到重试事件就认为选举成功 |
| 为什么选这个副本 | `+selected-slave`、候选连接状态、优先级和复制位点 | 只按 offset 大小猜测 |
| 主角色是否真的改变 | 提升事件、目标的 `ROLE` / `INFO replication` | 新进程能连上就等于新主可用 |
| 应用何时恢复 | 地址查询、连接池刷新、错误率、首个成功业务请求 | 用控制面事件代替业务恢复时间 |
| 写是否完整 | 客户端确认流水与恢复后的业务 ID 集合 | 最大序号相同就认为中间没有缺口 |

事件名中仍可能出现历史用语 `slave`，这是日志字段，不代表应在配置中任意替换命令名称。将不同机器时间对齐，再计算检测、选举提升、连接恢复分别耗时多少。不要把 `failover-timeout` 直接填进 RTO 报表。

主进程退出、主机失联、只隔离旧主、Sentinel 少数派失联，必须分开验证。它们影响的探测、数据和客户端路径不同。在隔离实验中保留持续写入的请求 ID、是否收到成功响应，以及恢复后的逐条结果，才能测出实际丢写或重复效果。

## 5. 可重复的 Sentinel 演练 {/* #可重复的-sentinel-演练 */}

### 5.1 先确认视图，不先停服务

准备至少一个主、两个副本和三个 Sentinel。多端口单机实验可以观察协议，不能证明跨故障域高可用；生产部署应分散故障域。下面查询均为只读观察，示例省略认证参数，不应因此关闭认证。

```bash
redis-cli -p 26379 SENTINEL MASTER mymaster
redis-cli -p 26379 SENTINEL SENTINELS mymaster
redis-cli -p 26379 SENTINEL REPLICAS mymaster
redis-cli -p 26379 SENTINEL CKQUORUM mymaster
redis-cli -p 26379 SENTINEL GET-MASTER-ADDR-BY-NAME mymaster
```

`GET-MASTER-ADDR-BY-NAME` 在切换前的教学输出：

```text
1) "127.0.0.1"
2) "16379"
```

`CKQUORUM` 在三个成员都可用时的教学输出：

```text
OK 3 usable Sentinels. Quorum and failover authorization can be reached
```

这表示查询时该 Sentinel 认为计票条件可满足，不是主动执行了一次故障转移，也不证明副本数据完整。

`MASTER` 返回键值数组，以下为便于阅读整理的字段摘录，不是完整终端输出：

| 字段 | 示例 | 解读 |
| --- | --- | --- |
| `name` | `mymaster` | 客户端配置的逻辑主名 |
| `ip` / `port` | `127.0.0.1` / `16379` | 该 Sentinel 当前记录的主地址 |
| `flags` | `master` | 此例未标记下线；出现 `s_down`、`o_down` 时需继续取证 |
| `quorum` | `2` | 此主的 ODOWN 阈值 |
| `num-other-sentinels` | `2` | 已知其他 Sentinel 数量，不包含查询对象自己 |
| `num-slaves` | `2` | 已知副本数量；字段沿用历史名称 |
| `down-after-milliseconds` | `5000` | 该实验的检测阈值 |

在 26380、26381 上重复查询并比较。不同视图、认证失败或成员发现不完整时，先解决观察与连通问题；不能只看第一台的结果。

### 5.2 再在隔离环境观察一次切换

保留持续业务请求记录，再通过实验平台停止测试主进程；不要直接在生产照做。观察 SDOWN、ODOWN、选举、提升与客户端恢复，并查询新地址。假设测试副本 16380 被选中，地址结果应变为：

```text
1) "127.0.0.1"
2) "16380"
```

继续确认 16380 的角色为主、其余副本的上游变为新主，旧主恢复后不再接收旧拓扑写入。最后核对业务流水：既查“已确认却缺失”的 ID，也查“重复产生业务效果”的 ID。只有地址变了，不算完成验证。

若只有 SDOWN 没有 ODOWN，检查 quorum 与 Sentinel 互通；已有 ODOWN 却没有提升，继续查授权多数派、候选资格与选举重试；已经提升但业务仍失败，转向客户端、地址、认证与连接池。按阶段缩小范围，比反复重启所有进程更能保留证据。

## 6. 验收题 {/* #验收题 */}

### 6.1 SDOWN、ODOWN、quorum 和 majority 有何区别？

答案：SDOWN 是单个 Sentinel 的主观判断；ODOWN 是对主故障收集到足够判断后的结论，阈值由 quorum 决定。执行切换还必须取得 Sentinel 多数派的本轮授权。五个已知 Sentinel、quorum 为 2 时，两台可以形成 ODOWN 判断，却不足以取得三票授权。

### 6.2 Sentinel 切换成功为什么仍可能丢写？

答案：Redis 复制通常异步，旧主已确认但未到达被提升副本的写可能丢失；网络分区中旧主还可能继续产生写入，重新加入后这段历史不会自动合并。成功提升与数据零损失是两个不同条件，应通过确认策略、旧写隔离和业务对账量化边界。

### 6.3 为什么 Sentinel 必须跨故障域？

答案：三个进程若在同一台主机，主机故障就同时失去全部观察者和授权者。分散主机、机架等故障域是为了避免一次故障破坏多数派；数据主从也需分散，否则只剩健康 Sentinel 仍无可提升副本。

### 6.4 客户端需做哪些切换动作？

答案：按逻辑主名查询新主，验证角色，刷新连接池并完成认证/TLS，使用有界重试和退避，同时处理命令结果未知。重连不是事务回滚，非幂等写入不能见到超时就无条件重放。

### 6.5 offset 最大的副本一定先被提升吗？

答案：不是。先做候选资格过滤，优先级 0 不参与；合格副本按优先级数值从小到大选择，同优先级才比较 offset，最后用 run ID 打破平局。优先级较高的候选可能比另一候选更落后。

### 6.6 failover-timeout 设为 60 秒，业务一定在 60 秒内恢复吗？

答案：不是。该参数影响切换状态推进与重试等内部行为；检测、选举竞争、副本提升、连接池刷新和业务重试还有各自耗时。业务恢复必须从实际请求证据测量，不能只读取一个配置值。

### 6.7 CKQUORUM 返回 OK，能证明不会脑裂或丢数据吗？

答案：不能。它只检查当前可用 Sentinel 是否满足 quorum 与授权条件，不验证旧主已被隔离、未来网络是否正常、候选数据是否最新，更不替代应用幂等、落盘与恢复验证。

## 7. 参考资料 {/* #参考资料 */}

- [Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis 8.6.0 Sentinel 配置及注释](https://github.com/redis/redis/blob/8.6.0/sentinel.conf)
- [Redis 8.6.0 Redis 配置：replica-priority 与写入约束](https://github.com/redis/redis/blob/8.6.0/redis.conf)
- [Sentinel 客户端规范](https://redis.io/docs/latest/develop/reference/sentinel-clients/)
