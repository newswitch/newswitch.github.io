---
title: "KVCacheManager、BlockPool 与 Prefix Cache"
sidebar_label: "05. KVCacheManager、BlockPool 与 Prefix Cache"
sidebar_position: 5
tags: [vLLM, V1, KV Cache, Prefix Cache, 源码分析]
description: "以 vLLM v0.23.0 为基线，沿一次请求分析 KV Cache 命中、Block 分配、回收、抢占与前缀复用。"
---

# KVCacheManager、BlockPool 与 Prefix Cache

上一篇已经走到 `Scheduler.schedule()`。调度器知道某个请求本轮可以计算多少 token，但它还不能直接让 GPU 执行：这些 token 的 Key/Value 必须有可写入的物理位置。

本篇只回答一件事：**逻辑 token 如何获得、复用并最终释放物理 KV Block？**

> 源码基线：vLLM `v0.23.0`。本文讲清职责和状态变化，只保留少量方法名作为源码路标。

---

## 1. 先建立三个层次

不要把下面三个对象混为一谈：

| 层次 | 代表对象 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| 调度决策 | `Scheduler` | 本轮选哪些请求、各算多少 token | 不直接管理空闲物理块 |
| 请求到块的映射 | `KVCacheManager` / Coordinator | 查命中、分配、追加和释放请求的 Block | 不执行 Attention Kernel |
| 全局物理块池 | `BlockPool` | 空闲队列、哈希索引、缓存块淘汰顺序 | 不理解 HTTP、优先级和 SLO |

一次正常的调度可简化为：

```text
Scheduler 选中 request
  ↓
KVCacheManager.get_computed_blocks() 查可复用前缀
  ↓
Scheduler 计算本轮真正需要执行的 token 数
  ↓
KVCacheManager.allocate_slots() 预留写入槽位
  ↓
SchedulerOutput 携带 Block 信息进入 ModelExecutor
```

这里最关键的顺序是：**先查命中，再决定还要算多少，最后分配新槽位**。

---

## 2. KV Block 解决了什么问题

如果为每条请求预留一整段连续 KV Cache，会出现两个问题：

1. 请求实际输出长度未知，提前预留容易浪费；
2. 请求结束时间不同，连续区域容易产生外部碎片。

PagedAttention 把 KV Cache 划成固定 token 数的 Block。请求看到的是逻辑序列，底层可以映射到不连续的物理 Block：

```text
Request A 的逻辑块:  A0 → A1 → A2
物理 Block ID:       19 →  3 → 41

Request B 的逻辑块:  B0 → B1
物理 Block ID:        8 → 27
```

因此，扩展请求通常是追加 Block，而不是搬迁原有 KV。请求完成后，把 Block 归还全局池即可。

需要区分两个“满”：

- **KV Block 不足**：调度器无法为当前请求分配足够槽位，可能推迟或抢占请求；
- **CUDA OOM**：权重、激活、临时 Workspace 或其他 CUDA 分配真正失败。

二者可能相关，但不是同一个故障。

---

## 3. BlockPool 的两个核心索引

`BlockPool` 可以先按两个数据结构理解：

```text
free_block_queue
  维护当前可复用 Block，以及缓存块的淘汰次序

cached_block_hash_to_block
  block_hash + cache_group → 已缓存 Block
```

一个 Block 不是只有“空闲/占用”两种状态。请求已经释放它之后，里面的旧 KV 内容仍可能保留，并通过哈希索引成为可命中的缓存块。

因此“在空闲队列里”不等于“数据已清零”：

```text
未缓存空闲块
  可直接分配

缓存但当前无人引用的块
  也可分配；分配前先从哈希索引中淘汰旧身份

正在被请求引用的块
  不可分配
```

这个设计把“内存所有权”和“缓存内容是否仍有价值”分开了。

---

## 4. Prefix Cache 如何识别相同前缀

Automatic Prefix Caching 复用的不是自然语言字符串，而是**完整 Block 对应 token 序列的链式哈希**。

