---
title: "Continuous Batching 与 Chunked Prefill"
sidebar_label: "09. Continuous Batching 与 Chunked Prefill"
sidebar_position: 9
tags: [vLLM, Continuous Batching, Chunked Prefill, Scheduler, TTFT, ITL]
description: "理解 vLLM 如何在每个 Engine Step 动态重组批次、分配 Token Budget，并通过 Chunked Prefill 缓解长 Prompt 对 Decode 的阻塞。"
---

# Continuous Batching 与 Chunked Prefill

传统离线推理常把一批固定样本一起执行，必须等整批完成后才能开始下一批。

在线 LLM 请求具有三个特点：

- 到达时间不同。
- 输入长度不同。
- 输出长度事先未知。

如果使用静态 Batch，一个生成 1000 token 的请求会让已经完成的短请求所在位置长期空闲，
新请求也不能及时加入。

Continuous Batching 的核心是：

> 每个 Engine Step 都重新决定本轮执行哪些请求和多少 token。

---

## 1. 静态 Batch 的问题

假设同时进入三个请求：

| 请求 | Prompt | Output |
| --- | ---: | ---: |
| A | 128 | 32 |
| B | 128 | 256 |
| C | 128 | 1024 |

静态 Batch：

```text
Step 1 ... 32:   A B C
Step 33 ... 256:   B C
Step 257 ... 1024:   C
```

A 完成后的槽位不能及时放入 D，B 完成后的槽位也继续浪费。

Continuous Batch：

```text
A 完成 → 下一 Step 可以加入 D
B 完成 → 下一 Step 可以加入 E
```

批次是“活的”，吞吐和设备利用率通常更高。

---

## 2. Engine Step

一次简化的 V1 Engine Step：

```text
接收新请求与取消请求
→ Scheduler 分配本轮 Token Budget
→ KVCacheManager 分配 Block
→ 生成 Scheduler Output
→ ModelExecutor 执行
→ Sample Token
→ 更新请求状态
→ 释放完成请求资源
→ 输出增量结果
```

伪代码：

```python
while has_requests:
    scheduler_output = scheduler.schedule()
    model_output = model_executor.execute_model(scheduler_output)
    outputs = scheduler.update_from_output(
        scheduler_output,
        model_output,
    )
    output_processor.emit(outputs)
```

真实实现包含异步执行、Structured Output、Speculative Decoding、DP 协调等更多路径。

---

## 3. Scheduler 的两个主要预算

### 3.1 Sequence Budget

```text
max_num_seqs
```

限制一轮最多处理多少 Sequence。

过小：

- Decode Batch 小。
- GPU 利用率可能不足。
- 等待请求增加。

过大：

- KV Cache 压力上升。
- 单 Step 时间可能增加。
- 请求间干扰更明显。

### 3.2 Token Budget

```text
max_num_batched_tokens
```

限制一轮最多调度多少 token。

一个 Decode 请求本轮通常消耗少量 token；Prefill 请求可能消耗大量 token。

示例：

```text
Token Budget = 4096

128 个 Decode 请求 × 1 token = 128
剩余 Prefill Budget           = 3968
```

如果新 Prompt 有 20K token，不能在这一轮全部处理，就需要切块。

---

## 4. 没有 Chunked Prefill 时的问题

假设一个长 Prefill 与一批 Decode 同时存在。

### 策略 A：先完整 Prefill

```text
[Long Prefill 20K]
→ [Decode Batch]
```

优点：

- 长请求 Prefill 完成快。
- 大 GEMM 计算效率高。

问题：

- 正在流式输出的请求长时间得不到下一 token。
- ITL/TPOT 出现尖峰。

### 策略 B：Decode 永远优先，完整 Prefill 必须等

优点：

- Decode 流畅。

问题：

- 长 Prompt 可能长时间进不来。
- Prefill 吞吐下降或饥饿。

Chunked Prefill 在两者之间分配每轮预算。

---

## 5. Chunked Prefill

把长 Prompt 分成多个 Chunk：

```text
20K Prompt
→ 4K + 4K + 4K + 4K + 4K
```

每轮先安排需要继续 Decode 的请求，再用剩余 Token Budget 安排 Prefill Chunk。

```text
Step N:
  Decode tokens: 128
  Prefill chunk: 3968

Step N+1:
  Decode tokens: 125
  Prefill chunk: 3971
```

