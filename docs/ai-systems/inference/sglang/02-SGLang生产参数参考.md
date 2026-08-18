---
title: "SGLang 生产参数参考"
sidebar_label: "02. SGLang 生产参数参考"
sidebar_position: 2
description: "按模型、内存、Radix Cache、调度、Kernel、Graph、并行和请求层解释 SGLang Server 参数及调优因果关系。"
tags: [SGLang, 参数, Radix Cache, Scheduler, CUDA Graph]
---

# SGLang 生产参数参考

SGLang 参数数量很多，因为它同时暴露模型加载、HTTP Server、内存池、Radix Cache、Scheduler、Kernel Backend、CUDA Graph、并行、投机解码和分离式推理等能力。

本文覆盖生产参数族和核心字段。精确默认值与枚举必须以目标环境为准：

```bash
python -m sglang.launch_server --help
python -c "import sglang; print(sglang.__version__)"
```

当前官方文档支持 YAML 配置，CLI 会覆盖配置文件中的同名值：

```bash
python -m sglang.launch_server --config /etc/sglang/server.yaml
```

## 1. 参数控制的请求路径

```text
HTTP 参数
  ↓ HTTP Server
Tokenizer 参数
  ↓ TokenizerManager
调度/Radix/内存参数
  ↓ Scheduler + KV Pool
并行/Graph/Kernel 参数
  ↓ TP Worker + ModelRunner
Sampling 参数
  ↓ Sampler
Detokenizer/流式参数
  ↓ DetokenizerManager → Client
```

调参前先确定瓶颈组件。若 Tokenizer 已经是瓶颈，修改 Attention Backend 不会降低排队。

## 2. 最小启动基线

```bash
python -m sglang.launch_server \
  --model-path /models/Qwen \
  --served-model-name qwen-prod \
  --host 0.0.0.0 \
  --port 30000 \
  --dtype bfloat16 \
  --context-length 32768 \
  --tp-size 2 \
  --mem-fraction-static 0.85 \
  --enable-metrics
```

不要直接复制数值到另一型号 GPU。`mem_fraction_static` 必须结合权重、KV、Graph、Workspace 和其他进程重新测量。

## 3. 模型与 Tokenizer

| 参数 | 含义 | 影响与风险 |
|---|---|---|
| `--model-path` / `--model` | 本地模型目录或 Hugging Face ID | 生产固定不可变制品或 Revision |
| `--served-model-name` | API 暴露名称 | 与真实权重身份分开记录 |
| `--revision` | 模型 Revision | 使用 Commit 以保证复现 |
| `--tokenizer-path` | 单独指定 Tokenizer | 变化会改变 Token、容量和模板 |
| `--tokenizer-mode` | Fast/Slow | Slow 兼容性更强但 CPU 可能更慢 |
| `--tokenizer-backend` | Hugging Face 或 fastokens 等 | 需要额外依赖与结果一致性验证 |
| `--tokenizer-worker-num` | TokenizerManager Worker 数 | 增加可提高分词吞吐，也增加 CPU/内存/IPC |
| `--detokenizer-worker-num` | Detokenizer Worker 数 | 输出反分词成为瓶颈时测试 |
| `--skip-tokenizer-init` | 跳过 Tokenizer | 请求必须提交 Token ID；普通文本 API 不启用 |
| `--context-length` | 服务最大上下文 | 调大提高单请求上限并增加 KV 最坏成本 |
| `--trust-remote-code` | 执行模型仓库代码 | 只对审计、固定哈希制品开启 |
| `--model-impl` | SGLang/Transformers 实现选择 | Transformers 回退的性能与功能需重新验收 |
| `--model-config-parser` | 模型 Config 解析器 | 自定义/特殊模型使用，错误会误解模型结构 |
| `--load-format` | 权重加载格式 | safetensors、pt、sharded、gguf 等；必须匹配制品 |
| `--model-loader-extra-config` | Loader 专属 JSON | 字段依 Loader 变化 |
| `--download-dir` | 下载/缓存目录 | 影响冷启动、磁盘和多副本共享 |

### 3.1 多模态模型 {/* #多模态模型 */}

