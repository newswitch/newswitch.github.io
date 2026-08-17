---
title: SGLang 整体架构与请求生命周期
sidebar_position: 1
tags: [SGLang, RadixAttention, Scheduler, ModelRunner, 源码分析]
description: 不堆砌代码，沿一个请求分析 SGLang 的 HTTP Server、TokenizerManager、Scheduler、TP Worker、Radix Cache 与 DetokenizerManager。
---

# SGLang 整体架构与请求生命周期

这篇文章回答一个具体问题：

> 用户向 SGLang 发送“请解释 KV Cache”以后，这句话经历了哪些进程、数据结构、队列、缓存和 Kernel，才成为流式文本？

SGLang 的关键不只是 RadixAttention。它首先是一条将 CPU 协议处理、调度、GPU 执行和反分词拆开的并行管线；Radix Cache、Continuous Batching、Paged KV Cache、CUDA Graph 和高性能 Kernel 都运行在这条管线上。

## 1. 先看全景

```text
Client
  │ POST /v1/chat/completions
  ▼
HTTP Server / OpenAI Adapter
  │ GenerateReqInput
  ▼
TokenizerManager ─────── 请求状态 ReqState
  │ TokenizedGenerateReqInput
  │ ZMQ PUSH
  ▼
Scheduler Process
  ├─ Waiting Queue / Running Batch
  ├─ Schedule Policy / PrefillAdder
  ├─ Radix Cache / Token-To-KV Pool
  └─ TP Worker / ModelRunner
        ├─ Prefill / Decode
        ├─ Attention Backend
        ├─ CUDA Graph
        └─ Sampling
  │ BatchTokenIDOutput
  │ ZMQ PUSH
  ▼
DetokenizerManager Process
  │ BatchStrOutput
  │ ZMQ PUSH
  ▼
TokenizerManager
  │ SSE / JSON
  ▼
Client
```

默认思维模型中有三个主要执行单元：

| 单元 | 主要职责 | 不应该承担的工作 |
|---|---|---|
| 主进程：HTTP Server + TokenizerManager | 协议转换、模板、分词、请求状态、结果聚合 | GPU 批调度与模型前向 |
| Scheduler 子进程 | 队列、Batch、KV、模型执行协调与输出 Token | 将 Token ID 逐段转换成最终文本 |
| DetokenizerManager 子进程 | 增量反分词、可打印文本边界 | 决定下一个请求是否进入 GPU |

这种拆分让 Tokenizer、调度循环和增量反分词不必在同一个 Python 解释器中争用执行时间。组件之间主要通过 ZMQ IPC 发送结构化消息。

## 2. 启动时发生了什么

常见启动命令是：

```bash
python -m sglang.launch_server \
  --model-path /models/Qwen \
  --host 0.0.0.0 \
  --port 30000 \
  --tp-size 2
```

启动不是“导入模型然后监听端口”，而是依次完成：

1. 解析 `ServerArgs`，归一化模型、内存、并行、调度和 Backend 参数。
2. 读取模型 `config.json`、Tokenizer 与 Chat Template。
3. 建立进程间通信地址和 ZMQ Socket。
4. 创建 Scheduler；TP 场景为各 Rank 建立执行环境和 NCCL 通信。
5. ModelRunner 加载、切分权重并选择 Attention/Sampling/GEMM Backend。
6. 分配模型权重、KV Cache Pool、Token 映射和临时 Workspace。
7. 执行 Kernel Warmup 和 CUDA Graph Capture（若启用）。
8. 启动 DetokenizerManager，建立返回通道。
9. 完成健康检查后，HTTP Server 才对外 Ready。

因此启动阶段卡住要按阶段定位：

| 最后日志阶段 | 常见问题层 |
|---|---|
| Tokenizer/Config | 模型目录、Remote Code、Chat Template、Transformers 版本 |
| Weight Loading | 权重格式、量化 Backend、磁盘吞吐、GPU OOM |
| Distributed Init | GPU 可见性、NCCL、网卡、端口、Rank 配置 |
| KV Pool | `mem_fraction_static` 过高、上下文和模型占用超预算 |
| Warmup/Graph | Capture Batch、Kernel Backend、动态 Shape、额外显存 |
| HTTP Ready 前 | 子进程异常退出、IPC、共享内存或 Watchdog |

