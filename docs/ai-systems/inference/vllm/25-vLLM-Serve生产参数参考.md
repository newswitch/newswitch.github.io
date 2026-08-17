---
title: vLLM Serve 生产参数参考
sidebar_label: "25. vLLM Serve 生产参数参考"
sidebar_position: 25
tags: [vLLM, 参数, vllm serve, KV Cache, Scheduler, CUDA Graph]
description: 按服务、模型、显存、调度、并行、编译、量化和请求层解释 vLLM 参数的作用、因果关系与生产调优方法。
---

# vLLM Serve 生产参数参考

这不是一张需要背诵的参数表，而是一张“参数如何改变请求路径和资源预算”的地图。

vLLM CLI 演进很快。文章以 V1 架构和当前 `vllm serve` 参数族为主，执行时必须以目标镜像为事实来源：

```bash
vllm --version
vllm serve --help=all
vllm serve --help=ModelConfig
vllm serve --help=max-num-seqs
vllm collect-env
```

固定镜像 Digest 后，将 `--help=all` 输出与启动命令一起归档。不要使用主分支文档解释旧生产镜像。

## 1. 参数分成四种

| 类型 | 示例 | 生效范围 |
|---|---|---|
| 服务启动参数 | `--max-num-seqs` | 整个实例，修改通常需要重启 |
| 嵌套配置 | `--compilation-config '{...}'` | 某个子系统，字段受版本约束 |
| 请求参数 | `temperature`、`max_tokens` | 单个请求 |
| 环境变量 | NCCL、PyTorch allocator、日志变量 | 进程/设备运行时 |

只保存 CLI 不能完全复现服务，还要保存环境变量、模型配置、驱动/CUDA/NCCL、硬件拓扑和请求分布。

## 2. 参数因果总图

```text
model / dtype / quantization / TP
                  ↓
             权重显存

max-model-len / kv-cache-dtype / block-size
                  ↓
          每请求 KV Cache 成本

gpu-memory-utilization 或 kv-cache-memory-bytes
                  ↓
              KV 总预算

max-num-seqs + max-num-batched-tokens
                  ↓
        每轮 Batch / 并发 / 抢占

chunked-prefill + prefix-cache + compilation/graph
                  ↓
       TTFT / TPOT / 吞吐 / 启动时间
```

任何性能参数都至少影响容量、延迟、吞吐、稳定性中的两项。不存在脱离工作负载的“最佳值”。

## 3. 最小可审计启动

```bash
vllm serve /models/Qwen \
  --served-model-name qwen-prod \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --generation-config vllm
```

这只是基线，不是生产答案。随后应通过真实 Token 分布测量调度和容量参数。

## 4. 模型身份与加载参数

| 参数 | 含义 | 影响与风险 |
|---|---|---|
| 位置参数 `model` / `--model` | Hugging Face ID 或本地模型目录 | 生产应使用不可变本地制品或固定 Revision |
| `--served-model-name` | API 暴露的一个或多个模型名 | 只是别名，不证明权重身份；也可能进入指标 Label |
| `--revision` | 权重/仓库 Revision | 固定 Commit 才能复现 |
| `--code-revision` | Remote Code Revision | 与权重 Revision 分开固定 |
| `--tokenizer-revision` | Tokenizer Revision | Tokenizer 变化会改变 Token 数、模板和输出 |
| `--download-dir` | 模型下载/缓存目录 | 影响启动、磁盘容量和多副本共享 |
| `--hf-token` | Hugging Face 访问凭证来源 | 不要把明文 Secret 写入命令行或镜像 |
| `--config-format` | 模型配置格式 | `auto`/HF/Mistral 等；必须匹配制品 |
| `--load-format` | 权重加载格式 | safetensors、pt、sharded_state、gguf 等；影响兼容与加载性能 |
| `--model-loader-extra-config` | 对具体 Loader 的 JSON 参数 | 字段取决于 Loader，错误字段可能启动失败 |
| `--trust-remote-code` | 允许执行模型仓库代码 | 高风险；仅对审计、固定哈希制品开启 |
| `--model-impl` | 优先 vLLM 内置或 Transformers 实现 | Transformers 回退的性能/功能可能不同 |
| `--hf-overrides` | 覆盖模型 Config | 会改变架构解释；仅在明确验证时使用 |