| 参数 | 作用 |
|---|---|
| `--enable-multimodal` | 显式开启支持的多模态路径 |
| `--allowed-media-domains` | 远程媒体精确域名白名单，降低 SSRF 风险 |
| `--media-url-max-file-size-mb` | 限制单个远程媒体大小 |
| `--mm-attention-backend` | 多模态 Attention Backend |
| `--mm-processor-kwargs` 等 | 覆盖 Processor，影响图片尺寸、帧数和视觉 Token |

多模态容量必须记录媒体尺寸、视觉 Token、CPU 解码、Encoder 显存和缓存，不能只看文本 Token。

## 4. HTTP Server 与协议

| 参数 | 含义 | 生产注意事项 |
|---|---|---|
| `--host` | 监听地址 | 默认只监听本地更安全；对外监听需网关和网络策略 |
| `--port` | 服务端口 | 默认端口依版本确认 |
| `--fastapi-root-path` | 反向代理子路径 | 与 Ingress Rewrite 一致 |
| `--grpc-mode` | 使用 gRPC Server | 客户端、健康检查和指标需同步调整 |
| `--skip-server-warmup` | 跳过 Warmup | 缩短启动但首请求可能暴露编译/Graph 冷延迟 |
| `--warmups` | 自定义 Warmup 列表 | 应覆盖实际模型能力，避免空跑假就绪 |
| `--ssl-keyfile` / `--ssl-certfile` | TLS 私钥和证书 | Secret 权限、轮换和过期告警 |
| `--ssl-ca-certs` | CA 文件 | mTLS/客户端验证场景 |
| `--enable-ssl-refresh` | 证书变化时热加载 | 目标版本和失败行为需演练 |
| `--enable-http2` | 使用支持 HTTP/2 的 Server | 需要额外依赖，重新测连接、代理和延迟 |
| `--http2-max-concurrent-streams` | 单连接并发 Stream 上限 | 不是模型 Batch 上限 |

## 5. Chat、工具调用与 API 功能

| 参数族 | 含义 |
|---|---|
| Chat Template 参数 | 指定/选择 HF Template，决定消息如何变为 Token |
| Tool Call Parser | 将模型文本解析为结构化工具调用，模型相关 |
| Reasoning Parser | 拆分思考内容和最终回答，模型相关 |
| Grammar Backend | JSON Schema/Regex/EBNF 等结构化输出后端 |
| API Key/鉴权相关参数 | 提供基础鉴权；生产仍建议统一网关 |
| Sampling Defaults | 服务级请求默认值，可能改变未显式传值请求 |

模板、Parser 和模型必须成套冻结。框架升级后即使权重没变，Parser 行为也可能改变。

## 6. dtype 与量化

| 参数 | 含义 | 验证重点 |
|---|---|---|
| `--dtype` | 模型权重/激活计算精度 | FP16/BF16/FP32 等；硬件和模型相关 |
| `--quantization` | 权重量化方法 | AWQ、GPTQ、FP8、Marlin 等枚举随版本扩展 |
| `--quantization-param-path` | KV Scale 等量化参数文件 | 缺失或错误 Scale 会影响精度 |
| `--kv-cache-dtype` | KV Cache 精度 | FP8/FP4 等取决于硬件、CUDA、Backend |
| `--enable-fp32-lm-head` | LM Head 输出使用 FP32 | 可能改善特定精度，增加计算/带宽 |
| ModelOpt 相关参数 | 在线量化、恢复、保存或导出 | 生产更推荐离线生成并验证不可变制品 |
| `--quantize-and-serve` | 量化后立即服务 | 适合实验；生产制品追踪和冷启动风险较高 |

量化不能只看能否启动，必须比较：任务精度、输出分布、长上下文、TTFT、TPOT、吞吐、显存和故障率。

## 7. 静态显存与 KV 内存池

SGLang 的设备内存近似：

```text
M_total
= M_weights
 + M_KV_pool
 + M_cuda_graph
 + M_workspace/activations
 + M_communication
 + M_runtime/fragmentation
```

