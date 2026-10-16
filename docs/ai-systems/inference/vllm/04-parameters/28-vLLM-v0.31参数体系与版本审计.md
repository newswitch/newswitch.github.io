---
title: "vLLM v0.31 参数体系、配置优先级与版本审计"
sidebar_label: "28. v0.31 参数体系与版本审计"
sidebar_position: 28
description: "以 vLLM v0.31.0 为固定基线，建立 Serve、Engine、请求、环境变量和 Benchmark 五层参数地图，并给出升级审计方法。"
tags: [vLLM, 参数, V1, 配置审计, 版本升级]
---

# vLLM v0.31 参数体系、配置优先级与版本审计

“记住启动命令”不等于掌握 vLLM 参数。一个生产实例的行为至少由五层输入共同决定：

~~~text
请求字段
  ↓ 覆盖单次生成行为
Serve / Engine CLI 与 YAML
  ↓ 构造 VllmConfig 和前端配置
环境变量
  ↓ 改变平台、编译、通信和进程行为
模型制品中的 config / tokenizer / generation_config
  ↓ 提供模型结构与生成默认值
驱动、CUDA、NCCL、GPU 拓扑
  ↓ 决定参数最终是否可执行
~~~

本文固定 **vLLM v0.31.0**。阅读其他版本时，应重新生成参数清单，不能把本文默认值机械复制过去。

## 1. 为什么必须固定版本

vLLM 发布节奏快，同一个概念可能发生以下变化：

- 参数改名、合并进 JSON 配置或被删除；
- 默认值随硬件平台、模型类型和 V1 初始化逻辑变化；
- 参数仍能解析，但只保留兼容语义；
- CUDA、ROCm、XPU、CPU 等平台支持的取值不同；
- 主分支文档已经描述下一版本，而生产镜像仍是旧版本。

因此“全部参数”必须是“某个确定版本、某个入口、某个平台的全部参数”。

## 2. 五类参数的边界

| 层级 | 事实来源 | 示例 | 典型生效时机 |
|---|---|---|---|
| Serve 前端参数 | `vllm serve --help=Frontend` | 监听、TLS、Parser、日志 | API Server 启动 |
| Engine 参数 | `vllm serve --help=ModelConfig` 等 | 模型、KV、调度、并行、编译 | Engine 初始化 |
| 嵌套配置 | JSON CLI / YAML | `compilation_config`、`kv_transfer_config` | 对应子系统初始化 |
| 请求参数 | OpenAI 兼容 API Schema | `temperature`、`max_tokens`、`structured_outputs` | 单次请求 |
| 环境变量 | `vllm.envs` 与平台运行时 | `VLLM_*`、`CUDA_VISIBLE_DEVICES` | import、进程或设备初始化 |

Benchmark 参数不改变生产服务本身，但决定压测产生什么工作负载，因此必须作为第六个审计面保存。

## 3. CLI、YAML 与默认值的优先级

v0.31.0 支持把长命令写进 YAML：

~~~yaml
model: /models/Qwen
served-model-name: qwen-prod
host: 0.0.0.0
port: 8000
dtype: bfloat16
max-model-len: 32768
tensor-parallel-size: 2
gpu-memory-utilization: 0.88
~~~

~~~bash
vllm serve --config /etc/vllm/config.yaml
~~~

优先级是：

~~~text
命令行显式值 > YAML 中的值 > 当前版本默认值
~~~

请求字段位于另一层。例如 YAML 中的 `generation-config: auto` 可能载入模型仓库默认采样参数，而请求中的 `temperature` 又会覆盖对应字段。

## 4. 正确获取当前镜像的全部参数

不要从博客复制参数全集，应从将要上线的镜像生成：

~~~bash
vllm --version
vllm serve --help=all > /audit/vllm-serve-help.txt
vllm serve --help=ModelConfig > /audit/model-config.txt
vllm serve --help=CacheConfig > /audit/cache-config.txt
vllm serve --help=SchedulerConfig > /audit/scheduler-config.txt
vllm serve --help=ParallelConfig > /audit/parallel-config.txt
vllm serve --help=CompilationConfig > /audit/compilation-config.txt
vllm collect-env > /audit/vllm-environment.txt
~~~

如果某个参数是否存在不确定：

~~~bash
vllm serve --help=max-num-seqs
vllm serve --help=kv-transfer
vllm serve --help=cudagraph
~~~

帮助输出属于目标二进制本身，比 `latest` 网页更接近事实。

## 5. 参数如何进入 V1 组件

~~~text
CLI / YAML
  ↓ 参数解析与校验
ModelConfig / LoadConfig / CacheConfig
ParallelConfig / SchedulerConfig / CompilationConfig
  ↓ 组合为 VllmConfig