### 身份证据

生产发布记录至少包含：

```text
模型目录/仓库 + revision/commit
权重文件哈希
config.json 哈希
Tokenizer 文件和哈希
chat_template
量化方法和转换工具版本
vLLM 镜像 Digest
```

## 5. Tokenizer 与 Chat Template

| 参数 | 含义 | 何时调整 |
|---|---|---|
| `--tokenizer` | 单独指定 Tokenizer 路径/ID | 模型和 Tokenizer 不在同一目录时 |
| `--tokenizer-mode` | Fast/Slow/Mistral/自定义等模式 | 兼容性问题或专用 Tokenizer |
| `--skip-tokenizer-init` | 引擎不初始化 Tokenizer/Detokenizer | 外部分词且请求只提交 Token ID；普通 OpenAI 文本服务不要开 |
| `--tokenizer-pool-size` | 并行 Tokenizer Worker 数 | Tokenize 成为 CPU 瓶颈时测试 |
| `--tokenizer-pool-type` | Tokenizer Pool 实现 | 与部署方式、Ray 等执行环境一起验证 |
| `--tokenizer-pool-extra-config` | Pool 专属配置 | 字段随 Pool 类型变化 |
| `--chat-template` | 指定 Jinja Chat Template | 模型未提供或业务需固定模板时 |
| `--chat-template-content-format` | 消息 Content 如何传给模板 | `auto`、OpenAI 风格或字符串；必须契约测试 |
| `--default-chat-template-kwargs` | 模板默认参数 | 工具、推理开关等默认行为 |
| `--trust-request-chat-template` | 允许请求提交模板 | 等同允许客户端影响服务器模板，生产默认关闭 |

Tokenizer 和模板决定实际 Prompt Token 数。容量测试只记录字符长度没有意义。

## 6. 模型长度、精度和任务

| 参数 | 含义 | 调整后果 |
|---|---|---|
| `--max-model-len` | 实例允许的最大总上下文 | 调大扩大单请求上限，但提高 KV 最坏预算并降低稳定并发 |
| `--dtype` | 权重/激活执行精度 | BF16/FP16/FP32 等；影响兼容、精度、权重和算子 |
| `--kv-cache-dtype` | KV Cache 存储精度 | FP8 可省 KV，但需硬件/Backend/Scale 支持和精度验证 |
| `--runner` / 任务相关参数 | Generate、Pooling、Draft 等执行类型 | 不同版本命名会变化，以目标帮助为准 |
| `--convert` | 对模型任务做转换 | 生成模型转 Embedding/分类等场景使用 |
| `--seed` | 引擎随机种子 | 不能单独保证跨 Batch/硬件完全确定性 |
| `--generation-config` | 是否读取模型仓库 GenerationConfig | `auto` 可能隐式改变采样默认；`vllm` 使用框架默认 |
| `--override-generation-config` | 覆盖全局生成默认 | 会影响所有未显式传值的请求 |

长度关系：

```text
prompt_tokens + requested_output_tokens ≤ max_model_len
```

同时还受模型自身位置编码、业务网关限制和请求级 `max_tokens` 约束。

## 7. 服务监听和网络参数

| 参数 | 含义 | 生产注意事项 |
|---|---|---|
| `--host` | 监听地址 | `0.0.0.0` 需要网络策略、鉴权和网关保护 |
| `--port` | HTTP/gRPC 端口 | 避免与管理端口冲突 |
| `--uds` | Unix Domain Socket | 同机代理可使用，注意权限和生命周期 |
| `--root-path` | 反向代理子路径 | 必须与 Ingress rewrite 匹配 |
| `--api-key` | 简单 Bearer Key | 不能替代完整 IAM、TLS、限流和审计 |
| `--ssl-keyfile` / `--ssl-certfile` | TLS 私钥/证书 | Secret 挂载、权限和轮换 |
| `--ssl-ca-certs` / `--enable-ssl-refresh` | CA 与证书热加载 | mTLS/轮换场景按版本验证 |
| `--allowed-origins` | CORS Origin | 不要在公网无条件 `*` |
| `--allowed-methods` | CORS Method | 只开放需要的方法 |
| `--allowed-headers` | CORS Header | 只开放必要 Header |
| `--middleware` | 额外 ASGI Middleware | 可能增加延迟或引入安全风险 |
| `--api-server-count` | API Server 进程数 | 缓解前端 CPU，但需要验证端口、路由和指标语义 |
| `--disable-frontend-multiprocessing` | 改变前端/引擎进程模型 | 主要用于调试或特定部署，重新测故障隔离与性能 |
| `--headless` | 无普通 API 前端的引擎实例 | 多节点 DP 等官方架构使用，不是普通服务开关 |

