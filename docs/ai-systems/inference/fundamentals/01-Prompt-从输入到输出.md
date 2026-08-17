---
title: Prompt，从输入到输出
sidebar_label: "01. Prompt，从输入到输出"
date: 2026-02-25 12:00:00
categories: 机器学习
tags: [LLM, 大模型, 推理, Transformer, Tokenizer, Attention, KV-Cache]
---

# Prompt，从输入到输出

## 摘要

很多人把大模型（LLM）当作黑盒：输入一段话，输出一段话。但在工程与算法视角下，一个 Prompt 从「文本输入」到「逐 token 输出」会经历一条清晰的流水线：请求封装、分词、服务侧调度、Prefill、Decode、反解码。本文按链路拆解每一步发生了什么，以及它们如何对应到 TTFT/TPOT 等常见指标。

---

## 1 核心链路概览

一个请求的完整旅程通常可分为六步：

- **请求封装**：Prompt 模板化与角色注入（如 ChatML）
- **Tokenization**：文本转为 token ids（模型可计算的离散序列）
- **推理调度**：进入服务框架的队列与批处理系统（如 vLLM/TGI）
- **Prefill**：并行处理整段输入，建立上下文并产出 KV-Cache
- **Decode**：自回归逐 token 生成，复用 KV-Cache
- **Detokenization**：token ids 转回文本并返回给客户端

---

## 2 从文本到 token：Tokenizer 做了什么

用户输入的文本并不是模型的直接输入，模型接收的是 token id 序列。

- **请求封装**：后端会将提问包装成固定格式（如 ChatML），加入 `system`/`user` 等角色标记与分隔符。
- **分词（Tokenization）**：将文本切分并映射为 token id 序列。例如“学习”可能对应某个编号（不同 tokenizer 不同）。这是后续所有计算的基础。

---

## 3 服务侧调度：为什么不是“直接跑模型”

在真实生产环境中，请求通常不会立即进入模型前向计算，而是先进入 Serving 框架的调度系统，以提升吞吐与资源利用率。

- **Continuous Batching**：为了不让 GPU 空转，系统会将不同用户请求拼批计算（Prefill/Decode 的批策略可能不同）。
- **缓存与显存管理**：系统需要在显存中为每个请求分配 KV-Cache 空间；输入过长、并发过高或碎片化都可能触发 OOM 或排队。

---

## 4 模型计算：Transformer Block 在做什么

当请求进入模型内部后，token ids 会先映射为 embedding 向量，并叠加位置编码（如 RoPE）。随后经过多层 Transformer block，核心由两部分组成：Self-Attention 与 MLP（FFN）。

### 4.1 Self-Attention（自注意力）

- **Q/K/V**：输入向量分别经线性变换得到 Query/Key/Value。
- **注意力计算**：通过 \(QK^T\) 得到相关性分数，经 mask（causal mask）与 softmax 后，对 V 做加权求和。
- **多头机制**：常见有 MHA/GQA/MQA，核心差异在 K/V 是否共享，会影响显存与吞吐。

### 4.2 MLP / FFN（前馈网络）

- 对每个 token 做非线性变换（如 FFN、SwiGLU），提升模型表达能力。
- 与残差连接、LayerNorm/RMSNorm 共同保证训练与推理稳定性。

---

## 5 推理两阶段：Prefill 与 Decode

这是理解推理性能的关键分界。

### 5.1 Prefill（预填充）

- **做什么**：首次处理整段 prompt，GPU 可并行计算整段 token 的中间状态。
- **产出**：第一步 logits，以及后续 Decode 需要的 **KV-Cache**（每层的 K/V）。

### 5.2 Decode（自回归生成）

- **做什么**：每一步只输入最新生成的 1 个 token，复用历史 KV-Cache，预测下一个 token。
- **输出如何产生**：模型输出 logits，经采样策略（如 temperature、top-p/top-k）选择下一个 token。
- **性能特征**：本质是串行循环，因此你会看到文本逐 token “流式输出”。

---

## 6 指标对应：TTFT 与 TPOT 为什么不同

- **TTFT（Time To First Token）**：首 token 延迟，主要受 Prefill 影响；输入越长，Prefill 计算与 KV-Cache 写入越多，TTFT 往往越大。
- **TPOT（Time Per Output Token）**：平均每个输出 token 的耗时，主要受 Decode 影响；该阶段常更偏 **memory-bound**（需要频繁读写 KV-Cache），不一定是纯算力瓶颈。

---

## 7 小结

一个 Prompt 的推理链路可以概括为：文本封装与分词 → 服务侧调度与批处理 → Prefill 建立 KV-Cache → Decode 逐 token 生成 → 反解码输出。理解这条链路后，你就能更自然地把“现象”（首字慢、生成慢、OOM、排队）映射回具体阶段，并做出针对性的排查与优化。

