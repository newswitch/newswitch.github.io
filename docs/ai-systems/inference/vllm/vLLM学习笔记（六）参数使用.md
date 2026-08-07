---
title: vLLM 学习笔记（六）：参数使用
sidebar_position: 6
date: 2026-02-19 12:00:00
categories: 机器学习
tags: [vLLM, 大模型, 推理, LLM, 深度学习]
---

# vLLM 学习笔记（六）：参数使用

本系列基于 vLLM 0.6.3 版本。前五篇侧重源码与内部机制，本文整理 **vLLM 的常用参数与配置**，便于部署与调优时查阅。

## 概述

vLLM 支持通过命令行参数或配置文件控制模型加载、KV Cache、并发、采样与分布式等行为。下文按功能分组说明常用参数，并与本系列（一）～（五）中的概念对应，便于结合源码理解。

下文在每个参数旁用 **取值** 标出可选值及含义、用 **默认值** 标出默认；**第 10 节**对枚举/多选类参数逐值展开说明。参数与（一）中模型加载、KV 块估计、（三）调度器、（四）BlockSpaceManager、（五）PrefixCaching 等对应，便于对照源码理解。

## 1 模型与加载

### 1.1 模型路径与来源

- **--model**：使用的 Hugging Face 模型名称或路径。**取值**：任意 HF 模型 ID（如 `facebook/opt-125m`）或本地目录路径。默认: `"facebook/opt-125m"`。
- **--download-dir**：下载和加载权重的目录。**取值**：合法目录路径；空/未指定时使用 Hugging Face 默认缓存目录。
- **--revision**：使用的具体模型版本（分支名、标签名或提交 ID）。**取值**：如 `main`、`v1.0`、或 commit hash；`None` 表示仓库默认。默认: `None`。
- **--code-revision**：模型代码的修订版本。**取值**：同 `--revision`。默认: `None`。
- **--trust-remote-code**：是否信任并执行来自 Hugging Face 的远程代码。**取值**：`True` / `False`。默认: `False`。
- **--allowed-local-media-path**：允许 API 从指定服务器目录读取本地图像/视频；存在安全风险。**取值**：目录路径字符串；空字符串表示不开放任何本地路径。默认: `""`。

### 1.2 分词器与配置

- **--tokenizer**：分词器名称或路径。**取值**：HF 模型 ID 或本地路径；`None` 表示与 `--model` 相同。默认: `None`。
- **--skip-tokenizer-init**：是否跳过分词器/反分词器初始化。**取值**：`True` / `False`。默认: `False`。**影响**：设为 `True` 时，引擎内不加载分词器/反分词器；请求必须提供**已分词的** `prompt_token_ids`，且不能传原始文本 `prompt`（需为 `None`）。适用于在外部或前置服务统一分词、避免重复加载分词器或减少内存占用的场景；若仍传文本 prompt 会报错或无法处理。
- **--tokenizer-revision**：Hugging Face 分词器的修订版本。**取值**：同 `--revision`。
- **--tokenizer-mode**：分词器模式。**取值**：`auto` 自动选择；`slow` 慢路径兼容；`mistral` Mistral 专用；`custom` 自定义。默认: `"auto"`。
- **--load-format**：加载模型权重的格式。**取值**：`auto` 自动（优先 safetensors）；`pt` PyTorch；`safetensors`；`npcache` NP 缓存；`dummy` 占位；`tensorizer`；`sharded_state` 分片；`gguf`；`bitsandbytes`；`mistral`；`runai_streamer`。默认: `"auto"`。
- **--config-format**：加载模型配置的格式。**取值**：`auto` 自动；`hf` HuggingFace 标准；`mistral` Mistral 格式。默认: `"auto"`。
- **--hf-overrides**：Hugging Face 配置的额外覆盖。**取值**：JSON 字符串，如 `"{\"key\": \"value\"}"`。

### 1.3 数据类型与任务

- **--dtype**：模型权重和激活的数值类型。**取值**：`auto`（按模型 config 的 `torch_dtype`，config 为 float32 时改用 float16）；`half`/`float16`；`bfloat16`；`float`/`float32`。默认: `"auto"`。
- **--kv-cache-dtype**：KV 缓存存储的数据类型。**取值**：`auto` 与模型权重 dtype 一致（不读 config 单独字段）；`fp8`/`fp8_e4m3`/`fp8_e5m2` 8 比特，省显存。默认: `"auto"`。
- **--task**：任务类型。**取值**：`auto` 由模型类型/API 推断；`generate` 生成；`embedding`/`embed` 嵌入；`classify` 分类；`score` 打分；`reward` 奖励模型；`transcription` 语音转写。默认: `"auto"`。
- **--model-impl**：模型实现。**取值**：`auto` 由 vLLM 按模型架构选择实现（非 config）；`vllm` 内置（推荐）；`transformers` 走 HF。默认: `"auto"`。
- **--max-model-len**：模型最大上下文长度（token 数）。**取值**：正整数或 `None`。**`None`/未指定时**：从模型 config（如 `max_position_embeddings`）推导，是少数直接读 config 的参数之一。默认: `None`。
- **--guided-decoding-backend**：**引导解码**（Guided Decoding）所用引擎，即按**语法/JSON Schema/正则**等约束逐 token 生成，使输出符合指定格式（如合法 JSON、EBNF 文法、正则）。**取值**：`outlines-dev/outlines` Outlines；`mlc-ai/xgrammar` xGrammar（默认）；`noamgat/lm-format-enforcer` lm-format-enforcer。默认: `"xgrammar"`。
- **--logits-processor-pattern**：允许的 logits 处理器名称正则。**取值**：正则字符串，如 `"^my_processor$"`。与 config 无关。
- **--device**：执行设备。**取值**：`auto` 按当前环境与硬件选择（如检测到 CUDA 则 `cuda`），不读模型 config。其余：`cuda`、`neuron`、`cpu`、`openvino`、`tpu`、`xpu`、`hpu`。默认: `"auto"`。**华为升腾（Ascend NPU）**：上游 vLLM 不直接支持；需使用 **vLLM-Ascend**，并通过**环境变量**指定设备，例如 `export DEVICE=/dev/davinci0`（多卡可为 `davinci1` 等），再启动服务；Docker 运行时需挂载对应 `--device /dev/davinci0` 等。

