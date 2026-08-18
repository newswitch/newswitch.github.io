---
title: "vLLM、vLLM-Ascend、SGLang、MindIE 框架对比与选型"
sidebar_label: "01. vLLM、vLLM-Ascend、SGLang、MindIE 框架对比与选型"
sidebar_position: 1
description: "从控制面、执行面、KV Cache、前缀缓存、调度、参数、硬件生态和生产运维对比四大推理框架，并给出公平压测和迁移方法。"
tags: [vLLM, vLLM-Ascend, SGLang, MindIE, 推理框架, 选型]
---

# vLLM、vLLM-Ascend、SGLang、MindIE 框架对比与选型

这四个名称不能放在同一层简单比较：

- **vLLM**：以开放源码和多平台扩展为基础的通用高性能推理引擎，生产中最常见的是 NVIDIA CUDA 路径；
- **vLLM-Ascend**：vLLM 的昇腾硬件平台插件，复用 upstream 控制面并实现 NPU 执行面；
- **SGLang**：独立的高性能推理服务框架，以 TokenizerManager/Scheduler/DetokenizerManager 管线和 RadixAttention 等能力为特征；
- **MindIE**：面向昇腾的完整推理解决方案，包含 Server、LLM Manager、Text Generator、Modeling 及集群能力。

因此真正的选型问题不是“哪个框架绝对更快”，而是：

> 在指定硬件、模型、功能、请求分布、SLO、团队能力和发布约束下，哪套控制面与执行面最合适？

## 1. 一张定位图

```text
                        推理服务框架/控制面
                 通用开源生态              昇腾一体化生态
              ┌──────────────────┬──────────────────┐
NVIDIA/CUDA   │ vLLM             │                  │
              │ SGLang           │                  │
              ├──────────────────┼──────────────────┤
Ascend/NPU    │ vLLM +           │ MindIE           │
              │ vLLM-Ascend      │                  │
              │ SGLang NPU*      │                  │
              └──────────────────┴──────────────────┘

* SGLang NPU 的模型、功能和版本支持必须按目标 Backend 文档验证，
  不能从 CUDA 支持情况直接推定生产能力。
```

vLLM-Ascend 不是与 vLLM 并列的全新控制面，它是“vLLM 控制面 + Ascend 执行面”。为了部署和运维清晰，本文仍把它作为一个可选运行栈单独比较。

## 2. 核心组件映射

| 职责 | vLLM | vLLM-Ascend | SGLang | MindIE |
|---|---|---|---|---|
| 服务入口 | OpenAI API Server | 同 upstream | HTTP Server/OpenAI Adapter | Server/EndPoint |
| 输入协调 | InputProcessor/Tokenizer | 同 upstream | TokenizerManager | Server + Tokenizer Processes |
| 核心请求状态 | EngineCoreRequest/Request | 同 upstream | Req/ReqState | LLM Manager Request State |
| 调度 | V1 Scheduler | upstream + Ascend 扩展 | Scheduler/PrefillAdder | LLM Manager Scheduler |
| KV 逻辑管理 | KVCacheManager/BlockPool | 共同逻辑 + NPU 物理实现 | Radix Cache + Memory Pool | Block Manager |
| 设备 Worker | GPU Worker | NPU Worker | TP Worker | Executor |
| 设备执行 | GPUModelRunner | NPUModelRunner | ModelRunner | Text Generator/Generator |
| 模型/算子 | CUDA Model/Attention/Custom Ops | Ascend Model/Attention/CANN Ops | Model Executor/Kernel Backend | Modeling/ATB 或 MindSpore |
| 图执行 | CUDA Graph/Compile | ACLGraph/Npugraph_ex | CUDA Graph/多种图模式 | C++/Python Graph（按模型支持） |
| 集合通信 | NCCL | HCCL | NCCL 或目标硬件 Backend | HCCL |
| 反分词/输出 | OutputProcessor/Detokenizer | 同 upstream | 独立 DetokenizerManager | Text Generator/Server 后处理 |

这张表的价值在故障定位。例如“首 Token 已在设备生成但客户端没收到”：

- vLLM/vLLM-Ascend 看 OutputProcessor、Detokenizer、API Server；
- SGLang 看 Scheduler → DetokenizerManager → TokenizerManager 的 ZMQ 管线；
- MindIE 看 LLM Manager/Text Generator 返回、Tokenizer 与 EndPoint。

