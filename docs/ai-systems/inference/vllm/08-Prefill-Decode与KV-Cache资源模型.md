---
title: "Prefill、Decode 与 KV Cache 资源模型"
sidebar_position: 8
tags: [vLLM, Prefill, Decode, KV Cache, PagedAttention, TTFT, TPOT]
description: "从计算量、显存带宽和 KV Cache 容量出发，理解 Prefill 与 Decode 的性能差异，并建立可用于容量规划和故障分析的资源模型。"
---

# Prefill、Decode 与 KV Cache 资源模型

大模型推理不是一次普通的前向计算，而是两个资源特征不同的阶段：

```text
Prefill：一次处理输入 Prompt
Decode：逐步生成输出 Token
```

如果不区分两者，常见误判包括：

- 只看 GPU 利用率判断容量。
- 用一个 tokens/s 指标代表全部体验。
- 认为显存只由模型权重决定。
- 把 KV Cache 满和 CUDA OOM 混为一谈。
- 通过增加 Batch 一味追求吞吐，却让 TTFT 或 TPOT 失控。

---

## 1. 自回归生成

Decoder-only Transformer 的生成过程：

```text
输入 tokens: x1, x2, ... xL
Prefill 计算 → 生成 y1
Decode(y1)   → 生成 y2
Decode(y2)   → 生成 y3
...
```

模型每一步只能在已有上下文基础上产生下一个 token，因此单个请求的 Decode 在 token
维度是串行的。

GPU 并行性来自：

- 一个请求的矩阵运算。
- 多个请求组成 Batch。
- TP/PP/DP/EP。
- Prefill 中同时处理多个输入 token。

---

## 2. Prefill 阶段

Prefill 输入整个 Prompt 或一个 Prompt Chunk：

```text
[token_1, token_2, ..., token_L]
```

每一层执行：

```text
Embedding
→ Q/K/V Projection
→ Attention
→ Output Projection
→ MLP
→ 写入本层 KV Cache
```

### 2.1 资源特点

- 多个 token 可并行计算。
- 大 GEMM 更容易充分使用 Tensor Core。
- 通常计算密度较高。
- Prompt 越长，计算量越大。
- Attention 在普通实现中随上下文长度有明显增长。
- 需要一次性写入大量 KV Cache。

因此 Prefill 直接影响：

- TTFT。
- Prompt tokens/s。
- 新请求对正在 Decode 请求的干扰。

### 2.2 Prefill 不是只有 GPU 时间

端到端 Prefill 前还有：

```text
Chat Template
→ Tokenization
→ Scheduler Queue
→ Prefix Cache Lookup
→ KV Block Allocation
→ H2D / Metadata Preparation
```

所以 TTFT 变慢时不能直接断言是 Prefill Kernel 变慢。

---

## 3. Decode 阶段

Decode 每个 Step 通常为每个请求处理一个或少量新 token：

```text
new token
→ 生成 Q/K/V
→ 读取全部历史 KV
→ Attention
→ MLP
→ 采样下一个 token
```

### 3.1 资源特点

- 单请求每步矩阵较小。
- 每步都要读取模型权重。
- Attention 要读取该请求历史 KV。
- 每个 Step 后可能发生跨 GPU Collective。
- 容易受显存带宽、通信延迟和调度开销影响。

多个请求 Continuous Batching 的目的，就是把许多小 Decode 操作合并，提高矩阵规模和
硬件利用率。

### 3.2 Decode 为什么常被称为带宽受限

粗略理解：

```text
每生成一个 token：
  计算一次模型
  读取大量权重
  读取历史 KV
```

如果 Batch 太小，同一批读取权重只服务很少的 token，算术强度低，计算单元可能等待
显存数据。

随着 Batch 增大，同一轮权重读取服务更多 Sequence，吞吐通常提高；但 Batch 增大也会：

- 占用更多 KV Cache。
- 增加单步执行时间。
- 影响单请求 TPOT。
- 增加排队。

---

