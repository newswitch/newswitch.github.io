---
title: "Redis Cluster、slot、Gossip、迁移与故障转移"
sidebar_label: "10. Redis Cluster、slot、Gossip、迁移与故障转移"
sidebar_position: 10
description: "从键的槽位计算走到 MOVED/ASK、在线迁移状态和多数派故障转移，解释路由、数据搬迁与热点治理的边界。"
tags: [Redis, Cluster, Slot, Gossip]
---

# Redis Cluster、slot、Gossip、迁移与故障转移

Redis Cluster 把 key 映射到 16,384 个 hash slot（哈希槽），再把槽分给不同主节点。槽是数据分片和路由的单位，不是连接数、线程数，也不是直接等于一台 Redis 服务器。

```text
key → hash slot → cluster slot map → master → optional replica
```

客户端负责选节点；目标节点校验路由；主从复制负责分片内冗余；集群总线负责交换拓扑和故障信息。这几条路径不能混为“所有节点互相同步所有数据”。

本文以 Redis Open Source 8.6 为基线，配置值核对 `8.6.0`。回环地址、端口、重定向和状态摘录均为教学示例。示例的 A、B 只是一个至少三主集群中的两个主节点，不是推荐两主部署；其他主和副本不在每段输出中重复展示。

## 1. 客户端路由 {/* #客户端路由 */}

### 1.1 从 key 算到 slot

普通键按 `CRC16/XMODEM(key) mod 16384` 算槽。若 key 的第一个 `{` 后存在 `}`，且两者之间非空，则只对括号内的字节计算，这部分叫 Hash Tag。

例如在已配置的测试 Cluster 上执行：

```bash
redis-cli -p 7000 CLUSTER KEYSLOT 'order:{42}:header'
redis-cli -p 7000 CLUSTER KEYSLOT 'order:{42}:items'
redis-cli -p 7000 CLUSTER KEYSLOT other
```

对应教学输出依次为：

```text
(integer) 8000
(integer) 8000
(integer) 11361
```

两个订单键都哈希 `42`，因此可以参与要求同槽的多 key 操作；键 `other` 属于另一槽。即使两个槽恰好由同一主节点持有，普通跨槽 `MGET`、事务或脚本也不能因此获得同槽语义，通常返回 `CROSSSLOT`。

`a{}b{42}` 的第一个括号对为空，不会继续找后面的 `42`，而是哈希整个 key。Hash Tag 是字节级规则，不是任意嵌套的模板语言。算法和边界见[Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)。

### 1.2 MOVED：修正槽映射

Cluster-aware 驱动通过 `CLUSTER SHARDS` 等接口建立槽到节点的映射。种子节点只帮助初次发现，不必是每个请求的固定中转站。

假设槽 8000 当前归 B（7001），客户端却把命令发到 A（7000），会收到类似：

```text
127.0.0.1:7000> GET order:{42}:header
(error) MOVED 8000 127.0.0.1:7001
```

它表示此节点当前认为槽 8000 的负责人是 B。驱动应到 B 重试，并修正该槽映射，必要时刷新完整拓扑；不是永远把这个键固定到 B，后续迁移或故障转移仍可能改变归属。

### 1.3 ASK：只为这一条请求临时改道

现在换一个时刻：槽 8000 正从 A 迁移到 B，名义负责人仍是 A，但这个键已经搬到 B。A 可能返回：

```text
127.0.0.1:7000> GET order:{42}:header
(error) ASK 8000 127.0.0.1:7001
```

此时在 B 上，用同一条 TCP 连接连续执行：

```text
127.0.0.1:7001> ASKING
OK
127.0.0.1:7001> GET order:{42}:header
"created"
```

`ASKING` 是这条连接上供下一条命令使用的一次性标记，允许正在 IMPORTING 的目标节点处理请求。不能分别运行两个独立的 `redis-cli` 进程来发送 `ASKING` 与 `GET`，也不能在连接池里先归还连接再借另一条。