| 参数 | 含义 | 调大后的常见影响 |
|---|---|---|
| `--mem-fraction-static` | 权重与 KV Pool 等静态分配占总显存比例 | KV 容量可能增加；过高会在 Prefill/Graph/通信峰值 OOM |
| `--max-total-tokens` | 内存池最多容纳的 Token 数 | 显式限制容量，主要用于控制/调试；错误值浪费或 OOM |
| `--page-size` | KV Page 的 Token 数 | 小 Page 更细、内部碎片小，但 Metadata 更多 |
| `--max-running-requests` | 运行请求上限 | 增加并发潜力，同时增加 KV 和尾延迟压力 |
| `--max-queued-requests` | 等待队列上限 | 构成过载保护；不能替代网关限流 |
| `--enable-memory-saver` | 内存节省模式（支持场景） | 可能改变加载/执行路径，需测性能 |
| `--enable-weights-cpu-backup` | 权重 CPU 备份 | 增加主机内存，便于释放/恢复 GPU 等场景 |
| `--enable-unified-memory` | 特定 Hybrid 模型统一内存池 | 有 Backend/Graph/PD/Spec 限制，不能通用开启 |

OOM 时首先降低 `mem_fraction_static` 并观察是哪一阶段失败。启动成功不代表长 Prompt Prefill 峰值安全。

## 8. Radix Cache

| 参数 | 含义 | 影响 |
|---|---|---|
| `--disable-radix-cache` | 关闭 Radix 前缀缓存 | 用于无共享前缀或对照实验；会重复计算 Prefill |
| `--radix-eviction-policy` | LRU/LFU/SLRU/Priority 等淘汰策略 | 热点稳定性、扫描流量和公平性不同 |
| `--page-size` | Radix 节点最终引用的 KV Page 粒度 | 影响碎片和管理开销 |
| Session-aware 相关参数 | 按会话管理/保护缓存 | 需明确会话 ID 生命周期与多租户隔离 |

评估 Radix Cache 时记录：

- 匹配/命中 Token 数；
- Prefill 实际减少量；
- KV Pool 占用；
- 淘汰 Token/节点；
- 冷热流量；
- TTFT 与总吞吐。

## 9. Prefill 和调度

| 参数 | 含义 | 调大/调整后的效果 |
|---|---|---|
| `--chunked-prefill-size` | 单个 Prefill Chunk 最大 Token；`-1` 常表示禁用 | 小值减少长 Prompt 阻塞，但增加调度轮次 |
| `--max-prefill-tokens` | 一轮 Prefill Token 总预算 | 提高 Prefill 吞吐潜力，也增加 Workspace/Decode 干扰 |
| `--prefill-max-requests` | 一轮 Prefill 请求数上限 | 限制 Batch Shape 和瞬时资源 |
| `--schedule-policy` | `fcfs`、`lpm`、`random`、`priority` 等 | LPM 强调缓存局部性，FCFS 强调顺序；必须测公平性 |
| `--schedule-conservativeness` | 调度保守程度 | 增大可减少 Request Retract，但可能降低并发利用 |
| `--enable-priority-scheduling` | 开启请求优先级 | 必须有租户配额和防饥饿设计 |
| `--priority-scheduling-preemption-threshold` | 优先级差达到多少才抢占 | 太低造成频繁抖动，太高则优先级不敏感 |
| `--enable-dynamic-chunking` | 动态计算 Pipeline Chunk | PP 场景使用，依赖在线拟合与稳定工作负载 |
| Prefill Delayer 参数 | 在 DP Attention 场景延迟 Prefill | 用于减少空闲，需控制最大延迟和水位 |

### 9.1 Request Retract {/* #request-retract */}

当 KV 预算不足，SGLang 可能撤回运行请求并稍后重调度。频繁 Retract 的证据包括尾延迟升高、重复计算和相关计数增加。优先检查：

- `mem_fraction_static` 是否过低；
- `max_running_requests` 是否过大；
- 工作负载输出是否比压测假设更长；
- `schedule_conservativeness` 是否过激；
- 长上下文和 Radix Cache 是否占满 Pool。

## 10. Runtime 和设备参数

| 参数 | 含义 |
|---|---|
| `--device` | CUDA、NPU、CPU 等目标设备，具体支持看版本/Backend |
| `--base-gpu-id` | 本实例使用的起始 GPU ID |
| `--gpu-id-step` | 多 Rank GPU ID 步长 |
| `--random-seed` | 引擎随机种子，不保证跨 Batch 完全确定 |
| `--stream-interval` | 每隔多少生成 Step 发送流式结果 |
| `--watchdog-timeout` | Worker 无响应检测阈值 |
| `--dist-timeout` | 分布式初始化/操作超时 |
| `--sleep-on-idle` | 空闲时降低资源占用的支持路径 |
| `--enable-p2p-check` | 显式检查 GPU P2P；拓扑异常时使用 |