## 8. API 功能参数

| 参数 | 含义 | 风险/约束 |
|---|---|---|
| `--response-role` | Chat Response 默认角色 | 应与客户端协议一致 |
| `--enable-auto-tool-choice` | 允许模型自动选择工具 | 还必须配置正确的 Tool Parser |
| `--tool-call-parser` | 工具调用输出解析器 | 模型家族相关，错误 Parser 会产生错误结构 |
| `--tool-parser-plugin` | 外部 Tool Parser 插件 | 插件代码需审计、固定版本 |
| `--reasoning-parser` | 将思考内容与回答拆分 | 模型格式相关 |
| `--enable-prompt-tokens-details` | 返回更细 Prompt Token 统计 | 增加响应字段与一定处理成本 |
| `--enable-tokenizer-info-endpoint` | 暴露 Tokenizer 信息接口 | 评估信息暴露边界 |
| `--enable-prompt-embeds` | 允许直接提交 Embedding | 输入 Shape 错误可能使引擎失败，只对可信客户端开放 |
| `--allowed-local-media-path` | 允许读取服务端本地媒体目录 | 高风险，必须限制到专用只读目录 |
| `--allowed-media-domains` | 远程媒体域名白名单 | 防 SSRF；还要校验重定向和 DNS |

## 9. 权重显存、KV Cache 和运行时内存

单卡显存可以拆成：

```text
M_total
= M_weights
 + M_KV
 + M_activations/workspace
 + M_graph
 + M_communication
 + M_runtime/fragmentation
```

### 核心参数

| 参数 | 含义 | 调大/启用后的常见影响 |
|---|---|---|
| `--gpu-memory-utilization` | 实例规划使用的设备内存比例 | 可给 KV 留更多空间，但不是硬隔离；过高会挤压峰值和 Graph |
| `--kv-cache-memory-bytes` | 显式指定 KV Cache 字节预算 | 支持版本中会覆盖比例推算，容量更可控；必须留足其他内存 |
| `--block-size` | 每个 KV Block 的 Token 粒度 | 小块减少尾部浪费但 Metadata 更多，Backend 支持范围不同 |
| `--num-gpu-blocks-override` | 强制 KV Block 数 | 仅用于实验/故障注入，生产错误值会 OOM 或浪费容量 |
| `--swap-space` | 每 GPU 的 CPU Swap 空间 | 给特定输出/抢占路径提供 CPU 容量，受版本实现和 PCIe/NUMA 影响 |
| `--cpu-offload-gb` | 每 GPU 权重 CPU Offload 容量 | 可加载更大模型，但每轮跨 PCIe 传输会显著增加延迟 |
| `--kv-offloading-size` 等 | KV Offload 预算 | 仅在支持后端/版本使用；网络/CPU 带宽成为新瓶颈 |
| `--calculate-kv-scales` | 动态计算 FP8 KV Scale | 无正确 Scale 时改善精度，但增加初始化/执行复杂度 |

### 不应同时做的事情

不要在一次调优中同时提高 `gpu_memory_utilization`、`max_model_len`、`max_num_seqs` 和 Graph Capture Size。若 OOM，无法判断是哪项预算造成。

## 10. Prefix Cache

| 参数 | 含义 | 注意事项 |
|---|---|---|
| `--enable-prefix-caching` | 复用相同 Token 前缀的 KV | 收益取决于共享前缀 Token 数，不是请求相似度 |
| `--prefix-caching-hash-algo` | 前缀 Block 的哈希/序列化算法 | 安全性、性能和跨语言稳定性需按版本理解 |
| `--cache-salt` 请求字段 | 隔离前缀缓存命名空间 | 多租户可防止不希望的跨租户命中 |