概念上可以写成：

```text
H0 = hash(parent_hash, block_0_tokens, extra_keys)
H1 = hash(H0,          block_1_tokens, extra_keys)
H2 = hash(H1,          block_2_tokens, extra_keys)
```

`extra_keys` 需要覆盖会改变缓存语义的因素，例如 LoRA、特定多模态输入，以及用于租户隔离的 salt。不能只因为 token ID 相同，就假设所有上下文都可以共享。

查找时从第一个完整 Block 开始向后匹配：

```text
System Prompt: [B0][B1][B2]
User Prompt:   [B3][不足一个完整 Block]

命中:          B0  B1
未命中:                B2  B3...
```

为什么常常只缓存完整 Block？因为完整块才能稳定地产生哈希和复用边界。尾部不足一个 Block 的 token 仍要正常计算。

此外，V1 查命中时会为“本次仍需产生日志概率或最后 token 的 logits”保留必要计算，不能简单把整条 Prompt 都视作零计算成本。

---

## 5. `get_computed_blocks()`：命中只改变计算量

`KVCacheManager.get_computed_blocks()` 的输出可以理解为：

- 已经命中的完整 Block；
- 已经计算过的 token 数。

调度器随后用它计算：

```text
本轮待算 token
= 目标计算位置
- 已计算 token
- 外部 KV Connector 已提供 token
```

Prefix Cache 命中带来的主要收益是避免重复 Prefill。它不会直接让 Decode 的每 token 成本消失，也不会让传输、Tokenization、排队和采样开销归零。

所以评估 APC 时必须同时记录：

- Prompt token 数；
- 命中 token 数或命中 Block 数；
- 首次与重复请求的 TTFT；
- GPU Prefill 时间；
- 是否混入了队列等待。

只看“Prefix Cache 已开启”没有意义。

---

## 6. `allocate_slots()`：为本轮执行预留位置

查完命中后，`allocate_slots()` 为新增 token 计算所需 Block，并把命中块与新块拼成请求当前的 Block 表。

可以把它分为五步：

1. 校验请求还需要多少 token；
2. 计算现有尾块能否容纳新增 token；
3. 计算还需多少新 Block；
4. 检查全序列必须可容纳、Lookahead 等约束；
5. 从 `BlockPool` 取块并更新请求映射。

示例：Block Size 为 16，当前请求已经有 30 个 token：

```text
Block 0: 16 / 16
Block 1: 14 / 16
```

如果本轮再调度 6 个 token，Block 1 先写 2 个，剩下 4 个需要一个新 Block。分配的单位是物理 Block，但调度预算仍以 token 为单位。

### 分配失败意味着什么

常见结果不是立刻报错，而是：

- 本轮少调度一些 token；
- 请求继续留在 waiting；
- 选择一个低优先级/较晚运行的请求进行抢占；
- 在无法满足最大序列配置时拒绝请求。

因此排查时要同时看 `waiting`、KV Cache 使用率、抢占次数与 TTFT，不能只盯显存曲线。

---

## 7. 请求状态与 Block 生命周期

一条请求的典型 Block 生命周期如下：

```text
WAITING
  └─ 查 Prefix Cache 命中
       └─ 分配剩余 Block

RUNNING
  └─ 每轮继续追加 Slot
       ├─ 正常完成 → free(request)
       ├─ 客户端取消 → finish → free(request)
       └─ 资源不足 → preempt → 释放或重算
```

释放时通常按反向顺序归还请求 Block，使最近使用过的块与淘汰顺序保持合理关系。Prefix Cache 开启时，释放引用不等于立即删除哈希内容；后续请求仍可能命中，直到它成为需要被复用的淘汰候选。

### 抢占为什么会伤害尾延迟

如果请求的 KV 被释放，恢复时可能需要重新计算已完成上下文：

```text
资源不足
→ 请求被抢占
→ 已计算上下文需要重算
→ 消耗额外 Prefill 预算
→ 其他请求也等待更久
```