`stream_interval` 调大可减少 CPU/网络 Chunk 数，但客户端看到的 Token 更成批，交互平滑性下降。

## 11. Tensor、Data、Pipeline、Expert Parallel

| 参数 | 含义 | 主要约束 |
|---|---|---|
| `--tp-size` / `--tp` | Tensor Parallel | 权重分片与每层 NCCL 通信 |
| `--dp-size` / `--dp` | Data Parallel | 多副本吞吐与路由 |
| `--pp-size` / `--pp` | Pipeline Parallel | Stage 切分、Bubble 和负载不均 |
| `--ep-size` / EP 参数 | Expert Parallel | MoE All-to-All 和专家负载不均 |
| `--dcp-size` | Decode Context Parallel | 特定 MLA/长上下文场景，模型与 Backend 约束 |
| `--enable-dp-attention` | Attention 使用 DP 组织 | 依模型/拓扑，改变权重和通信分工 |
| `--dp-size` + Router | 多 DP 实例路由 | 官方通常推荐配合 SGLang Model Gateway |

### 11.1 多节点 TP {/* #多节点-tp */}

| 参数 | 作用 |
|---|---|
| `--nnodes` | 节点总数 |
| `--node-rank` | 当前节点 Rank |
| `--dist-init-addr` | 分布式初始化地址 |
| `--nccl-port` | NCCL 初始化端口 |

还必须保存网卡、NCCL 环境、GPU 拓扑、共享内存和容器网络。参数正确但网络选错仍会挂起或性能极差。

## 12. CUDA Graph

| 参数 | 含义 | 影响 |
|---|---|---|
| `--disable-cuda-graph` | 完全关闭 CUDA Graph | 定位动态 Shape/捕获问题；通常增加 Launch 开销 |
| `--cuda-graph-max-bs` | 捕获的最大 Batch Size | 调大覆盖更大 Batch，也增加启动/显存 |
| `--cuda-graph-bs` | 显式 Capture Batch Size 列表 | 应匹配真实 Batch 分布 |
| `--disable-cuda-graph-padding` | 禁止 Padding 到已捕获 Shape | 减少无效计算，但更多 Shape 可能回退 Eager |
| `--enable-profile-cuda-graph` | 对 Graph 捕获路径进行 Profile | 诊断窗口使用，注意开销 |
| `--enable-piecewise-cuda-graph` | 分段图执行 | 支持更动态路径，兼容性看版本 |
| `--enable-breakable-cuda-graph` | 可中断/拆分图路径 | 高级功能，必须按模型特性验证 |

必须区分：启动捕获成功、请求实际命中 Graph、端到端性能提高，这是三件事。

## 13. Kernel Backend

SGLang 将多个热点组件做成可选 Backend：

| 参数族 | 控制对象 | 选择依据 |
|---|---|---|
| `--attention-backend` | Prefill/Decode Attention | GPU 架构、模型 Attention、dtype、Head Dim、Graph |
| `--prefill-attention-backend` | 单独选择 Prefill Backend | 长 Prompt 与 FlashAttention 能力 |
| `--decode-attention-backend` | 单独选择 Decode Backend | Paged KV、MLA、Batch 和 Kernel Launch |
| `--sampling-backend` | Sampling Kernel | Logprobs、Grammar、性能和确定性 |
| `--grammar-backend` | 结构化输出 | JSON Schema 支持、编译冷延迟、缓存 |
| `--gemm-backend` | GEMM 实现 | GPU、量化和 Shape |
| `--moe-runner-backend` | MoE Expert 执行 | 量化、EP 和硬件支持 |

Backend 名称和支持组合更新很快。只有官方支持矩阵和目标 `--help` 能证明可选值；压测才能证明最优值。

## 14. Overlap 与 CPU 路径