## 3. 第一站：OpenAI API 进入 HTTP Server

请求示例：

```json
{
  "model": "qwen-prod",
  "messages": [
    {"role": "user", "content": "请解释 KV Cache"}
  ],
  "temperature": 0.2,
  "max_tokens": 128,
  "stream": true
}
```

HTTP 层先做的是协议工作：

- 校验模型名和请求字段；
- 使用 Chat Template 将消息数组渲染为模型实际 Prompt；
- 规范化 Sampling 参数、停止条件、工具调用和结构化输出；
- 构造内部的 `GenerateReqInput`；
- 将请求交给 TokenizerManager。

这里还没有进入 GPU。以下故障属于接入/预处理层：

- 400 参数错误；
- Chat Template 不存在或角色不支持；
- 工具调用 Parser 不匹配；
- 多模态 URL 被安全策略拒绝；
- 请求体过大；
- 输入已经很长但尚未得到 Token 数。

## 4. 第二站：TokenizerManager

TokenizerManager 是请求生命周期的协调者，而不只是一个 `tokenizer.encode()` 包装器。

它主要完成：

1. 将文本转换为 Token ID；
2. 处理图像、音频等多模态预处理结果；
3. 校验输入长度和生成预算；
4. 创建请求 ID 与 `ReqState`；
5. 将 Sampling 参数变成内部对象；
6. 构造 `TokenizedGenerateReqInput`；
7. 通过 ZMQ 发给 Scheduler；
8. 等待 DetokenizerManager 返回增量文本；
9. 聚合 Usage、Finish Reason 和流式响应。

数据结构可简化为：

```text
GenerateReqInput
  ├─ text / input_ids / embeddings
  ├─ sampling params
  ├─ stream
  ├─ multimodal data
  └─ request metadata
          ↓ tokenize + validate
TokenizedGenerateReqInput
  ├─ rid
  ├─ input_ids
  ├─ sampling_params
  ├─ stream
  └─ feature metadata
```

如果 GPU 利用率低但 CPU 很高、进入 Scheduler 的速率低，应检查：

- Tokenizer 单核或进程数；
- Chat Template 与超长文本处理；
- 多模态 Processor；
- Python GC 与 CPU Cgroup；
- NUMA 和容器 CPU 限额；
- HTTP 连接和请求解析。

## 5. 第三站：Scheduler 接收请求

Scheduler 收到 Tokenized 请求后会创建内部 `Req`，并放入等待队列。一个请求至少携带：

- 原始输入 Token；
- 已生成 Token；
- Sampling/Stop 条件；
- KV Cache 位置；
- 前缀匹配长度；
- 当前是 Prefill、Decode、Retracted 还是 Finished；
- 优先级、到达时间和流式状态。

Scheduler 的循环可以概括为：

```text
接收新请求/控制消息
        ↓
更新 waiting_queue 与 running_batch
        ↓
回收已完成请求资源
        ↓
检查 Radix Cache 可复用前缀
        ↓
依据 Token/KV 预算选择 Prefill 请求
        ↓
与正在 Decode 的请求组成下一轮执行计划
        ↓
ModelRunner Forward + Sampling
        ↓
更新请求、KV 和输出
```

Continuous Batching 的含义就在这里：每轮前向结束后，都可以移除完成请求、加入新请求或调整 Batch，而不是等一整批请求全部生成完。

## 6. RadixAttention 到底是什么

### 6.1 它解决的问题

多个请求常共享前缀：

```text
系统提示词 + 工具定义 + 用户问题 A
系统提示词 + 工具定义 + 用户问题 B
系统提示词 + 工具定义 + 用户问题 C
```

如果共享部分已经计算过，重复 Prefill 会浪费算力。SGLang 使用 Radix Tree 表达 Token 序列前缀，并把树节点与 KV Cache 位置关联。