官方当前 V1 优化说明中，Chunked Prefill 在可用时通常启用，并以 Decode 优先为核心，
再把 Prefill 填入剩余 Token Budget。实际默认值和限制仍应由运行版本确认。

---

## 6. 为什么混合 Prefill 与 Decode

粗略资源特征：

```text
Prefill → 更偏计算密集
Decode  → 更偏显存带宽
```

把两者放进同一批次可能更充分地使用 GPU 的计算与带宽资源。

但收益不是无条件的：

- Model/Kernel 是否支持高效混合。
- Chunk 大小。
- TP/PP 通信。
- Prompt 长度分布。
- Decode Batch 大小。
- GPU 架构和量化方式。

必须通过目标硬件压测验证。

---

## 7. 参数之间的关系

### `max_num_batched_tokens`

较小通常：

- 单轮 Prefill 干扰较小。
- Decode ITL 更稳定。
- 长 Prompt 需要更多轮完成。
- Prefill 大矩阵效率可能下降。

较大通常：

- Prefill 吞吐更高。
- 长 Prompt 更快完成。
- 单个 Step 更长。
- Decode 尾延迟可能变差。

### `max_num_seqs`

决定一轮最多容纳的 Sequence 数；需要与 KV Cache 容量和典型上下文一起测。

### `long_prefill_token_threshold`

用于定义何种 Prompt 被视为长 Prefill。设置为 0 等行为随配置语义而定，应检查当前 CLI。

### `max_num_partial_prefills`

限制同时存在多少 Partial Prefill。

### `max_long_partial_prefills`

限制其中长 Prefill 数量。让该值小于总 Partial Prefill 数，可为短 Prompt 留出机会。

### Scheduling Policy

当前 Scheduler 可支持类似：

```text
fcfs
priority
```

优先级调度必须有反饥饿和租户约束，否则低优先级请求可能永远无法执行。

---

## 8. 一个调度示例

假设：

```text
max_num_batched_tokens = 2048
max_num_seqs = 64
```

当前：

| 请求组 | 数量 | 每请求本轮 token |
| --- | ---: | ---: |
| Decode | 48 | 1 |
| Short Prefill | 1 | 512 |
| Long Prefill | 1 | 8192 remaining |

本轮可能分配：

```text
Decode:        48
Short Prefill: 512
Long Prefill:  1488
Total:         2048
```

下一轮长 Prefill 仍有：

```text
8192 - 1488 = 6704 tokens
```

如果新的短请求加入，Scheduler 还要根据 FCFS/Priority、Partial Prefill 上限和 KV Block
决定顺序。

---

## 9. Head-of-Line Blocking

队首阻塞不只发生在 HTTP 队列，也发生在 Token 和 KV 资源层。

### 场景

队首请求需要大量 KV Block，但当前空闲不足；后面的小请求本可运行。

需要考虑：

- 是否允许小请求越过。
- 是否会造成大请求饥饿。
- 是否按租户/优先级隔离。
- 是否在 Gateway 阶段就拒绝不可能满足的请求。

如果 Scheduler 反复尝试一个无法分配的请求，会浪费控制面时间并放大尾延迟。

---

## 10. 抢占与重算

运行中请求随着生成会持续申请 KV Block。

容量不足时可能抢占请求：

```text
Running
→ Preempted
→ 释放部分/全部运行资源
→ 后续重新调度和重算
```

V1 的具体抢占实现与 V0 GPU/CPU Swap 不同。不要把旧版 BlockSpaceManager 的 Swap 流程
直接套用当前 V1。

抢占会导致：

- 额外重算。
- TTFT/E2E 上升。
- 吞吐下降。
- 用户 ITL 出现长停顿。

`num_preemptions` 持续增长说明容量或调度配置需要调整。

---

## 11. Prefix Cache 与调度

同样长度的两个 Prompt，成本可能完全不同：

```text
Request A: 8K Prompt，7K Cache Hit → 只计算 1K
Request B: 8K Prompt，0 Cache Hit → 计算 8K
```

负载均衡和 Scheduler 如果只看 Prompt Length，会估错成本。

DP 多实例场景还需要考虑：

- 每个实例 KV Cache 独立。
- 把相同 Prefix 路由到同一实例能提高命中。
- 但粘性路由可能导致队列倾斜。

需要在“缓存局部性”和“实时负载”之间权衡。

---

## 12. 公平性

### 12.1 长短请求

策略目标可能不同：

- 聊天短请求：TTFT 优先。
- 长文总结：吞吐优先。
- 批处理：成本优先。