| 参数族 | 作用 |
|---|---|
| Overlap Scheduler 开关 | 将 CPU 调度/输出处理与 GPU 计算流水重叠 |
| Double Sparsity/双批等优化 | 针对特定模型/Backend 的流水优化 |
| Dynamic Batch Tokenizer | 提升高并发 Tokenizer 批处理 |
| GC/Watchdog 参数 | 控制 Python GC 抖动和卡死检测 |

Overlap 可减少 Kernel 间空洞，但增加并发状态和排障复杂度。若出现结果错位、卡死或异常 Timeline，应先与关闭 Overlap 的基线对比。

## 15. LoRA

| 参数 | 含义 |
|---|---|
| `--enable-lora` | 开启 LoRA 服务 |
| `--lora-paths` / 注册参数 | 启动时加载 LoRA 名称与路径 |
| `--max-loras-per-batch` | 单 Batch 最大 LoRA 数 |
| `--max-lora-rank` | 支持的最大 Rank |
| `--lora-backend` | LoRA Kernel/实现 Backend |
| 动态 LoRA 参数 | 允许运行时加载/卸载；需要鉴权、容量和制品审计 |

多 LoRA 可能降低 Batch 同质性、增加显存和 Kernel 分支。容量报告必须包含 LoRA 分布。

## 16. Speculative Decoding

主要参数族包括：

| 参数 | 含义 |
|---|---|
| `--speculative-algorithm` | EAGLE、NEXTN、N-gram 等方法 |
| `--speculative-draft-model-path` | Draft 模型路径 |
| `--speculative-num-steps` | 连续草拟 Step 数 |
| `--speculative-eagle-topk` | EAGLE 候选宽度 |
| `--speculative-num-draft-tokens` | 草拟 Token 预算 |
| `--speculative-accept-threshold-*` | 接受阈值/自适应参数 |
| N-gram 参数 | 最小/最大 N-gram 与搜索范围 |

收益取决于接受率：

```text
节省的目标模型 Decode
> Draft 计算 + Verify + 额外内存 + 调度成本
```

必须测 Acceptance Length、TPOT、吞吐、Graph 覆盖、显存与质量。

## 17. HiCache、LMCache 与分层 KV

高级 KV 参数族用于将缓存扩展到 CPU、本地存储或远端：

- HiCache 存储 Backend、大小、写策略和 IO Backend；
- LMCache 集成；
- KV Offload Ratio/Buffer；
- Session Cache；
- PD Disaggregation KV 传输。

收益来自减少重复 Prefill或扩大有效缓存，代价是序列化、网络/PCIe、CPU 内存、存储 IO、一致性和故障清理。应单独监控各级 Hit、读取时延、写放大和回退。

## 18. PD/EPD Disaggregation

| 参数族 | 含义 |
|---|---|
| `--disaggregation-mode` | `null`、Prefill、Decode 等角色 |
| Transfer Backend/Bootstrap 参数 | KV/Metadata 通信和协调 |
| Prefill/Decode 地址与端口 | 实例发现和数据传输 |
| EPD 参数 | Encoder、Prefill、Decode 更细分角色 |

新增故障面包括路由、KV 传输、超时、孤儿缓存、P/D 版本与模型一致性。单机混部未证明瓶颈前，不要先上分离架构。

## 19. 日志、指标与 Trace

| 参数 | 含义 | 原则 |
|---|---|---|
| `--log-level` / `--log-level-http` | 内部和 HTTP 日志级别 | Debug 只在控制窗口开启 |
| `--log-requests` | 记录请求 | 原始 Prompt 有隐私风险，应脱敏/采样 |
| `--log-requests-level` | 请求日志详细程度 | 详细级别增加 IO 和敏感数据 |
| `--enable-metrics` | Prometheus 指标 | 生产应开启并限制访问 |
| Histogram Bucket 参数 | TTFT/ITL/E2E Bucket | 围绕业务 SLO 设计 |
| `--enable-trace` | 分布式 Trace | 采样、OTLP 下游容量和 Label 基数 |
| `--otlp-traces-endpoint` | Trace Collector | TLS、超时和不可用时行为 |
| Request Metrics Exporter 参数 | 自定义请求指标导出 | 插件代码与性能开销需审计 |

## 20. 请求级 Sampling 参数