### 6.2 一次匹配

新请求进入调度器后：

1. 用输入 Token 序列查询 Radix Cache；
2. 找到最长已缓存前缀；
3. 复用该前缀对应的 KV 位置；
4. 只对未命中的后缀执行 Prefill；
5. 新产生的 KV 再插入树中；
6. 内存不足时，按淘汰策略清理未被运行请求锁定的节点。

### 6.3 Radix Tree 与物理 KV Pool 不是一回事

- Radix Tree 回答“哪些 Token 前缀已经计算过”；
- Token-To-KV Pool 回答“每个逻辑 Token 的 KV 在物理内存哪里”；
- KV Cache Tensor 才是真正占用显存的数据。

只看树节点数量不能等价推导显存，用命中率也不能单独证明性能收益。还要看命中 Token 数、树维护、淘汰、请求分布和实际 Prefill 时间。

### 6.4 LPM 调度

`schedule_policy=lpm` 倾向选择与现有缓存有较长前缀匹配的请求，以提高局部性。它可能提高吞吐，但必须验证尾延迟和公平性：长时间没有热门前缀的请求不应被无限推迟。

## 7. Prefill 如何进入执行批次

Scheduler 不能把所有等待请求一次塞进 GPU。它受多重预算约束：

- 剩余 KV Token 容量；
- `max_prefill_tokens`；
- `chunked_prefill_size`；
- `prefill_max_requests`；
- 最大运行请求数；
- 已运行 Decode 请求占用；
- Graph/Kernel 支持的 Shape；
- 多模态 Encoder 的额外资源。

长 Prompt 可以被切成多个 Chunk。这样能避免一次 Prefill 长时间阻塞 Decode，但也会带来更多调度轮次和中间状态。调优目标不是“Chunk 越小越好”，而是同时满足：

- 在线请求 TTFT；
- 已运行请求 TPOT；
- 总 Token 吞吐；
- KV/Workspace 不 OOM。

## 8. ScheduleBatch 到 ModelRunner

调度完成后，请求会被整理为 GPU 可执行批次。概念上的数据变化是：

```text
Req
  ↓ Scheduler 选中多个请求
ScheduleBatch
  ↓ 整理设备输入与执行元数据
ModelWorkerBatch / ForwardBatch
  ↓
ModelRunner Forward
```

ForwardBatch 通常需要表达：

- Prefill 或 Decode 模式；
- 每条序列的长度和位置；
- KV Cache Slot/页映射；
- Attention 元数据；
- Sampling 元数据；
- TP/DP Rank 信息；
- CUDA Graph 是否可复用的 Batch Shape。

如果 Timeline 显示 GPU Kernel 之间存在大段空洞，问题不一定在算子。可能是 CPU 正在构造 Batch、复制元数据、等待另一个 Rank，或当前 Shape 没有命中 Graph。

## 9. TP Worker 与 ModelRunner

TP Worker 负责一个模型执行 Rank。ModelRunner 是设备热路径的组织者，主要负责：

- 权重加载与模型实例；
- 输入 Tensor 和 Buffer 准备；
- Attention Backend；
- KV Cache 读写；
- CUDA Graph Capture/Replay；
- 模型 Forward；
- Logits 处理和 Sampling；
- TP 集合通信。

一层 Transformer 的核心路径仍然是：

```text
Embedding
  → Q/K/V Projection
  → RoPE
  → Attention（读写 KV Cache）
  → O Projection
  → All-Reduce / Reduce-Scatter
  → MLP 或 MoE
  → Residual / Norm
```

SGLang 允许选择 Attention、Sampling、Grammar、GEMM 等 Backend。Backend 不是单纯的“更快开关”，它受 GPU 架构、dtype、量化、Head Dimension、模型结构、上下文和功能组合约束。

## 10. Prefill 与 Decode 的设备特征