## 3. 四条请求生命周期

### 3.1 vLLM

```text
HTTP
→ Protocol/Input Processing
→ EngineCoreRequest
→ V1 Scheduler
→ KVCacheManager
→ GPU Worker/GPUModelRunner
→ CUDA Attention/Graph/NCCL
→ Sampling
→ OutputProcessor
→ SSE/JSON
```

### 3.2 vLLM-Ascend

```text
HTTP
→ upstream Input/EngineCore/Scheduler
→ NPU Worker/NPUModelRunner
→ Ascend Attention/ACLGraph/CANN/HCCL
→ sampled token
→ upstream OutputProcessor/API
```

### 3.3 SGLang

```text
HTTP
→ TokenizerManager
→ ZMQ
→ Scheduler + Radix/KV Pool
→ TP Worker/ModelRunner
→ Kernel Backend/CUDA Graph/NCCL
→ Scheduler
→ DetokenizerManager
→ TokenizerManager
→ SSE/JSON
```

### 3.4 MindIE

```text
Server/EndPoint
→ LLM Manager
   ├─ Engine/Scheduler/Block Manager/Executor
→ Text Generator
   ├─ Preprocess/Generator/Sampler
→ Modeling
   ├─ ATB/MindSpore
→ CANN/HCCL/Ascend
→ Server Response
```

## 4. 架构差异总表

| 维度 | vLLM | vLLM-Ascend | SGLang | MindIE |
|---|---|---|---|---|
| 控制面来源 | upstream vLLM | upstream vLLM | SGLang SRT | MindIE LLM |
| 主要硬件路径 | NVIDIA CUDA 最成熟，另有平台扩展 | Ascend NPU | CUDA 最常用，另有硬件 Backend | Ascend NPU |
| 前缀缓存表达 | Block Hash/Prefix Cache | 同逻辑，NPU KV 实现 | Radix Tree/RadixAttention | Prefix Cache 能力按版本/模型配置 |
| 请求进程管线 | API 与 EngineCore/Worker 分层 | 同上 + NPU Worker | Tokenizer/Scheduler/Detokenizer ZMQ 管线 | Server/Manager/Generator 分层 |
| 配置风格 | CLI/YAML/嵌套 Config | vLLM CLI + Additional Config + env | CLI/YAML + env | 嵌套 `config.json` + env |
| 模型实现 | vLLM/Transformers | Ascend 插件模型与算子 | SGLang/Transformers | ATB Models/MindSpore Models |
| Graph | CUDA Graph/CompilationConfig | ACLGraph/Npugraph_ex/Xlite | CUDA Graph 及分段/可中断路径 | 后端 Graph，模型支持相关 |
| 分布式 | TP/PP/DP/EP + NCCL | TP/PP/DP/EP + HCCL | TP/PP/DP/EP/DCP + NCCL/Backend | TP/DP/EP/CP/SP + HCCL |
| PD 分离 | KV Connector 生态 | Ascend KV Connector/MindIE Motor 等集成 | 原生 Disaggregation 能力 | MindIE Motor/DMI 等能力 |
| 源码可读性 | 高 | 上游和插件均可读 | 高 | 以官方架构、配置、日志和工具为主 |
| 发布边界 | vLLM + CUDA/PyTorch | 完整 Ascend 兼容矩阵 | SGLang + CUDA/PyTorch/Backend | MindIE/CANN/ATB/驱动完整套件 |

## 5. KV Cache 与前缀复用

### 5.1 vLLM

使用 Block Pool 管理 Paged KV Cache；Prefix Cache 通常按 Token Block 内容哈希查找可复用前缀。优势是结构直接、与 Block 管理结合紧密。

### 5.2 vLLM-Ascend

逻辑框架继承 vLLM，但物理 KV Tensor、布局、Attention Kernel、HBM 分配和 Graph Buffer 是 Ascend 实现。相同 Block 参数不保证与 CUDA 得到相同容量和性能。

### 5.3 SGLang

使用压缩 Radix Tree 表达 Token 前缀，并将树节点映射到 KV 位置。LPM 等调度策略可利用前缀局部性。优势在共享系统提示词、Agent 工具定义、多轮会话等场景，但要验证公平性、淘汰和租户隔离。