| 参数 | 含义 | 容量/行为影响 |
|---|---|---|
| `temperature` | Logits 温度 | 改变随机性，不是性能旋钮 |
| `top_p` / `top_k` / `min_p` | 候选 Token 过滤 | 联合决定分布 |
| `max_new_tokens` / `max_tokens` | 最大输出长度 | 直接影响 KV、Decode 时间和成本 |
| `min_new_tokens` | 最少输出长度 | 可能推迟 EOS |
| `stop` / `stop_token_ids` | 停止条件 | Stop String 依赖反分词边界 |
| `ignore_eos` | 忽略 EOS | 容易生成到上限 |
| `frequency_penalty` / `presence_penalty` | 重复相关惩罚 | 改变输出语义 |
| `repetition_penalty` | SGLang 扩展重复惩罚 | 与前两者算法不同 |
| `seed` | 请求随机种子 | 不保证跨并发/Kernel 位级一致 |
| `n` | 输出候选数 | 放大计算、KV 与响应流量 |
| `logprobs` / `top_logprobs` | 返回 Logprob | 增加 Logits、GPU/CPU 和网络成本 |
| `json_schema` / `regex` / `ebnf` | 结构化输出约束 | Grammar 编译冷延迟和缓存 |

## 21. 常见现象与参数入口

| 现象 | 优先参数/证据 |
|---|---|
| 启动 OOM | dtype、quantization、TP、mem fraction、Graph、模型长度 |
| 长 Prompt OOM | chunked prefill、max prefill tokens、Workspace、KV |
| TTFT 高 | Queue、Tokenizer、Prefill Budget、Radix Hit、Chunk Size |
| TPOT 高 | Running Batch、Graph、Attention Backend、TP/NCCL |
| Retract 多 | KV Pool、运行请求上限、调度保守度、输出分布 |
| GPU 低利用 | 到达率、Tokenizer、Scheduler CPU、Graph、IPC、NCCL |
| 流式不平滑 | stream interval、Detokenizer、HTTP/代理 Buffer |
| 多租户不公平 | schedule policy、Priority、队列和配额 |

## 22. 参数调优顺序

1. 固定 SGLang 镜像、模型、Tokenizer、GPU 和请求集。
2. 单卡、Eager/关闭高级优化建立正确性基线。
3. 确定最小 TP、dtype/量化和 Context Length。
4. 调 `mem_fraction_static`，确认 Prefill 峰值有余量。
5. 调 `max_running_requests`、`max_prefill_tokens` 和 Chunk Size。
6. 用真实共享前缀流量选择 Radix 与 Schedule Policy。
7. 调 CUDA Graph Capture Shape。
8. A/B Attention/Sampling/GEMM Backend。
9. 再引入 Speculative、LoRA、HiCache、PD 等高级能力。
10. 用开环到达率验证 P95/P99、过载和故障恢复。

## 23. 发布检查表

```text
[ ] 目标镜像 launch_server --help 已归档
[ ] 模型/Tokenizer/Chat Template/量化制品已固定
[ ] YAML、CLI 覆盖项、环境变量和硬件拓扑已保存
[ ] mem_fraction_static 在最长 Prompt 峰值下仍有余量
[ ] Radix Cache 使用真实共享前缀流量验收
[ ] 调度策略完成公平性和饥饿测试
[ ] CUDA Graph 实际 Replay 覆盖率已记录
[ ] Kernel Backend 组合在目标模型上受支持
[ ] TTFT/TPOT/E2E/吞吐/错误率容量曲线完成
[ ] TP Rank/NCCL、CPU/NUMA、ZMQ/共享内存无持续瓶颈
[ ] 流式、停止、工具调用和结构化输出完成契约测试
[ ] 回滚和进程/网络/GPU 故障演练完成
```

## 24. 官方资料 {/* #官方资料 */}

- [Server Arguments](https://docs.sglang.io/docs/advanced_features/server_arguments)
- [Hyperparameter Tuning](https://docs.sglang.io/docs/advanced_features/hyperparameter_tuning)
- [Sampling Parameters](https://docs.sglang.io/docs/basic_usage/sampling_params)
- [Production Metrics](https://docs.sglang.io/docs/references/production_metrics)
- [ServerArgs 源码](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/server_args.py)