不应让所有流量共享完全相同的队列。

### 12.2 多租户

只做 FCFS 时，一个租户的突发长请求可能占用全部 Token Budget。

Gateway 可以先划分：

```text
interactive-high
interactive-standard
batch
```

然后：

- 独立队列。
- 独立并发/Token 配额。
- 独立实例池。
- 不同最大上下文。

### 12.3 Priority 的风险

Priority 需要：

- 租户不能自行抬高。
- 低优先级有最大等待时间。
- 高优先级也受硬配额。
- 记录被抢占和越过原因。

---

## 13. 参数调优方法

不要从“推荐参数表”开始。先测工作负载。

### 13.1 建立请求分布

至少采集：

```text
input_tokens P50/P95/P99
output_tokens P50/P95/P99
arrival_rate
concurrency
stream ratio
prefix reuse
tenant/service tier
```

### 13.2 建立基线

固定模型、硬件和并行策略，记录：

- TTFT。
- ITL/TPOT。
- E2E。
- Prompt/Generation tokens/s。
- waiting/running。
- KV usage。
- preemption。
- GPU Tensor/Memory 利用。

### 13.3 单变量实验

例如：

```text
max_num_batched_tokens:
  2048 → 4096 → 8192 → 16384
```

每次保持输入分布和到达率相同，比较完整结果。

### 13.4 画出 Pareto 前沿

找到无法同时继续改善的点：

```text
更高吞吐 ↔ 更差 TTFT/ITL
```

生产配置是在 SLO 约束下选择最高吞吐，而不是选择绝对最高吞吐。

---

## 14. 压测场景

### 场景 A：Decode-only 倾向

```text
input = 16
output = 512
```

观察 Decode Batch 和 ITL。

### 场景 B：Prefill-only 倾向

```text
input = 8192
output = 1
```

观察 Prompt tokens/s 和 TTFT。

### 场景 C：长短混合

```text
90%: input 128, output 128
10%: input 16384, output 256
```

观察短请求 P99 是否被长 Prefill 拖慢。

### 场景 D：突发

稳态请求之上瞬间注入 5 倍流量，观察：

```text
queue growth
→ TTFT
→ KV
→ preemption
→ rejection
→ recovery time
```

---

## 15. 关键指标

```promql
max(vllm:num_requests_waiting)
```

```promql
histogram_quantile(
  0.99,
  sum by (le) (
    rate(vllm:request_queue_time_seconds_bucket[5m])
  )
)
```

```promql
sum(rate(vllm:prompt_tokens[5m]))
```

```promql
sum(rate(vllm:generation_tokens[5m]))
```

```promql
sum(rate(vllm:num_preemptions[5m]))
```

还要关联：

- TTFT。
- ITL/TPOT。
- KV Cache Usage。
- GPU SM/Tensor/Memory 活跃度。
- NCCL Collective 时间。

---

## 16. 常见错误

### 只提高 `max_num_batched_tokens`

可能提高吞吐，但让 Decode ITL 尾部变差。

### 只提高 `max_num_seqs`

可能先耗尽 KV Cache，产生更多抢占和排队。

### 只用平均长度压测

平均值无法模拟长尾请求对调度的破坏。

### 只用闭环压测

客户端等上一个请求完成再发送下一个，会掩盖真实到达率与排队。

### 不区分 Prefix Cache 冷热

测试结果无法代表首次请求或真实多租户命中率。

### 把旧 V0 Swap 流程当成 V1

版本实现已经演进，排障时必须核对实际版本。

---

## 17. 验收清单

- [ ] 能解释静态 Batch 与 Continuous Batch。
- [ ] 能解释 Sequence Budget 和 Token Budget。
- [ ] 能手算一个 Engine Step 的 Token 分配。
- [ ] 能解释长 Prefill 如何影响 Decode。
- [ ] 能说明 Chunked Prefill 的收益和代价。
- [ ] 能识别抢占、饥饿和队首阻塞。
- [ ] 能设计长短混合和突发压测。
- [ ] 能在 TTFT/ITL SLO 下选择吞吐配置。

## 18. 官方资料

- [vLLM Optimization and Tuning](https://docs.vllm.ai/en/latest/configuration/optimization/)
- [vLLM Scheduler Configuration](https://docs.vllm.ai/en/stable/api/vllm/config/scheduler/)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)

下一篇将把单实例内部调度扩展到多 GPU、多副本和 MoE，比较 TP、PP、DP 与 EP 的
通信路径和选型方法。