| 特征 | Prefill | Decode |
|---|---|---|
| 单请求 Token 数 | 多 | 通常每轮 1 个或少量草稿 Token |
| 主要压力 | 计算、Attention、瞬时 Workspace | HBM 带宽、Kernel Launch、Batch 组织 |
| 关键指标 | TTFT、Prompt Tokens/s | TPOT/ITL、Generation Tokens/s |
| 常见优化 | Radix 命中、Chunked Prefill、FlashAttention | Continuous Batching、CUDA Graph、融合 Kernel |
| 常见干扰 | 长 Prompt 阻塞 Decode | Batch 太小、Graph 未命中、CPU 空洞 |

设备利用率是两类工作混合后的结果。仅看一条平均 GPU Utilization，无法判断 TTFT 高是排队、Prefill 计算、Graph 回退还是通信。

## 11. Sampling 与完成判断

ModelRunner 得到 Logits 后会执行：

1. Temperature、Top-k、Top-p、Min-p 等变换；
2. 重复惩罚和自定义 Logits Processor；
3. Grammar/JSON Schema 约束（若启用）；
4. 采样或 Greedy 选择下一个 Token；
5. 将 Token ID 返回 Scheduler。

Scheduler 更新请求并判断：

- 是否命中 EOS/Stop Token；
- 是否命中停止字符串所需状态；
- 是否达到 `max_new_tokens`；
- 是否因长度、Abort、错误或超时结束；
- KV 资源是否应释放或进入可复用缓存。

## 12. DetokenizerManager 为什么独立

Token ID 到字符串不是简单的一一映射。BPE/SentencePiece 可能把一个 UTF-8 字符拆成多个 Token；单独解码某个中间 Token 可能产生乱码。DetokenizerManager 维护每个请求的增量解码状态：

```text
BatchTokenIDOutput
  ↓ 追加 Token ID
维护 read_offset / decode_offset / 已解码文本
  ↓ 只输出新出现且可打印的部分
BatchStrOutput
```

然后 TokenizerManager 将文本片段转换为 SSE Chunk，并最终返回 Usage、Finish Reason 和结束标记。

如果 GPU 已完成但客户端流式卡顿，应检查：

- Scheduler 到 Detokenizer 的 IPC；
- Detokenizer CPU 与 GC；
- Stop String 检测；
- TokenizerManager 结果聚合；
- ASGI/代理 Buffer；
- 客户端是否及时读取 SSE。

## 13. 请求数据结构全链路

```text
HTTP JSON
  ↓
ChatCompletionRequest
  ↓ protocol conversion
GenerateReqInput
  ↓ tokenize
TokenizedGenerateReqInput
  ↓ scheduler admission
Req
  ↓ batch construction
ScheduleBatch
  ↓ device preparation
ModelWorkerBatch / ForwardBatch
  ↓ forward + sample
next_token_ids
  ↓
BatchTokenIDOutput
  ↓ detokenize
BatchStrOutput
  ↓ state aggregation
SSE / JSON Response
```

遇到问题时，先找“最后一个正确的数据结构”，再检查下一个转换，而不是直接改显存参数。

## 14. 关键参数映射到组件

| 参数 | 主要作用组件 | 典型影响 |
|---|---|---|
| `tokenizer_worker_num` | TokenizerManager | CPU 分词吞吐 |
| `mem_fraction_static` | ModelRunner/KV Pool | 权重与 KV 的静态显存预算 |
| `max_running_requests` | Scheduler | 运行中请求上限 |
| `max_prefill_tokens` | Scheduler | 单次 Prefill Token Budget |
| `chunked_prefill_size` | Scheduler | 长 Prompt 切分和 Decode 干扰 |
| `schedule_policy` | Scheduler | 公平性与前缀局部性 |
| `page_size` | KV Pool | 分配粒度与内部碎片 |
| `radix_eviction_policy` | Radix Cache | 缓存淘汰行为 |
| `attention_backend` | ModelRunner | Attention Kernel 路径 |
| `cuda_graph_max_bs` | ModelRunner | Graph Capture 覆盖与显存 |
| `tp_size` | TP Worker | 单卡权重与 NCCL 通信 |

完整释义见[生产参数参考](./02-SGLang生产参数参考.md)。

