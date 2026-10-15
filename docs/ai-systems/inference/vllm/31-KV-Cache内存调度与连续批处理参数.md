---
title: "vLLM v0.31 KV Cache、内存、调度与连续批处理参数"
sidebar_label: "31. KV、内存与调度参数"
sidebar_position: 31
description: "深入解释 CacheConfig 与 SchedulerConfig，建立显存、KV Block、动态 Batch、Token Budget、抢占和延迟之间的因果关系。"
tags: [vLLM, KV Cache, Scheduler, Continuous Batching, PagedAttention]
---

# vLLM v0.31 KV Cache、内存、调度与连续批处理参数

这一组参数最容易被误解，因为它同时出现“长度、块、序列、Token 和 Batch”：

~~~text
max_model_len          单请求总长度上限
block_size             每个 KV Block 容纳的 Token 数
max_num_seqs           一轮可参与调度的序列上限
max_num_batched_tokens 一轮计划处理的 Token 上限
实际 Batch Size        Scheduler 每一步动态形成的运行结果
~~~

它们不是同一个维度。

## 1. 显存组成

单卡稳态显存近似：

~~~text
M_total
= M_weights
 + M_KV
 + M_activations_workspace
 + M_cuda_graph
 + M_communication
 + M_runtime_fragmentation
~~~

`--gpu-memory-utilization` 不是“KV 占显存的比例”，而是实例规划设备内存时使用的整体比例。权重、运行时和非 KV 开销扣除后，剩余空间才可能交给 KV Cache。

## 2. KV Cache 参数

| 参数 | 含义 | 调整影响 |
|---|---|---|
| `--gpu-memory-utilization` | 实例使用设备内存的目标比例 | 调高可能增加 KV，但压缩峰值余量 |
| `--kv-cache-memory-bytes` | 显式 KV 字节预算 | 支持版本中比比例更直接 |
| `--block-size` | 每个 KV Block 的 Token 数 | 粒度、碎片、元数据和 Backend 约束 |
| `--kv-cache-dtype` | KV 存储精度 | 容量、带宽、Scale 和精度 |
| `--calculate-kv-scales` | 运行时计算 KV Scale | 量化 KV 的精度与初始化成本 |
| `--num-gpu-blocks-override` | 强制 Block 数 | 只用于实验或故障注入 |
| `--enable-prefix-caching` | 允许复用相同前缀的 KV | 命中、占用、淘汰和隔离 |
| `--prefix-caching-hash-algo` | Block Hash 算法 | 哈希成本与稳定性 |
| `--disable-hybrid-kv-cache-manager` | 关闭混合层专用 KV 分组 | 混合 Attention/SSM 模型容量会变化 |
| `--watermark` | 调度时保留的空闲 KV Block 比例 | 减少反复抢占，但降低可用容量 |

## 3. Block Size 的物理意义

假设 `block_size=16`，一个 30 Token 请求需要：

~~~text
ceil(30 / 16) = 2 个 Block
物理槽位 = 32 Token
尾块浪费 = 2 Token
~~~

同样的请求在 `block_size=8` 时需要 4 个 Block，尾部浪费仍为 2 Token，但 Block Table、Hash、空闲链表和调度操作更多。

一般规律：

| 更小 Block | 更大 Block |
|---|---|
| 尾块浪费更小 | Block 数更少 |
| 分配更细 | 元数据和管理成本更低 |
| Prefix 匹配粒度更细 | Backend 更容易做大粒度访问 |
| Block Table 更长 | 短请求尾块浪费更大 |

实际可选值受平台和 Attention Backend 限制，不能只凭公式选择。

## 4. 单 Token KV 字节

普通 Transformer 的近似公式：

~~~text
bytes_per_token
≈ 2
 × num_layers
 × num_kv_heads_per_rank
 × head_dim
 × bytes_per_element
~~~

`2` 表示 K 和 V。GQA/MQA 使用 `num_kv_heads`，不是 Query Head 数；TP 后还要考虑 KV Head 如何切分或复制。

单 Block 字节：

~~~text
bytes_per_block = block_size × bytes_per_token
~~~

可用 KV Block 数近似：

~~~text
num_blocks = floor(KV_budget_bytes / bytes_per_block)
~~~

混合 Attention、MLA、SSM 和特定 Backend 需要使用对应布局，不能生搬这条公式。

## 5. Scheduler 的两个核心预算

| 参数 | 限制对象 |
|---|---|
| `--max-num-seqs` | 本轮最多让多少条序列参与 |
| `--max-num-batched-tokens` | 本轮最多计划多少个 Token |

Scheduler 必须同时满足：

~~~text
scheduled_sequences ≤ max_num_seqs
scheduled_tokens ≤ max_num_batched_tokens
KV slots 足够
执行 Shape 和 Backend 可支持
~~~

因此 `max_num_seqs=64` 不代表 HTTP 并发只能是 64，也不证明稳定运行 Batch 一定是 64。

## 6. Continuous Batching

静态 Batch 必须等整批结束；连续批处理每个 Engine Step 都重新组织：

~~~text
Step N:
  A decode + B decode + C prefill chunk

完成：B
新到达：D、E

Step N+1:
  A decode + C prefill chunk + D prefill + E prefill
~~~

实际 Batch Size 是运行结果：

