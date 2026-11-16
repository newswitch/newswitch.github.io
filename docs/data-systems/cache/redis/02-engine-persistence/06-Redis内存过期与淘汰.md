---
title: "Redis 内存管理、maxmemory 与淘汰策略"
sidebar_label: "06. 内存管理、maxmemory 与淘汰策略"
sidebar_position: 6
description: "解释 maxmemory、allkeys 与 volatile、LRU、LFU、LRM、随机、TTL 和 noeviction，结合配置、输出与指标理解淘汰和 OOM。"
tags: [Redis, jemalloc, 内存, maxmemory, LRU, LFU, LRM, 过期, 淘汰]
---

# Redis 内存管理、maxmemory 与淘汰策略

Redis 的内存策略要回答三个不同的问题：**什么时候需要回收、哪些键可以被回收、优先回收谁**。`maxmemory` 决定内存压力边界，`maxmemory-policy` 决定候选范围与选择方式，TTL 则决定键的有效期限。它们不能相互替代。

本文以 Redis Open Source 8.x 为主线：先解释 8.0 已有的八种策略，再单独说明 **8.6 起新增的 `allkeys-lrm`、`volatile-lrm`**。托管服务可能限制可配置项，实际生效值应从目标实例读取。命令示例使用隔离实验实例 `127.0.0.1:16379`，输出中的数值和键名用于说明，不代表生产默认配置。

## 1. 内存指标与分配路径 {/* #指标 */}

```text
logical objects → allocator allocations → RSS pages
                                  ├─ fragmentation
                                  ├─ retained pages
                                  └─ COW during fork
```

Key/Value 只是内存的一部分。对象元数据、过期信息、连接缓冲、复制/AOF 缓冲、分配器碎片与进程运行开销都要占空间；fork 后被写入的共享页还会产生 Copy-on-Write，简称 COW。

| 指标 | 主要含义 |
| --- | --- |
| `used_memory` | Redis 分配器统计的内存，不只是 Value 大小 |
| `used_memory_dataset` | 数据集部分，不含全部运行开销 |
| `used_memory_rss` | 操作系统观察到的 Redis 常驻内存 |
| `mem_not_counted_for_evict` | 未计入淘汰判断的特定缓冲，仍然占用实际内存 |
| `maxmemory` | 配置的淘汰/拒写边界，不是进程 RSS 硬上限 |

