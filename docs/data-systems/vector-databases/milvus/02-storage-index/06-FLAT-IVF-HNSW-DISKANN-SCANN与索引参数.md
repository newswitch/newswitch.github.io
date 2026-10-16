---
title: "FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数"
sidebar_label: "06. FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数"
sidebar_position: 6
description: "按召回、延迟、内存、构建和硬件选择 Milvus 向量索引。"
tags: [Milvus, ANN, HNSW, IVF, DISKANN]
---

# FLAT、IVF、HNSW、DISKANN、SCANN 与索引参数

索引可用性随 Milvus 版本、向量类型和 CPU/GPU 后端变化，先查询目标版本支持矩阵。

| 家族 | 思路 | 主要权衡 |
| --- | --- | --- |
| FLAT | 全量精确距离 | 高 Recall、成本随 N×D |
| IVF | 聚类桶，只探测部分 | nlist/nprobe 交换召回与延迟 |
| HNSW | 多层近邻图 | 高内存/构建，低延迟高召回 |
| DISKANN | 磁盘图/缓存 | 降内存，依赖 SSD 与缓存 |
| SCANN/量化 | 候选+压缩/重排 | 内存与误差交换 |

## 1. 评测流程 {/* #评测流程 */}

### 1.1 先定义“最近”和“召回”

欧氏距离最小、内积最大和余弦相似度最大是不同目标。只有查询与库向量都归一化时，才有 `||q-x||² = 2-2(q·x)`，三者的排序相同。FLAT 精确的是指定度量下的近邻，不是“语义必然正确”；Embedding 错误不能靠索引参数修复。

设过滤后精确 Top-K 的 ID 集合为 G，ANN 返回集合为 A，则 `Recall@K = |A∩G|/|G|`。过滤后不足 K 个对象时要明确分母约定；距离相等时也要固定 tie-break 或采用允许并列的评测规则。检索候选、量化距离、最终重排都可能损失召回，不能只测最后一层排序。

```text
real vectors + labeled queries
→ FLAT ground truth
→ build each candidate index
→ sweep search params
→ Recall@K vs P95/P99/QPS
→ index size/build time/load time
→ filter/concurrency/failure
```

只测随机向量会掩盖真实聚类和过滤。索引构建也占 CPU/GPU、内存、对象存储与任务队列，增量写入期间需测构建延迟。

## 2. 索引机制与参数治理 {/* #参数治理 */}

### 2.1 IVF：聚类如何变成一次查询