~~~text
actual_batch(t)
= f(到达率, 请求长度, 已完成请求, KV 空间,
    max_num_seqs, token_budget, 调度策略, Graph Shape)
~~~

不存在一个固定的 Serve `--batch-size` 能完整描述这件事。

## 7. Chunked Prefill 参数

| 参数 | 作用 |
|---|---|
| `--enable-chunked-prefill` | 把长 Prompt 拆成多个调度轮次 |
| `--long-prefill-token-threshold` | 识别长 Prefill |
| `--max-num-partial-prefills` | 一轮允许的部分 Prefill 数 |
| `--max-long-partial-prefills` | 其中长 Prefill 的上限 |
| `--max-num-batched-tokens` | 形成 Chunk 的关键 Token Budget |

Chunk 大：

- Prefill 吞吐通常更好；
- 单轮 GPU 占用更长；
- Decode TPOT/P99 可能受干扰。

Chunk 小：

- 更容易给 Decode 插入执行机会；
- 调度、Kernel Launch 和中间状态开销增加；
- 长 Prompt TTFT 可能变差。

## 8. 调度策略与异步调度

| 参数 | 含义 |
|---|---|
| `--scheduling-policy` | FCFS、Priority 等请求选择策略 |
| `--scheduler-cls` | 自定义 Scheduler |
| `--async-scheduling` | 将部分 CPU 调度与设备执行重叠 |
| `--prefill-schedule-interval` | DP 场景中隔多少个 Engine Step 接纳 Prefill |
| `--stream-interval` | 每多少 Token 向前端产生一次流式输出 |

异步调度减少 GPU 等待 CPU 的空洞，但会改变状态可见时机和部分功能组合。验证不能只看吞吐，还要测试取消、异常、流式顺序和多 Rank 一致性。

## 9. Watermark 与抢占

KV Block 接近耗尽时，若继续接纳请求，可能出现：

~~~text
分配失败
→ 抢占运行请求
→ 释放其 KV
→ 被抢占请求稍后重新调度
→ 重新计算已丢弃状态
→ 尾延迟上升
~~~

`--watermark` 主动保留一部分空闲 Block，减少刚释放又立即抢占的振荡。代价是降低名义容量。

抢占不是 CUDA OOM。CUDA OOM 是分配设备内存失败；KV 抢占是 Scheduler 在逻辑 Block 预算不足时主动回收或重算。

## 10. Prefix Cache 与容量

Prefix Cache 命中主要减少重复 Prefill 计算。它不会让后续 Decode 不再需要上下文 KV。

需要同时记录：

- 查询的前缀 Token；
- 命中的 Token；
- 被锁定和可淘汰 Block；
- Cache Eviction；
- Prefill 计算减少量；
- 租户 Cache Salt。

只看“命中请求数”会误判：命中 10 个 Token 和命中 10,000 个 Token 的价值完全不同。

## 11. 参数联动示例

### 11.1 同时调大四项为什么危险

~~~text
max_model_len ↑
max_num_seqs ↑
max_num_batched_tokens ↑
gpu_memory_utilization ↑
~~~

这会同时扩大单请求 KV 上限、并发 KV、单轮 Workspace，并压缩安全余量。出现 OOM 后无法知道主因。

### 11.2 安全调优顺序

1. 固定模型、dtype、TP 和最大上下文。
2. 记录权重加载后的 HBM。
3. 确认自动分配的 KV Block 数。
4. 扫描 `max_num_seqs`。
5. 固定并发后扫描 `max_num_batched_tokens`。
6. 调整 Chunked Prefill。
7. 再评估 Graph Capture Size。

## 12. 指标到参数

| 现象 | 相关参数/证据 |
|---|---|
| Waiting 持续增长、GPU 未满 | max sequences、Token Budget、前端供给 |
| TTFT 高、TPOT 正常 | Prefill Budget、Chunk、队列、Tokenizer |
| TPOT P99 抖动 | 大 Prefill 混跑、Decode Batch、Graph 未命中 |
| Preemption 增长 | KV Block、长输出、并发、Watermark |
| KV 使用高但 GPU Util 低 | 长上下文等待 Decode、到达率低或前端饥饿 |
| Capture OOM | Graph Shape、max sequences、剩余 HBM |

## 13. 验收题与答案

**问题：`block_size=32` 是否表示一次处理 32 个请求？**

答案：不是。它表示一个 KV Block 容纳 32 个连续 Token，与请求 Batch 数没有直接等价关系。

**问题：为什么降低 `max_num_seqs` 可能改善 P99？**

答案：它减少同时驻留的序列和 KV 压力，也可能减少抢占与过大 Decode Batch；代价是排队和总吞吐可能变差。

**问题：KV Cache 使用率 100% 是否等于 CUDA OOM？**

答案：不等于。前者是逻辑 KV Block 池耗尽，Scheduler 可以抢占或拒绝接纳；后者是 CUDA Allocator 无法满足设备内存分配。

## 14. 官方资料

- [vLLM v0.31.0 Engine Arguments](https://docs.vllm.ai/en/v0.31.0/configuration/engine_args/)
- [Automatic Prefix Caching](https://docs.vllm.ai/en/v0.31.0/features/automatic_prefix_caching/)
- [Optimization and Tuning](https://docs.vllm.ai/en/v0.31.0/configuration/optimization/)