### 1.4 vLLM 与 vLLM-Ascend 区别

| 维度 | vLLM | vLLM-Ascend |
|------|------|-------------|
| **定位** | 上游主项目，通用 GPU（含 CUDA 等）推理框架 | 面向华为昇腾 NPU 的**硬件插件**，非 fork，独立仓库与包 |
| **关系** | 主代码库，支持 PageAttention、连续批处理等 | 遵循 vLLM 的「硬件可插拔」RFC，实现 Ascend 的 Executor / Worker / Attention 等后端，与主库解耦 |
| **设备** | `--device` 支持 cuda、cpu、neuron、tpu、xpu、hpu 等 | 仅 Ascend NPU，通过环境变量 `DEVICE=/dev/davinci0` 等指定 |
| **安装** | `pip install vllm` | `pip install vllm-ascend`（与 vLLM 版本对齐，如 v0.13.0 对应 vLLM v0.13.0） |
| **维护** | vLLM 社区 | vLLM 社区 + 昇腾相关适配（仓库 `vllm-project/vllm-ascend`） |

二者 API 与使用方式尽量一致，便于在 GPU 与昇腾 NPU 间切换；昇腾上需用 vLLM-Ascend 并配置 CANN、驱动等环境。

## 2 KV Cache 与内存

与（一）中 **determine_num_available_blocks**、（四）**BlockSpaceManager** 的块数与显存分配对应。

### 2.1 block-size、gpu-memory-utilization

- **--block-size**：每个 KV 块容纳的连续 token 数。**取值**：`8`、`16`、`32`、`64`、`128`（越小块越细、调度越灵活；CUDA 仅支持 ≤32）。**未指定时**：无 `auto` 字面值，不传则由 `Platform.check_and_update_config()` 在运行时设定；CUDA 上通常为 **16**，HPU 上通常为 **128**。
- **--gpu-memory-utilization**：用于模型执行的 GPU 内存比例。**取值**：0～1 的浮点数（如 `0.9` 表示 90%）。默认: `0.9`。
- **--num-gpu-blocks-override**：强制使用的 GPU 块数量，覆盖自动分析。**取值**：正整数或 `None`。默认: `None`。

### 2.2 swap-space、CPU 卸载

- **--swap-space**：每个 GPU 对应的 **KV cache 交换空间**（CPU 侧，单位 GiB）。**含义**：当请求被抢占（preempt）时，可将该请求的 KV 块从 GPU 换出到这块 CPU 内存，等再次调度时再换回，从而避免从头重算（recompute）。**取值**：非负浮点数，如 `4`。默认: `4`。与 `preemption-mode=swap` 配合使用；设为 0 则无法做 KV swap，抢占时只能 recompute。
- **--cpu-offload-gb**：每个 GPU 对应的 **模型权重复制到 CPU 的容量**（GiB）。**含义**：把一部分模型权重常驻在 CPU，前向时再按需拷到 GPU，相当于“虚拟扩大显存”，用于在显存不足时加载更大模型（如 24G 卡 + 10G offload ≈ 34G，可加载约 13B BF16）。**取值**：非负浮点数；`0` 表示不卸载。默认: `0`。需 CPU–GPU 带宽较好，否则前向会变慢。

**区别简述**：`swap-space` 管的是 **KV 缓存的换入换出**（给被抢占的请求腾显存）；`cpu-offload-gb` 管的是 **模型权重** 放在 CPU、按需拷到 GPU，二者作用对象不同。

### 2.3 其他内存与长度

- **--max-model-len**（最大上下文长度）  
  见 1.3。约束单条序列允许的最大 token 数（prompt + 生成），直接影响显存占用与调度预算：越大则 KV 块需求越多、单批可并发的序列数越少。未指定时从模型 config（如 `max_position_embeddings`）推导。**取值**：正整数或 `None`。

- **--enforce-eager**（强制 Eager 模式）  
  为 `True` 时**完全禁用 CUDA Graph**，所有前向均以 PyTorch 的 eager 模式执行。CUDA Graph 会把一段 GPU 算子序列录成图并复放，减少 kernel 启动开销、提升吞吐，但不利于调试且对动态 shape 等支持有限。**适用**：调试、遇到 CUDA Graph 相关报错或兼容性问题时。**取值**：`True` / `False`。默认: `False`。