开启后应记录：Cache Query、Hit Token、命中节省的 Prefill、Block 占用和淘汰，而不是只看命中请求比例。

## 11. Scheduler 与批处理参数

| 参数 | 含义 | 调大后的效果与风险 |
|---|---|---|
| `--max-num-seqs` | 单轮/运行中可调度序列预算 | 提高并发潜力，也增加 KV、Batch 和尾延迟风险 |
| `--max-num-batched-tokens` | 一轮 Scheduler Token Budget | Prefill 吞吐可能提高；过大可能阻塞 Decode、增加 Workspace |
| `--enable-chunked-prefill` | 将长 Prompt 分块 | 降低长 Prefill 对 Decode 的阻塞；过小增加轮次和调度开销 |
| `--long-prefill-token-threshold` | 判断长 Prefill 的阈值 | 影响哪些请求被分块/限制 |
| `--max-num-partial-prefills` | 同时处理的部分 Prefill 数 | 提高长 Prompt 并发，但增加状态和资源竞争 |
| `--max-long-partial-prefills` | 长请求部分 Prefill 上限 | 给短请求留调度机会，影响公平性 |
| `--scheduler-policy` | FCFS、Priority 等策略 | 必须验证公平性、饥饿和请求优先级语义 |
| `--scheduler-cls` | 自定义 Scheduler 类 | 高风险扩展点，需要回归、监控和升级测试 |
| `--enable-preemption`/相关配置 | 抢占策略（依版本） | 缓解 KV 压力但会 Swap/Recompute，增加尾延迟 |

### 两个核心预算

```text
本轮序列数 ≤ max_num_seqs
本轮计划 Token 总量 ≤ max_num_batched_tokens
```

这两个上限都满足，也不代表一定不会 OOM；模型 Workspace、Graph 和 Attention Shape 仍会产生峰值。

## 12. Tensor/Pipeline/Data/Expert Parallel

| 参数 | 含义 | 主要代价 |
|---|---|---|
| `--tensor-parallel-size` / `-tp` | 层内切分权重和计算 | 每层集合通信，依赖 NVLink/PCIe/NCCL |
| `--pipeline-parallel-size` / `-pp` | 按层切分 Stage | Pipeline Bubble、Stage 不均和跨 Stage 传输 |
| `--data-parallel-size` / `-dp` | 多模型副本 | 权重复制、路由和跨副本负载均衡 |
| `--data-parallel-size-local` | 本节点本地 DP 数 | 多节点 DP 拓扑使用 |
| `--data-parallel-start-rank` | 本节点首个 DP Rank | 必须与全局 Rank 规划一致 |
| `--data-parallel-address` | DP 协调地址 | 网络、DNS 和故障恢复需设计 |
| `--data-parallel-rpc-port` | DP RPC 端口 | 防火墙和端口冲突 |
| `--enable-expert-parallel` | MoE Expert 并行 | All-to-All、负载不均、网络和专家热度 |
| `--enable-eplb` | Expert Load Balancer | 额外统计/迁移；模型和版本支持需核对 |
| `--eplb-config` | EPLB JSON 配置 | 冗余专家、统计窗口、平衡策略等 |
| `--distributed-executor-backend` | multiprocessing、Ray 等 | 部署依赖、控制面和故障模型不同 |
| `--disable-custom-all-reduce` | 禁用 vLLM 自定义 All-Reduce | 特殊拓扑/问题定位时使用，性能可能下降 |
| `--all2all-backend` | MoE All-to-All Backend | 硬件、NCCL/Kernel 和模型相关 |

### 并行度选择

1. 权重单卡放得下时，优先用单卡基线。
2. 放不下或吞吐需要时增加 TP，并测通信占比。
3. 单实例已经满足模型容量后，用 DP 扩展总吞吐通常更易隔离故障。
4. 超大模型才考虑 PP/EP 组合，并逐层测 Bubble、慢 Rank 和网络。

## 13. CUDA Graph 与编译

