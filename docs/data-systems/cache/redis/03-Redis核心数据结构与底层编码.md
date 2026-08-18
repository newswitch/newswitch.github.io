---
title: "String、Hash、List、Set、ZSet 与底层编码"
sidebar_label: "03. String、Hash、List、Set、ZSet 与底层编码"
sidebar_position: 3
description: "从业务语义、复杂度、对象编码和内存代价选择 Redis 核心数据结构。"
tags: [Redis, String, Hash, List, Set, ZSet]
---

# String、Hash、List、Set、ZSet 与底层编码

> 版本基线：以 Redis 7.0+ 的 listpack/quicklist 编码体系为主；最后核验：2026-08-18。内部编码属于实现细节，始终用目标实例的 `OBJECT ENCODING` 和配置验证。

Redis 的“类型”是客户端可见的操作语义，`encoding` 是服务端根据版本、元素数量、元素大小和配置选择的内部实现。业务建模不能只看命令是否方便，还要同时考虑：

- 单次操作复杂度；
- 返回和写入的字节数；
- Key 的总内存；
- 编码转换成本；
- 主线程占用时间；
- 复制、持久化和 Cluster 迁移代价。

## 1. 类型、对象和编码的关系

```text
key
→ redisObject(type, encoding, lru/lfu, refcount...)
→ concrete data structure
→ allocator memory
```

同一个 Hash，在元素少且字段短时可能采用紧凑 listpack；超过阈值后转成哈希表。对客户端来说仍然是 Hash，但内存、遍历和扩容行为已经不同。

用下面三个命令分别回答不同问题：

```bash
redis-cli TYPE user:1001
redis-cli OBJECT ENCODING user:1001
redis-cli MEMORY USAGE user:1001 SAMPLES 5
```

`TYPE` 不能告诉你内存实现；`OBJECT ENCODING` 不能告诉你整个对象占了多少字节；`MEMORY USAGE` 也不等于应用请求的网络返回大小。

## 2. 五种核心类型怎么选

| 类型 | 业务语义 | 适合操作 | 容易踩坑 |
| --- | --- | --- | --- |
| String | 一个二进制安全值 | 缓存、计数、原子覆盖、位操作 | 大 value、无界 APPEND、整值更新 |
| Hash | 一个对象的字段集合 | 字段读写、稀疏属性、小对象聚合 | 大 Hash、`HGETALL`、字段无界增长 |
| List | 有序可重复序列 | 两端 push/pop、有限范围读取 | 大范围 `LRANGE`、中间随机访问 |
| Set | 无序唯一集合 | 成员判断、去重、交并差 | 大集合聚合阻塞主线程 |
| ZSet | member 唯一、按 score 排序 | 排行榜、延迟队列、范围查询 | 大范围返回、score 精度、聚合 |

选择时先写出访问模式，而不是先选数据类型：

```text
每次读整个对象还是单字段？
是否需要顺序？
成员是否允许重复？
是否需要按分数或时间范围检索？
单个 Key 最坏会有多少元素和字节？
是否需要跨 Key 原子操作？
```

## 3. String：int、embstr 与 raw

String 是字节序列，不是只保存文本。现代 Redis 常见编码：

| encoding | 典型条件 | 特点 |
| --- | --- | --- |
| `int` | 可表示为整数的值 | 节省对象和字符串存储 |
| `embstr` | 较短字符串 | 对象与字符串紧凑分配 |
| `raw` | 较长或发生可变操作的字符串 | 独立 SDS，适合一般字符串 |

具体阈值属于实现细节，不能写死为业务契约。一次 `APPEND` 或值变大可能触发编码变化。

适合：

- JSON/Protobuf 等整值缓存；
- `INCRBY` 计数器；
- 分布式状态中的小标记；
- Bitmap 的底层载体。

不适合：

- 数 MB 模型元数据或大 JSON 频繁整值更新；
- 需要高频修改某个字段却每次反序列化整个对象；
- 无边界日志追加。

## 4. Hash：省 Key 元数据不等于可以无限大