- **--max-seq-len-to-capture**（CUDA 图捕获的最大序列长度）  
  使用 CUDA Graph 时，仅对**序列长度 ≤ 该值**的 batch 进行图捕获与复放；超过该长度的请求会**回退到 eager**，避免为过长序列捕获图导致显存或兼容性问题。未指定时由编译/图配置内部决定。**取值**：正整数或 `None`。默认: `None`。

- **--disable-custom-all-reduce**（禁用自定义 All-Reduce）  
  张量并行（TP）下，多卡间需做 all-reduce 同步。vLLM 提供**自定义 all-reduce 内核**以替代 NCCL，在某些拓扑下更快。设为 `True` 时强制使用 NCCL 等标准通信。**适用**：多节点、非常规 GPU 数（如 3/5/6 卡）时自定义实现可能不可用或报错，可显式关闭。**取值**：`True` / `False` / `None`。默认: `None`（自动；多节点等场景下会自动禁用）。

- **--calculate-kv-scales**（动态计算 KV FP8 缩放因子）  
  当 `--kv-cache-dtype` 为 fp8 时，KV 写入缓存前需用量化缩放因子（k_scale、v_scale）。为 `True` 时在**运行时**根据 warmup 或当前 batch 动态计算这些 scale；为 `False` 时使用 checkpoint 中预存的 scale，若无则默认为 1.0，可能影响 fp8 KV 精度。**适用**：无预校准或希望随数据自适应时设为 `True`。**取值**：`True` / `False`。默认: `False`。

## 3 并发与调度

与（三）**调度器**、（四）**SchedulingBudget** 的 token 预算与序列数上限对应。

### 3.1 max-num-seqs、max-num-batched-tokens

二者共同构成调度器每轮迭代的**预算**（对应本系列（三）调度器、（四）SchedulingBudget）：每次前向步内，同时参与的序列数不超过 `max_num_seqs`，总 token 数不超过 `max_num_batched_tokens`。显存一定时，二者越大则单步并发越高、吞吐潜力越大，但 KV 占用与抢占风险也上升；调小可减轻抢占、改善尾延迟，代价是并发与吞吐下降。

- **--max-num-seqs**（每轮最大序列数）  
  单次调度迭代中**最多允许同时参与计算**的序列（请求）数。越大则同一时刻能跑的请求越多，有利于高 QPS；但每条序列都会占用 KV 块，过大易导致显存不足、触发抢占（recompute/swap），反而拉高延迟。**调优**：若日志中抢占频繁，可适当减小以稳定延迟；显存充裕且追求吞吐时可增大。**取值**：正整数（如 64、128、256）。默认: 未指定时由引擎根据配置填入（SchedulerConfig 默认 128）。

- **--max-num-batched-tokens**（每轮 token 预算）  
  单次调度迭代中**允许处理的总 token 数上限**（prefill 与 decode 共享该预算）。调度器会在此预算内尽量多排请求：先满足正在 decode 的序列，再在剩余预算内排 prefill。**与 max_model_len 关系**：若不开启 chunked prefill，单条 prompt 必须在一轮内全部 prefill，因此 `max_num_batched_tokens` 需 ≥ `max_model_len`，否则长 prompt 无法被调度；开启 chunked prefill 后，长 prompt 可多轮分块 prefill，该值可小于 max_model_len（如 512、2048）。**调优**：值越大，单步可处理的 prefill 越多，首 token 延迟（TTFT）易改善，但步内 decode 与 prefill 争抢预算，可能拉长 inter-token 延迟（ITL）；减小则 TTFT 可能变差、ITL 更稳。**取值**：正整数（如 2048、4096）。默认: 未指定时由引擎填入（SchedulerConfig 默认 2048）。

### 3.2 分块预填充与调度策略

- **--max-num-partial-prefills**：分块预填充时，可同时进行部分预填充的最大序列数。**取值**：正整数，≥1。默认: `1`。
- **--max-long-partial-prefills**：分块预填充时，长请求（超过 long_prefill_tokens_threshold）中可同时部分预填充的最大数。**取值**：正整数，≤ max_num_partial_prefills。默认: `1`。
- **--long-prefill-token-threshold**：prompt 超过该 token 数即视为“长请求”。**取值**：非负整数，0 表示不区分长短。默认: `0`。
- **--enable-chunked-prefill**：是否启用按 token 预算分块的预填充。**取值**：`True` / `False`；支持时多为 True。默认: 由模型/引擎决定。
- **--scheduler-delay-factor**：调度下一个 prompt 前的延迟系数（延迟 = 系数 × 上一 prompt 延迟）。**取值**：浮点数。默认: 未指定。
- **--num-scheduler-steps**：每次调度器调用最多执行的前向步数。**取值**：正整数。默认: `1`。
- **--multi-step-stream-outputs**：多步调度时是否每步流式输出。**取值**：`True` 每步流式；`False` 全部步完成后再输出。默认: `True`。
- **--scheduling-policy**：调度策略。**取值**：`fcfs` 先到先服务；`priority` 按优先级（数小优先）。默认: `"fcfs"`。
- **--scheduler-cls**：调度器类名或类。**取值**：如 `vllm.v1.core.sched.scheduler.Scheduler` 或 `None` 用内置。默认: `None`。
- **--preemption-mode**：被抢占序列的处理方式。**取值**：`recompute` 释放 KV、下次重算；`swap` 换出到 CPU、恢复时换回。默认: 未指定。

