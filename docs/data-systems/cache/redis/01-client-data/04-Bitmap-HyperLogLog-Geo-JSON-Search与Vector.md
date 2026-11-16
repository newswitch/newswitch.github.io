---
title: "Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector"
sidebar_label: "04. Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector"
sidebar_position: 4
description: "用可推演的命令与数据解释 Bitmap 空间、HLL 误差、GEO 坐标、JSON 路径和 Search/Vector 索引参数，并建立精度与容量验证方法。"
tags: [Redis, Bitmap, HyperLogLog, JSON, Search, Vector]
---

# Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector

这些能力解决的不是同一种问题：Bitmap 按位保存状态，HyperLogLog 估计去重数量，GEO 查地理邻近，JSON 保存结构化文档，Search 为字段建立查询索引，Vector 则按向量距离找相近对象。

选择前先问三个问题：需要保存原始成员还是只要统计？结果必须精确还是允许误差？一次查询按主键取值，还是要在大量记录中筛选、排序？不能只因某个结构“节省内存”就替换业务需要的语义。

| 能力 | 适用 | 关键边界 |
| --- | --- | --- |
| Bitmap/Bitfield | 稠密布尔状态、签到 | 最大 offset 决定 String 空间 |
| HyperLogLog | 近似去重计数 | 有误差，不能枚举成员 |
| Geo | 经纬度附近查询 | 地球模型与精度有限 |
| JSON | 局部字段访问 | 文档/索引内存与更新放大 |
| Search | 文本/标量索引 | 索引构建、Schema 与一致性 |
| Vector | 向量近邻与混合检索 | 模型契约、距离、召回、过滤、索引内存和扩展方式 |

本文以 Redis Open Source 8.6 为示例基线。命令使用单机隔离实例中全新的 `lab:` 测试键，输出为教学状态；已有同名键或索引时换命名空间，不要删除真实数据来复现。JSON/Search 的命令还需要目标发行包实际提供相应能力。

## 1. 选择方法 {/* #选择方法 */}

### 1.1 Bitmap 的成本由最高位决定

Bitmap 使用 String 的二进制空间，offset 是从 0 开始的位编号；一个字节中从最高有效位开始编号。`SETBIT` 返回修改前的位值，不是本次修改后的值。

```text
127.0.0.1:16379> SETBIT lab:active 0 1
(integer) 0
127.0.0.1:16379> SETBIT lab:active 7 1
(integer) 0
127.0.0.1:16379> STRLEN lab:active
(integer) 1
127.0.0.1:16379> BITCOUNT lab:active
(integer) 2
127.0.0.1:16379> SETBIT lab:sparse 1000000 1
(integer) 0
127.0.0.1:16379> STRLEN lab:sparse
(integer) 125001
```

前四条形成一个字节 `10000001`。后两条只设置一个状态，却需要 `floor(1000000 / 8) + 1 = 125001` 字节，因为中间空洞也要补零。这是 String 有效载荷长度，不含键、对象头和分配器开销；实际分配看 `MEMORY USAGE`。