| 参数 | 含义 | 使用方式 |
|---|---|---|
| `--enforce-eager` | 禁用编译/Graph 的相关快速路径，强制 Eager | 定位 Graph/编译问题；不是默认生产优化 |
| `--compilation-config` / `-cc` | 编译与图执行的嵌套配置 | 字段随版本变化，必须归档完整 JSON |
| `--max-seq-len-to-capture` | Graph 捕获最大序列范围（支持版本） | 超出通常回退 Eager；过大增加捕获/内存成本 |
| `cudagraph_mode` | Graph 模式 | NONE/PIECEWISE/FULL 等值依版本与平台支持 |
| `cudagraph_capture_sizes` | 捕获的 Batch Size 集合 | 覆盖真实流量即可，不要盲目捕获全部尺寸 |
| `compile_sizes` | 编译 Shape 集合 | 冷启动和缓存体积与覆盖率权衡 |

Graph 调优至少记录：

- 启动与 Capture 耗时；
- Capture Size 列表；
- Graph 额外显存；
- Replay/Eager 覆盖率；
- TTFT/TPOT P95/P99；
- 功能/精度回归。

## 14. Attention 与算子 Backend

不同版本允许通过参数或环境变量选择 Attention Backend。选择受以下因素共同限制：

- GPU 架构与 CUDA 版本；
- MHA/GQA/MLA/滑动窗口等 Attention 结构；
- Head Dimension、dtype 和 KV dtype；
- Prefill/Decode；
- 量化、Speculative Decoding、Prefix Cache；
- CUDA Graph 和分布式并行。

不要看到 FlashAttention 名称就认为一定更快。应在相同请求分布下比较 Kernel 时间、Workspace、Graph 覆盖和端到端 SLO。

## 15. 量化参数

| 参数 | 含义 | 验证重点 |
|---|---|---|
| `--quantization` / `-q` | 权重量化方法 | 必须与制品格式和 GPU Kernel 匹配 |
| `--dtype` | 非量化部分/激活精度 | 某些量化方法要求 FP16/BF16 |
| `--kv-cache-dtype` | KV 量化 | 容量收益、Scale 和长上下文精度 |
| `--calculate-kv-scales` | 运行时 KV Scale | 无预存 Scale 的精度与性能权衡 |
| `--quantization-param-path` 等 | 量化 Scale/配置路径（依版本） | 文件与模型 Revision 必须绑定 |

验收必须包含：固定题集精度、Logprob/输出分布、短长上下文、吞吐、TTFT/TPOT、显存和异常输入。

## 16. LoRA 参数

| 参数 | 含义 | 容量/风险 |
|---|---|---|
| `--enable-lora` | 开启 LoRA 服务 | 增加 Buffer、调度和模型管理 |
| `--lora-modules` | 启动时注册 LoRA 名称与路径 | 路径和基座模型必须匹配 |
| `--max-loras` | 单 Batch 可同时激活 LoRA 数 | 调大增加显存和 Kernel 复杂度 |
| `--max-cpu-loras` | CPU 常驻 LoRA 数 | 调大增加主机内存，换入影响延迟 |
| `--max-lora-rank` | 支持的最大 Rank | 过大增加预分配和计算成本 |
| `--lora-dtype` | LoRA 计算/存储精度 | 需做精度和 Kernel 兼容验证 |
| `--fully-sharded-loras` | TP 下更完整地切分 LoRA | 通信与计算权衡，长序列/高 Rank 可能受益 |
| `--enable-lora-bias` | 支持带 Bias 的 LoRA | 只对需要的制品开启 |

## 17. 多模态参数

| 参数族 | 含义 |
|---|---|
| `--limit-mm-per-prompt` | 每请求各种媒体数量上限，防止资源失控 |
| `--mm-processor-kwargs` | 覆盖 Processor 参数，影响图像尺寸/帧数等 |
| `--mm-processor-cache-gb` | 多模态预处理缓存预算 |
| `--disable-mm-preprocessor-cache` | 关闭缓存用于兼容/定位，可能降低性能 |
| `--allowed-media-domains` | 远程媒体域名白名单，防 SSRF |
| `--media-io-kwargs` | 媒体加载专属配置（依版本） |

多模态容量不能只按文本 Token 计算，还要记录 Encoder 输入尺寸、视觉 Token、CPU 解码、显存峰值和缓存。

## 18. Speculative Decoding