EngineCore
  ├─ Scheduler：序列与 Token 预算
  ├─ KVCacheManager：Block 与 Prefix Cache
  └─ Executor
       └─ Worker / ModelRunner
            ├─ 权重与 Attention Backend
            ├─ torch.compile
            └─ CUDA Graph
~~~

参数必须映射到组件后再调优。例如：

- `max_num_seqs` 首先约束 Scheduler，不是 HTTP 连接数；
- `block_size` 改变 KV Block 粒度，不是 CUDA Thread Block；
- `api_server_count` 扩展前端进程，不会直接增加模型副本；
- `cudagraph_capture_sizes` 控制已捕获 Shape，不是业务准入上限。

## 6. 深度解析应回答的六个问题

每个参数至少应能回答：

1. 谁读取它，初始化期还是请求期生效？
2. 它限制请求数、Token、字节、进程、Rank 还是 Shape？
3. 默认值是常量、自动推导还是平台决定？
4. 它与哪些参数存在上下界或互斥关系？
5. 调大、调小或开启后，TTFT、TPOT、吞吐、显存和稳定性如何变化？
6. 用什么日志、指标或最小实验证明它确实生效？

只写“参数用于提高性能”不算深度解析。

## 7. 参数专题索引

| 专题 | 核心配置族 |
|---|---|
| Serve 前端、协议与安全 | Frontend、TLS、Chat Template、Tool/Reasoning Parser |
| 模型与权重加载 | ModelConfig、LoadConfig、AttentionConfig、MambaConfig |
| KV、内存与调度 | CacheConfig、SchedulerConfig |
| 并行与通信 | ParallelConfig、TP/PP/DP/DCP/PCP/EP/EPLB/DBO |
| 编译与执行 | CompilationConfig、CUDA Graph、Sleep Mode |
| 高级功能 | MultiModalConfig、LoRAConfig、SpeculativeConfig、Structured Outputs |
| 分离式推理 | KVTransferConfig、KVEventsConfig、Encoder Cache |
| 可观测性与环境 | ObservabilityConfig、`VLLM_*`、CUDA/NCCL 环境 |
| Benchmark 与请求 | `vllm bench`、Sampling、Tool、Structured Outputs |

## 8. 版本升级差异审计

升级前后分别保存：

~~~bash
vllm serve --help=all
python -m pip freeze
vllm collect-env
~~~

对比时把变化分成四类：

| 变化 | 风险 |
|---|---|
| 参数删除或改名 | 启动失败，或启动脚本中的旧值被忽略 |
| 默认值变化 | 命令不变但容量、延迟或输出改变 |
| 枚举取值变化 | Backend、Parser、量化方法不再兼容 |
| 行为变化 | 同名参数进入 V1 新路径，语义与 V0 不同 |

生产配置应尽量显式写出会影响正确性、容量和 SLO 的参数，但不要把所有默认值全部复制到命令行。复制过多会阻碍升级，也可能固定原本应由平台推导的值。

## 9. 可复现清单

~~~text
[ ] vLLM 版本、镜像 Digest 和 Python 包清单
[ ] serve --help=all 原始输出
[ ] CLI、YAML、嵌套 JSON 与相关环境变量
[ ] 模型、Tokenizer、Chat Template 和 GenerationConfig 哈希
[ ] GPU 型号、驱动、CUDA、NCCL 与拓扑
[ ] 请求长度、输出长度、到达率、并发和采样分布
[ ] 冷启动、预热和 CUDA Graph 捕获状态
[ ] P50/P95/P99 TTFT、TPOT、E2E、吞吐和错误
~~~

## 10. 验收题与答案

**问题：为什么“启动命令相同”仍可能得到不同容量？**

答案：模型 Revision、Tokenizer、GenerationConfig、环境变量、硬件、驱动以及 vLLM 默认值都可能不同。CLI 只是配置的一部分。

**问题：为什么不建议直接使用 latest 文档解释生产镜像？**

答案：latest 可能包含生产版本尚未发布的参数和默认值。应先查看镜像内 `--help`，再使用相同版本的文档解释。

**问题：是否应该把所有默认值显式写入 YAML？**

答案：不应该。只显式固定影响正确性、资源预算和 SLO 的关键项；平台自动推导项应保留自动选择，并把实际解析结果记录到发布证据中。

## 11. 官方资料

- [vLLM v0.31.0 CLI](https://docs.vllm.ai/en/v0.31.0/cli/)
- [vLLM v0.31.0 Serve CLI](https://docs.vllm.ai/en/v0.31.0/cli/serve/)
- [vLLM v0.31.0 Engine Arguments](https://docs.vllm.ai/en/v0.31.0/configuration/engine_args/)
- [vLLM v0.31.0 Server Arguments](https://docs.vllm.ai/en/v0.31.0/configuration/serve_args/)