构建先用训练样本学习 `nlist` 个质心，再把每个向量分配给最近质心对应的倒排桶。查询先计算查询到质心的距离，选 `nprobe` 个桶，在桶内计算距离并维护 Top-K。IVF_FLAT 保留原始向量，因此桶内距离精确，但未探测的桶仍可能含真正近邻。[Milvus IVF_FLAT](https://milvus.io/docs/ivf-flat.md)

用一维例子手算：两个质心是 0、10，查询 q=4.9。q 离质心 0 更近；库中 x=5.1 被分到质心 10 的桶，而 y=0 位于质心 0 的桶。只探测桶 0 会返回 y，尽管 `|q-x|=0.2` 远小于 `|q-y|=4.9`。质心距离不是桶内任意对象距离的下界，所以“最近质心”不等于“包含所有最近对象”。

均匀分桶的粗略距离计算量是 `nlist·D + nprobe·(N/nlist)·D`，另有 Top-K、访存和过滤成本。增大 nlist 缩小单桶却增加质心搜索，增大 nprobe 扩大候选却增加延迟；倾斜数据的热门大桶会使这个均匀模型失效。对 IVF_FLAT 探测全部桶、使用同一数据快照和度量时可恢复全量候选；这不意味着 IVF_PQ 自动恢复原始距离。

### 2.2 HNSW：为什么需要层级和搜索宽度

每个对象随机获得最高层，底层包含全部对象，上层是越来越稀疏的子集。插入时从高层入口贪心下降，在待连接层扩大候选搜索，用邻居选择启发式保留兼顾距离和方向的边，并维护反向连接。只连最近的 M 个点容易把边预算耗在同一个密集簇内，失去跨簇路径。[HNSW 原论文](https://arxiv.org/abs/1603.09320)

搜索高层用少量路径定位入口；底层维护两个集合：待扩展候选按距离从近到远弹出，当前最佳结果保留至多 ef 个对象。发现邻居时计算距离、去重并更新两者；当最近待扩展对象也不优于已满结果集的最差对象时，可以停止该搜索过程。这个停止条件针对当前图路径，不是对所有未访问向量的精确下界。

例如入口距离 10，邻居距离 8、9；只保留一条路径可能沿 8 停住，但距离 9 的点可能连到距离 1 的真正近邻。增加 ef 能保留后一条探索分支，却不能修复根本不存在的连接。`M` 管边预算，`efConstruction` 管建图搜索质量，`ef` 管查询候选宽度；ef 不是严格等于距离计算次数，距离计算还取决于图度数、去重和终止过程。[Milvus HNSW 参数](https://milvus.io/docs/hnsw.md)

### 2.3 PQ：压缩如何改变距离与排序

把 D 维向量切成 m 个子向量，每个子空间训练含 `2^b` 个中心的码本。每个对象只存 m 个中心编号，编码约占 `m·b/8` 字节，码本和 ID 等元数据另算。非对称距离计算保留查询原精度，预先建立查询子向量到各中心的距离表，再对对象的 m 个编号查表求和。IVF_PQ 还可能编码相对粗质心的 residual，查询与码本必须使用相同坐标定义。[Milvus IVF_PQ](https://milvus.io/docs/ivf-pq.md)、[Faiss ProductQuantizer](https://faiss.ai/cpp_api/struct/structfaiss_1_1ProductQuantizer.html)

若原向量 x 重构为 x̂，记 `e=x̂-x`，平方 L2 的距离误差为：

```text
||q-x̂||² - ||q-x||² = -2(q-x)·e + ||e||²
绝对误差 ≤ 2||q-x||·||e|| + ||e||²
```

这说明同一重构误差对不同查询不一定产生相同排序误差。假设两个候选的距离估计误差都不超过 ε，真实距离间隔超过 `2ε` 才能保证次序不被翻转；相近候选最脆弱。例如真实平方距离 1.00、1.05，误差 +0.04、-0.04 会变成 1.04、1.01。原向量重排能修正已进入候选集的次序，但不能找回早已被粗分桶或量化截断的对象。

### 2.4 过滤不是给最终 Top-K 再加一个条件

正确目标是“满足过滤条件的对象中的 Top-K”。若先取未过滤 Top-10，再只剩 1 个合法对象，不能用这个结果评估过滤搜索的 Recall@10；ground truth 也必须先过滤。若合法比例为 q，在独立同分布的理想模型下取 `K/q` 个候选仅使合法数量的期望达到 K，不保证每次足够。过滤属性和向量簇相关时，这个估计更可能失效。

标准过滤可先得到合法集合再参与 ANN；迭代过滤则边找候选边检查标量条件，直到足够结果或搜索终止。稀疏合法集合可能使图探索绕路，复杂标量条件则可能使预过滤昂贵，实际实现还可切换精确扫描。需要同时分析合法比例、过滤代价和候选扩张，不能把“filter 更严格”直接等同于“查询更快”。[Milvus filtered search](https://milvus.io/docs/filtered-search.md)

### 2.5 DISKANN：把容量问题变成搜索与 I/O 调度问题

DISKANN 将图与原始向量等主要数据放在磁盘，以内存中的 PQ code 估计候选距离，并缓存部分热点节点。搜索从入口扩展候选，选择较有希望的节点做磁盘读取、获得邻接关系与更精确距离，再迭代。这仍依赖可导航图质量，不是把 HNSW 文件移到 SSD 就完成等价实现。[Milvus DISKANN](https://milvus.io/docs/diskann.md)

若某次查询需要 12 个未缓存节点，假设每轮最多 4 个独立读取、每轮完成耗时 100 μs，且三轮之间存在探索依赖，理想 I/O 链至少约 300 μs。并发宽度增大可减少波次，但新邻居要等旧节点读出后才能知道，不能一开始发出全部读取；多查询又共享 SSD IOPS/带宽。冷查询的尾延迟可能远高于缓存预热后的均值，减内存并不等于消除延迟成本。

### 2.6 SCANN：候选筛选、量化与重排的分层误差

SCANN 可按“分区选择 → 压缩距离筛选 → 更精确重排”理解。Milvus 当前 SCANN 接口用 nprobe 控制探测分区、reorder_k 控制重排候选，是否保存原向量影响最终距离精度。三阶段依次缩小候选，最后重排的最高召回受候选集包含真实近邻的比例限制。[Milvus SCANN](https://milvus.io/docs/scann.md)

ScaNN 原论文还研究面向最大内积搜索的 anisotropic quantization。令重构误差 e=x̂-x，内积估计误差是 `q·e`；对相同 `||e||`，误差沿 q 的分量大时更影响排名。例如 q=`[1,0]`，误差 `[0.1,0]` 改变得分 0.1，误差 `[0,0.1]` 不改变该查询得分。只最小化所有方向均等的 L2 重构误差，不一定最小化目标查询分布上的 Top-K 错排。因此训练损失可以对重要方向加权，但具体 Milvus 后端是否采用某种论文变体必须核对，不能只凭 SCANN 名称推断。[Anisotropic Vector Quantization 原论文](https://arxiv.org/abs/1908.10396)

### 2.7 参数治理

保存 index definition、build version、search params 和评测结果。查询参数可按 SLO 分级，但不能允许任意客户端无限增大候选宽度。索引变更采用新 index/Collection、双读和回滚。

## 3. 用 Recall 曲线选索引 {/* #用-recall-曲线选索引 */}

固定数据、查询集、Embedding 版本、距离度量和过滤条件，用 FLAT 结果建立 ground truth。对每种候选索引记录 build time、index bytes、load memory、Recall@10、P50/P95/P99 与峰值 QPS，再扫描 `nprobe`、`ef`、`search_list` 等查询参数。

```text
索引选择不是“谁最快”：
数据规模/增长 -> 内存和磁盘预算 -> 召回目标 -> 写入与建索引窗口 -> 延迟/QPS
```

Milvus 3.0 增加了新的索引和 FAISS passthrough 等能力；具体支持的向量类型、GPU/CPU、参数名与默认值以当前版本文档为准。索引构建成功不等于已加载可查，实验要分别记录 build、load 和 search 三个阶段。模型或归一化方式改变后必须重建索引并重新评估召回。

## 4. 验收题 {/* #验收题 */}

- FLAT 为什么可作 Ground Truth？
- nprobe 增大通常怎样影响 Recall/P99？
- HNSW 为何内存较高？
- DISKANN 对磁盘提出什么要求？
- 为什么最近质心的桶可能漏掉最近向量？
- 为什么 ef 不等于距离计算次数，重排也不能消除全部 PQ 召回损失？
- 候选距离间隔多大时，才能抵抗已知的距离估计误差？
- 为什么过滤后 ground truth 和候选宽度必须一起改变？

## 5. 参考资料 {/* #参考资料 */}

- [Index explained](https://milvus.io/docs/index-explained.md)
- [Index in-memory](https://milvus.io/docs/index-vector-fields.md)