## 4 采样与生成

- **--max-logprobs**：每个 token 返回的最大 log 概率个数。**取值**：非负整数（0 表示不返回）。默认: `20`。
- **--served-model-name**：API 暴露的模型名，可多个。**取值**：单个字符串或列表；`None` 表示与 `--model` 一致。默认: `None`。
- **--seed**：随机种子，用于采样可复现。**取值**：整数。默认: `0`。
- **--disable-log-stats**：是否禁用日志中的统计信息。**取值**：`True` / `False`。默认: `False`。
- **--generation-config**：生成配置所在目录路径。**取值**：目录路径字符串。默认: 由 ModelConfig 决定。
- **--override-generation-config**：覆盖生成配置的键值。**取值**：JSON 对象（如 `{"temperature": 0.7}`）。默认: 空字典。

（temperature、top_p、stop、max_tokens 等多为请求级参数，在 API 请求体中指定，此处为引擎/服务端全局相关参数。）

## 5 分布式

- **--distributed-executor-backend**（分布式执行后端）  
  决定多 GPU/多节点时如何启动与通信。**uni**：单进程单卡，不启分布式；**mp**（multiprocessing）：单机多卡时常用，同一节点内多进程、通信低延迟；**ray**：多节点或需 Ray 编排时使用（如 `ray symmetric-run` 启动）；**external_launcher**：由外部启动器（如 torchrun）管理进程，vLLM 内只起一个 worker。单卡默认 `uni`，多卡单节点默认多为 `mp`，多节点需显式设 `ray` 或配合外部启动器。**取值**：`ray`、`mp`、`uni`、`external_launcher`。

- **--tensor-parallel-size, -tp**（张量并行大小）  
  把**同一层**的矩阵运算沿维度切分到多张 GPU 上，单层内需频繁 all-reduce/all-gather，对卡间带宽（NVLink/InfiniBand）要求高。**适用**：单机多卡、模型单卡放不下时；通常设为**该节点内参与推理的 GPU 数**（如 2、4、8）。**与 pp 区别**：tp 是“层内”切分、同节点；pp 是“层间”切分、可跨节点。**取值**：正整数。默认: `1`。

- **--pipeline-parallel-size, -pp**（管道并行阶段数）  
  把模型**按层**切成若干段，每段在一个 pipeline 阶段（可对应不同节点）上执行，阶段间传递激活。**适用**：模型跨多节点（如 70B+ 两节点各 8 卡），常与 tp 组合：`tp`=每节点 GPU 数，`pp`=节点数。**注意**：pp 会引入 pipeline 气泡与阶段间传输，小 batch 时延迟可能上升。**取值**：正整数。默认: `1`。

- **--max-parallel-loading-workers**（并行加载 worker 数上限）  
  启动时**并行加载模型权重**的 worker 数上限。TP 下若不使用分片 checkpoint，每个进程会读完整权重再切分，多进程同时读会推高 CPU RAM 与 I/O；限制该值可降低加载阶段内存峰值，避免 OOM，代价是加载时间可能变长。使用**分片 checkpoint**（每 rank 只读自己的分片）时压力较小。**取值**：正整数或 `None`（不限制）。默认: `None`。

- **--ray-workers-use-nsight**（Ray worker 使用 Nsight）  
  使用 Ray 后端时，是否对 worker 进程启用 **NVIDIA Nsight** 性能分析（如 profiling、trace）。仅在做多节点/Ray 下的性能调优时使用。**取值**：`True` / `False`。默认: `False`。

- **--worker-cls**（Worker 类）  
  指定实际执行前向的 **Worker 类**（负责模型加载、KV 与计算）。一般保持 `auto` 由 vLLM 按设备与后端选择；仅在自定义或调试时改为指定类名（如 `vllm.worker.worker.Worker`）。**取值**：类名字符串或 `auto`。默认: `"auto"`。

- **--kv-transfer-config**（KV 传输配置）  
  在使用 **pipeline 并行**或跨节点时，**阶段/节点间传输 KV 或中间结果**的配置（如传输方式、缓冲、压缩）。不设则使用默认传输逻辑。**取值**：JSON 或配置对象；`None` 表示默认。默认: `None`。

## 6 前缀缓存与 LoRA

与（五）**PrefixCachingBlockAllocator** 对应；前缀缓存与 LoRA 影响块复用与路由。

### 6.1 前缀缓存与滑动窗口

- **--enable-prefix-caching / --no-enable-prefix-caching**：是否启用前缀缓存（相同前缀复用 KV）。**取值**：带 `--enable-prefix-caching` 为 True，带 `--no-enable-prefix-caching` 为 False。默认: 引擎层可为 `None`；CacheConfig 默认 True。
- **--disable-sliding-window**（禁用滑动窗口）  
  **是什么**：部分模型（如 Mistral）使用**滑动窗口注意力**——每个位置只对**前若干 token**（窗口）做 attention，而不是全序列，从而省显存、支持更长上下文。该参数为 `True` 时禁用该机制或严格按窗口大小限制 KV 缓存（视实现而定），一般保持 `False` 让模型按设计使用滑动窗口。**取值**：`True` / `False`。默认: `False`。