收到 ASK 不应把整个槽永久改指向 B：同槽其他键可能还留在 A。迁移结束后，A 才会用 MOVED 引导客户端修改槽归属。[ASKING 命令](https://redis.io/docs/latest/commands/asking/)定义了这个连接级标记。

| 返回 | 当前含义 | 客户端动作 |
| --- | --- | --- |
| `MOVED` | 槽负责人在其他节点 | 跳转并修正映射，必要时刷新拓扑 |
| `ASK` | 迁移中的临时访问路径 | 在目标同连接执行 ASKING + 原命令，不永久修改整个槽 |
| `CROSSSLOT` | 多 key 不满足同槽要求 | 修改键设计或拆解业务，单纯重试无效 |
| `TRYAGAIN` | 如迁移期间同槽多 key 暂时分布在两端 | 有界退避重试并检查迁移状态，不当作普通读空 |

普通 TCP 负载均衡器不会自动理解这些协议。若驱动收到的重定向地址无法从应用网络访问，首个连接成功也会在后续路由时失败。

## 2. Gossip 与故障 {/* #gossip-与故障 */}

### 2.1 探测、传播和选举各负责什么

集群总线用于节点间探测、Gossip 与配置传播，不承载普通客户端命令。节点先形成本地 PFAIL 怀疑，再结合其他有投票资格主节点的报告确认 FAIL；合格副本可发起故障转移选举。配置纪元用于协调槽归属变化，不能把它当作业务事务的提交编号。

故障判断与副本提升都涉及拥有槽的主节点多数派，副本不是凭自身数量直接增加选票。三个主、三个副本的六进程集群，不是“存活四个进程就一定可写”。若某个分片的主与副本一起丢失，即使其他进程都健康，也无法凭空恢复这段数据。

| 条件 | 可能发生的结果 |
| --- | --- |
| 三主中一主失联，另两主互通，失联主有可达合格副本 | 多数派一侧具备授权提升的基础条件，仍需经历检测与选举 |
| 某一侧只有一台有槽主节点 | 不能因旁边还活着几个副本就自成授权多数派；写入会受到集群故障判定限制 |
| 主及其全部副本失去，产生不可服务槽 | 其他分片健康也不代表全槽可用，需结合覆盖策略与恢复能力判断 |

Cluster 不使用 Sentinel 选主。两者都出现“多数派”一词，不代表是同一组投票成员或同一套数据路由机制。

### 2.2 配置决定故障影响是否扩大到其他槽

以下是 `8.6.0 redis.conf` 中的基线值，不是为所有环境推荐的调整方案：

| 参数 | 基线 | 影响 |
| --- | --- | --- |
| `cluster-node-timeout` | 15000 毫秒 | 节点超时与相关故障处理的重要阈值，不是业务恢复时间承诺 |
| `cluster-require-full-coverage` | `yes` | 槽不能完整服务时，默认不让集群继续正常处理整体键空间请求 |
| `cluster-allow-reads-when-down` | `no` | 默认不在集群 down 状态下额外放行读；改为 yes 也不恢复写入或保证数据最新 |

将 `cluster-require-full-coverage` 改为 `no`，可以让仍可服务的槽在覆盖不全时继续工作；但不能恢复丢失分片，也不绕过多数派限制。是否允许部分可用应由业务对缺失数据的语义决定，而不是把报错压下去就算恢复。参数原意见[固定版本配置](https://github.com/redis/redis/blob/8.6.0/redis.conf)。

复制依然存在异步窗口。自动提升成功不等于旧主全部已确认写都存在于新主，确认与恢复边界见[主从复制与 PSYNC](./08-Redis主从复制PSYNC与一致性.md)。

## 3. Reshard {/* #reshard */}

### 3.1 一个槽不是一次整体搬完

以槽 8000 从 A 移到 B 为例，假设 `header` 和 `items` 两个同槽键最初都在 A：

| 阶段 | A 状态 | B 状态 | 两个键的位置 | 客户端主要观察 |
| --- | --- | --- | --- | --- |
| 稳定期 | 槽负责人 | 非负责人 | 都在 A | 按映射访问 A |
| 准备迁移 | MIGRATING 到 B | IMPORTING 自 A | 仍都在 A | 已有键由 A 正常服务 |
| 搬迁中 | 仍是名义负责人 | 接受 ASKING 请求 | header 在 B，items 在 A | A 对 header 返回 ASK；items 仍在 A 处理 |
| 完成并传播归属 | 不再负责该槽 | 成为负责人 | 都在 B | 旧映射访问 A 得到 MOVED |

准备阶段通常先让 B 进入 IMPORTING，再让 A 进入 MIGRATING。`CLUSTER SETSLOT` 的迁移标记、逐批数据搬迁、最终槽负责人发布是不同操作，不是给目标设置一个标记就自动搬完所有 key。

在搬迁中，A 能处理仍在本地的单 key 请求；本地没有该 key 时，让客户端临时去 B，因此新建键也会顺着重定向走向目标。多 key 命令即使属于同一个槽，若所需键暂时分散在两端，仍可能得到 `TRYAGAIN`。同槽是必要约束，不是迁移时跨两台执行的分布式事务。

### 3.2 标记与真实数据必须一起核对

`CLUSTER NODES` 会包含槽和迁移标记。下面只摘出相应节点本地视图中的标记后缀，省略其余列；A_ID/B_ID 代表实际 40 位节点 ID：

```text
A 本地行后缀：... [8000->-B_ID]
B 本地行后缀：... [8000-<-A_ID]
```

前者表示向外迁出，后者表示从指定源导入。不能要求每个节点查询到的每行都重复显示这两个本地迁移标记。应分别访问 A、B，对照拥有者、导入/迁出方向和键分布，再核对其余节点的归属视图。

`CLUSTER COUNTKEYSINSLOT 8000` 查看当前节点本地数量，不是全槽跨集群汇总；迁移中必须在源、目标分别观察。`CLUSTER GETKEYSINSLOT 8000 10` 可限量取样，不要把生产键值和敏感 ID 全量写进日志。

### 3.3 迁移超时不是业务回滚

常见在线 reshard 会利用 `MIGRATE` 搬运数据。大 key 传输、序列化以及目标恢复都会消耗 CPU、网络和内存，并可能阻塞相关节点的命令处理。小批次并不自动解决单个巨大 key 的耗时。

`MIGRATE` 的 timeout 表示传输过程中允许的最大空闲时间，不是整批迁移的严格总时长。出现 IOERR/超时后，键可能仍只在源，也可能在两端都存在；不能根据一个失败返回就直接删除目标，或者无条件加 `REPLACE` 覆盖。先核对双端状态、工具检查结果和数据版本，再决定续迁或修复。[MIGRATE 文档](https://redis.io/docs/latest/commands/migrate/)明确说明了这种不确定结果。

同样，`CLUSTER SETSLOT ... STABLE` 只是清除本地导入/迁出状态，不会把已搬走的键搬回来；`NODE` 修改槽负责人也不等于完成数据校验。不要通过手改 `nodes.conf` 或清标记来掩盖未完成迁移。[SETSLOT 参考](https://redis.io/docs/latest/commands/cluster-setslot/)区分了这些操作。

## 4. 热点 {/* #热点 */}

slot 数量均匀只说明哈希范围分配接近，不说明请求、数据量和命令代价均匀。一个槽可能只有几个小键，也可能有巨型集合或极高频热点。

先区分三类不均衡：请求数倾斜看客户端按 key/槽的统计；CPU 倾斜还要看命令复杂度与大 key；网络倾斜还要看返回值大小和复制。不能只按 `INFO commandstats` 的全节点聚合结果猜具体热键，也不应为了找热键长期开全量 MONITOR。

Hash Tag 既能让一个订单的相关键放在同槽，也能把所有订单错误地挤到一个槽。`order:{42}:...` 按订单分散；`order:{all}:...` 把所有订单绑定在一起。移动这个槽能改变由哪台主承压，不能把一个槽或单个热键自动拆成多个并行主。

本地缓存、请求合并、业务拆键和限流各有代价；读副本还需接受复制延迟，并让驱动明确使用相应读路径。不能把“增加副本”当成所有热点写操作都能分摊。

## 5. Cluster 实验与安全扩缩容 {/* #cluster-实验与安全扩缩容 */}

### 5.1 先做只读基线检查

在已部署的隔离测试集群上执行；完整建群步骤见[多种部署方式](./11-Redis-APT-RPM源码Docker-Sentinel-Cluster与Kubernetes部署.md)。示例省略认证参数，线上应保留认证/TLS 与最小权限。

```bash
redis-cli --cluster check 127.0.0.1:7000
redis-cli --cluster info 127.0.0.1:7000
redis-cli -p 7000 CLUSTER INFO
redis-cli -p 7000 CLUSTER SHARDS
redis-cli -p 7000 CLUSTER NODES
redis-cli -p 7000 CLUSTER COUNTKEYSINSLOT 8000
```

一个三主三副本集群的健康状态摘录可以是：

```text
cluster_state:ok
cluster_slots_assigned:16384
cluster_slots_ok:16384
cluster_slots_pfail:0
cluster_slots_fail:0
cluster_known_nodes:6
cluster_size:3
```

`cluster_size` 是至少拥有一个槽的主节点数；`cluster_known_nodes` 包括已知主和副本，不能拿 6 代替选举中的有槽主数量。`cluster_slots_assigned` 只证明分配了槽，还要一起看是否正常服务、是否存在故障报告。

`CLUSTER SHARDS` 提供分片、槽范围和节点端点等结构化信息；老客户端可能仍使用 `CLUSTER SLOTS`。无论用哪种，应用都要能访问返回的所有业务地址。集群总线通常使用业务端口加 10000，亦可显式配置；仅放通 7000、遗漏节点间总线端口，可能导致客户端能连但节点无法正常组网。announce、NAT、证书和跨网络路由应分别核对。

### 5.2 用一小段迁移验证完整链路

先确认目标容量、源与目标复制/持久化状态以及备份。持续产生带唯一业务 ID 的测试请求，再由已验证的集群管理工具迁移少量槽，观察上述状态，而不是直接在生产手敲一套未经验证的 SETSLOT/MIGRATE 序列。

| 阶段 | 必须保存的证据 | 不能接受的替代判断 |
| --- | --- | --- |
| 迁移前 | 拓扑、槽负责人、复制健康、容量和延迟基线 | “目标进程已经启动” |
| 迁移中 | 双端迁移标记、本地键数、ASK/TRYAGAIN、P99、超时和复制延迟 | “控制台进度条还在动” |
| 迁移后 | 全槽覆盖、无遗留导入/迁出、各方负责人收敛、旧路由得到正确 MOVED | “工具退出码为 0” |
| 业务验证 | 已确认请求逐条对账、重复效果与错误率回归 | “最终最大业务 ID 一样” |

实验前约定延迟、错误率、内存和复制延迟停止线。遇到异常先暂停新增迁移并保留当前状态，再按工具支持的恢复路径处理，不把“清除迁移标记”等同于回滚。

迁移完成后再分别验证单主故障、主从同域故障与网络分区。在线搬迁、故障转移和备份恢复是不同能力，不能用一次成功扩容代替全部验证。

## 6. 验收题 {/* #验收题 */}

### 6.1 MOVED 与 ASK 的语义差异是什么？

答案：MOVED 指向节点当前认为的槽负责人，客户端应修正槽映射；ASK 是迁移中的临时跳转，应在目标同连接发送 ASKING 后执行原命令，不永久修改整个槽。迁移期间同槽不同键可能仍在两端。

### 6.2 Hash Tag 如何同时解决跨 key 和制造热点？

答案：它让相关键哈希同一非空标签，满足多 key 操作的同槽要求；但若大量业务都使用固定标签，也会把所有相关请求集中到一槽。标签粒度应围绕真正需要共同操作的数据，不是越大越方便。

### 6.3 为什么 slot 均匀而 CPU 仍可能倾斜？

答案：不同槽的键数、访问频率、值大小和命令复杂度不同。单个热键或高代价命令即可压满一台主；迁槽只能移动压力位置，不能自动把该键的写执行拆散。

### 6.4 网络分区时多数派怎样影响写可用性？

答案：拥有槽的主节点多数派参与故障判断与故障转移授权；副本数量不直接替代主节点选票。少数派不能独立完成合法提升，检测后写入会受限制；多数派一侧还需有合格副本和可服务槽，full-coverage 等配置进一步决定请求范围。

### 6.5 为什么分别执行两个 redis-cli，ASKING 就可能无效？

答案：ASKING 标记属于当前连接的下一条命令。两个独立 redis-cli 使用不同连接，GET 看不到前一个连接的标记；连接池换连接也有同样问题。应让驱动在目标同连接完成这两个步骤。

### 6.6 清掉迁移标记就算回滚了吗？

答案：不是。STABLE 只清本地迁移状态，不返还已经搬走的数据；修改槽负责人也不自动修复双端键分布。需核对状态、数据和工具恢复流程，尤其不能在 MIGRATE 超时后盲目覆盖或删除一端。

### 6.7 两个键同槽，迁移时为什么仍可能 TRYAGAIN？

答案：当一个键已在目标、另一个仍在源时，当前节点无法在本地执行整个多 key 操作。此时可返回 TRYAGAIN，让客户端有界退避；这不同于键本来就在不同槽的 CROSSSLOT，也不代表查询结果为空。

## 7. 参考资料 {/* #参考资料 */}

- [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Scaling with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [Redis 8.6.0 配置](https://github.com/redis/redis/blob/8.6.0/redis.conf)
- [ASKING](https://redis.io/docs/latest/commands/asking/)
- [CLUSTER SETSLOT](https://redis.io/docs/latest/commands/cluster-setslot/)
- [MIGRATE](https://redis.io/docs/latest/commands/migrate/)
- [CLUSTER INFO](https://redis.io/docs/latest/commands/cluster-info/)