当前版本通常使用 `--speculative-config` JSON 统一描述：

```bash
--speculative-config '{
  "method": "draft_model_method",
  "model": "/models/draft",
  "num_speculative_tokens": 4
}'
```

具体 Method 和字段以目标版本为准。关键指标不是“每次草拟几个 Token”，而是：

```text
有效收益
≈ 接受的草稿 Token 节省
 - 草稿模型成本
 - 验证成本
 - 额外 KV/显存
 - 调度复杂度
```

必须记录 Acceptance Length/Rate、TPOT、吞吐、显存和精度。接受率低时，Speculative 可能更慢。

## 19. KV Transfer 与 PD 分离

`--kv-transfer-config` 用于定义 KV Connector、角色、地址和额外配置。典型角色：Producer（Prefill）、Consumer（Decode）或 Both。

新增的容量与故障面：

- P/D 路由；
- KV 序列化/传输/注册；
- 网络带宽、时延和重试；
- Connector 元数据服务；
- P/D 模型、Block、dtype 和 Revision 一致性；
- KV 未到达时的 Decode 排队；
- 超时与孤儿 KV 清理。

普通单机服务不要为了“架构先进”开启 PD 分离。

## 20. 日志、指标与 Trace

| 参数族 | 作用 | 生产原则 |
|---|---|---|
| 请求日志开关/最大长度 | 记录请求摘要 | 默认不记录原始 Prompt，避免隐私泄露 |
| `--log-config-file` | Python 日志配置 | 固定格式、轮转和敏感字段脱敏 |
| `--enable-per-request-metrics` | 更细请求级指标 | Label/开销和基数需要评估 |
| `--enable-server-load-tracking` | 服务负载追踪 | 用于路由/可观测性，核对版本语义 |
| `--otlp-traces-endpoint` | OTLP Trace 端点 | 下游容量、采样和 TLS |
| `--collect-detailed-traces` | 详细 Trace 模块 | 开销较高，只在控制窗口使用 |
| Histogram Bucket 参数 | 自定义 TTFT/E2E/ITL Bucket | 应覆盖业务 SLO 区间 |

最少指标：Running、Waiting、KV Usage、Prompt/Generation Token、Queue、TTFT、TPOT/ITL、E2E、Preemption、错误和流式完成率。

## 21. 请求级 Sampling 参数

| 参数 | 含义 | 常见误区 |
|---|---|---|
| `temperature` | 缩放 Logits；0 常用于确定性/Greedy 语义 | 不是“回答正确率”旋钮 |
| `top_p` | Nucleus Sampling 概率质量上限 | 与 Temperature 联合改变分布 |
| `top_k` | 只保留概率最高 K 个 Token | OpenAI 扩展兼容性需确认 |
| `min_p` | 相对最高概率过滤低概率 Token | 模型/框架扩展字段 |
| `max_tokens` | 最大新生成 Token | 不是总上下文长度 |
| `min_tokens` | 最少生成 Token | 可能暂时忽略 EOS，需谨慎 |
| `stop` | 停止字符串 | 可能跨 Token 边界，需要反分词检测 |
| `stop_token_ids` | 停止 Token ID | 与 Tokenizer Revision 绑定 |
| `ignore_eos` | 忽略 EOS | 可能生成到上限，增加成本 |
| `seed` | 请求随机种子 | 不保证跨并发/Backend 位级确定 |
| `n` | 返回候选数 | 近似放大 Decode、KV 与成本 |
| `best_of` | 内部候选数（支持范围依版本） | 可能显著增加计算和内存 |
| `logprobs` | 返回 Token Logprob | 增加 Logits/通信/响应成本 |
| `prompt_logprobs` | 返回 Prompt Token Logprob | Prefill 输出与内存成本明显增加 |
| `presence_penalty` | 按是否出现惩罚 Token | 与 Frequency Penalty 语义不同 |
| `frequency_penalty` | 按出现次数惩罚 Token | 调大可能破坏事实词复用 |
| `repetition_penalty` | vLLM 扩展重复惩罚 | 与 OpenAI 两类 Penalty 不同 |
| `response_format` / Structured Outputs | 约束 JSON 等格式 | Grammar 编译、首请求冷延迟和 Backend 兼容 |