## 4. TTFT、TPOT 与 E2E

### 4.1 TTFT

```text
TTFT =
  Queue
  + Input Processing
  + Prefill
  + First Sampling
  + Output Flush
```

### 4.2 TPOT

请求级常用近似：

```text
TPOT =
  (request_duration - TTFT)
  / (output_tokens - 1)
```

不同实现对起止点可能不同，必须核对指标定义。

### 4.3 ITL

```text
ITL_i = receive_time(token_i) - receive_time(token_i-1)
```

TPOT 是请求平均值；ITL 分布能发现周期性停顿和调度抖动。

### 4.4 E2E

```text
E2E ≈ TTFT + (output_tokens - 1) × TPOT
```

它是近似式，因为实际 ITL 并不完全相等。

---

## 5. KV Cache 保存了什么

在每一层 Self-Attention 中：

```text
Q = XWq
K = XWk
V = XWv
```

生成下一个 token 时，只需要计算新 token 的 Q/K/V；历史 token 的 K/V 从 Cache 读取。

如果没有 KV Cache：

```text
第 1 步重新算 L 个 token
第 2 步重新算 L+1 个 token
第 3 步重新算 L+2 个 token
...
```

有 KV Cache 后，只追加新 token 的 K/V，大幅减少重复计算，但消耗显存。

---

## 6. KV Cache 容量公式

对标准或 GQA/MQA Attention，可用下面的近似：

```text
KV bytes per token =
  num_layers
  × 2
  × num_kv_heads
  × head_dim
  × bytes_per_element
```

其中 `2` 表示 Key 和 Value。

一个请求：

```text
request_kv_bytes =
  kv_bytes_per_token
  × (prompt_tokens + generated_tokens)
```

所有并发请求：

```text
total_kv_bytes =
  Σ request_kv_bytes
  + block/internal overhead
```

### 6.1 示例

假设：

```text
num_layers = 32
num_kv_heads = 8
head_dim = 128
dtype = BF16 = 2 bytes
```

每 token：

```text
32 × 2 × 8 × 128 × 2
= 131072 bytes
= 128 KiB/token
```

8K token 上下文：

```text
128 KiB × 8192 ≈ 1 GiB
```

这表示一个请求在全模型范围的 KV 近似占用。TP 下每卡实际占用取决于 KV Head 是否以及
如何切分，不能在不了解模型和实现时简单除以 TP。

### 6.2 为什么 GQA/MQA 能降低 KV

MHA：

```text
num_kv_heads = num_attention_heads
```

GQA：

```text
num_kv_heads < num_attention_heads
```

MQA：

```text
num_kv_heads = 1
```

KV Cache 与 `num_kv_heads` 成正比，因此 GQA/MQA 对长上下文推理非常重要。

---

## 7. 推理显存组成

```text
GPU Memory =
  Model Weights
  + KV Cache
  + Activations / Temporary Tensors
  + CUDA Graph
  + NCCL / Communication Buffers
  + CUDA Context
  + Allocator Fragmentation
  + Safety Margin
```

### 7.1 权重近似

```text
weight_bytes ≈ parameter_count × bits_per_weight / 8
```

还要加：

- Quantization scale/zero-point。
- 未量化层。
- Padding 和 Shard 对齐。
- Runtime 转换副本。

### 7.2 KV Cache 预算

如果运行时根据 `gpu_memory_utilization` 自动推导 KV Cache：

```text
usable_memory
  - weights
  - measured_runtime_peak
  - safety
= KV Cache pool
```

启动时显存接近设定水位通常是预分配结果，不代表发生泄漏。

---

## 8. PagedAttention 与 Block

连续显存分配有两个问题：

- 每个请求长度不同，预留最大长度浪费显存。
- 请求增长和结束会产生碎片。

PagedAttention 把 KV Cache 划分成固定粒度 Block：

```text
Logical Block 0 → Physical Block 17
Logical Block 1 → Physical Block 03
Logical Block 2 → Physical Block 88
```

