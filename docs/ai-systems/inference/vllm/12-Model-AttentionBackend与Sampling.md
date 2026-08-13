---
title: "Model、Attention Backend 与 Sampling"
sidebar_position: 12
tags: [vLLM, V1, Attention, Sampling, 源码分析]
description: "从 GPUModelRunner 的输入张量出发，理解模型层、Attention Backend、KV Cache 写入、Logits 与采样的边界。"
---

# Model、Attention Backend 与 Sampling

到上一篇为止，`GPUModelRunner` 已经准备好本轮 `input_ids`、`positions`、Slot Mapping 与 Attention Metadata。接下来真正进入 GPU 热路径。

本篇不逐层粘贴模型代码，而是回答：**一次前向怎样读取权重和历史 KV、写入新 KV、产生 Logits，并选出下一个 token？**

> 源码基线：vLLM `v0.23.0`。具体模型类、Attention Backend 和 Kernel 会随硬件与版本变化，本文把稳定接口和可观测现象分开说明。

---

## 1. 先看完整数据变换

```text
input_ids + positions
  ↓ Embedding
hidden_states
  ↓ Transformer Layers × N
  ├─ Attention: Q/K/V、历史 KV、写入新 KV
  ├─ MLP / MoE
  └─ Residual + Normalization
  ↓ Final Norm / LM Head
logits
  ↓ Sampling / Grammar / Logprobs
sampled token IDs
```

一次 Decode 看似只新增一个 token，但仍需经过每一层，并读取该请求此前全部上下文的 KV。它省掉的是历史 token 的 Q/K/V 和 MLP 重算，不是“只运行模型最后一层”。

---

## 2. 模型层与运行框架的边界

在 vLLM 中，模型实现主要负责：

- 权重结构与加载映射；
- Embedding、Transformer Layer、LM Head；
- TP/PP/EP 下权重如何切分；
- 调用 vLLM Attention Layer；
- 某些模型专属位置编码、MoE 或多模态逻辑。

运行框架主要负责：

- 本轮有哪些 token；
- token 属于哪个请求；
- KV 写到哪个 Slot；
- 选哪个 Attention Backend；
- CUDA Graph、编译、输入 Padding；
- 采样参数与输出组织。

因此新增一个模型支持与新增一个 Kernel Backend 是两条不同扩展路径。模型类描述语义，Backend 描述怎样高效执行 Attention。

---

## 3. Prefill 与 Decode 在 Attention 中有什么不同

### Prefill

Prompt 中大量新 token 同时进入模型：

```text
新 Q: [q0 q1 q2 ... qN]
新 K/V: [k0/v0 ... kN/vN]
```

特点：

- 矩阵规模大，更容易吃满计算单元；
- 会批量写入 KV Cache；
- TTFT 对长 Prompt 非常敏感；
- Chunked Prefill 可能把它拆到多个 Step。

### Decode

每条普通请求本轮通常新增一个 token：

```text
新 Q: [qN+1]
读取历史 K/V: [0 ... N]
写入: slot(N+1)
```

特点：

- 单请求矩阵小；
- 每步都要读取历史 KV 和权重；
- 常受显存带宽、Kernel Launch 和批大小影响；
- TPOT/ITL 是更直接的用户指标。

Continuous Batching 的核心价值之一，就是把多条请求的“小 Decode”合成更有效的 GPU 工作。

---

## 4. Attention Layer 为什么需要 Backend

不同场景可能需要不同实现：

- GPU 架构不同；
- Prefill 和 Decode 形状不同；
- Head Size、dtype、KV dtype 不同；
- 普通 MHA、GQA、MQA、MLA 不同；
- 是否支持 Sliding Window、Prefix、Spec Decode；
- 是否需要与特定编译/CUDA Graph 路径兼容。

Attention Layer 因而把统一语义交给 Backend：

```text
模型层传入 Q/K/V
  ↓
Attention Layer
  ├─ 根据 metadata 写入 KV Cache
  ├─ 根据 Block Table 找历史 KV
  └─ 调用具体 Backend / Kernel
```

运行时真正关键的数据不只有 Q/K/V，还包括：

- 每条请求的实际序列长度；
- query 起始位置；
- Block Table；
- Slot Mapping；
- Prefill/Decode 分界；
- 因 Padding 加入但不应被当成真实 token 的位置。

元数据错误比普通性能问题更危险：它可能产生错误输出，而不是简单变慢。

---

## 5. Slot Mapping 怎样落到 KV Cache

逻辑上，每个新 token 都需要在每层写入 K 和 V。Slot Mapping 告诉 Kernel：这个 token 对应哪个物理 Block 的哪个偏移。

若 Block Size 为 16：

```text
slot_id = physical_block_id × 16 + offset_in_block
```

真实实现还要考虑不同 KV Cache Group、Layer 布局和 Backend，但这个公式足以建立直觉。

同一条请求的逻辑相邻 token 可以落到不连续物理 Block；Attention 通过 Block Table 恢复正确序列视图。这正是 PagedAttention 把逻辑序列与物理显存解耦的地方。

---

## 6. TP 模式下模型层发生什么

Tensor Parallel 会切分层内权重和中间 Tensor。以常见思路为例：

```text
Column Parallel Linear
  各 rank 计算不同输出分片

Row Parallel Linear
  各 rank 计算部分和
  → All-Reduce 得到完整结果
```

Attention Head、QKV Projection、Output Projection、MLP 也会按模型实现切分。每层通信可能不大，但层数多、Decode Step 多，所以链路延迟和慢 rank 会累积到 TPOT。

