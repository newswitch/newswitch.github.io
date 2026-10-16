---
title: "SELECT Pipeline、向量化、PREWHERE、Join 与聚合"
sidebar_label: "06. SELECT Pipeline、向量化、PREWHERE、Join 与聚合"
sidebar_position: 6
description: "从解析、裁剪、列读取到并行 Pipeline、Join、聚合和输出定位查询成本。"
tags: [ClickHouse, Query Pipeline, PREWHERE, Join]
---

# SELECT Pipeline、向量化、PREWHERE、Join 与聚合

```text
parse/analyze/plan
→ partition/index pruning
→ parallel read ranges
→ PREWHERE/filter
→ expression/join/aggregate/sort
→ merge streams → format/output
```

ClickHouse 按 Block 批量处理列，减少解释和分支成本。`max_threads` 控制部分并行，不代表每查询固定线程数。

## 1. 列批处理的源码结构 {/* #列批处理源码 */}

源码基线为 ClickHouse `v24.8.1.2684-lts`，选择普通数值列的过滤路径。`ColumnVector<T>` 的数据容器是 `PaddedPODArray<T>`，批处理中的同列数值连续存放；`FilterTransform` 针对一个 Chunk 执行过滤表达式，产生共同的行过滤条件，再对相应列执行过滤。[数值列容器](https://github.com/ClickHouse/ClickHouse/blob/v24.8.1.2684-lts/src/Columns/ColumnVector.h#L48)、[Chunk 过滤](https://github.com/ClickHouse/ClickHouse/blob/v24.8.1.2684-lts/src/Processors/Transforms/FilterTransform.cpp#L123)

例如两列 `id=[10,11,12,13]`、`price=[5,20,7,30]`，条件 `price>10` 生成 mask `[0,1,0,1]`。对两列应用同一 mask 后得到 `id=[11,13]`、`price=[20,30]`。这里批处理的是同一算子下的一组行，不是向量数据库的相似度检索，也不是把两列各自过滤后再随意拼接。

### 1.1 过滤为何既有批次又有硬件分支

`ColumnVector<T>::filter` 先验证 mask 与列长度一致，并为结果准备空间；它把对齐部分按每组 64 个 mask 元素处理，剩余尾部走逐项路径。该版本对适合的元素宽度和支持的 CPU 还可选择 AVX512VBMI2 实现，否则使用默认实现。64 是这段过滤实现的分组数量，不是“所有 ClickHouse Block 固定 64 行”。[数值列过滤与硬件选择](https://github.com/ClickHouse/ClickHouse/blob/v24.8.1.2684-lts/src/Columns/ColumnVector.cpp#L679)

默认实现会把 mask 压成位图，并对连续通过区域等情况优化复制；硬件分支可使用压缩写入指令。可以据此解释减少部分分支、调度和散乱访问的机会，却不能推出每个算子都是 SIMD 或所有类型都走同一快路径。Nullable、String、常量列和低基数表示还要考虑自己的结构；编译选项与 CPU 能力也影响实际分派。

### 1.2 Pipeline 怎样把计算和背压分开

`ISimpleTransform::prepare` 先检查输出端口：下游不能接收时将输入设为不需要，并返回 `PortFull`；缺少输入时返回相应等待状态；有可执行输入才返回 Ready。`work` 负责实际 transform，再保存待输出状态。这不是每个算子都占一个线程阻塞等待下游的流水线。[prepare 与 work](https://github.com/ClickHouse/ClickHouse/blob/v24.8.1.2684-lts/src/Processors/ISimpleTransform.cpp#L15)

由此可以推断，调度器能把线程用于当前可执行的 Processor，避免部分无效推进；但排序、Join 和聚合仍可能保留大量内部状态，不能因为有背压就断言内存始终有界。批次过大也可能增加临时内存和延迟。ClickHouse 的收益要把列式读取、裁剪、批处理、实际硬件路径和 Pipeline 放在一起分析，不能只用“用了 SIMD”解释所有查询。

## 2. PREWHERE {/* #prewhere */}

先读取选择性过滤列，确定行后再读其余列，降低 I/O。优化器可自动移动条件；用 EXPLAIN 和 read bytes 证明。过滤列很宽/选择性差时收益有限。

### 2.1 理想字节模型与真实读取粒度 {/* #11-理想字节模型与真实读取粒度 */}

设 N 行，过滤列每行 4 字节，其他所需列每行 100 字节，匹配比例 q=1%。若能按匹配行精确读取宽列，先全读再过滤需要 `104N` 字节，PREWHERE 需要 `4N+100qN=5N` 字节，理想字节比为 20.8。它只是列字节工作量的上界比较，不等于端到端加速 20.8 倍。[PREWHERE 的分阶段列读取](https://clickhouse.com/docs/reference/statements/select/prewhere)

如果每个压缩块都至少有一行匹配，宽列仍可能需要读取大量块；压缩、缓存、表达式 CPU 和最终输出还会改变瓶颈。多个条件要比较“读取该列与计算条件的代价 / 能排除的后续读取量”，不是机械地把最严格条件放最前。

## 3. Join {/* #join */}

Hash/parallel hash、merge、direct、grace hash 等算法在内存、排序、外部存储和字典访问间权衡。小表放右侧/字典并非万能，需考虑分布式数据搬运和重复键语义。

### 3.1 Join 语义先决定工作量 {/* #21-join-语义先决定工作量 */}

ALL 等值连接中，左侧某键有 a 行、右侧有 b 行，结果需要 `a·b` 行；右表“小”也可能因重复键产生巨大输出。ANY、SEMI 等语义改变的是结果集合，不是无代价的优化替代，必须先证明业务允许。

Hash Join 的内存不是右表原始文件大小，而是建表行、键、payload、桶和分配器开销。Grace hash 将输入分桶后逐桶处理，降低同时驻留量，却增加读写；单个极热键仍可能形成大分区。Merge Join 可借助已有排序省去 hash 内存，但需要输入顺序与键匹配。算法选择受数据分布和内存限制共同影响。

## 4. 聚合 {/* #聚合 */}

Hash table 按 key 基数增长；two-level aggregation、partial merge 和 external spill 控制内存。`GROUP BY` 高基数、`uniqExact`、大状态函数和并发会触发 OOM/落盘。

### 4.1 从局部状态到全局结果 {/* #31-从局部状态到全局结果 */}

每个读取流为自己的 key 建局部聚合状态，再合并相同 key 的状态，最后 finalize。平均数必须传 `(sum,count)`，distinct 必须传集合或 sketch；具体推导见[聚合状态的代数契约](../01-foundations-storage/05-Replacing-Summing-Aggregating-Collapsing-MergeTree.md#能合并的不是任意最终值)。若在每个流先 finalize 再平均，改变线程数就可能改变逻辑结果。

假设 G 个分组，key 与 hash entry 平均开销 h，状态平均大小 s，则单张表约需 `G·(h+s)`，多个流的局部重复分组还会额外占内存。固定大小 count 状态与随输入增长的 `uniqExact` 集合不能使用同一个 s。Spill 将状态移到磁盘，不消灭其合并 CPU、序列化和最终结果成本；某个单组的巨大状态也不能靠只增加分组桶数解决。

## 5. 排障 {/* #排障 */}

用 `EXPLAIN PIPELINE`、query_log/ProfileEvents、read_rows/bytes、memory_usage、temporary files 定位。返回亿行时客户端/网络是瓶颈，先限制结果。

## 6. 查询 Pipeline 取证 {/* #查询-pipeline-取证 */}

```sql
EXPLAIN PIPELINE
SELECT tenant, count(), quantile(0.99)(latency)
FROM events PREWHERE ts >= now() - INTERVAL 1 DAY
GROUP BY tenant;

SELECT query_duration_ms, read_rows, read_bytes, memory_usage, ProfileEvents
FROM system.query_log WHERE type = 'QueryFinish' ORDER BY event_time DESC LIMIT 10;
```

用 `EXPLAIN indexes=1/PIPELINE/PLAN` 区分索引裁剪、并行执行和算子逻辑；再用 query_log 证明读放大、内存和线程。PREWHERE 适合先读取高选择性列，不保证手写一定优于优化器。

Join/聚合问题要检查右表大小、键分布、算法、溢写、并发和 distributed 阶段。单查询更快但占满全部线程可能降低集群吞吐，调优要同时比较单查询 P99 与多租户并发吞吐，并设置内存/执行时间/读取量限制。

## 7. 验收题 {/* #验收题 */}

- 向量化执行与向量数据库有什么区别？
- PREWHERE 为什么能少读列？
- 高基数聚合如何耗尽内存？
- max_threads 越大为何不一定更快？

## 8. 参考资料 {/* #参考资料 */}

- [Query optimization](https://clickhouse.com/docs/optimize/query-optimization)
- [EXPLAIN](https://clickhouse.com/docs/sql-reference/statements/explain)