请求只在需要时获得新 Block。

### 8.1 Block 带来的收益

- 非连续物理存储。
- 减少外部碎片。
- 便于请求间共享 Prefix。
- 易于统一分配、引用和回收。

### 8.2 Block 的内部浪费

如果一个 Block 容纳 16 token，而请求最后只使用 1 token，剩余空间暂时无法给其他请求
使用。这是内部碎片。

Block 越大：

- 元数据和调度开销可能更低。
- 内部碎片可能更高。
- Prefix Cache 复用粒度更粗。

具体可选值和默认值必须以当前 vLLM/Attention Backend 为准。

---

## 9. Automatic Prefix Caching

如果多个请求共享相同前缀：

```text
System Prompt
+ 相同文档
+ 不同用户问题
```

可复用已经计算的 KV Block，跳过重复 Prefill。

V1 的基本思想：

```text
block_hash =
  hash(parent_hash, block_tokens, extra_hashes)
```

`extra_hashes` 可包含：

- LoRA ID。
- 多模态输入 Hash。
- Cache Salt。

### 9.1 只复用完整 Block

Prefix Cache 通常以完整 Block 为复用单位，不完整尾块需要重新计算或等待补齐。

### 9.2 Prefix Cache 改善什么

主要改善：

- 重复 Prefix 的 Prefill 计算。
- TTFT。
- Prompt tokens 实际计算量。

通常不改善：

- 新输出 token 的 Decode。
- 没有共同前缀的请求。
- 首次出现的 Prefix。

### 9.3 多租户隔离

共享 Prefix Cache 可能通过延迟差异暴露“某前缀是否曾被使用”。

多租户平台应：

- 按信任域设置 Cache Salt。
- 不允许不可信租户任意共享缓存。
- 使用安全哈希策略。
- 不在日志中记录 Prompt。

---

## 10. KV Cache 满时会发生什么

KV Cache 使用率接近 100% 后，可能出现：

1. 新请求无法获得足够 Block，继续等待。
2. Scheduler 抢占部分请求。
3. 被抢占请求需要后续重算。
4. Prefix Cache Block 被逐出。
5. 达到配置限制后拒绝请求。

这与 CUDA OOM 不同：

| KV Cache 容量不足 | CUDA OOM |
| --- | --- |
| Cache Pool 逻辑容量不足 | Allocator 无法分配 GPU Memory |
| 常表现为 waiting/preemption | 常导致请求或进程报错 |
| 可通过准入和调度控制 | 需要检查峰值、碎片和显存预算 |
| 显存可能仍按预留水位稳定 | 可能出现分配失败栈 |

---

## 11. 容量模型

### 11.1 Token 容量

```text
max_resident_tokens ≈
  kv_cache_pool_bytes
  / kv_bytes_per_token
```

实际还要减去 Block 对齐和内部开销。

### 11.2 并发容量

如果平均每请求驻留 token：

```text
average_resident_tokens =
  average_prompt_tokens
  + average_generated_tokens_in_flight
```

则：

```text
kv_limited_concurrency ≈
  max_resident_tokens
  / average_resident_tokens
```

但真实并发上限还受：

- `max_num_seqs`。
- Token Budget。
- TTFT/TPOT SLO。
- Gateway 队列。
- GPU 计算和带宽。
- TP/PP/EP 通信。

所以“显存能放下”不等于“SLO 能承载”。

---

## 12. 关键指标

| 目标 | 指标 |
| --- | --- |
| Queue | waiting、request queue time |
| Prefill | prompt tokens、prefill time、computed/cached prompt tokens |
| Decode | generation tokens、decode time、ITL/TPOT |
| KV | KV Cache usage |
| Cache | prefix queries、hits、cached prompt tokens |
| 压力 | preemption、rejected requests |
| 用户 | TTFT、E2E、流式完成率 |

PromQL 示例：

```promql
sum(rate(vllm:prompt_tokens[5m]))
```

```promql
sum(rate(vllm:generation_tokens[5m]))
```