请求参数也影响容量。`n=4`、长 `max_tokens` 和 Logprobs 不能与普通单输出请求放在同一容量模型中。

## 22. 参数冲突与排查矩阵

| 现象 | 先检查参数 |
|---|---|
| 启动即 OOM | dtype、quantization、TP、gpu memory、Graph、模型长度 |
| Warmup/Capture OOM | compilation config、Capture Sizes、max sequences、剩余显存 |
| 高并发 OOM | KV 预算、max sequences、上下文/输出分布、Workspace |
| TTFT 高 | Queue、Token Budget、Chunked Prefill、Tokenizer、Prefix Cache |
| TPOT 高 | Decode Batch、Graph 覆盖、Attention Backend、TP/NCCL |
| Preemption 高 | KV 容量、max sequences、max model len、长输出 |
| GPU 利用率低 | 到达率、API/Tokenizer、Scheduler Budget、Graph、CPU、NCCL |
| 输出行为升级后变化 | generation config、Tokenizer、Chat Template、Parser、dtype/quant |

## 23. 四套基线配置思路

### 在线低延迟

- 限制最大上下文和最大输出；
- 保守设置并发，先满足 P95/P99；
- 使用 Chunked Prefill 防止超长 Prompt 阻塞 Decode；
- Capture 真实常见 Batch；
- 网关做准入和超时预算。

### 离线高吞吐

- 提高 Batch/Token Budget；
- 允许更长队列；
- 按 Prompt 长度分桶；
- 关注总 Token/s 和单位成本，而非单请求 TTFT。

### 共享前缀业务

- 启用 Prefix Cache；
- 固定模板 Token；
- 记录命中 Token，不只命中请求；
- 多租户使用 Cache Salt/隔离策略。

### 超长上下文

- 先计算单请求 KV；
- 限制并发和输出；
- 调整 Chunked Prefill；
- 测 Prefill 峰值与 TPOT 干扰；
- 不仅验证能启动，还要验证最坏输入。

## 24. 正确调参顺序

1. 固定硬件、拓扑、镜像、模型和 Tokenizer。
2. 用 Eager/单请求建立正确性基线。
3. 确定权重能否放下及最小 TP。
4. 确定最大上下文和 KV dtype。
5. 测出可用 KV Block 与单请求容量。
6. 调 `max_num_seqs` 和 `max_num_batched_tokens`。
7. 调 Chunked Prefill 与 Prefix Cache。
8. 开启/优化 Compilation 和 CUDA Graph。
9. 再测试量化、Speculative、LoRA、PD 等高级能力。
10. 用真实到达过程验证 P95/P99 和故障恢复。

每轮只改变一个变量，并保存完整命令、指标和 Timeline。

## 25. 发布检查表

```text
[ ] 目标镜像 vllm serve --help=all 已归档
[ ] 模型/Tokenizer/模板/量化制品已固定哈希
[ ] CLI、嵌套 JSON、环境变量和硬件拓扑已保存
[ ] 参数中不存在目标版本已删除或无效字段
[ ] 最大上下文、输出和请求级 n/logprobs 有网关限制
[ ] KV、Graph、Workspace 与峰值显存留有安全余量
[ ] TTFT/TPOT/E2E/吞吐/错误率容量曲线完成
[ ] 流式、停止、工具调用、结构化输出完成契约测试
[ ] 多卡 Rank/NCCL 无持续不均
[ ] 回滚镜像、配置和容量已验证
```

## 26. 与旧参数文章的关系

[vLLM 学习笔记（六）：参数使用](./vLLM学习笔记（六）参数使用.md)保留了 vLLM 0.6.3 的历史参数和迁移说明，适合复现旧源码；本文用于当前 V1 生产参数的机制学习。两篇文章的默认值不能混用。

## 官方资料

- [vLLM CLI Guide](https://docs.vllm.ai/en/latest/cli/)
- [vLLM serve 完整参数](https://docs.vllm.ai/en/latest/cli/serve/)
- [Engine Arguments](https://docs.vllm.ai/en/latest/configuration/engine_args/)
- [OpenAI-compatible Server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)
- [Sampling Parameters API](https://docs.vllm.ai/en/latest/api/vllm/sampling_params/)