### 5.4 MindIE

由 Block Manager 统一管理 KV 资源，`cacheBlockSize`、`npuMemSize`、`cpuMemSize` 和 ScheduleConfig 共同决定容量。Prefix Cache 是否可用和配置方法取决于 MindIE 版本、模型和特性文档。

### 5.5 不能用一个命中率横比 {/* #不能用一个命中率横比 */}

公平比较必须固定：

- 完全一致的 Token 前缀；
- 冷/热启动顺序；
- Cache 容量；
- 请求到达过程；
- 命中 Token 数；
- 淘汰状态；
- TTFT 和实际减少的 Prefill 时间。

## 6. 调度思想对比

| 问题 | vLLM | SGLang | MindIE |
|---|---|---|---|
| 每轮 Token 上限 | `max-num-batched-tokens` | `max-prefill-tokens`/Chunk 等 | `maxPrefillTokens` |
| 运行请求上限 | `max-num-seqs` | `max-running-requests` | `maxBatchSize`（Decode） |
| 长 Prefill | Chunked Prefill | `chunked-prefill-size` | SplitFuse/Mix 等依版本能力 |
| 策略 | FCFS/Priority 等 | FCFS/LPM/LOF/Priority 等 | Prefill/Decode 策略及选择模型 |
| KV 不足 | 抢占/重算/Swap 路径 | Request Retract/重新调度 | `maxPreemptCount` 与 CPU KV |
| 首 Token 保护 | Token Budget/优先级/准入 | 调度策略和 Prefill 控制 | `maxFirstTokenWaitTime` |

表中字段不是一一等价。例如 vLLM `max-num-seqs` 控制 Scheduler 序列预算，MindIE `maxBatchSize` 明确偏向 Decode 最大 Batch；迁移时应翻译资源含义，而不是替换参数名。

## 7. 参数语义映射

| 目标 | vLLM | vLLM-Ascend | SGLang | MindIE |
|---|---|---|---|---|
| 最大上下文 | `max-model-len` | 同 vLLM | `context-length` | `maxSeqLen` |
| 最大输入 | 网关/请求/模型长度共同限制 | 同 vLLM | API/Context 限制 | `maxInputTokenLen` |
| 最大输出 | 请求 `max_tokens` + 长度 | 同 vLLM | 请求 `max_new_tokens` | `maxIterTimes` + 请求上限 |
| 设备内存比例 | `gpu-memory-utilization` | 名称相同，实际 NPU HBM | `mem-fraction-static` | `npuMemSize=-1` + `NPU_MEMORY_FRACTION` |
| 显式 KV 预算 | `kv-cache-memory-bytes` | 支持版本同名 | `max-total-tokens` 等 | `npuMemSize` |
| KV 粒度 | `block-size` | 同名、NPU Backend 解释 | `page-size` | `cacheBlockSize` |
| 运行序列预算 | `max-num-seqs` | 同名 | `max-running-requests` | `maxBatchSize`（不完全等价） |
| Prefill Token Budget | `max-num-batched-tokens`（全局 Step 预算） | 同名 | `max-prefill-tokens` | `maxPrefillTokens` |
| TP | `tensor-parallel-size` | 同名 + HCCL | `tp-size` | `worldSize`/模型并行配置 |
| 前缀缓存 | `enable-prefix-caching` | 同名 + Feature Matrix | 默认 Radix 路径/`disable-radix-cache` | 版本/模型特性配置 |
| Graph 关闭 | `enforce-eager` | `enforce-eager` | `disable-cuda-graph` | 后端/模型 Graph 配置 |
| API 接入并发 | 网关/API 进程设计 | 同 vLLM | HTTP/Queue 参数 | `maxLinkNum` |

参数迁移时先写出目标含义，例如“单轮 Prefill Token 不超过 8192”，再到每个框架寻找对应控制面。

## 8. Graph 与 Kernel 生态

### 8.1 vLLM {/* #vllm */}

典型 CUDA Graph、torch.compile/Inductor、FlashAttention/FlashInfer 和自定义 CUDA/Triton 算子路径，具体由模型、GPU 架构和版本选择。

### 8.2 vLLM-Ascend {/* #vllm-ascend */}

使用 Npugraph_ex、ACLGraph、Ascend Attention 和 CANN/自定义算子。即使配置字段仍叫 `cudagraph_mode`，底层也不是 CUDA Graph。