```promql
max(vllm:kv_cache_usage_perc)
```

```promql
sum(rate(vllm:prefix_cache_hits[5m]))
/
sum(rate(vllm:prefix_cache_queries[5m]))
```

部署版本可能调整指标名称，先检查 `/metrics`。

---

## 13. 症状判断矩阵

| Queue | Prefill | TPOT | KV | 可能原因 |
| --- | --- | --- | --- | --- |
| 高 | 高 | 正常 | 中 | 长 Prompt 或 Prefill 算力不足 |
| 高 | 正常 | 高 | 高 | Decode/KV 容量饱和 |
| 高 | 正常 | 正常 | 低 | 准入、路由不均或 Scheduler 限制 |
| 低 | 高 | 高 | 中 | Prefill 干扰 Decode、GPU/通信退化 |
| 低 | 正常 | 高 | 低 | Batch 太小、频率下降、网络通信 |
| 高 | 高 | 高 | 高 | 整体过载 |

这只是形成假设的入口，最终需要 Trace、Profiler 和对照实验验证。

---

## 14. 调优方向

### TTFT 优先

- 限制输入长度。
- 启用并验证 Prefix Cache。
- 调整 Chunked Prefill。
- 控制排队。
- 提高短请求优先级或分池。
- 增加副本/DP。

### TPOT 优先

- 保证 Decode 优先。
- 控制每轮 Prefill Token。
- 调整并发和 Batch。
- 检查显存带宽与 GPU 时钟。
- 优化 TP/EP 通信。

### 吞吐优先

- 增大有效 Batch。
- 增大 Token Budget。
- 使用合适量化和 Kernel。
- 提高 Prompt/Prefix Cache 命中。
- 用 DP 扩展独立 Batch。

任何调优都要同时观察 TTFT、TPOT、吞吐和错误率，不能只优化一个数字。

---

## 15. 实验

### 实验 1：测 KV bytes/token

1. 读取模型 `num_hidden_layers`、`num_key_value_heads`、`head_dim`。
2. 按公式计算。
3. 固定模型，逐步增加总驻留 token。
4. 对照运行时 KV Cache 容量和使用率。

### 实验 2：Prefill 与 Decode 分离测量

准备：

```text
A: 4K 输入，1 输出
B: 16 输入，512 输出
```

- A 主要观察 Prefill/TTFT。
- B 主要观察 Decode/TPOT。

### 实验 3：Prefix Cache

重复相同长 System Prompt：

1. 第一次冷请求。
2. 后续相同 Prefix 请求。
3. 比较 computed prompt tokens、cache hits 和 TTFT。
4. 修改一个完整 Block 内 token，观察命中边界。

### 实验 4：KV 压力

逐步提高并发和上下文，观察：

```text
KV usage
→ waiting
→ preemption
→ TTFT/TPOT
→ rejected/error
```

不要在生产集群直接进行饱和实验。

---

## 16. 验收清单

- [ ] 能解释 Prefill 与 Decode 的资源差异。
- [ ] 能分解 TTFT、TPOT、ITL 和 E2E。
- [ ] 能根据模型配置计算 KV bytes/token。
- [ ] 能估算 KV 限制下的驻留 Token 和并发。
- [ ] 能解释 PagedAttention Block 与碎片。
- [ ] 能说明 Prefix Cache 改善和不改善什么。
- [ ] 能区分 KV Cache 满和 CUDA OOM。
- [ ] 能设计 Prefill-only 与 Decode-heavy 基准。

## 17. 官方资料

- [vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/stable/design/prefix_caching/)
- [vLLM KV Cache Configuration](https://docs.vllm.ai/en/stable/api/vllm/config/cache/)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)
- [vLLM V1 User Guide](https://docs.vllm.ai/en/latest/getting_started/v1_user_guide.html)

下一篇将解释 Scheduler 如何把 Prefill 和 Decode 请求动态组成 Continuous Batch，以及
Chunked Prefill 为什么可以改善长短请求干扰。