适合把当天活跃用户映射到稠密编号后做位统计；若直接把极稀疏的外部大 ID 作为 offset，空间可能远超 Set。分桶可以限制单键大小，但编号映射本身也有维护成本。`BITOP AND/OR` 可以做交并集，但输入位必须使用同一套编号语义，Cluster 下相关键还需满足同槽约束。首次扩展大 String 也可能带来明显分配与清零开销，见[SETBIT](https://redis.io/docs/latest/commands/setbit/)。

### 1.2 BITFIELD 还需要定义溢出语义

BITFIELD 在 String 中按指定位宽存整数。`u8` 范围为 0～255，`i8` 为 -128～127；裸 offset 是位偏移，`#1` 则是“一个字段宽度之后”，对 u8 相当于位偏移 8。它不是每个字段都有独立键和 TTL 的 Hash。

```text
127.0.0.1:16379> BITFIELD lab:counter SET u8 0 250
1) (integer) 0
127.0.0.1:16379> BITFIELD lab:counter INCRBY u8 0 10
1) (integer) 4
127.0.0.1:16379> BITFIELD lab:counter OVERFLOW SAT INCRBY u8 0 300
1) (integer) 255
127.0.0.1:16379> BITFIELD lab:counter OVERFLOW FAIL INCRBY u8 0 1
1) (nil)
127.0.0.1:16379> BITFIELD lab:counter GET u8 0
1) (integer) 255
```

默认 WRAP 按位宽回绕，所以 250 加 10 变为 4；SAT 在上界饱和；FAIL 在溢出时返回 nil，该操作不修改字段。`OVERFLOW` 影响同一条命令后续适用的写子操作，不是永久修改这个键的属性。若忽略 nil，把“计数没增加”当成成功，就会产生业务错误。命令细节见[BITFIELD](https://redis.io/docs/latest/commands/bitfield/)。

### 1.3 HyperLogLog 保存统计摘要，不保存成员清单

HLL 将元素哈希分桶，记录各桶的统计特征，再估计不同元素数量。Redis 实现有 16,384 个寄存器，稠密表示的寄存器载荷约 12 KiB，标准误差约 0.81%；少量元素可以用更紧凑的稀疏表示。这不是“每次结果必定落在真实值 ±0.81%”，也不是整个键在所有状态下精确占 12 KiB。

```bash
redis-cli -p 16379 PFADD 'lab:uv:{shop}:day1' alice bob alice
redis-cli -p 16379 PFADD 'lab:uv:{shop}:day2' bob carol
redis-cli -p 16379 PFCOUNT 'lab:uv:{shop}:day1' 'lab:uv:{shop}:day2'
```

这里精确并集是 `{alice, bob, carol}`，基数为 3；PFCOUNT 返回的是估计，即使小样本恰好得到 3，也不能据此推断大样本必然精确。PFADD 返回 1 表示内部摘要发生变化，不是“新增了一个确定成员”；此前未见的元素也可能不改变摘要。

跨日 UV 应合并摘要后估计并集，不能直接相加每天 UV，否则重复用户被重复计算。`PFMERGE destination source...` 可把并集摘要保存到目标键，但不能用 HLL 枚举用户、精确判断某人是否出现，或删除指定成员。按天分键后合并适合窗口统计，不能把滑动窗口理解成从一个 HLL 里精确减去过期用户。Cluster 示例中的共同 Hash Tag 只解决同槽，不替代容量与热点设计。[HLL 原理与精度](https://redis.io/docs/latest/data-types/probabilistic/hyperloglogs/)和[PFADD 返回语义](https://redis.io/docs/latest/commands/pfadd/)应一起理解。

### 1.4 GEO 是地理索引，不是任意坐标系的地图引擎

GEO 把经纬度编码进 Sorted Set 的 score，再按地理范围筛选与计算距离。参数顺序为经度、纬度；经度范围 -180～180，纬度约 -85.05112878～85.05112878。它采用球面距离近似，不提供完整椭球测量、道路导航或多边形 GIS 语义。

```text
127.0.0.1:16379> GEOADD lab:places 13.361389 38.115556 Palermo 15.087269 37.502669 Catania
(integer) 2
127.0.0.1:16379> GEOSEARCH lab:places FROMMEMBER Palermo BYRADIUS 200 km ASC COUNT 2
1) "Palermo"
2) "Catania"
```

这里按距 Palermo 的距离升序，包含中心成员本身。`FROMLONLAT` 可直接指定查询中心；`BYBOX` 换成矩形范围；`WITHDIST/WITHCOORD` 可带回距离与坐标。`COUNT 2 ANY` 允许提前找到足够结果就停止，不能承诺是真正最近的两个，不能把它当成无损加速开关。

同一成员再次 GEOADD 会更新位置，返回数量默认主要反映新增成员；`CH` 才把变化计入返回，`NX/XX` 分别限制新增或更新。需移除成员时使用 ZREM，不能任意 ZADD 普通分数来“更新坐标”。国内业务常遇到 WGS84、GCJ-02 等坐标差异，存入前应统一来源与坐标语义；把数值合法但坐标系不同的数据混在一起，距离结果仍会偏。[GEOADD](https://redis.io/docs/latest/commands/geoadd/)与[GEOSEARCH](https://redis.io/docs/latest/commands/geosearch/)说明了参数边界。

### 1.5 JSON 是数据本体，Search 是二级查询结构

普通 `SET key '{...}'` 保存的是 String，不会自动成为 JSON 文档或生成搜索索引。JSON 命令提供路径级读写；FT.CREATE 则声明哪些 JSON 路径进入哪种索引，之后 FT.SEARCH 才能按这些字段查询。

在交互式 redis-cli 中写入三个全新测试文档，单行 JSON 保持完整：

```text
127.0.0.1:16379> JSON.SET lab:item:1 $ '{"title":"coffee beans","category":"drink","price":25,"embedding":[1,0,0,0]}'
OK
127.0.0.1:16379> JSON.SET lab:item:2 $ '{"title":"tea leaves","category":"drink","price":15,"embedding":[0,1,0,0]}'
OK
127.0.0.1:16379> JSON.SET lab:item:3 $ '{"title":"coffee grinder","category":"tool","price":199,"embedding":[0.8,0.2,0,0]}'
OK
127.0.0.1:16379> JSON.GET lab:item:1 $.price
"[25]"
127.0.0.1:16379> JSON.GET lab:item:1 .price
"25"
```

以 `$` 开头的 JSONPath 即使匹配一个值，也按匹配结果数组返回；旧式 `.price` 路径返回形态不同。`JSON.GET` 的正文是序列化 JSON，不是已经解码的 Python/Java 对象。应用要明确路径和客户端解码规则，不要随手去掉一层数组来“兼容所有情况”。见[JSON.GET](https://redis.io/docs/latest/commands/json.get/)。

接着创建索引，以下 FT.CREATE 在交互终端作为一整条命令输入：

```text
FT.CREATE lab:idx ON JSON PREFIX 1 lab:item: SCHEMA $.title AS title TEXT $.category AS category TAG $.price AS price NUMERIC $.embedding AS embedding VECTOR FLAT 6 TYPE FLOAT32 DIM 4 DISTANCE_METRIC COSINE
```

| 片段 | 这里定义的语义 | 容易混淆的点 |
| --- | --- | --- |
| `ON JSON` | 来源是 JSON 文档 | 不索引同名前缀下的普通 String |
| `PREFIX 1 lab:item:` | 只选这个键前缀 | 不是查询时才临时扫描整个 Redis |
| `$.title AS title TEXT` | JSON 路径取字段，别名用于全文查询 | TEXT 有分词等语义，不是精确字符串等号 |
| `$.category AS category TAG` | 类别标签过滤 | 不应为了查分类把所有字段都设为全文 |
| `$.price AS price NUMERIC` | 数值范围查询 | 文档里的数值类型也应正确 |
| `VECTOR FLAT 6` | 创建精确向量检索字段，后面有 6 个配置 token | 6 是三个参数名和值的 token 数，不是维度 |

已存在文档会经历初始索引扫描。用 `FT.INFO lab:idx` 确认完成且没有索引错误；本例健康状态的字段可整理为下列摘录，不是原始 RESP 键值数组：

```text
num_docs:3
indexing:0
percent_indexed:1
hash_indexing_failures:0
```

`percent_indexed=1` 表示完成 100%，不是 1%。再执行查询：

```text
127.0.0.1:16379> FT.SEARCH lab:idx '@title:coffee @price:[0 50]' NOCONTENT DIALECT 2
1) (integer) 1
2) "lab:item:1"
```

这是全文条件与闭区间数值条件的交集，NOCONTENT 只返回文档 ID。Query Engine 的 TEXT/TAG/NUMERIC 索引不是同一套处理规则；JSON 中有字段但 Schema 没声明，就不能假定它可按该字段检索。

已有文档的常规更新会维护相应索引；但初始扫描、索引失败、异步清理与读取副本等状态仍要分别确认。单条 JSON.SET 的原子性不等于跨文档事务，也不承诺任意多次查询都看到同一快照。更新放大来自本体变更、索引维护，以及复制/AOF/COW 等成本，见[索引定义](https://redis.io/docs/latest/commands/ft.create/)。

## 2. Vector 评测 {/* #vector-评测 */}

### 2.1 先固定模型与距离契约

向量不是“同为 768 维就可以混用”的数组。模型版本、文本切分、归一化、维度、元素类型和距离定义都属于数据契约。同维度不同模型可能没有可比语义。

| 参数或概念 | 含义 | 错配时的表现 |
| --- | --- | --- |
| `TYPE FLOAT32` | 每个分量按 32 位浮点参与索引/查询 | 把 JSON 文本字节或 FLOAT64 原样当查询 blob，会长度/解释错误 |
| `DIM` | 分量个数，本例为 4 | 查询 blob 长度应为 `DIM × 4` 字节 |
| `COSINE` | 方向差异，常用距离为 `1 - cos(q,v)`，越小越近 | 零向量无有效方向，归一化策略必须明确 |
| `L2` | 本节 FLAT/HNSW 的 VecSim 路径返回平方欧氏距离 | 不能把返回数值直接解释为普通欧氏长度 |
| `IP` | 距离按 `1 - dot(q,v)` 解释，越小越近 | 未归一化时，向量模长会改变排序，距离也可能为负 |
| `KNN K` | 从匹配范围中取最近 K 个候选 | 不是把所有候选都保证逐个比较，也不是结果数永远足 K |

欧氏距离的数学定义带平方根，但 VecSim 的 L2 路径累加平方差后直接返回；例如 `[0,0]` 与 `[3,4]` 返回平方距离 25，而不是长度 5。开不开平方不改变近邻排序，却影响距离阈值和跨系统比较，见[VecSim L2 实现](https://github.com/RedisAI/VectorSimilarity/blob/a26291683b5bacc7821c834261fe3081987b87fb/src/VecSim/spaces/L2/L2.cpp)。不要把不同产品都叫 L2，就认定返回数值单位完全相同。

下面向量都与查询 `q=[1,0,0,0]` 比较。数学值按输入算得，实际 FLOAT32/索引输出会有舍入：

| 文档 | 类别 | 向量 | COSINE 距离约值 |
| --- | --- | --- | --- |
| `lab:item:1` | drink | `[1,0,0,0]` | 0 |
| `lab:item:2` | drink | `[0,1,0,0]` | 1 |
| `lab:item:3` | tool | `[0.8,0.2,0,0]` | 0.0298575 |

不加过滤时前两名为 1、3；限制 drink 后前两名为 1、2。不能拿未过滤的真值去评价带过滤查询的召回率。

### 2.2 用二进制查询参数，不用字符串伪装向量

以下代码需要 redis-py，连接本地测试实例。对常见小端服务器使用 `<4f` 打包；其他字节序环境要匹配目标表示。文档仍是 JSON 数组，但查询参数是 16 字节 FLOAT32 blob：

```python
import struct
import redis

r = redis.Redis(host="127.0.0.1", port=16379, decode_responses=False)
query = struct.pack("<4f", 1.0, 0.0, 0.0, 0.0)
reply = r.execute_command(
    "FT.SEARCH", "lab:idx",
    "(@category:{drink})=>[KNN 2 @embedding $q AS distance]",
    "PARAMS", 2, "q", query,
    "SORTBY", "distance", "ASC",
    "RETURN", 1, "distance",
    "DIALECT", 2,
)
print(reply)
```

结果应含两个 drink 文档，按 distance 从小到大为 1、2，距离约为 0、1；具体字节串格式由客户端和协议决定。`PARAMS 2` 是一个参数名与一个值共两个 token；`RETURN 1` 只选择一个返回字段。用 `b"[1,0,0,0]"` 替代 query 不等价，也不要让客户端把二进制参数错误转码。

### 2.3 FLAT 与 HNSW 交换什么

FLAT 对候选做精确距离计算，适合建立同数据、同距离、同过滤条件的真值基线。HNSW 构建多层邻接图，在查询时探索部分候选，以内存和近似搜索换取速度；是否更快要以数据、过滤与并发实测为准。

若另建一个 HNSW 对照索引，向量字段定义可以改为：

```text
$.embedding AS embedding VECTOR HNSW 10 TYPE FLOAT32 DIM 4 DISTANCE_METRIC COSINE M 16 EF_CONSTRUCTION 200
```

这只是替换字段定义的片段，不是可单独执行的命令。10 仍是五个参数名和值的 token 总数。不要覆盖现有索引名称来做对照；两份索引并存本身也要占内存。

| HNSW 参数 | 控制什么 | 增大后的主要交换 |
| --- | --- | --- |
| `M` | 图的连接规模 | 通常增加图内存与构建工作，可能改善搜索质量 |
| `EF_CONSTRUCTION` | 建图时探索候选的宽度 | 构建更慢，通常有利于图质量；不是每次查询的候选数 |
| `EF_RUNTIME` | 查询时探索候选的宽度 | 通常提高召回机会，也增加延迟与 CPU；不能保证 Recall=100% |

这两个建图值是对照示例，不应直接当成所有版本和产品的默认值。HNSW 查询可在 KNN 子句中显式增加 `EF_RUNTIME 100`；本节 FLAT 查询不要直接套用 HNSW 专用参数。参数定义见[向量搜索](https://redis.io/docs/latest/develop/ai/search-and-query/vectors/)。

### 2.4 Recall、内存与尾延迟一起测

```text
固定模型、数据与过滤条件
  → 精确检索得到 ground truth
  → ANN 索引在同一条件返回候选
  → 对比 Recall@K、P99、内存、构建/重建时间
  → 增加并发写入和不同过滤选择率，再重复
```

若符合过滤条件的记录数为 N，令 `K_eff=min(K,N)`；`Recall@K = |ANN结果 ∩ 精确前K结果| / K_eff`，以不同文档 ID 计数，N 为 0 时单列空集查询，不除以 0。存在距离并列时还应约定真值规则，避免把同距离的等价结果误算为错误。

例如 K=3、真值为 A/B/C，近似结果为 A/C/D，则 Recall@3 为 2/3；不能按返回了三条就填 100%。统计查询集合的分布与均值，并同时记录负载和超时，单个小样本成功不是容量结论。

只按原始 FLOAT32 数据计算，一百万条、每条 768 维就有 `1000000 × 768 × 4 = 3072000000` 字节，约 2.86 GiB；还未计入 JSON 本体、键、HNSW 图、文本/标量索引、复制、持久化与重建并存。`MEMORY USAGE` 单个文档不覆盖全部二级索引成本。

是否使用 Redis、[Milvus](../../../vector-databases/milvus/00-Milvus从零到精通学习路线.md)或[Elasticsearch](../../../search/elasticsearch/00-Elasticsearch从零到精通学习路线.md)，应比较工作集、查询类型、过滤、保留、扩展、资源隔离、恢复和运维，而不是用一个固定向量条数直接下结论。模型升级时新旧向量应分版本存储/建索引，验证后切换，不能把不兼容向量悄悄混进同一字段。

## 3. 排障 {/* #排障 */}

| 现象 | 先取什么证据 | 不应直接下的结论 |
| --- | --- | --- |
| Bitmap 只记一个人却变大 | 最大 offset、STRLEN、MEMORY USAGE、编号分布 | Redis 存在内存泄漏 |
| HLL 与明细不一致 | 同一统计口径的精确去重数、多个样本的相对误差 | HLL 必须返回精确数，或必定不超 0.81% |
| GEO 附近结果偏移 | 经纬顺序、坐标系、单位、ANY 与范围条件 | 只要经纬数值合法，地图语义就正确 |
| JSON 能读，FT.SEARCH 找不到 | 前缀、ON 类型、JSONPath、Schema、初始扫描和索引错误 | 数据主键存在就必然已进所有索引 |
| 向量写入/查询失败 | DIM、TYPE、blob 长度、有限数值、模型版本 | 只需把 EF_RUNTIME 调大 |
| ANN 召回低 | 同过滤真值、距离/归一化、建图与查询参数、更新负载 | 看到相似文本就说明 embedding 契约没问题 |
| 内存或 P99 飙升 | 文档与索引分别统计、重建并存、CPU、复制、COW | 只看 JSON 文档大小就能解释总内存 |

`FT.INFO lab:idx` 可观察 `num_docs`、`indexing`、`percent_indexed`、向量/倒排索引内存和索引错误信息。字段布局随 Query Engine 版本变化，应保存完整结果并按该版本解读；初始扫描完成不代表所有文档都索引成功，必须一起检查错误。见[FT.INFO](https://redis.io/docs/latest/commands/ft.info/)。

## 4. Redis 8.x 能力边界与实验矩阵 {/* #redis-8x-能力边界与实验矩阵 */}

Redis 8 系列整合了 Search、JSON 等能力，但旧 Redis 7、不同构建方式、Redis Stack 与云托管产品不能只按主版本号互相等同。本文不依赖 8.6 之后的新命令。

先在目标实例检查，而不是遇到 unknown command 就先升级客户端：

```bash
redis-cli -p 16379 INFO server
redis-cli -p 16379 COMMAND INFO SETBIT PFADD GEOSEARCH JSON.SET FT.CREATE FT.SEARCH
redis-cli -p 16379 MODULE LIST
```

COMMAND INFO 能帮助确认命令是否注册；MODULE LIST 辅助识别模块形态，但不能替代实际命令与版本检查。`unknown command`、`NOPERM` 和命令参数不支持是不同问题，分别对应能力/命令入口、ACL 权限和版本语法，不能混为“Redis 不支持”。命令注册也不表示当前用户有执行权限。

| 目标 | 数据结构 | 必须验证 |
|---|---|---|
| 活跃标记 | Bitmap | 用同样成员但不同最大 ID 比较长度，核对字节与实际内存 |
| 近似 UV | HyperLogLog | 同数据精确去重、重复输入、跨日并集，对比多样本误差 |
| 地理邻近 | GEO | 已知点的坐标/距离、边界、排序和 ANY 对结果的影响 |
| 文档更新 | JSON | 单值/数组路径返回、修改字段后搜索结果、错误类型 |
| 文本/向量检索 | Search/Vector | 初始扫描、索引失败、精确真值、过滤选择率与索引容量 |

实验记录应包含数据规模、键命名/标签、版本、参数、结果误差、内存、构建时间、P99 与复制/AOF 放大。对含写入的示例先隔离数据，对持久化与恢复另做验证；正确返回一个结果和可承受生产负载是两项不同的验收。

## 5. 验收题 {/* #验收题 */}

### 5.1 HyperLogLog 为什么不能代替精确集合？

答案：它保存哈希统计摘要，只估计基数，不能枚举成员、精确判断成员身份或删除指定成员。0.81% 是标准误差，不是每次估计的硬误差上限；精确账务和成员查询仍需有相应语义的数据结构。

### 5.2 稀疏用户 ID 为什么不适合直接作 Bitmap offset？

答案：String 要覆盖最高位，中间空洞也占字节。offset 为 1,000,000 时，即使只设置一个 bit，也有 125,001 字节载荷；应先评估编号稠密度、映射与分桶成本，再与 Set 等结构比较。

### 5.3 Redis Vector 与 Milvus 的选型维度有哪些？

答案：比较查询与过滤语义、工作集和总内存、精度/召回、写入与重建、扩展和资源隔离、保留/恢复及运维能力。不能仅按“已有 Redis”或某个向量条数阈值替代工作负载验证。

### 5.4 JSON 文档小但索引为何可能很大？

答案：索引还保存文本倒排、标签/数值结构、文档映射和向量及图等内容；同一文档可能进入多份索引。MEMORY USAGE 单键不是索引总成本，还需计入复制、持久化与新旧索引并存。

### 5.5 u8 的 250 加 10 为什么可能得到 4、255 或 nil？

答案：u8 范围为 0～255。WRAP 默认按 256 回绕，得到 4；SAT 饱和到 255；FAIL 返回 nil 且该操作不修改字段。OVERFLOW 是本次命令中的行为控制，不能当成键的永久配置。

### 5.6 GEOSEARCH COUNT 2 ANY 一定是最近两个吗？

答案：不是。ANY 可以在找到足够候选时提前结束，不承诺全范围内最接近。需要最近邻排序时应理解 ASC 与 COUNT 的组合，并核对坐标系、经纬顺序、单位和范围。

### 5.7 JSON.GET 的 $.price 为什么返回数组？

答案：JSONPath 可以匹配多个位置，所以新式 `$` 路径按匹配结果数组序列化，单匹配也保留数组形态；旧式路径返回形式不同。客户端必须区分 RESP 返回值、JSON 解码和路径匹配结果这几层。

### 5.8 维度相同为什么仍可能向量结果错误？

答案：模型版本、归一化、TYPE、二进制字节序或距离定义可能不同。维度只决定分量个数，不能保证语义和编码相同；FLOAT32 的 DIM=4 查询需 16 字节原始 blob，不是字符串形式的四个数字。

### 5.9 ANN 返回了 K 条，为什么 Recall@K 仍可能很低？

答案：召回看返回 ID 与同数据、同距离、同过滤真值的交集，不看数量是否凑足 K。真值 A/B/C、结果 A/C/D 时是 2/3；符合条件不足 K 时用有效真值数量，并单列空集和并列距离规则。

### 5.10 JSON.SET 失败，是否就说明 Redis 没装 JSON？

答案：不一定。先区分命令未注册、ACL 禁止、路径/类型不合法和语法版本不支持。结合 INFO、COMMAND INFO、错误原文与发行包信息判断，不能只升级客户端或盲目重建数据。

## 6. 参考资料 {/* #参考资料 */}

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis Query Engine](https://redis.io/docs/latest/develop/ai/search-and-query/)
- [SETBIT](https://redis.io/docs/latest/commands/setbit/)
- [BITFIELD](https://redis.io/docs/latest/commands/bitfield/)
- [HyperLogLog](https://redis.io/docs/latest/data-types/probabilistic/hyperloglogs/)
- [Redis 8.6.0 HLL 寄存器与编码实现](https://github.com/redis/redis/blob/8.6.0/src/hyperloglog.c)
- [PFADD](https://redis.io/docs/latest/commands/pfadd/)
- [GEOADD](https://redis.io/docs/latest/commands/geoadd/)
- [GEOSEARCH](https://redis.io/docs/latest/commands/geosearch/)
- [JSON.GET](https://redis.io/docs/latest/commands/json.get/)
- [FT.CREATE](https://redis.io/docs/latest/commands/ft.create/)
- [Vector search](https://redis.io/docs/latest/develop/ai/search-and-query/vectors/)
- [FT.INFO](https://redis.io/docs/latest/commands/ft.info/)
- [VecSim L2 距离实现](https://github.com/RedisAI/VectorSimilarity/blob/a26291683b5bacc7821c834261fe3081987b87fb/src/VecSim/spaces/L2/L2.cpp)