- **--num-lookahead-slots**（Lookahead 槽数）  
  **是什么**：在**投机解码**（speculative decoding）中，为 **lookahead** 预留的 token 槽数。草稿模型一次可提议多个候选 token，目标模型在一次前向中同时验证这些 token；该值影响“一次验证多少 slot”，与调度/内存中为多 token 预留的槽位对应，用于减少步数、降低延迟。需与 `--speculative-model`、`--num-speculative-tokens` 等配合使用。**取值**：非负整数。默认: 未指定。

### 6.2 LoRA

vLLM 支持在基座模型上挂载 **LoRA 适配器**做轻量微调推理。启用后，请求可指定要使用的 LoRA（如 `lora_request`），同一批内可混合不同 LoRA；以下参数控制容量、显存与多 LoRA 行为。

- **--enable-lora**（启用 LoRA）  
  总开关：为 `True` 时才加载与执行 LoRA 适配器，并启用 `--max-loras`、`--max-lora-rank` 等配置。仅用基座、不用 LoRA 时保持 `False`。**取值**：`True` / `False`。默认: `False`。

- **--enable-lora-bias**（启用 LoRA bias）  
  部分 LoRA 实现带有可训练的 bias 项。为 `True` 时启用该类参数；若适配器本身无 bias 则无影响。**取值**：`True` / `False`。默认: 未指定。

- **--max-loras**（单批最大 LoRA 数）  
  同一调度批内**最多可同时使用**的 LoRA 适配器数量。每个 slot 会预分配张量，越大显存越高，但不同 LoRA 的请求可在同批内并行；设为 1 时同一时刻只服务一种 LoRA，其余请求排队。**调优**：显存紧张或仅单 LoRA 时用 1；多租户/多风格并行时适当增大。**取值**：正整数。默认: `1`。

- **--max-lora-rank**（LoRA 秩上限）  
  所有已加载 LoRA 的 **rank 不得超过此值**（需 ≥ 任一适配器的实际 rank）。秩越大单 LoRA 参数量越多，此处设大则预分配缓冲更大、显存占用增加；若所有 LoRA 均为同一较小 rank，建议设为该 rank 以省显存。**取值**：正整数（如 8、16、32）。默认: `16`。

- **--lora-extra-vocab-size**（LoRA 扩展词表大小）  
  若 LoRA 引入**新 token**（如特殊标记、新语言），需在基座词表外预留扩展词表大小。该参数为扩展部分的 **token 数上限**，不足时可能报错或截断。**取值**：非负整数。默认: `256`。

- **--lora-dtype**（LoRA 权重精度）  
  LoRA 权重在引擎内的数据类型。`auto` 与基座一致；显存或带宽敏感时可显式设为 `float16`/`bfloat16`。**取值**：`auto`、`float16`、`bfloat16`。默认: `"auto"`。

- **--long-lora-scaling-factors**（LongLoRA 缩放因子）  
  **LongLoRA** 等方案通过缩放注意力/位置扩展长上下文，此处为各维度的缩放因子，多个用逗号分隔（如 `"1,2,4"`）。仅在使用 LongLoRA 类适配器时需要。**取值**：逗号分隔的数字字符串。默认: 未指定。

- **--max-cpu-loras**（CPU 侧 LoRA 缓存数）  
  可将部分 LoRA 权重缓存在 **CPU**，用时再拷到 GPU，以节省显存、支持更多 LoRA 数量（换入换出）。该值为 CPU 侧最多缓存的 LoRA 数；`None` 表示不限制或不用 CPU 缓存。**取值**：正整数或 `None`。默认: `None`。

- **--fully-sharded-loras**（LoRA 完全分片）  
  在多卡/分布式下，是否对 LoRA 权重做**完全分片**（各 rank 只持有一部分），减少单卡显存。适用于单卡放不下多 LoRA 或大 rank 时。**取值**：`True` / `False`。默认: `False`。

- **--qlora-adapter-name-or-path**（QLoRA 适配器）  
  若使用 **QLoRA**（量化基座 + LoRA）训出的适配器，可在此指定该适配器的 HF 名称或本地路径，引擎会按 QLoRA 约定加载。**取值**：字符串（HF 名或路径）。默认: 未指定。

## 7 量化、RoPE 与多模态

- **--quantization, -q**：权重量化方法。**取值**：`None` 不量化；`awq`、`gptq`、`squeezellm`、`fp8`、`marlin` 等（以当前版本 `--help` 为准）。默认: `None`。
- **--rope-scaling**：RoPE 位置编码缩放。**取值**：JSON 对象，如 `{"type": "yarn", "factor": 2.0}`。默认: 未指定。
- **--rope-theta**：RoPE 的 theta 基值。**取值**：浮点数（如 10000）。默认: 未指定。
- **--limit-mm-per-prompt**：每个多模态插件每条 prompt 允许的输入实例数上限。**取值**：整数字典或 JSON。默认: 由 MultiModalConfig 决定。
- **--mm-processor-kwargs**：多模态处理器覆盖参数。**取值**：JSON 对象或 `None`。默认: `None`。
- **--disable-mm-preprocessor-cache**：是否禁用多模态预处理器缓存。**取值**：`True` / `False`。默认: 未指定。

## 8 投机解码

