---
title: "vLLM v0.31 多模态、LoRA、投机解码与结构化输出参数"
sidebar_label: "34. 多模态、LoRA 与投机解码参数"
sidebar_position: 34
description: "解释 vLLM v0.31 高级能力的参数边界、资源模型、执行路径和生产验收方法。"
tags: [vLLM, 多模态, LoRA, Speculative Decoding, Structured Outputs]
---

# vLLM v0.31 多模态、LoRA、投机解码与结构化输出参数

这些功能都会改变请求执行路径，不能只用“开启/关闭”理解：

~~~text
多模态：增加媒体读取、Processor、Encoder 与 Encoder Cache
LoRA：增加 Adapter 存储、换入和 Batch 异质性
投机解码：增加 Draft、Verify 与接受率
结构化输出：增加 Grammar 编译与每步 Token Mask
~~~

## 1. MultiModalConfig

| 参数 | 作用 |
|---|---|
| `--language-model-only` | 禁用模型多模态输入以释放 Encoder 相关资源 |
| `--limit-mm-per-prompt` | 限制每请求媒体数量和规格 |
| `--mm-processor-kwargs` | 覆盖 Processor 参数 |
| `--media-io-kwargs` | 控制媒体读取，如视频帧数 |
| `--enable-mm-embeds` | 允许客户端直接提交预计算 Embedding |
| `--mm-processor-cache-gb` | 多模态预处理缓存预算 |
| `--disable-mm-preprocessor-cache` | 关闭预处理缓存 |
| `--mm-ipc-gpu-memory-gb` | 为前端 GPU 多媒体处理预留显存 |
| `--mm-device-do-normalize` | 把部分归一化移动到设备 |
| `--allowed-local-media-path` | 本地媒体读取白名单目录 |
| `--allowed-media-domains` | 远程媒体域名白名单 |

`limit_mm_per_prompt` 不应只限制数量，还要按版本支持的结构限制帧数、宽高等，否则一个视频与一张小图虽然都计为“1”，资源消耗完全不同。

## 2. 多模态资源路径

~~~text
URL/文件/请求字节
→ Media IO
→ 图片解码/视频抽帧
→ Processor
→ Pixel Tensor
→ Vision Encoder
→ Projector
→ 视觉 Token/Embedding
→ LLM Prefill
~~~

需要分别测量：

- 下载和解码延迟；
- CPU RSS 与线程；
- Processor Cache；
- Encoder HBM/Workspace；
- 视觉 Token 数；
- TTFT 与总吞吐。

仅记录文本 Token 会严重低估容量。

## 3. 预计算多模态 Embedding 的风险

`--enable-mm-embeds` 允许跳过部分 Encoder 工作，但错误 Shape、dtype 或模型不匹配可能使引擎失败。只应对可信调用方开放，并验证：

- 模型/Processor Revision；
- Embedding Shape 与位置；
- 输入大小上限；
- 租户隔离；
- 错误输入是否会导致 Worker 崩溃。

## 4. LoRAConfig

| 参数 | 含义 |
|---|---|
| `--enable-lora` | 开启 Adapter 服务 |
| `--lora-modules` | 注册名称、路径和基座模型 |
| `--max-loras` | 单 Batch 同时活动的 LoRA 数 |
| `--max-cpu-loras` | CPU 常驻 Adapter 数 |
| `--max-lora-rank` | 预留支持的最大 Rank |
| `--lora-dtype` | Adapter dtype |
| `--fully-sharded-loras` | TP 下完整切分 LoRA 计算 |
| `--enable-tower-connector-lora` | 为多模态 Tower/Connector 开启 LoRA |
| `--lora-target-modules` | 限定应用 LoRA 的模块 |
| `--default-mm-loras` | 按多模态类型自动选择 Adapter |
| `--specialize-active-lora` | 按活动 LoRA 数量专门捕获 CUDA Graph |

LoRA 不只是多加载一小份权重。不同请求使用不同 Adapter 会降低 Batch 同质性，并影响 Kernel、Graph Shape、缓存与路由。

## 5. LoRA 容量

至少区分：

~~~text
CPU Adapter Store
GPU Active Adapter
单 Batch 活动 LoRA 数
每个 LoRA Rank
LoRA 与 TP 的切分
Graph 对活动 LoRA 数的专门化
~~~

`max_lora_rank` 和 `max_loras` 常会影响预分配。配置远大于真实需求会浪费显存；过小则制品无法加载或请求被拒绝。

## 6. SpeculativeConfig