小 Hash 通常使用紧凑编码，元素或字段变大后转为哈希表。把一个对象的几十个字段放入 Hash，通常比拆成几十个顶层 Key 更节省 Key 元数据，并支持单字段更新。

但把整个租户的百万用户都放入一个 Hash 会造成：

- `HGETALL` 返回巨大；
- 单 Key 无法在 Redis Cluster 中进一步拆分；
- 迁移和复制以整个 Key 为单位；
- 删除、过期和持久化成本集中；
- 热点全部落到一个分片。

更合理的拆分应同时控制 Key 数量和单 Key 大小，例如按租户和稳定分桶：

```text
user:{tenant-7}:bucket:000
user:{tenant-7}:bucket:001
...
```

花括号是 Redis Cluster hash tag，使用前要确认是否真的希望这些 Key 落在同一 Slot；错误使用会制造新热点。

## 5. List：Quicklist 与范围边界

现代 Redis List 通常由 quicklist 组织多个紧凑 listpack 节点，在两端操作效率和内存局部性之间折中。

`LPUSH/RPUSH/LPOP/RPOP` 适合两端队列，但普通 List 不自动提供完善的消费确认、重放和 Consumer Group。如果业务需要可靠事件消费，优先评估 Streams 或专业消息队列。

`LRANGE key 0 -1` 的危险不是语法，而是它要求：

1. 遍历所有元素；
2. 构造完整响应；
3. 占用网络输出缓冲；
4. 让客户端一次性接收。

生产接口必须限制范围长度，并定义队列最大长度和清理策略。

## 6. Set：成员关系和集合计算

Set 可根据内容和规模使用 intset、listpack 或哈希表等编码，实际结果以 `OBJECT ENCODING` 为准。

`SISMEMBER` 适合成员判断；`SINTER`、`SUNION`、`SDIFF` 的成本取决于输入集合规模和分布。大集合在线聚合会在 Redis 主线程消耗明显 CPU。

安全策略：

- 先用 `SCARD` 获取规模；
- 限制参与聚合的 Key 数量和元素数；
- 大结果写入临时 Key 时设置 TTL；
- 超大关系计算移到异步任务或离线系统；
- 不用 `SMEMBERS` 为分页接口提供“全量分页”。

`SSCAN` 可以分批遍历，但它是增量迭代，不提供事务快照；遍历期间集合变化可能出现重复或遗漏，调用方要能容忍。

## 7. ZSet：Skiplist、字典与 score

小 ZSet 可采用紧凑 listpack；一般实现使用有序结构配合 member 查找结构，对外编码通常显示为 `skiplist`。

ZSet 常见模型：

| 场景 | member | score |
| --- | --- | --- |
| 排行榜 | user_id | 分数 |
| 延迟任务 | task_id | 计划执行时间 |
| 最近访问 | object_id | Unix 时间 |
| 优先队列 | job_id | 优先级与时间组合 |

score 使用双精度浮点数。若把超大整数、纳秒时间或多个字段粗暴拼成 score，可能出现精度和排序问题。必须定义：

- 相同 score 如何排序；
- 时间单位；
- 是否需要稳定二级排序；
- 分数更新是否允许覆盖；
- 窗口数据何时清理。

## 8. 编码转换为何影响延迟

紧凑编码节省内存，但元素增多或变大后需要转换：

```text
compact encoding
→ cross threshold
→ allocate general structure
→ copy/rehash elements
→ release old structure
```

转换发生在执行命令的线程路径中，可能造成一次延迟尖峰。阈值配置也不是越大越省内存：紧凑结构过大时，中间插入、删除和查找的 CPU 成本可能变高。

检查目标实例的真实配置，而不是照抄旧版本参数：

```bash
redis-cli CONFIG GET '*max*listpack*'
redis-cli CONFIG GET 'list-max-*'
redis-cli INFO server
```

Redis 6.2 及更早资料常出现 ziplist，Redis 7.x 之后多个类型已经转向 listpack；升级评审必须重新验证编码和阈值。