### 8.3 SGLang {/* #sglang */}

显式暴露 Attention、Sampling、Grammar、GEMM、MoE 等 Backend，并提供 CUDA Graph、Piecewise/Breakable 等演进能力。灵活度高，也要求更严格的组合验证。

### 8.4 MindIE {/* #mindie */}

Modeling 通过 ATB 或 MindSpore 模型实现和 CANN 执行，支持的 C++/Python Graph、通信融合和专项优化依模型/版本文档。

任何框架都不能只比较单个 Kernel 宣传值。最终业务性能是 Scheduler、Batch Shape、缓存、Graph 覆盖、通信和返回路径的乘积。

## 9. 硬件与软件栈

### 9.1 NVIDIA 路径 {/* #nvidia-路径 */}

```text
vLLM 或 SGLang
→ PyTorch
→ CUDA/cuBLAS/Attention Kernels
→ NCCL
→ NVIDIA GPU
```

### 9.2 vLLM-Ascend 路径 {/* #vllm-ascend-路径 */}

```text
vLLM + vLLM-Ascend
→ PyTorch + torch-npu
→ CANN/Ascend Ops/ACLGraph
→ HCCL
→ Ascend 910B
```

### 9.3 MindIE 路径 {/* #mindie-路径 */}

```text
MindIE Server/LLM
→ ATB Models 或 MindSpore Models
→ CANN
→ HCCL
→ Ascend 910B
```

在 910B 上，vLLM-Ascend 与 MindIE 的选择主要是两套推理控制面/模型执行生态的选择，而不是硬件选择。

## 10. 模型与量化制品

| 问题 | 结论 |
|---|---|
| BF16/FP16 权重能否共享 | 逻辑上最容易共享，但各框架必须支持模型架构和权重布局 |
| CUDA 量化包能否直接放 910B | 通常不能默认；量化 Packing、Scale 和 Kernel 不同 |
| vLLM-Ascend 量化包能否给 MindIE | 不能默认；使用各自官方模型教程和转换链路 |
| Tokenizer/Chat Template 能否共享 | 可以作为共同制品候选，但 Parser/API 和默认模板仍需契约测试 |
| 输出是否应位级一致 | 浮点/Kernel/采样实现会有差异，应按业务容忍度和精度集验证 |

## 11. API 兼容不等于行为一致

四套框架都可能提供 `/v1/chat/completions`，但以下内容可能不同：

- 未显式传值时的 Sampling 默认；
- Chat Template；
- `max_tokens` 与长度报错；
- Stop String 是否出现在输出中；
- SSE Chunk、Usage 和结束标记；
- Logprobs；
- Tool Call/Reasoning Parser；
- JSON Schema/Structured Outputs；
- 错误码、超时和 Abort；
- 多模态 URL 与安全限制。

必须维护一套框架无关的 API 契约测试，而不是只用 `curl` 看 HTTP 200。

## 12. 可观测性对比

### 12.1 可以统一的业务指标 {/* #可以统一的业务指标 */}

- 请求率、Token 到达率；
- Queue、Running/Waiting；
- TTFT、TPOT/ITL、E2E；
- Prompt/Generation Tokens/s；
- Goodput；
- 错误率、超时和流式完成率；
- KV 使用率、抢占/撤回；
- 每模型/租户的容量与成本。

### 12.2 必须平台化的设备证据 {/* #必须平台化的设备证据 */}

| NVIDIA | Ascend |
|---|---|
| GPU SM/Memory 利用率 | NPU Core/HBM 利用率 |
| CUDA Timeline | CANN/NPU Timeline |
| CUDA Graph Replay | ACLGraph/NPU Graph Replay |
| NCCL | HCCL |
| Nsight/PyTorch Profiler | msprof/msprobe/torch_npu Profiler 等 |

设备“60% 利用率”在不同工具和硬件上的定义不完全相同，不能直接作为跨平台输赢指标。

## 13. 故障定位映射