jemalloc 等分配器释放对象后，不一定立刻把所有页归还操作系统。因此键已经减少、`used_memory` 下降，而 RSS 没有同步下降，并不矛盾。进一步查看 allocator 指标，而不是单凭碎片比例就断定泄漏。字段定义见 [INFO memory](https://redis.io/docs/latest/commands/info/)。

## 2. 先分清过期与淘汰 {/* #ttl */}

**过期**是有效期到了，例如验证码 5 分钟后失效；**淘汰**是内存有压力时，按策略提前移除键。一个设置 1 小时 TTL 的缓存，可能在第 10 分钟就被淘汰；也可能因为没有内存压力，一直保留到过期。

Redis 结合访问时检查与主动过期处理，不是为每个键建立一个独立精确定时器。大量键同时到期会造成集中处理与回源压力，可在业务允许时为 TTL 加抖动。

下面三个键可用于区分候选范围，写操作只在实验实例执行：

```bash
redis-cli -h 127.0.0.1 -p 16379 SET lab:product:1 cached EX 3600
redis-cli -h 127.0.0.1 -p 16379 SET lab:product:2 cached EX 60
redis-cli -h 127.0.0.1 -p 16379 SET lab:account:1 durable
redis-cli -h 127.0.0.1 -p 16379 TTL lab:account:1
```

最后一条返回 `-1` 表示键存在但没有过期时间；`-2` 表示键不存在。`PTTL` 使用毫秒。普通 `SET` 覆盖已有键时会移除原 TTL，除非使用适当的过期参数或 `KEEPTTL`，所以应用更新方式也会改变 `volatile-*` 的候选集合。[TTL](https://redis.io/docs/latest/commands/ttl/) 和 [SET](https://redis.io/docs/latest/commands/set/) 的语义应一起理解。

## 3. maxmemory 与淘汰策略 {/* #淘汰 */}

### 3.1 maxmemory 决定什么时候处理内存压力

配置片段如下，不是完整生产配置：

```text
maxmemory 64mb
maxmemory-policy allkeys-lru
```

这里的 `64mb` 是 `64 × 1024 × 1024 = 67108864` 字节。Redis 配置中 `1m` 与 `1mb` 不同，前者是 1000000 字节，后者是 1048576 字节，单位大小写不敏感。不要按其他软件的单位习惯推断，见 [8.0 配置文件的单位说明](https://github.com/redis/redis/blob/8.0.0/redis.conf)。

`maxmemory=0` 表示不设置这个内存上限，并不是容量为零，也不是能使用无限物理内存。即使设置了非零值，一条大命令、缓冲和分配器行为也可能让实际内存暂时超过它。

淘汰记账也不是单纯拿 `used_memory_dataset` 与上限比较。特定复制/AOF 缓冲会从淘汰判断中排除，避免淘汰生成更多复制命令、缓冲变大、继而继续淘汰的反馈循环；排除的是记账，不是实际占用。实现可从 [8.6 的 getMaxmemoryState 与 performEvictions](https://github.com/redis/redis/blob/8.6.0/src/evict.c) 阅读。

### 3.2 allkeys 与 volatile 决定谁有资格

`allkeys-*` 面向实例中的所有普通键，有没有 TTL 都可以进入候选范围。`volatile-*` 只考虑设置了键级过期时间的键，**不要求这些键已经过期**。

在前面的例子中：

- `allkeys-lru` 可以选择三个键中的任何一个，再按 LRU 近似规则排序。
- `volatile-lru` 只考虑两个 product 键；无 TTL 的 account 键不参与这种淘汰。
- `volatile-ttl` 也只考虑两个 product 键，但选择依据是剩余 TTL，不是访问时间。

`volatile` 在这里不是“没有持久化”的意思。一个键是否写入 RDB/AOF，与它是否有 TTL 是不同维度。

候选空间以实例为边界，而不是某个业务前缀。Redis 的多个逻辑数据库不构成独立内存配额；Cluster 则要分别给各节点做预算，不能把一个节点的 `maxmemory` 当作全群总容量。

### 3.3 八种常见策略对照

| 策略 | 候选范围 | 如何选择 |
| --- | --- | --- |
| `noeviction` | 不主动选键淘汰 | 内存不足时拒绝相应的受 OOM 限制命令 |
| `allkeys-lru` | 所有键 | 优先选择较久未访问的键 |
| `volatile-lru` | 有 TTL 的键 | 在候选中优先选择较久未访问的键 |
| `allkeys-lfu` | 所有键 | 优先选择近似访问频度较低的键 |
| `volatile-lfu` | 有 TTL 的键 | 在候选中优先选择近似访问频度较低的键 |
| `allkeys-random` | 所有键 | 随机选择 |
| `volatile-random` | 有 TTL 的键 | 在候选中随机选择 |
| `volatile-ttl` | 有 TTL 的键 | 优先选择较早到期的键 |

这张表描述排序方向，不承诺实际每次都选出全局最优对象。策略枚举及默认 `noeviction` 可对照 [8.0 配置](https://github.com/redis/redis/blob/8.0.0/redis.conf)；配置映射实现见 [config.c](https://github.com/redis/redis/blob/8.6.0/src/config.c)。

### 3.4 LRU 看最近访问，LFU 看频度

**LRU，Least Recently Used，最近最少使用**。假设 A 曾经很热门，但已有 10 分钟没人访问；B 刚被访问过一次。LRU 更倾向回收 A。它适合近期访问能够预测后续访问的缓存，但一次全量扫描可能让大量只读一次的冷数据看起来很新。

Redis 不给每个键维护完整的精确 LRU 排序链，而是抽样并维护候选池，以节省成本。`maxmemory-samples` 影响近似质量，增大采样可能增加 CPU 消耗；不能说设置为 10 就变成精确 LRU。[近似算法实现](https://github.com/redis/redis/blob/8.0.0/src/evict.c)中可以看到采样与候选池的分工。

**LFU，Least Frequently Used，最不经常使用**。它更关注一段历史中的访问热度，适合热点相对稳定的工作负载；热点快速迁移时，历史热度也可能成为负担。Redis 的 LFU 使用概率增长的对数计数与衰减，不是完整的 GET 次数累加器。

`lfu-log-factor` 控制增长曲线，`lfu-decay-time` 控制衰减时间尺度。8.0 配置中的默认值分别为 10 与 1，后者单位为分钟，不是键的 TTL。先使用默认值观察，不要把“计数衰减”误解成“数据自动删除”。使用 `OBJECT FREQ key` 可观察 LFU 分数，但它仅适用于 LFU 策略；`OBJECT IDLETIME key` 不能直接替代它。[OBJECT FREQ](https://redis.io/docs/latest/commands/object-freq/) 与 [OBJECT IDLETIME](https://redis.io/docs/latest/commands/object-idletime/)有不同适用条件。

### 3.5 random、volatile-ttl 与 noeviction

**随机策略**不区分业务热度或大小。它的选择规则简单，适用于没有明显热点、可接受随机丢失缓存的情形，但没有“随机必然命中率更高或延迟更低”的保证。`volatile-random` 同样不能回收无 TTL 的键。

**volatile-ttl**把剩余有效期当作选择线索。若 A 剩余 5 秒、B 剩余 1 小时，在两者都进入候选时更倾向回收 A；不是等 A 到期才开始淘汰。它适合业务确实用 TTL 表达缓存保留优先级的情况，不会自动识别昂贵查询或高价值数据。刚写入的短 TTL 键也可能比老的长 TTL 键先被回收。

**noeviction**选择保留现有键，而不是靠淘汰维持写入。内存不足时，像 SET 这样带相应 OOM 检查的命令可能被拒绝，读与释放数据的命令仍有不同处理路径。不要简化为“所有命令都失败”或“只禁止新增键，更新已有键永远成功”。应用必须处理写失败，并做容量扩展、数据清理或限流。

拒写也不等于数据永远不丢。带 TTL 的键仍然会过期，客户端仍可删除，持久化和复制仍有自己的故障边界。策略只决定内存压力下是否主动淘汰。

### 3.6 Redis 8.6 新增 LRM

**LRM，Least Recently Modified，最近最少修改**，使用 `allkeys-lrm` 或 `volatile-lrm`。它像 LRU 一样比较时间，但关注最近修改，而不是最近访问；重复读取不会像 LRU 那样刷新修改时间。它也使用近似采样，受 `maxmemory-samples` 影响。[官方 LRM 说明](https://redis.io/docs/latest/develop/reference/eviction/#lrm-eviction)明确了 8.6 的版本边界。

例如 A 两小时前写入、现在每秒被读取；B 刚被修改过但读得少。LRU 可能继续保留 A，LRM 则不会因为 A 的高读取频率就保护它。只有当业务确实愿意优先保留近期修改的数据时，LRM 才符合目标。

LRM 不是数据新鲜度协议：Redis 不知道后端数据库是否已经更新，更不会因为选择 LRM 就自动刷新缓存。8.0、8.2 等旧版本也不能直接使用这两个名称，应先确认版本，不能照着较新文档强行配置。

### 3.7 没有候选键时会发生什么

最典型的情况是 `volatile-lru` 配合大量无 TTL 的键。即使这些键很久没人访问，也不在候选范围内。如果所有符合条件的键都回收后仍不够，相关写入仍会被拒绝，表现类似 noeviction。

```text
(error) OOM command not allowed when used memory > 'maxmemory'.
```

这是 Redis 命令层的示意错误，不等于进程已经被操作系统杀死。另一类是内核或容器因实际内存超限终止进程，客户端通常看到断连，Kubernetes 可能记录 `OOMKilled`。更换淘汰策略不能自动修复后者。

`allkeys-*` 也不是写入永不失败的保证：值过大、非数据开销、内存分配失败等都可能让释放仍然不足。具体命令还受版本、命令标志与事务/脚本上下文影响。

### 3.8 先按业务选择，再用负载验证

纯可重建缓存，可先比较 allkeys-lru 与 allkeys-lfu，观察近期性和稳定热点哪个更能预测后续访问。若要求按修改活跃度保留，再评估支持版本中的 LRM。它们都不是“越新越好”的替换关系。

若缓存与需要保护的键混在一个实例，volatile 策略可以限制候选范围，但前提是 TTL 管理可靠；非 TTL 数据持续增长时仍可能拒写。更强的资源与故障隔离应通过独立实例实现，而不只是命名前缀。

对于不可随意丢弃的任务、幂等记录、会话等数据，先明确丢失后果与恢复设计，再决定是否允许淘汰。noeviction 可以避免主动淘汰，却把容量压力转为应用需要处理的写错误。

## 4. 大 Key 删除 {/* #大-key-删除 */}

淘汰通常以键为单位，不是从每个大集合里平均删一点。LRU/LFU 也不是“优先删除最大键”的算法。一个不合适的数据模型，不能仅靠换策略修复。

同步 `DEL` 释放大量对象可能阻塞；`UNLINK` 将实际释放移交后台，但仍要付出字典删除、后台 CPU 和内存回收成本，内存也未必瞬间归还 OS。批量扫描使用有界 `SCAN`，不要在生产用无界 `KEYS`。删除语义见 [UNLINK](https://redis.io/docs/latest/commands/unlink/)。

## 5. 容量原则 {/* #容量原则 */}

不能把 `maxmemory` 直接设置成容器 Memory Limit。Redis 进程 RSS、fork 子进程新增的独占页，以及容器内其他计费内存，都需要留有余量。

预算时避免重复相加：一部分客户端与复制开销已经包含在分配内存或 RSS 中，不能把所有 INFO 数值机械累加。应以实际 RSS/cgroup 峰值、分配器状态、复制/AOF 缓冲与 COW 的观测结果分解原因。主从复制、RDB/AOF 重写与真实写流量要一起验证，不能只测静止数据集。

副本通常由主节点的淘汰结果保持数据一致，默认不会简单独立执行同样的 maxmemory 淘汰约束；故障提升后角色也会变化。因此主、副本都要做内存与切换预算。进一步阅读[性能与容量分析](../04-patterns-operations/14-Redis性能容量监控安全备份升级与故障Runbook.md)与 [RDB、AOF、fork 与 COW](./07-Redis-RDB-AOF-fork与Copy-on-Write.md)。

## 6. 内存实验与排障闭环 {/* #内存实验与排障闭环 */}

### 6.1 创建独立实验实例

以下是 Linux/Bash 的 Docker 实验示例，使用固定功能版本，不是生产版本推荐。若同名容器已存在，先确认归属，不要接管；只有本次成功创建后才执行后面的写入和停止命令。

```bash
docker run -d --rm --name redis-evict-lab \
  --label purpose=redis-eviction-lab \
  --memory=128m --cpus=1 \
  -p 127.0.0.1:16379:6379 redis:8.6.0 \
  redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru \
  --save '' --appendonly no
```

这个实例没有持久化且使用 `--rm`，停止后实验数据会删除。若宿主机没有安装 redis-cli，可使用 `docker exec redis-evict-lab redis-cli` 进入 CLI；容器内端口是 6379，宿主机映射端口是 16379。

### 6.2 查看和修改配置

```bash
redis-cli -h 127.0.0.1 -p 16379 --raw CONFIG GET maxmemory
redis-cli -h 127.0.0.1 -p 16379 --raw CONFIG GET maxmemory-policy
redis-cli -h 127.0.0.1 -p 16379 --raw CONFIG GET maxmemory-samples
```

三个查询的示意输出分别如下：

```text
maxmemory
67108864

maxmemory-policy
allkeys-lru

maxmemory-samples
5
```

`CONFIG SET` 可以动态修改支持的配置。例如在实验中比较 LFU：

```bash
redis-cli -h 127.0.0.1 -p 16379 CONFIG SET maxmemory-policy allkeys-lfu
redis-cli -h 127.0.0.1 -p 16379 CONFIG GET maxmemory-policy
```

返回 `OK` 表示运行配置修改成功；不代表已保存到重启后的配置来源，也不代表命中率必然更高。降低 maxmemory 可能立即触发回收或拒写，切换 allkeys 策略也可能让原先受保护的键进入候选，不能在生产中随意试开关。[CONFIG GET](https://redis.io/docs/latest/commands/config-get/) 与 [CONFIG SET](https://redis.io/docs/latest/commands/config-set/)分别用于观察和变更。

通过配置文件启动且有写权限时，可按管理方式使用 `CONFIG REWRITE` 将有效配置写回文件；它不是保存业务数据。如果启动时没有配置文件，命令会报错。上面的 Docker 示例正是直接传启动参数，所以不能照抄 `CONFIG REWRITE` 并期待成功；应修改容器启动参数后重建实验。ConfigMap/Helm/Operator 管理的部署应更新声明式配置来源，不能只修改容器临时文件。[CONFIG REWRITE 文档](https://redis.io/docs/latest/commands/config-rewrite/)说明了这一限制。

### 6.3 有界制造压力并观察结果

先记录 INFO，再在上面的专用容器中运行有限请求。以下命令最多发送 30000 次 SET，值大小 4096 字节，连接数为 2；有随机键碰撞，最终键数不等于请求数。它通常能在该实验限额下触发淘汰，是否触发以实际统计为准。

```bash
docker exec redis-evict-lab redis-cli INFO stats
docker exec redis-evict-lab redis-benchmark \
  -t set -n 30000 -r 30000 -d 4096 -c 2 -P 4
docker exec redis-evict-lab redis-cli INFO memory
docker exec redis-evict-lab redis-cli INFO stats
docker exec redis-evict-lab redis-cli INFO commandstats
```

重点对比同一时间窗口内的增量，而不是只看累计数：

- `evicted_keys`：内存压力下淘汰了多少键。
- `expired_keys`：正常到期移除了多少键，两者不要混算。
- `keyspace_hits/misses`：与业务 GET 模式结合观察，纯 SET 压测不能证明命中率。
- OOM 错误与相关命令拒绝数：判断是否存在不能回收或拒写。
- P99、CPU、RSS、复制延迟和回源负载：防止通过大量淘汰维持写入，却把后端压垮。

LRU 下可以对实验键查看 `OBJECT IDLETIME`；LFU 下改看 `OBJECT FREQ`。频度计数和采样都带近似性，不要要求“高频键一次也不被淘汰”。对照不同策略应使用新的隔离实验数据和一致的访问分布，避免把旧热度、前一次残留和策略本身混在一起。压测参数见 [redis-benchmark](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/)。

实验完成后，确认容器是本次创建的，再停止：

```bash
docker inspect --format '{{.Config.Labels.purpose}}' redis-evict-lab
docker stop redis-evict-lab
```

第一条应显示 `redis-eviction-lab`，停止后 `--rm` 会移除容器及其中的实验数据。不要把停止、改配置或清数据命令指向生产实例。

### 6.4 按现象排查

写入 OOM 但进程仍活着，先查有效上限、策略、候选键及开销；`volatile-*` 尤其要检查 TTL 是否丢失。只有 RSS 高而分配内存不高，则继续分解分配器、缓冲和 COW，而不是认定 LRU 没生效。

持续淘汰而命中率下降时，检查数据集是否超出容量、热点是否变化、TTL 是否过短和回源是否受控。`maxmemory-samples` 是采样精度相关参数，`maxmemory-eviction-tenacity` 是淘汰处理投入相关参数；后者不代表“允许淘汰多少比例”，更不是内存配额。不要同时修改多个参数后只凭一次 QPS 对比判断效果。

监控指标、告警口径与排查入口见[Redis 核心监控指标采集与告警](../04-patterns-operations/16-Redis核心监控指标采集与告警.md)。

## 7. 练习与答案 {/* #验收题 */}

**问题一：设置一小时 TTL，是否保证至少保留一小时？**

答案：不能。内存压力下只要符合淘汰策略，就可能提前被移除；客户端也可能更新或删除它。

**问题二：volatile-lru 为什么不能清理很久没访问的无 TTL 大键？**

答案：它先限定有 TTL 的候选，再比较访问近期性；无 TTL 的键没有资格参与，不是“排在最后”。

**问题三：allkeys-lru 是否只处理没有 TTL 的键？**

答案：不是。它的范围包含有 TTL 和无 TTL 的键，allkeys 与 volatile 的区别是候选范围，而不是两类互斥的键集合。

**问题四：一个键读得很热但长期没修改，LRU、LFU、LRM 会怎样看它？**

答案：近期读取使它在 LRU 中较新，持续频繁读取使它在 LFU 中可能较热；LRM 不因读取而刷新修改时间，所以仍可能优先回收它。实际还受候选、采样和其他键状态影响。

**问题五：noeviction 报 OOM，能否认定 Redis 已经被杀死？**

答案：不能。这是命令层拒绝；应与进程被内核/cgroup OOM Kill 区分。读、删除与受 OOM 检查命令的行为也不同。

**问题六：used_memory 低于容器限额，为什么仍可能 OOMKilled？**

答案：分配内存不等于容器全部计费内存，还可能有 RSS 偏差、COW、其他进程等开销。maxmemory 不是操作系统硬上限。

**问题七：UNLINK 是否免费，fork 是否立即复制全部数据？**

答案：都不是。UNLINK 将部分回收工作移到后台，仍消耗 CPU/内存；fork 初始共享很多页面，后续写入产生 COW，峰值取决于被改写页面等因素。

**问题八：CONFIG SET 返回 OK 后，重启是否一定保留？**

答案：不一定。它修改运行配置；重启读取的文件、启动参数或声明式配置必须同步。CONFIG REWRITE 也需要满足配置文件及权限等条件，不能把它当作保存业务数据的命令。

## 8. 参考资料 {/* #参考资料 */}

- [Redis Key eviction 与 LRM](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis 8.0 配置与默认值](https://github.com/redis/redis/blob/8.0.0/redis.conf)
- [Redis 8.6 策略配置](https://github.com/redis/redis/blob/8.6.0/redis.conf)
- [Redis 8.6 淘汰实现](https://github.com/redis/redis/blob/8.6.0/src/evict.c)
- [内存优化](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/)