所以抢占次数不是一个“只影响被抢占请求”的指标，它可能形成全局正反馈。

---

## 8. 从指标反推这一层的问题

| 现象 | 这一层的可能原因 | 还要排除什么 |
| --- | --- | --- |
| TTFT 上升、waiting 上升、GPU 利用率不高 | Block 不足导致无法形成有效批次；频繁抢占重算 | Tokenizer、EngineCore CPU 饥饿、路由不均 |
| 重复 System Prompt 仍无收益 | token 不一致、未形成完整 Block、salt/LoRA 不同、缓存被淘汰 | 请求是否真的落到同一副本 |
| KV 使用率长期接近上限 | 并发上下文过大、输出上限过宽、准入失效 | 权重/激活 OOM 与显存碎片 |
| 命中率高但 TTFT 仍高 | 排队或 API/Tokenizer 主导；命中 token 占比其实很低 | 网络、网关、CPU、调度循环 |
| 延迟呈周期性尖刺 | 热缓存被批量淘汰、长请求触发抢占波 | GC、流量周期、GPU 降频 |

一个实用判断是：

```text
如果 waiting 很高、KV 很高、preemption 增加
  先查容量与调度

如果 waiting 很高、KV 不高、GPU 也低
  先查 CPU/EngineCore/路由/输入处理

如果 waiting 不高、GPU 很高、TPOT 上升
  先查 GPU Kernel、批大小和通信
```

---

## 9. 三组最小实验

### 实验 A：验证前缀命中

1. 固定同一副本、模型 Revision 和采样参数；
2. 连续发送相同长 System Prompt、不同短问题；
3. 对比冷请求与热请求的命中 token、TTFT 和 Prefill 时间；
4. 改动前缀开头一个 token，再验证命中从哪里中断。

### 实验 B：验证 Block 压力

1. 固定输入/输出 token 分布；
2. 阶梯增加并发，而不是瞬间打满；
3. 记录 KV 使用率、running、waiting、preemption、TTFT/TPOT；
4. 找到第一个 SLO 失守点，而不是只找 OOM 点。

### 实验 C：验证长短请求干扰

1. 先运行稳定短请求流量；
2. 注入少量长上下文请求；
3. 观察 Block 占用、Chunked Prefill、抢占和短请求 P99；
4. 分别测试长度分池与统一队列。

实验结论必须能回答：瓶颈是**总 Block 不够、分配策略不合适，还是请求根本没有及时进入调度**。

---

## 10. 源码阅读路标

按这个顺序阅读，不需要从文件第一行开始：

1. `vllm/v1/core/kv_cache_manager.py`
   - `get_computed_blocks()`
   - `allocate_slots()`
   - `free()`
2. `vllm/v1/core/block_pool.py`
   - `BlockPool`
   - `get_cached_block()`
   - `cache_full_blocks()`
3. 回到 `vllm/v1/core/sched/scheduler.py`
   - 谁查命中；
   - 谁决定 token budget；
   - 分配失败后请求如何处理。

固定版本源码：

- [kv_cache_manager.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/core/kv_cache_manager.py)
- [block_pool.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/core/block_pool.py)
- [Automatic Prefix Caching 文档](https://docs.vllm.ai/en/stable/design/prefix_caching/)

---

## 11. 学完后的验收题

你应该能够不看文章回答：

1. 为什么 Prefix Cache 命中的是完整 Block，而不是任意字符串？
2. 为什么请求结束后缓存内容可能仍在，而 Block 又可以处于空闲队列？
3. KV Cache Block 不足与 CUDA OOM 有什么区别？
4. `get_computed_blocks()` 与 `allocate_slots()` 为什么必须分开？
5. 为什么抢占会同时伤害吞吐和尾延迟？
6. Prefix Cache 命中率高，为什么 TTFT 仍可能超标？

下一篇进入执行边界：`SchedulerOutput` 怎样穿过 Executor 和 Worker，最终由 `GPUModelRunner` 组织 GPU 执行。