- **--speculative-model**：投机解码用的草稿模型。**取值**：HF 模型名或路径，需与主模型兼容。默认: 未指定。
- **--speculative-model-quantization**：草稿模型量化方式。**取值**：同 `--quantization` 的取值。默认: 未指定。
- **--num-speculative-tokens**：每步从草稿模型采样的 token 数。**取值**：正整数。默认: 未指定。
- **--speculative-disable-mqa-scorer**：是否在投机解码中禁用 MQA 评分器。**取值**：`True` / `False`。默认: 未指定。
- **--speculative-draft-tensor-parallel-size, -spec-draft-tp**：草稿模型的 TP 数。**取值**：正整数，常 ≤ 主模型 tp。默认: 未指定。
- **--speculative-max-model-len**：草稿模型支持的最大序列长度。**取值**：正整数。默认: 未指定。
- **--speculative-disable-by-batch-size**：排队请求数超过该值时对新请求关闭投机解码。**取值**：正整数。默认: 未指定。
- **--ngram-prompt-lookup-max / --ngram-prompt-lookup-min**：ngram 提示查找的窗口上下界。**取值**：正整数。默认: 未指定。
- **--spec-decoding-acceptance-method**：投机 token 的接受方式。**取值**：`rejection_sampler` 概率比较拒绝/接受（默认）；`typical_acceptance_sampler` 典型集接受。默认: `"rejection_sampler"`。
- **--typical-acceptance-sampler-posterior-threshold**：typical 接受的后验概率下限。**取值**：0～1 浮点数。默认: 未指定。
- **--typical-acceptance-sampler-posterior-alpha**：typical 接受的熵缩放因子。**取值**：浮点数。默认: 未指定。
- **--disable-logprobs-during-spec-decoding**：投机解码时是否不返回 logprobs。**取值**：`True` / `False`。默认: 未指定。

## 9 其他与可观测性

- **--tokenizer-pool-size**：异步分词时分词器池大小。**取值**：非负整数，0 表示同步分词。默认: 未指定。
- **--tokenizer-pool-type**：分词器池实现。**取值**：`ray` 使用 Ray 管理池；其他以 `--help` 为准。默认: `"ray"`。
- **--tokenizer-pool-extra-config**：分词器池的额外配置。**取值**：JSON 字符串。默认: 未指定。
- **--model-loader-extra-config**：模型加载器额外配置。**取值**：JSON 或字典。默认: 空字典。
- **--ignore-patterns**：加载权重时忽略的文件/目录模式。**取值**：glob 模式或列表，如 `original/**/*`。默认: 视版本而定，以 --help 为准。
- **--disable-async-output-proc**：是否禁用异步输出处理。**取值**：`True` / `False`。默认: 未指定。
- **--show-hidden-metrics-for-version**：自某版本起展示被隐藏的 Prometheus 指标。**取值**：版本号字符串或 `None`。默认: `None`。
- **--otlp-traces-endpoint**：OpenTelemetry  traces 上报地址。**取值**：URL 字符串或 `None`。默认: `None`。
- **--collect-detailed-traces**：要收集的详细 trace 模块。**取值**：`model`、`worker`、`all` 等列表或 `None`。默认: `None`。
- **--override-neuron-config**：Neuron 设备配置覆盖。**取值**：JSON 或配置对象。默认: 未指定。
- **--override-pooler-config**：池化层（pooler）配置覆盖。**取值**：JSON 或 `None`。默认: `None`。
- **--compilation-config, -O**：编译/优化配置。**取值**：配置对象或 JSON。默认: 由 VllmConfig 决定。
- **--enable-sleep-mode**：是否启用引擎空闲时睡眠（仅 cuda）。**取值**：`True` / `False`。默认: `False`。
- **--additional-config**：平台相关额外配置。**取值**：JSON 对象。默认: 空字典。

## 10 参数取值说明（枚举/多选参数）

以下对**有固定可选值的参数**逐项说明每个取值的含义，便于按场景选择。

### 10.1 模型与加载

- **--tokenizer-mode**
  - **auto**：根据模型自动选择分词器（如 HuggingFace 通用或模型特化）。
  - **slow**：使用兼容性更好的“慢”路径，适合非常规或老版本分词器。
  - **mistral**：Mistral 专用分词逻辑（如截断 tool call ID 等），配合 Mistral 系列模型使用。
  - **custom**：通过注册机制使用自定义分词器。

- **--load-format**
  - **auto**：优先尝试 safetensors，失败则回退到 PyTorch `.pt`。
  - **pt**：仅用 PyTorch 的 `.bin` / `.pt` 权重文件加载。
  - **safetensors**：仅用 SafeTensors 格式加载（推荐，更安全、可流式）。
  - **npcache**：从 vLLM 的 NP 缓存格式加载，加快重复加载。
  - **dummy**：不加载真实权重，用于测流程或占位。
  - **tensorizer**：使用 Tensorizer 格式/管线加载。
  - **sharded_state**：从按 rank 分片的检查点加载，每个 worker 只读自己的分片，适合大模型 TP 加载。
  - **gguf**：从 GGUF 量化格式加载。
  - **bitsandbytes**：配合 bitsandbytes 量化加载。
  - **mistral**：Mistral 官方/定制权重格式。
  - **runai_streamer**：通过 RunAI Streamer 流式加载。