## 15. 性能证据应该怎样采集

至少同时保留：

- 请求到达率、输入/输出 Token 分布；
- Waiting/Running 请求；
- Radix Cache 命中 Token 和淘汰；
- KV/Token Pool 使用率；
- Queue、TTFT、TPOT/ITL、E2E；
- Prefill/Decode Token 吞吐；
- CUDA Timeline、Graph Replay 与 Kernel；
- CPU、线程、GC、IPC；
- 每个 TP Rank 的 NCCL 和执行时间。

因果判断示例：

```text
TTFT 高
├─ Queue 高 → 容量/准入/调度
├─ Queue 低、Tokenize 高 → CPU/Tokenizer
├─ Prefill 高、Radix 命中低 → 输入分布/缓存/算子
├─ Kernel 短但空洞大 → CPU Batch/Graph/IPC
└─ 单 Rank 慢 → NCCL/拓扑/NUMA/硬件
```

## 16. 源码阅读入口

建议只抓住主线文件，不要从仓库根目录随机阅读：

| 源码入口 | 关注问题 |
|---|---|
| `sglang/srt/entrypoints/http_server.py` | HTTP API 如何进入 Engine |
| `sglang/srt/entrypoints/engine.py` | 三组件如何启动和连接 |
| `sglang/srt/managers/tokenizer_manager.py` | Tokenize、ReqState 和结果聚合 |
| `sglang/srt/managers/io_struct.py` | 进程间消息结构 |
| `sglang/srt/managers/scheduler.py` | Scheduler 主循环 |
| `sglang/srt/managers/schedule_batch.py` | Req 与 Batch 数据结构 |
| `sglang/srt/managers/tp_worker.py` | TP Rank 和 ModelRunner 调用 |
| `sglang/srt/model_executor/model_runner.py` | 模型设备热路径 |
| `sglang/srt/mem_cache/` | Radix Cache、内存池和 KV 映射 |
| `sglang/srt/managers/detokenizer_manager.py` | 增量反分词 |

## 17. 常见误区

### 误区一：SGLang 等于 RadixAttention

Radix Cache 是核心特性之一，但服务性能还取决于进程管线、Scheduler、ModelRunner、Kernel、Graph、通信和请求分布。

### 误区二：前缀命中率越高，业务一定越快

需要看命中 Token 数和节省的 Prefill 时间。大量极短前缀命中可能统计很好，却几乎不改变 TTFT。

### 误区三：增大静态显存比例只会增加 KV 容量

过高会挤压 CUDA Graph、通信、临时 Workspace 和运行时峰值，可能在压测时 OOM。

### 误区四：LPM 永远优于 FCFS

LPM 强调缓存局部性；FCFS 更容易解释公平性。最终取决于共享前缀分布和 SLO。

### 误区五：HTTP 返回慢就是 GPU 慢

流式路径还经过 Detokenizer、TokenizerManager、ASGI、代理和客户端 Buffer。

## 18. 总结

SGLang 的完整请求链路是：

```text
协议与模板
→ TokenizerManager
→ ZMQ
→ Scheduler + Radix/KV Pool
→ TP Worker + ModelRunner
→ Attention/Graph/Sampling
→ Scheduler
→ DetokenizerManager
→ TokenizerManager
→ 流式响应
```

真正掌握框架的标志，是能把每一个性能指标和故障证据映射到这条链路中的具体组件，并用参数控制实验验证，而不是只记住“RadixAttention 可以复用前缀”。

## 官方资料与源码

- [SGLang Server Arguments](https://docs.sglang.io/docs/advanced_features/server_arguments)
- [SGLang Hyperparameter Tuning](https://docs.sglang.io/docs/advanced_features/hyperparameter_tuning)
- [SGLang GitHub](https://github.com/sgl-project/sglang)
- [Engine 源码](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/entrypoints/engine.py)
- [Scheduler 源码](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/managers/scheduler.py)
- [TokenizerManager 源码](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/managers/tokenizer_manager.py)
- [DetokenizerManager 源码](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/managers/detokenizer_manager.py)
