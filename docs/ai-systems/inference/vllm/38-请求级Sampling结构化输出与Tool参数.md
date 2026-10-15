---
title: "vLLM v0.31 请求级 Sampling、结构化输出与 Tool 参数"
sidebar_label: "38. 请求级 Sampling 与 Tool 参数"
sidebar_position: 38
description: "从 Logits 到 Token 解释 vLLM 请求参数如何影响输出分布、KV 容量、计算成本、流式协议、结构化输出和工具调用。"
tags: [vLLM, Sampling, Structured Outputs, Tool Calling, OpenAI API]
---

# vLLM v0.31 请求级 Sampling、结构化输出与 Tool 参数

服务启动参数确定实例能力，请求参数决定一次生成怎样运行：

~~~text
Logits
→ Penalty / Bias / Processor
→ Temperature
→ Top-K / Top-P / Min-P
→ Structured Output Mask
→ Sampling
→ Stop 判断
→ Token / Text / SSE
~~~

请求参数不仅影响文本风格，还会改变计算量、KV Cache、响应体和容量。

## 1. 输出数量与长度

| 参数 | 含义 | 资源影响 |
|---|---|---|
| `n` | 返回多少个候选 | 多条 Sequence、KV 和 Decode |
| `max_tokens` / `max_completion_tokens` | 最大新 Token | 最坏 KV、时延和成本 |
| `min_tokens` | 最少生成 Token | 可能暂时抑制 EOS |
| `truncate_prompt_tokens` | 从哪种策略截断输入 | 会改变语义和 Prefix Cache |
| `stream` | 是否流式返回 | 不减少模型计算，但改善感知延迟 |
| `stream_interval` | 每多少 Token 形成一个流式批次 | 平滑度与前端开销权衡 |

`max_tokens` 是输出上限，不是模型总上下文：

~~~text
prompt_tokens + max_tokens ≤ max_model_len
~~~

## 2. Temperature

Temperature 对 Logits 做缩放：

~~~text
p_i = softmax(logit_i / temperature)
~~~

- 小于 1：分布更尖锐；
- 大于 1：分布更平；
- 0：通常进入 Greedy 语义。

Temperature 不等于事实正确率。它还会改变 Speculative Decoding 接受率与输出长度分布。

## 3. Top-K、Top-P 与 Min-P

| 参数 | 机制 |
|---|---|
| `top_k` | 只保留概率最高的 K 个 Token |
| `top_p` | 保留累计概率达到 P 的最小集合 |
| `min_p` | 相对当前最高概率过滤过低 Token |

它们可以叠加，顺序由实现决定。过度收紧可能让模型重复或无法选择必要低概率 Token。

## 4. Penalty

| 参数 | 含义 |
|---|---|
| `presence_penalty` | Token 是否出现过就施加惩罚 |
| `frequency_penalty` | 按出现次数施加惩罚 |
| `repetition_penalty` | vLLM/HF 风格的重复惩罚 |

三者数学语义不同。同时设置时要做输出回归，不能简单认为“值越大越不重复”。

## 5. Stop

| 参数 | 工作层 |
|---|---|
| `stop_token_ids` | Token 层停止 |
| `stop` | Detokenized Text 层匹配停止字符串 |
| `include_stop_str_in_output` | 是否保留停止字符串 |
| `ignore_eos` | 是否忽略模型 EOS |

字符串可能跨 Token 边界，因此 `stop` 需要增量 Detokenizer 保留缓冲区。`ignore_eos=true` 可能使请求一直生成到上限，显著扩大成本。

## 6. Logprobs

| 参数 | 作用 | 代价 |
|---|---|---|
| `logprobs` | 返回输出 Token 的候选概率 | Top-K、排序、序列化和网络 |
| `prompt_logprobs` | 返回 Prompt Token 概率 | Prefill 输出和响应体明显增大 |
| `max_logprobs` | 服务端允许的最大数量 | 防止单请求资源失控 |

Logprobs 会让“只需采一个 Token”的路径变成“保留并传输更多 Logits 信息”，容量必须单独测试。

## 7. Seed 与确定性

请求 `seed` 控制随机数初始状态，但完全复现还受：

- Batch 组成；
- 并行归约顺序；
- Kernel 和 dtype；
- Speculative Decoding；
- CUDA Graph/Eager；
- 模型和 Tokenizer Revision。

“同 Seed”不等于跨版本、跨硬件位级一致。