- **--config-format**
  - **auto**：根据模型目录自动选择配置解析方式。
  - **hf**：按 HuggingFace 的 `config.json` 等标准格式解析。
  - **mistral**：按 Mistral 的配置格式解析。

- **--dtype**
  - **auto**：根据模型配置或权重自动选择（常见为 bfloat16/float16）。
  - **half** / **float16**：FP16，兼容性好，部分卡上更快。
  - **bfloat16**：BF16，数值范围大，多数新卡推荐。
  - **float** / **float32**：全精度，显存占用大，一般用于调试或特殊需求。

- **--kv-cache-dtype**
  - **auto**：与模型权重 dtype 一致（如 bfloat16）。
  - **fp8**：一般指 fp8_e4m3，KV 用 8 比特存储，省显存、可能略损精度。
  - **fp8_e5m2**：FP8 指数 5 位、尾数 2 位；动态范围更大，适合数值范围较大的激活。
  - **fp8_e4m3**：FP8 指数 4 位、尾数 3 位；精度略好，常用作 KV 缓存默认 fp8 选项。

- **--task**
  - **auto**：根据模型或 API 自动推断（生成/嵌入等）。
  - **generate**：文本生成（对话/补全）。
  - **embedding** / **embed**：向量嵌入。
  - **classify**：分类。
  - **score**：序列/候选打分。
  - **reward**：奖励模型。
  - **transcription**：语音转文字。

- **--model-impl**
  - **auto**：由 vLLM 根据模型类型选择实现。
  - **vllm**：使用 vLLM 内置实现（优化多、推荐）。
  - **transformers**：走 HuggingFace Transformers 实现，兼容性优先。

- **--device**
  - **auto**：根据环境自动选择（有 CUDA 则 GPU，否则 CPU 等）。
  - **cuda**：NVIDIA GPU。
  - **neuron**：AWS Inferentia。
  - **cpu**：CPU 推理。
  - **openvino**：Intel OpenVINO。
  - **tpu**：Google TPU。
  - **xpu**：Intel GPU（XPU）。
  - **hpu**：Habana HPU。

- **--guided-decoding-backend**
  - **outlines-dev/outlines**：Outlines 库，用于结构化/约束生成。
  - **mlc-ai/xgrammar**：xGrammar，语法约束解码（默认）。
  - **noamgat/lm-format-enforcer**：lm-format-enforcer，格式约束解码。

### 10.2 KV Cache 与调度

- **--block-size**
  - **8 / 16 / 32 / 64 / 128**：每个 KV 块容纳的连续 token 数。越小块越细、调度越灵活、元数据开销略大；越大块越大、适合长序列、CUDA 上通常只支持到 32。具体支持以平台为准。

- **--scheduling-policy**
  - **fcfs**：先到先服务，按请求到达顺序调度（默认）。
  - **priority**：按优先级调度，数值越小越优先，可做交互优先于批处理等策略。

- **--preemption-mode**
  - **recompute**：被抢占的序列释放 KV 后，下次调度时从 prompt 重新计算（省显存、增加计算）。
  - **swap**：将 KV 换出到 CPU/交换区，恢复时换回，减少重复计算、需要额外内存与带宽。

### 10.3 分布式

- **--distributed-executor-backend**
  - **ray**：用 Ray 做多节点/多进程编排，适合多机或复杂部署。
  - **mp**：单机多进程（multiprocessing），多卡同机时常用默认。
  - **uni**：单进程单卡，不启用分布式。
  - **external_launcher**：由外部启动器（如 torchrun）管理进程，引擎内只起一个 worker，适合已有编排的场景。

### 10.4 LoRA 与投机解码

- **--lora-dtype**
  - **auto**：与模型权重 dtype 一致。
  - **float16**：LoRA 权重 FP16。
  - **bfloat16**：LoRA 权重 BF16。

- **--spec-decoding-acceptance-method**
  - **rejection_sampler**：经典投机解码：用 draft 与 target 概率比较决定接受/拒绝，拒绝时从修正分布重采样（默认）。
  - **typical_acceptance_sampler**：基于典型集合（typical set）的接受策略，可调节接受阈值与熵缩放。

### 10.5 其他

- **--tokenizer-pool-type**
  - **ray**：使用 Ray 管理分词器进程池，用于异步分词（多进程/多节点）。
  - 其他类型以当前版本 `--help` 为准。

- **--collect-detailed-traces**（示例取值）
  - **model**：只收集模型相关跟踪。
  - **worker**：只收集 worker 相关跟踪。
  - **all**：收集上述全部详细跟踪。

- **--quantization, -q**（常见取值，以当前版本 `--help` 为准）
  - **awq**：Activation-aware Weight Quantization，4bit 权重量化。
  - **gptq**：GPTQ 权重量化。
  - **squeezellm**：SqueezeLLM 量化。
  - **fp8**：FP8 权重量化（如 fp8_e4m3）。
  - **marlin** 等：其他内核/格式，依版本支持。

### 10.6 布尔与数值类（常见含义）

以下为常见布尔/数值参数的取值含义，便于与上文**取值**对照。

- **--enable-prefix-caching**（True/False）
  - **True**：启用前缀缓存，相同 prompt 前缀可复用 KV 块，省显存、提高吞吐。
  - **False**：不复用，每条序列独立占块，适合前缀几乎不重复的场景。