| 现象 | vLLM | vLLM-Ascend | SGLang | MindIE |
|---|---|---|---|---|
| API 400 | Protocol/InputProcessor | 同 upstream | HTTP/TokenizerManager | EndPoint/openAiSupport |
| Tokenize 慢 | API/Tokenizer Pool | 同 + ARM/NUMA | TokenizerManager | tokenizerProcessNumber/CPU |
| 调度排队 | EngineCore/Scheduler | 同 + Ascend 调度扩展 | Scheduler/Policy | LLM Manager Scheduler |
| KV 不足 | KVCacheManager/BlockPool | NPU KV/HBM/Graph | KV Pool/Radix/Retract | Block Manager/npuMemSize |
| Kernel 空洞 | GPUModelRunner/CPU/Graph | NPUModelRunner/ACLGraph/CPU | TP Worker/Graph/IPC | Text Generator/CANN/CPU |
| 多卡慢 | NCCL/慢 Rank | HCCL/慢 Rank | NCCL/Backend Rank | HCCL/Executor Rank |
| 流式卡顿 | Output/API/Proxy | 同 upstream | DetokenizerManager/ZMQ | Server/后处理/Proxy |

## 14. 典型问题：利用率 30%，TTFT 超标

四套框架都应按同一因果顺序排查：

```text
请求有没有到引擎？
  ↓
是否在 HTTP/Tokenizer 排队？
  ↓
Scheduler 为什么没有形成更大的有效 Batch？
  ↓
KV 是否限制准入或触发抢占？
  ↓
ModelRunner/Text Generator 输入准备是否产生 CPU 空洞？
  ↓
Graph 是否命中？
  ↓
Kernel 是否低效？
  ↓
是否等待 NCCL/HCCL 慢 Rank？
  ↓
Token 生成后是否卡在反分词/网络？
```

框架不同，只是每一层的组件名和工具不同。

## 15. 公平性能比较方法

### 15.1 固定不变项 {/* #固定不变项 */}

```text
模型 Revision/权重哈希
Tokenizer 与 Chat Template
精度或经过等价验证的量化制品
请求 Prompt Token/Output Token 分布
Sampling/Stop/Tool 参数
并发模型或开环到达率
缓存冷热与共享前缀比例
硬件型号、数量、拓扑和功耗模式
网络、存储和压测机位置
```

### 15.2 同时报告 {/* #同时报告 */}

| 类别 | 指标 |
|---|---|
| 延迟 | Queue、TTFT、TPOT/ITL、E2E P50/P95/P99 |
| 吞吐 | Request/s、Prompt/Generation/Total Tokens/s |
| SLO | Goodput、超时、错误、流式完成率 |
| 资源 | HBM、KV、CPU、Graph、通信、功耗 |
| 质量 | 固定评测集、输出/Logprob 偏差、工具成功率 |
| 运维 | 冷启动、扩缩容、升级、故障恢复、调试成本 |

只报告最大 Token/s 会偏向允许长排队的大 Batch 配置，不能代表在线服务优劣。

## 16. 选型建议

### 16.1 更倾向 vLLM 的场景 {/* #更倾向-vllm-的场景 */}

- 主要使用 NVIDIA GPU；
- 希望获得广泛 OpenAI 兼容生态和模型支持；
- 团队已经熟悉 vLLM V1、Kubernetes 与 CUDA/NCCL；
- 需要较清晰的源码、插件与社区集成路径。

### 16.2 更倾向 SGLang 的场景 {/* #更倾向-sglang-的场景 */}

- 共享系统提示词、Agent 工具定义或多轮前缀占比高；
- 希望深入控制 Radix Cache、调度策略和 Kernel Backend；
- 需要 SGLang 特定的分离、缓存或服务能力；
- 团队能够承担更丰富参数组合的基准和回归。

### 16.3 更倾向 vLLM-Ascend 的场景 {/* #更倾向-vllm-ascend-的场景 */}

- 生产硬件是 Ascend 910B；
- 希望复用 vLLM API、EngineCore、调度知识和上层生态；
- 团队愿意同时跟踪 upstream 与插件兼容矩阵；
- 目标模型/功能在 vLLM-Ascend Feature Matrix 中完成验证。

### 16.4 更倾向 MindIE 的场景 {/* #更倾向-mindie-的场景 */}

- 生产硬件是 Ascend，且希望使用 MindIE/ATB/Motor 的完整方案；
- 目标模型和部署规模已有官方验证配置；
- 重视服务/管理/指标平面、安全证书和集群能力的一体化；
- 团队能围绕 MindIE/CANN/HCCL 工具链运维。