## 8. Logit Bias 与 Processor

`logit_bias` 按 Token ID 修改 Logits，自定义 Logits Processor 可以实现更复杂规则。风险：

- Token ID 与 Tokenizer Revision 绑定；
- 每步 Python/CPU Processor 可能拖慢 Decode；
- 非法 Processor 可能破坏数值稳定；
- 多租户提交任意代码不可接受。

自定义 Processor 必须由服务端白名单注册。

## 9. Structured Outputs 请求参数

v0.31 的 Structured Outputs 可以表达：

- JSON Schema；
- JSON Object；
- Regex；
- Choice；
- Grammar。

请求进入后需要编译或查找 Grammar，再在每一步生成允许 Token 集。首个新 Schema 可能出现冷延迟。

验收：

~~~text
合法输出率
Grammar 编译 P99
Grammar Cache 命中
Decode TPOT
超大/递归 Schema
流式部分 JSON
取消与超时
~~~

## 10. Tool Choice

请求级常见字段：

| 字段 | 含义 |
|---|---|
| `tools` | 工具定义和参数 Schema |
| `tool_choice=none` | 不调用工具 |
| `tool_choice=auto` | 让模型选择 |
| `tool_choice=required` | 必须产生 Tool Call |
| 指定函数 | 限定工具名 |
| `parallel_tool_calls` | 是否允许多个 Tool Call |

服务端的 Tool Parser 必须匹配模型输出格式。请求 Schema 约束、服务端 Strict Level 和模型能力共同决定结果。

## 11. Reasoning 参数

不同推理模型可能支持：

- Reasoning Effort；
- Thinking Token Budget；
- 模板级 `enable_thinking`；
- Reasoning Parser。

Thinking Token 也是输出 Token 和 KV。若只按最终答案长度计费或限流，会低估容量与响应时间。

## 12. Guided 与 Sampling 的顺序

结构约束不是生成后再“修 JSON”，而是在 Decode 中限制候选 Token。因此它与 Sampling 联动：

~~~text
Penalty / Bias
→ 结构化允许集合
→ Top-K/Top-P 等过滤
→ Sample
~~~

具体顺序以 v0.31 实现为准。极端 Sampling 与严格 Grammar 组合可能只剩很少候选。

## 13. 请求参数如何破坏容量模型

以下请求不应与普通单输出请求混算：

- `n > 1`；
- Prompt Logprobs；
- 大量 Logprobs；
- 超长 `max_tokens`；
- Ignore EOS；
- 新 Grammar 冷编译；
- 多 Tool Schema；
- 多模态输入；
- LoRA；
- Speculative 参数；
- Thinking Token。

网关应建立请求成本估算：

~~~text
estimated_cost
= prompt_tokens
 + output_budget × n
 + multimodal_tokens
 + logprobs_factor
 + structured/tool overhead
~~~

## 14. 一组契约测试

1. Greedy 与固定 Seed；
2. 流式和非流式文本一致性；
3. Stop 跨 Token 边界；
4. 客户端取消后 KV 释放；
5. JSON Schema 合法与非法输入；
6. Tool Auto/Required/None；
7. Reasoning + Tool + Streaming；
8. `n=4` 与 Logprobs 容量；
9. 超过上下文时返回明确 4xx；
10. GenerationConfig 与请求显式值的优先级。

## 15. 验收题与答案

**问题：`stream=true` 是否减少模型端到端计算？**

答案：通常不减少。它让已生成 Token 更早发送，提高感知响应；模型仍需完成相同 Decode。

**问题：为什么 `n=4` 不能按一个普通请求计容量？**

答案：它会维护多条输出序列，增加 KV、Sampling 和 Decode 工作，资源成本接近多候选生成而不是单候选。

**问题：结构化输出是否等于生成后做 JSON 校验？**

答案：不是。vLLM 在生成过程中根据 Grammar 屏蔽不合法 Token，因此会进入每个 Decode Step。

## 16. 官方资料

- [SamplingParams API](https://docs.vllm.ai/en/v0.31.0/api/vllm/sampling_params/)
- [Structured Outputs](https://docs.vllm.ai/en/v0.31.0/features/structured_outputs/)
- [Tool Calling](https://docs.vllm.ai/en/v0.31.0/features/tool_calling/)
- [Reasoning Outputs](https://docs.vllm.ai/en/v0.31.0/features/reasoning_outputs/)