- **--enable-chunked-prefill**（True/False）
  - **True**：长 prompt 按 max_num_batched_tokens 分块多步预填充，避免单步过长。
  - **False**：整段 prompt 一次预填充，超过 token 预算的请求会被拒绝或排队。

- **--gpu-memory-utilization**（0～1）
  - 数值表示 GPU 显存中用于 vLLM 引擎的比例；如 `0.9` 即 90% 给 KV/模型，其余留给系统与其它进程。

- **--preemption-mode**（见 10.2）
  - **recompute**：抢占时释放 KV，恢复时从 prompt 重新算，省显存、多算力。
  - **swap**：抢占时把 KV 换出到 CPU，恢复时换回，少重算、多内存与带宽。

（未在以上列出的参数多为自由数值、路径或 JSON，其含义见前文各节**取值**与说明。）

## 11 参数默认值一览

下表汇总上文各节参数的默认值，便于快速查阅。未列出或标为「未指定」的，以当前运行环境的 `python -m vllm.entrypoints.openai.api_server --help` 及 vLLM 源码（如 `vllm/engine/arg_utils.py`、`vllm/config/`）为准；不同小版本可能略有差异。

| 分类 | 参数 | 默认值 |
|------|------|--------|
| **1 模型与加载** | `--model` | 依版本（如 0.6.x 常用 `facebook/opt-125m`，新版可能为 `Qwen/Qwen3-0.6B` 等） |
| | `--download-dir` | Hugging Face 默认缓存目录 |
| | `--revision` / `--code-revision` / `--tokenizer-revision` | `None` |
| | `--trust-remote-code` | `False` |
| | `--allowed-local-media-path` | `""` |
| | `--tokenizer` | `None`（同 model） |
| | `--skip-tokenizer-init` | `False` |
| | `--tokenizer-mode` | `"auto"` |
| | `--load-format` | `"auto"` |
| | `--config-format` | `"auto"` |
| | `--dtype` | `"auto"` |
| | `--kv-cache-dtype` | `"auto"` |
| | `--model-impl` | `"auto"` |
| | `--max-model-len` | `None`（由模型 config 推导） |
| | `--device` | `"auto"` |
| **2 KV Cache 与内存** | `--block-size` | 未指定（由平台设置，如 CUDA 常用 16） |
| | `--gpu-memory-utilization` | `0.9` |
| | `--swap-space` | `4`（GiB） |
| | `--cpu-offload-gb` | `0` |
| | `--num-gpu-blocks-override` | `None` |
| | `--enforce-eager` | `False` |
| | `--calculate-kv-scales` | `False` |
| **3 并发与调度** | `--max-num-seqs` | 未显式指定时由引擎填入（SchedulerConfig 默认 `128`） |
| | `--max-num-batched-tokens` | 未显式指定时由引擎填入（SchedulerConfig 默认 `2048`） |
| | `--max-num-partial-prefills` | `1` |
| | `--max-long-partial-prefills` | `1` |
| | `--long-prefill-token-threshold` | `0` |
| | `--num-scheduler-steps` | `1` |
| | `--multi-step-stream-outputs` | `True` |
| | `--scheduling-policy` | `"fcfs"` |
| | `--scheduler-cls` | `None` |
| **4 采样与生成** | `--max-logprobs` | `20` |
| | `--seed` | `0` |
| | `--disable-log-stats` | `False` |
| **5 分布式** | `--distributed-executor-backend` | 单卡 `uni`，多卡单节点多为 `mp`，多节点需显式设置 |
| | `-tp` / `--tensor-parallel-size` | `1` |
| | `-pp` / `--pipeline-parallel-size` | `1` |
| | `--worker-cls` | `"auto"` |
| **6 前缀缓存与 LoRA** | `--enable-prefix-caching` | 引擎层可为 `None`；CacheConfig 默认 `True` |
| | `--disable-sliding-window` | `False` |
| | `--enable-lora` | `False` |
| | `--max-loras` | `1` |
| | `--max-lora-rank` | `16` |
| | `--lora-extra-vocab-size` | `256` |
| | `--lora-dtype` | `"auto"` |
| **8 投机解码** | `--spec-decoding-acceptance-method` | `"rejection_sampler"` |
| **9 其他** | `--tokenizer-pool-type` | `"ray"` |
| | `--ignore-patterns` | 如 `original/**/*`（以 --help 为准） |
| | `--enable-sleep-mode` | `False` |

## 12 常用启动示例

（待补充：单卡、多卡、开启 prefix caching、开启 swap、LoRA 等典型 `python -m vllm.entrypoints.openai.api_server` 命令示例。）

## 13 总结

- **模型与加载**（1）：`--model`、`--download-dir`、`--dtype`、`--max-model-len` 等决定加载哪类模型与上下文长度。
- **KV Cache 与内存**（2）：`--block-size`、`--gpu-memory-utilization`、`--swap-space` 等与（一）（四）中块数与显存分配对应。
- **并发与调度**（3）：`--max-num-seqs`、`--max-num-batched-tokens`、`--preemption-mode` 等与（三）调度预算与抢占对应。
- **分布式**（5）：`-tp`、`-pp`、`--distributed-executor-backend` 用于多卡/多节点。
- **前缀缓存与 LoRA**（6）：`--enable-prefix-caching` 与（五）PrefixCaching 对应；LoRA 相关参数用于多适配器场景。