这解释了两个常见现象：

- TP 增大后模型能装下，但单请求并不一定更快；
- 某一张卡 GPU 利用率低，可能是在等待另一个 rank 或 collective，并非没有参与工作。

分析时必须查看每 rank Timeline、NCCL Kernel 与 NVLink/PCIe 拓扑，不能只看节点平均 GPU Util。

---

## 7. 从 Hidden States 到 Logits

最后一层输出经过 Norm 和 LM Head，映射到词表维度：

```text
hidden_states [num_selected_tokens, hidden_size]
  × lm_head [hidden_size, vocab_size]
  ↓
logits [num_selected_tokens, vocab_size]
```

并非本轮所有输入 token 都一定需要采样。例如 Chunked Prefill 的中间块主要是在建立 KV，通常只需在达到可生成位置时选取相关 Hidden State 进入 LM Head/采样。

大词表下，Logits 计算、跨 rank 处理和 logprobs 返回都可能成为可见开销。开启大量 `logprobs` 不是免费的功能开关。

---

## 8. Sampling 不只是 `argmax`

采样要组合多种请求级参数：

1. Temperature；
2. Top-k / Top-p；
3. Min-p 等截断；
4. Presence/Frequency/Repetition Penalty；
5. 随机种子与 RNG 状态；
6. Bad Words、Allowed Tokens 或 Grammar Mask；
7. Greedy / Random Sampling；
8. 可选 Logprobs。

抽象流程是：

```text
raw logits
→ 应用 penalty
→ grammar / allowed-token mask
→ temperature
→ top-k / top-p / min-p
→ multinomial 或 argmax
→ sampled token + logprob
```

参数通常按请求不同。Runner 需要把请求对象中的 Python 配置整理成可批处理的 Sampling Metadata，再在 GPU 上高效执行。

### 为什么结构化输出会增加尾延迟

Grammar 状态可能需要 CPU 侧推进或为每个请求生成允许 token Mask。如果它阻断下一轮采样，就可能在 GPU Step 之间制造空洞。应分别测量：

- 无结构化约束基线；
- Grammar 编译首请求；
- Grammar 热缓存请求；
- 每步 Mask/状态推进开销。

---

## 9. 推测解码怎样改变路径

普通 Decode 一轮通常确认一个 token。推测解码先由 Draft 路径提出多个候选，再由 Target Model 验证：

```text
Draft: 提出 d1 d2 d3 d4
  ↓
Target: 一次验证
  ↓
接受前缀 d1 d2，拒绝 d3
  ↓
提交已接受 token，并修正后续状态
```

它是否有收益取决于：

- 接受率；
- Draft 成本；
- Target 验证形状；
- 额外 Sampling、KV 和状态管理；
- 当前 Batch/并发。

只看“每轮提出几个 token”会高估收益。必须记录接受 token 数、验证时间和最终 TPOT。

---

## 10. 这一层的性能证据

| 现象 | 可能原因 | 需要的证据 |
| --- | --- | --- |
| Prefill 慢 | GEMM/Attention 计算、长 Prompt、Chunk 设置、TP 通信 | Prefill 分段 Timeline、输入长度分桶 |
| Decode TPOT 高且 GPU Busy | 权重/KV 带宽、Batch 太小、Kernel 效率低 | DRAM 吞吐、Kernel、Batch token 数 |
| GPU Busy 低且短 Kernel 多 | Launch/同步开销、Graph 未命中、Sampling CPU 间隙 | Nsight Systems |
| 开启 logprobs 后明显变慢 | Logits/Top-k 与 CPU 返回量增加 | 有无 logprobs A/B |
| 仅结构化输出慢 | Grammar 编译/Mask/状态推进 | Grammar 阶段计时 |
| TP 扩大反而慢 | collective 延迟、拓扑差、单 rank 工作太小 | rank 时间线与 NCCL 统计 |

注意：DCGM 的 GPU Util 是时间窗口内“是否有 Kernel 活动”的近似，不等于 Tensor Core 有效利用率，更不等于请求没有排队。

---

## 11. 源码阅读路标

1. 从正在使用的模型实现进入，例如 `vllm/model_executor/models/`；
2. 找到 QKV Projection 与 Attention Layer 调用；
3. 查看 `vllm/attention/layer.py` 的统一入口；
4. 沿 Backend 选择进入对应实现；
5. 回到 `gpu_model_runner.py`，找 Hidden State 选择、Logits 与 Sampling；
6. 用一次 Nsight Systems Trace 对照源码阶段，而不是只静态阅读。

固定版本入口：

- [模型实现目录（v0.23.0）](https://github.com/vllm-project/vllm/tree/v0.23.0/vllm/model_executor/models)
- [Attention 目录（v0.23.0）](https://github.com/vllm-project/vllm/tree/v0.23.0/vllm/attention)
- [gpu_model_runner.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/worker/gpu_model_runner.py)

---

## 12. 学完后的验收题

1. Decode 为什么仍要经过所有 Transformer Layer？
2. 模型实现与 Attention Backend 的职责边界是什么？
3. Slot Mapping 和 Block Table 分别解决什么问题？
4. 为什么 TP 增大可能让单请求 TPOT 变差？
5. Sampling 哪些功能会引入额外 CPU/GPU 开销？
6. 怎样证明瓶颈在 Kernel，而不是 GPU Step 之间的空洞？

下一篇回到 CPU 输出侧：采样 token 怎样变成增量文本、SSE 事件、Usage 和最终资源释放。