## 9. O(1) 为什么仍可能产生高 P99

复杂度只描述输入规模增长趋势。`GET` 是 O(1)，但读取 8 MiB value 仍需要：

- 查找对象；
- 拷贝或引用响应数据；
- 写入客户端输出缓冲；
- 经过复制和网络；
- 客户端反序列化。

因此风险模型应同时包含：

```text
operation complexity
× element count
× bytes per element
× concurrent requests
× replication/persistence amplification
```

`DEL` 一个包含大量元素的 Key 也可能有明显释放成本。可评估 `UNLINK` 异步释放，但它不消除内存和后台释放压力，也不能替代大 Key 治理。

## 10. Key 建模规范

建议结构：

```text
业务:环境:租户:对象类型:对象ID:版本
order:prod:t7:detail:89321:v2
```

必须明确：

- 最大 value 字节数；
- 最大字段/成员数量；
- TTL 归属；
- 更新和删除方式；
- Cluster Slot 分布；
- 是否可能成为热 Key；
- Schema 变更和版本兼容；
- 敏感数据与 ACL。

所有临时数据应有明确 TTL，但不能为了“保险”给永久事实数据随意加过期时间。

## 11. 可复现实验

只在独立 Redis 实例执行，并使用 `lab:encoding:*` 前缀。

### 11.1 实验一：观察 String 编码 {/* #实验一观察-string-编码 */}

```bash
redis-cli SET lab:encoding:int 123
redis-cli SET lab:encoding:short hello
redis-cli SET lab:encoding:long "$(printf 'x%.0s' {1..200})"

redis-cli OBJECT ENCODING lab:encoding:int
redis-cli OBJECT ENCODING lab:encoding:short
redis-cli OBJECT ENCODING lab:encoding:long
redis-cli MEMORY USAGE lab:encoding:long
```

### 11.2 实验二：观察 Hash 转换 {/* #实验二观察-hash-转换 */}

1. 创建只有几个短字段的 Hash；
2. 记录 `OBJECT ENCODING` 和 `MEMORY USAGE`；
3. 逐步增加字段数和单字段长度；
4. 找到编码变化发生的位置；
5. 对齐目标实例的 listpack 阈值配置。

不要把实验阈值直接当作所有 Redis 版本的固定结论。

### 11.3 实验三：证明返回大小影响延迟 {/* #实验三证明返回大小影响延迟 */}

分别创建：

- 1000 个 10 字节元素；
- 1000 个 10 KiB 元素；
- 一个包含大量成员的集合。

比较小范围读取与全量读取的延迟、响应字节和客户端内存。实验结束只删除 `lab:encoding:*` 前缀，不使用 `FLUSHALL`。

## 12. 生产观测

- `INFO commandstats`：命令调用次数和累计耗时；
- `SLOWLOG GET`：超过阈值的命令；
- `LATENCY DOCTOR`：实例内部延迟事件；
- `MEMORY USAGE`：确认候选大 Key；
- `redis-cli --bigkeys` / `--memkeys`：离线或低峰扫描；
- 客户端连接、输出缓冲和网络字节；
- Cluster 各 Slot 的 Key 数、内存和 QPS 分布。

扫描工具也会增加负载，先在副本或低峰验证 `COUNT` 和速率，不能在生产高峰无界运行。

## 13. 验收题

- Redis 类型和 encoding 有何区别？
- Hash 聚合对象为什么既省内存又可能成为迁移热点？
- O(1) 的大 value 读取为什么仍可能产生高 P99？
- `SSCAN` 为什么不能提供稳定快照？
- ZSet score 使用浮点数时要注意什么？
- 编码阈值调大为什么不一定更快？

## 14. 参考资料 {/* #参考资料 */}

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Compare data types](https://redis.io/docs/latest/develop/data-types/compare-data-types/)
- [OBJECT ENCODING](https://redis.io/docs/latest/commands/object-encoding/)
- [Redis command reference](https://redis.io/commands/)