### 16.5 不能仅凭框架名决定 {/* #不能仅凭框架名决定 */}

以下条件任一不满足，就应停止拍板并先做 PoC：

- 目标模型和量化受支持；
- 目标功能组合受支持；
- 峰值与 P99 SLO 达标；
- 容量/成本可接受；
- 监控和故障恢复可运维；
- 有稳定版本和回滚路径。

## 17. NVIDIA 与 910B 双资源池的推荐边界

```text
统一网关/API 契约/鉴权/限流/指标
              ↓
      ┌───────┴────────┐
      ↓                ↓
NVIDIA Resource Pool   Ascend Resource Pool
vLLM 或 SGLang         vLLM-Ascend 或 MindIE
CUDA/NCCL              CANN/HCCL
```

可以统一：模型逻辑名称、API 契约、业务指标、流量策略、评测集和发布流程。

必须分开：镜像、驱动/运行时、量化制品、启动参数、设备指标、容量曲线和故障 Runbook。

不要把 NVIDIA 与 Ascend 设备放入同一个 TP/PP/EP 模型实例。

## 18. 框架迁移方法

### 18.1 第一步：冻结源实例 {/* #第一步冻结源实例 */}

保存模型/Tokenizer、请求参数、全部启动配置、环境、硬件、容量曲线和 API 样例。

### 18.2 第二步：建立语义映射 {/* #第二步建立语义映射 */}

不要写：

```text
max-num-seqs 64 → maxBatchSize 64
```

应该写：

```text
目标：在给定 Token 分布下保持 32 条稳定 Decode，
TTFT P95 < X，TPOT P95 < Y，不触发 KV 抢占。
```

然后在目标框架重新求参数。

### 18.3 第三步：功能门禁 {/* #第三步功能门禁 */}

逐项验证模型、量化、Prefix、LoRA、Tool、Reasoning、Structured Output、Logprobs、Multimodal、Speculative、PD 和 Graph。

### 18.4 第四步：精度与协议 {/* #第四步精度与协议 */}

先做 Greedy/固定 Seed 的可比测试，再做真实 Sampling 分布和业务评测；同时跑完整 API 契约。

### 18.5 第五步：重新做容量 {/* #第五步重新做容量 */}

从单请求、并发阶梯、开环过载、缓存冷热到 N-1 故障，全部重新测。旧框架容量数字不可继承。

### 18.6 第六步：灰度 {/* #第六步灰度 */}

按模型/租户/请求特征小流量灰度，监控 SLO、质量、错误和成本，保留一键回滚。

## 19. 参数文章入口

| 框架 | 参数参考 |
|---|---|
| vLLM | [vLLM Serve 生产参数参考](./vllm/25-vLLM-Serve生产参数参考.md) |
| vLLM-Ascend | [vLLM-Ascend 生产参数参考](./vllm-ascend/02-vLLM-Ascend生产参数参考.md) |
| SGLang | [SGLang 生产参数参考](./sglang/02-SGLang生产参数参考.md) |
| MindIE | [MindIE config.json 生产参数参考](./mindie/02-MindIE-config生产参数参考.md) |

## 20. 最终结论

四套框架可以用两条轴理解：

```text
控制面：vLLM / SGLang / MindIE
执行面：CUDA/NCCL / Ascend-CANN/HCCL
```

- vLLM-Ascend 是 vLLM 控制面在 Ascend 执行面的实现；
- MindIE 是昇腾原生的完整推理服务与模型执行体系；
- SGLang 是独立控制面，强调自己的进程管线、Radix Cache 和性能 Backend；
- vLLM 是最值得作为通用推理原理和源码主线学习的基准之一。

学习上可以先掌握共同的 Prefill、Decode、KV、Batch、Graph 和并行，再分别学习组件名和参数；生产上则必须反过来，把每个框架和硬件栈作为独立发布单元，分别做精度、容量与故障验收。

## 21. 官方资料 {/* #官方资料 */}

- [vLLM 官方文档](https://docs.vllm.ai/)
- [vLLM-Ascend 官方文档](https://docs.vllm.ai/projects/ascend/en/latest/)
- [SGLang 官方文档](https://docs.sglang.io/)
- [MindIE 2.3 官方文档](https://www.hiascend.com/document/detail/zh/mindie/230/quickstart/mindie_quickstart_0001.html)