v0.31.0 将投机解码集中到 `--speculative-config`，具体字段以当前帮助为准。核心概念：

| 字段/概念 | 含义 |
|---|---|
| method | Draft Model、N-Gram、MTP/EAGLE 等方法 |
| model / spec-model | Draft 制品 |
| num speculative tokens / spec-tokens | 每轮草拟 Token 数 |
| acceptance method | 验证接受策略 |
| draft TP | Draft 模型并行方式 |
| target max model len | Draft 与 Target 长度边界 |

执行过程：

~~~text
Draft 生成 k 个候选
→ Target 一次验证
→ 接受前缀中的若干 Token
→ 从首个拒绝位置继续
~~~

## 7. 为什么草拟更多不一定更快

近似收益：

~~~text
节省的 Target Decode Step
- Draft 计算
- Verify 计算
- 额外 KV/显存
- 调度与同步
~~~

关键指标：

- Acceptance Rate；
- Mean Accepted Length；
- Draft/Verify 时间；
- TPOT；
- 总 Token/s；
- HBM；
- 不同 Prompt 和温度下的分布。

高温采样、Draft 与 Target 分布差异大或 Batch 已很大时，投机收益可能下降。

## 8. Structured Outputs

结构化输出将 JSON Schema、Regex、Choice 或 Grammar 编译成约束状态，在每个 Decode Step 屏蔽不合法 Token：

~~~text
Schema/Grammar
→ 编译状态机
→ 当前状态允许 Token 集
→ Logits Mask
→ Sampling
→ 状态转移
~~~

服务端配置选择 Backend 和全局策略，请求级字段提供具体 Schema。需要关注：

- 首次 Grammar 编译冷延迟；
- Grammar Cache；
- 超大/递归 Schema；
- 与 Tool Calling 的组合；
- 流式输出中的部分 JSON；
- Backend 不支持时的错误，而不是静默降级。

## 9. Tool Strict 与 Structured Outputs 的区别

`tool_strict_level` 控制 Tool Call 外壳、函数名和参数 Schema 的约束下限；普通 Structured Outputs 约束最终文本结构。两者可能使用相同的 Grammar 能力，但协议语义不同。

不能只验证“输出能被 JSON 解析”，还要验证：

- 函数名属于允许集合；
- 参数符合对应函数 Schema；
- 并行 Tool Call；
- Reasoning 与 Tool Call 分离；
- 流式 Delta 能正确聚合。

## 10. Pooling 与非生成模型

使用 `runner=pooling` 或 Convert 后，核心输出不再是逐 Token Decode。分类、Embedding、Reward、Score 等模型应关注：

- PoolerConfig；
- 最大 Batch 与输入 Token；
- Normalize/Pooling 方法；
- 输出 Tensor 大小；
- Late Interaction 等专用 Kernel。

不要用生成模型的 TPOT 指标评估 Embedding 服务。

## 11. 功能组合矩阵

高级功能必须测试组合，而不是逐项测试后默认可以叠加：

| 组合 | 风险 |
|---|---|
| LoRA + CUDA Graph | 活动 Adapter 数改变 Shape/捕获 |
| LoRA + TP | 切分与通信 |
| 多模态 + Graph | Encoder 动态 Shape |
| 多模态 + LoRA | Tower/Connector Adapter |
| Spec Decode + Quantization | Draft/Target Kernel 与精度 |
| Spec Decode + Prefix Cache | 两套状态和命中路径 |
| Tool + Reasoning + Streaming | Parser 状态边界 |
| Structured Output + Logprobs | Mask 后概率语义和响应成本 |

## 12. 验收题与答案

**问题：为什么 `max_loras=8` 不代表服务只能注册 8 个 LoRA？**

答案：它主要限制单 Batch 同时活动的 LoRA 数；注册数、CPU 常驻数和当前 GPU 活动数是不同概念。

**问题：投机接受率高是否一定提高吞吐？**

答案：不一定。还要扣除 Draft、Verify、额外显存和调度成本，并观察真实 Batch 下 Target Decode 是否原本已被充分摊薄。

## 13. 官方资料

- [Multimodal Inputs](https://docs.vllm.ai/en/v0.31.0/features/multimodal_inputs/)
- [LoRA Adapters](https://docs.vllm.ai/en/v0.31.0/features/lora/)
- [Dynamic Speculative Decoding](https://docs.vllm.ai/en/v0.31.0/features/speculative_decoding/dynamic_speculative_decoding/)
- [Structured Outputs](https://docs.vllm.ai/en/v0.31.0/features/structured_outputs/)
