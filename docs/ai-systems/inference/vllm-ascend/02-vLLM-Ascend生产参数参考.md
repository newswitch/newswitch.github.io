---
title: vLLM-Ascend 生产参数参考
sidebar_position: 2
tags: [vLLM-Ascend, 参数, Additional Config, ACLGraph, HCCL]
description: 解释 vLLM 公共参数、Ascend Additional Config、Graph 配置与 HCCL/CANN 环境参数怎样共同控制 910B 推理。
---

# vLLM-Ascend 生产参数参考

vLLM-Ascend 的参数不是一套独立 CLI，而是三层配置叠加：

```text
upstream vLLM CLI / VllmConfig
        +
vLLM-Ascend --additional-config
        +
torch_npu / CANN / HCCL / OS 环境
```

遗漏任意一层，都无法完整复现一个 910B 实例。

本文以当前 vLLM-Ascend 配置体系建立参数地图。精确字段、默认值、模型约束和弃用状态必须以目标版本为准：

```bash
python -c "import vllm, vllm_ascend; print(vllm.__version__); print(vllm_ascend.__version__)"
vllm serve --help=all
vllm collect-env
```

还要保存官方兼容矩阵中对应的 PyTorch、torch-npu、CANN、驱动和固件版本。

## 1. 三层参数分别控制什么

| 层 | 典型参数 | 控制对象 |
|---|---|---|
| upstream 公共层 | `--max-model-len`、`--max-num-seqs`、`--tensor-parallel-size` | API、Scheduler、KV 逻辑、并行抽象 |
| Ascend 插件层 | `--additional-config '{...}'` | NPU 编译、Graph、调度扩展、MoE、CPU 绑定和融合优化 |
| 运行时层 | `ASCEND_RT_VISIBLE_DEVICES`、HCCL、CANN、Allocator | 设备可见性、通信、内存和执行队列 |

公共参数的完整机制见 [vLLM Serve 生产参数参考](../vllm/25-vLLM-Serve生产参数参考.md)。本文重点解释这些参数在 Ascend 上的落地和插件专属字段。

## 2. 最小启动基线

```bash
export ASCEND_RT_VISIBLE_DEVICES=0,1,2,3

vllm serve /models/Qwen \
  --served-model-name qwen-prod \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 4 \
  --dtype bfloat16 \
  --max-model-len 32768 \
  --max-num-seqs 16 \
  --max-num-batched-tokens 8192 \
  --gpu-memory-utilization 0.85
```

示例数值只用于展示参数位置。生产必须按模型、910B 型号、量化、输入/输出 Token 分布和 SLO 重测。

## 3. 版本和设备参数

| 参数/配置 | 含义 | 风险 |
|---|---|---|
| `ASCEND_RT_VISIBLE_DEVICES` | 限制进程可见的物理 NPU | 进程内逻辑 ID 会重新编号，必须与 Rank 规划一致 |
| `--device auto` | 让 Platform Plugin 识别 NPU | 启动日志必须确认实际选择 Ascend Platform |
| `--distributed-executor-backend` | 多 Worker 执行方式 | multiprocessing/Ray 等部署和故障模型不同 |
| `VLLM_WORKER_MULTIPROC_METHOD` | Worker 进程启动方法 | fork/spawn 对库初始化、内存和兼容性影响明显 |

容器还必须正确挂载 NPU 设备、驱动运行库、共享内存和需要的 HCCL 网卡。CLI 无法修复宿主机运行时不完整。

## 4. 模型、Tokenizer 和加载

| upstream 参数 | Ascend 侧含义与注意事项 |
|---|---|
| `model` / `--revision` | 模型必须出现在当前硬件/版本支持矩阵，且固定权重 Revision |
| `--tokenizer` / `--tokenizer-revision` | Tokenizer 与 CUDA 服务可复用时也要固定哈希 |
| `--trust-remote-code` | 同样具有代码执行风险；只对审计制品开启 |
| `--dtype` | 常见 BF16/FP16，具体模型/硬件/量化路径按教程 |
| `--quantization ascend` | 选择 Ascend 量化实现；制品必须是对应格式，不是自动转换器 |
| `--load-format` | `auto`、`safetensors`、`sharded_state` 等支持依版本/教程 |
| `--model-loader-extra-config` | Ascend Loader 可能支持多线程加载等扩展 |
| `--max-model-len` | 影响 KV 最坏成本、Graph Shape 与稳定并发 |
| `--served-model-name` | API 别名，与真实权重身份分开记录 |

### 权重可移植性

- BF16/FP16 Hugging Face 权重通常最接近跨框架共享，但仍需模型实现支持。
- NVIDIA AWQ/GPTQ/FP8 制品不能默认作为 Ascend 量化制品使用。
- W8A8/W4A8/W4A4 等必须按 vLLM-Ascend 模型教程和转换链路生成。

## 5. HBM 与 KV Cache 参数

| 参数 | 作用 | Ascend 调优重点 |
|---|---|---|
| `--gpu-memory-utilization` | 公共名称，控制实例规划的设备内存比例 | 实际是 NPU HBM 预算；过高会挤压 ACLGraph/Workspace/HCCL |
| `--kv-cache-memory-bytes` | 显式 KV 预算（支持版本） | 比比例更可控，但必须留足 Graph 和算子峰值 |
| `--block-size` | KV Block Token 粒度 | Ascend Attention/模型支持和最优值与 CUDA 不必相同 |
| `--kv-cache-dtype` | KV Cache 精度 | 硬件、模型、Attention Backend 和 Scale 必须共同支持 |
| `--calculate-kv-scales` | 动态 KV Scale | 量化精度与性能需实测 |
| `--num-gpu-blocks-override` | 强制 Block 数 | 仅用于验证/故障注入；名称仍保留 GPU 历史 |
| `--cpu-offload-gb` / KV Offload | CPU 卸载 | 受 ARM/NUMA/PCIe/网络影响，延迟代价大 |

实际 HBM：

```text
权重
+ KV Cache
+ ACLGraph 固定 Buffer/Workspace
+ Attention/量化临时空间
+ HCCL Buffer
+ torch_npu/CANN 运行时
+ 碎片与峰值
```

所以“利用率设 0.95 仍有 5% 空闲”不是安全证明。

## 6. Scheduler 参数

| upstream 参数 | 含义 | 910B 上的验证重点 |
|---|---|---|
| `--max-num-seqs` | 同时调度序列预算 | Decode Batch、KV、Graph Capture Shape 与尾延迟 |
| `--max-num-batched-tokens` | 每轮 Token Budget | Prefill Shape、算子 Workspace、Decode 干扰 |
| `--enable-chunked-prefill` | 长 Prompt 分块 | NPU Prefill Kernel、Graph 和 TPOT 影响曲线 |
| `--enable-prefix-caching` | 复用公共前缀 KV | 当前模型/Feature Matrix 支持，命中 Token 和 HBM |
| `--scheduler-policy` | FCFS/Priority 等 | 插件调度扩展是否兼容 |
| `--async-scheduling` 等 | 异步调度能力 | 版本和特性组合受限，需对照支持矩阵 |

NVIDIA 环境验证过的 `max_num_seqs=64` 不能直接复制。两边的 Kernel、Graph、KV 布局和通信曲线不同。

## 7. TP、DP、PP、EP 与 HCCL

| 参数 | 含义 | Ascend 风险点 |
|---|---|---|
| `--tensor-parallel-size` | 层内张量并行 | HCCL 集合通信、HCCS/PCIe/RoCE 拓扑 |
| `--pipeline-parallel-size` | 层间流水并行 | 版本/模型支持、Bubble、动态 Chunk |
| `--data-parallel-size` | 多模型副本或 DP 域 | 外部/内部 LB、全局 Rank 与容量不均 |
| `--enable-expert-parallel` | MoE Expert 并行 | All-to-All、专家热度、通信融合和 Workspace |
| `--enable-eplb` / `--eplb-config` | Expert Load Balancing | ModelRunner V1/V2 配置 Schema 不同 |
| `--disable-custom-all-reduce` | 禁用自定义 All-Reduce 路径 | Ascend 平台的实际支持与行为按版本确认 |

### HCCL 网络环境族

| 环境变量族 | 用途 |
|---|---|
| `HCCL_IF_IP` | 指定 HCCL 通信 IP |
| `HCCL_SOCKET_IFNAME` | 指定 HCCL Socket 网卡 |
| `GLOO_SOCKET_IFNAME` | Gloo/控制通信网卡 |
| `TP_SOCKET_IFNAME` | 特定 TP 控制/通信选择（依版本方案） |
| `HCCL_BUFFSIZE` | HCCL Buffer 大小 |
| `HCCL_OP_EXPANSION_MODE` | 特定集合通信展开/实现模式 |
| `HCCL_RDMA_TIMEOUT` / `HCCL_RDMA_RETRY_CNT` | RDMA 超时与重试 |

这些不是通用“性能最佳实践”。仅按具体硬件、CANN/HCCL 版本、官方模型教程和网络设计设置，并保存基线对照。

## 8. `--additional-config` 的作用

用法：

```bash
vllm serve /models/Qwen \
  --additional-config '{
    "enable_cpu_binding": true,
    "ascend_compilation_config": {
      "enable_npugraph_ex": true
    }
  }'
```

它是 vLLM 为插件提供的扩展配置字典。字段由 vLLM-Ascend 解析，不属于 upstream 通用 CLI。

### 顶层配置概览

| 字段 | 类型/默认思路 | 含义 |
|---|---|---|
| `xlite_graph_config` | dict | Xlite Graph 模式配置 |
| `finegrained_tp_config` | dict | 不同模块使用细粒度 TP |
| `ascend_compilation_config` | dict | Ascend 编译与 Npugraph_ex 配置 |
| `eplb_config` | dict | Ascend ModelRunner 专属 EPLB 扩展 |
| `scheduler_config` | dict | Balance/Recompute/SRF/Dynamic Chunk/DyntraLB 等调度扩展 |
| `refresh` | bool | 刷新全局 Ascend 配置，通常用于测试/RLHF |
| `dump_config` | dict | 内联 msprobe Dump 配置 |
| `dump_config_path` | string | 旧式 msprobe 配置文件路径 |
| `enable_cpu_binding` | bool | Ascend ARM Server CPU 绑定；默认策略按版本确认 |
| `enable_sleep_mode_extra_cleanup` | bool | Sleep 时释放 HCCL/Graph 等额外资源，Wake 需要恢复 |
| `pa_shape_list` | list | Page Attention 自定义 Shape 列表 |

## 9. Ascend Compilation Config

```json
{
  "ascend_compilation_config": {
    "enable_npugraph_ex": true,
    "enable_static_kernel": false,
    "fuse_norm_quant": true,
    "fuse_qknorm_rope": true,
    "fuse_muls_add": true
  }
}
```

| 字段 | 含义 | 风险 |
|---|---|---|
| `enable_npugraph_ex` | 启用 Npugraph_ex 编译 Backend | 模型/功能/Shape 兼容性和编译冷启动 |
| `enable_static_kernel` | Shape 较稳定时使用静态 Kernel | 编译时间增加，动态 Shape 场景可能不合适 |
| `fuse_norm_quant` | 融合 Norm 与 Quant | 量化/模型支持和精度验证 |
| `fuse_qknorm_rope` | 融合 QK Norm/RoPE | 无相应 Triton/环境时可能需关闭 |
| `fuse_muls_add` | 融合乘加 Pattern | 需回归精度与性能 |

不要一次关闭所有 Fusion 解决启动问题。先用最小复现确定具体 Pass，再记录回退对性能的影响。

## 10. `--compilation-config` 与 ACLGraph

示例：

```bash
--compilation-config '{
  "cudagraph_mode": "FULL_DECODE_ONLY",
  "cudagraph_capture_sizes": [1, 2, 4, 8, 16]
}'
```

字段名来自 upstream，但在 Ascend 上由插件映射到 NPU Graph/ACLGraph 路径。

| 字段/参数 | 含义 |
|---|---|
| `--enforce-eager` | 禁止 Graph 快速路径，用于兼容和定位 |
| `cudagraph_mode` | NONE、PIECEWISE、FULL_DECODE_ONLY、FULL 等有效值依版本 |
| `cudagraph_capture_sizes` | 需要 Capture/Replay 的 Batch Size |
| 编译 Shape/Level | upstream 编译配置，实际支持由插件约束 |

### Graph 调优原则

1. Eager 跑通正确性。
2. 开启默认 Graph，记录实际模式。
3. 统计真实 Decode Batch 分布。
4. 只捕获高频 Shape。
5. 对比启动时间、HBM、Replay、TTFT/TPOT 和错误。

Graph 参数不能从 CUDA 原样照搬。两边 Capture 实现、Workspace 和最优 Shape 不同。

## 11. Xlite Graph

```json
{
  "xlite_graph_config": {
    "enabled": true,
    "full_mode": false
  }
}
```

| 字段 | 含义 |
|---|---|
| `enabled` | 开启 Xlite Graph |
| `full_mode` | 同时接管 Prefill 与 Decode；关闭时通常重点用于 Decode |

Xlite 与 ACLGraph、Eager、Speculative Decoding 等组合受模型和版本限制。必须使用对应 Feature Guide，不能将它当作通用加速开关。

## 12. CPU 绑定与主机运行时

| 配置 | 作用 | 调优证据 |
|---|---|---|
| `enable_cpu_binding` | 将 NPU Rank/Worker 绑定到合适 CPU/NUMA | Worker CPU、Kernel 空洞、跨 NUMA 内存访问 |
| `OMP_NUM_THREADS` | OpenMP 线程数 | 过大可能线程竞争，过小可能预处理慢 |
| `OMP_PROC_BIND` | OpenMP 线程绑定 | 与插件 CPU Binding 协同验证 |
| `TASK_QUEUE_ENABLE` | CANN 任务队列相关开关 | 只按目标 CANN/模型指导使用 |
| `PYTORCH_NPU_ALLOC_CONF` | torch_npu 分配器策略 | 碎片/OOM 与版本支持 |
| `LD_PRELOAD` jemalloc 等 | 主机分配器优化 | 需要基线对照与故障回滚 |

CPU Binding 错误可能让所有 NPU 周期性等待。容器的 CPU Request/Limit、cpuset 和 NUMA 必须与绑定策略一致。

## 13. Fine-Grained TP

```json
{
  "finegrained_tp_config": {
    "lmhead_tensor_parallel_size": 0,
    "oproj_tensor_parallel_size": 0,
    "embedding_tensor_parallel_size": 0,
    "mlp_tensor_parallel_size": 0
  }
}
```

它允许 lm_head、o_proj、Embedding、MLP 使用不同 TP 大小，用于平衡计算与通信。`0` 通常表示不自定义，精确语义以版本为准。

这属于模型/拓扑专项优化。配置不当可能导致额外重分布、HCCL 开销或不支持的分片。

## 14. MoE、共享专家与通信融合

| 字段 | 含义 | 代价/约束 |
|---|---|---|
| `enable_shared_expert_dp` | 共享专家权重在 TP Rank 复制并按 DP 执行 | 提升性能潜力，增加 HBM |
| `multistream_overlap_shared_expert` | 多 Stream 重叠共享专家 | 仅有共享专家的 MoE 生效 |
| `enable_flashcomm1` | FlashComm1 通信优化 | 模型/硬件/特性依赖 |
| `enable_fused_mc2` | 融合 MC2 配置 | 枚举/数值含义按版本和教程 |
| `enable_mc2_hierarchy_comm` | 跨节点 ROCE 层次通信 | 依赖网络和规模 |
| `enable_prefill_mc2` | 为 Prefill 预留 MC2 Token Capacity | Workspace 与 Token Budget 有约束 |
| `mega_moe_max_tokens` | 融合 MoE 算子每 Rank Token Capacity | 太小会丢 Token 影响精度；太大 Workspace 线性增加 |
| `enable_mlapo` | 模型分层自适应并行优化 | 默认/模型支持以版本为准 |

### `mega_moe_max_tokens` 是精度参数

当专家负载不均导致某 Rank 接收 Token 超过容量时，超出部分可能被丢弃，直接影响输出。不能只按“不 OOM”设置，必须监控溢出并做精度验证。

## 15. KV 和稀疏 Attention 专项字段

| 字段 | 含义 | 适用范围 |
|---|---|---|
| `enable_kv_nz` | KV Cache 使用 NZ 布局 | 主要面向 MLA 等支持模型 |
| `enable_transpose_kv_cache_by_block` | 按 Block 转置 KV 优化 | 与 Attention/Fusion 实现配套 |
| `enable_sparse_sfa_c8` | Sparse Flash Attention 的 C8 KV | DSA 模型和特定硬件/CP 约束 |
| `enable_sparse_li_c8` | LightningIndexer 的 C8 Key/Scale Cache | 需要量化 Config 支持 |
| `c8_enable_reshape_optim` | StoreKVBlock 加速 C8 写入 | 依赖 `enable_sparse_li_c8`，PD 角色有约束 |
| `enable_dsa_cp` | DSA Context Parallel | 依赖 FlashComm1，特定 DeepSeek/同构架构 |
| `pa_shape_list` | 自定义 Page Attention Shape | 仅在清楚 Kernel Shape 时调整 |

这些字段不是 910B 通用调优清单，应以目标模型教程为入口。

## 16. Scheduler Additional Config

```json
{
  "scheduler_config": {
    "enable_balance_scheduling": false,
    "recompute_scheduler_enable": false,
    "profiling_chunk_config": {},
    "short_request_first_config": {},
    "batch_job_sched_config": {},
    "dyntra_lb_config": {}
  }
}
```

| 字段 | 含义 | 约束 |
|---|---|---|
| `enable_balance_scheduling` | Ascend Balance Scheduling | 与目标场景和版本验证 |
| `recompute_scheduler_enable` | Decode 节点 Recompute Scheduler | 只在 PD 分离 Consumer/D 节点使用，错误角色会启动失败 |
| `profiling_chunk_config` | 动态 Chunked PP | 需要 PP>1，依赖在线 Timing/Fitting |
| `short_request_first_config` | 短请求优先 Prefill | 验证长请求饥饿和公平性 |
| `batch_job_sched_config` | Batch Job 感知调度 | 在线/离线混部使用 |
| `dyntra_lb_config` | PD Decode DP Rank 动态负载均衡 | 只在特定 PD Decode + DP 场景 |

### Dynamic Chunk 字段

| 字段 | 含义 |
|---|---|
| `enabled` | 启用动态 Pipeline Chunk |
| `smooth_factor` | 对新预测的信任程度 |
| `min_chunk` | 最小 Chunk，必须小于 Token Budget |
| `need_timing` | 是否在线采集校准时间 |
| `max_fit_chunk` | 用于拟合的样本数量 |

### DyntraLB 字段

| 字段 | 含义 |
|---|---|
| `enabled` | 启用 DyntraLB Scheduler |
| `mode` | 静态或动态激活 |
| `start_step` / `end_step` | 允许生成平衡计划的 Step 区间 |
| `bubble_threshold` | Rank 负载差达到多少才调整 |
| `long_req_block_threshold` | 长请求 Block 阈值 |
| `dynamic_max_step` | 动态平衡持续 Step 上限 |
| `enable_diagnostics` | 详细诊断日志，只在调试使用 |

## 17. EPLB 的 V1/V2 Schema

vLLM-Ascend 当前对 ModelRunner V1/V2 的 EPLB 配置入口不同：

- ModelRunner V2：使用 upstream `--enable-eplb`、`--eplb-config`，Ascend Additional Config 只接受特定扩展字段；
- ModelRunner V1：使用 `additional_config.eplb_config` 的旧字段，不接受 V2 Schema。

旧字段包括动态 EPLB 开关、Expert Map 路径、热度采集周期、算法执行周期、冗余专家数、策略类型和采集阶段。混用 Schema 应在启动时失败，不应靠猜测删字段。

## 18. Speculative Decoding 扩展

upstream 使用 `--speculative-config` 指定 MTP/EAGLE/Draft 等方法。Ascend 还可提供：

```json
{
  "dynamic_spec_config": {
    "method": "dspark",
    "method_params": {}
  },
  "rejection_sampler_config": {
    "enable_block_verify": false,
    "enable_entropy_verify": false,
    "posterior_threshold": 0.95,
    "posterior_alpha": 0.4
  }
}
```

| 字段 | 含义 |
|---|---|
| `dynamic_spec_config.method` | 动态草稿长度方法，如支持版本中的 DSpark/DFlash |
| `method_params` | 方法专属超参数 |
| `enable_block_verify` | 按 Block 累积概率验证草稿 |
| `enable_entropy_verify` | 按目标分布熵调整接受阈值 |
| `posterior_threshold` | 接受阈值上界 |
| `posterior_alpha` | 熵调整强度；更激进可能提速但降低采样精度 |

这些是性能与质量共同参数，不能只看 Acceptance Rate。

## 19. Reduce Sample

`enable_reduce_sample` 让 TP 场景不汇聚完整词表 Logits，而只通信少量 Top-k 候选，减少通信和计算。

约束包括：

- 某些 PD 场景不支持；
- 请求 Logprobs 时必须关闭，否则可能得到基于分片 Logits 的错误值；
- 不能与某些 LM Head TP 组合。

这是典型“性能优化可能改变语义”的参数，必须在 API 层建立禁止组合。

## 20. Dump、Profile 和调试

| 参数 | 作用 |
|---|---|
| `dump_config` | 以内联 JSON 配置 msprobe Dump |
| `dump_config_path` | 指向已有 msprobe 配置 |
| `--profiler-config` | 配置 torch/服务 Profiling 输出与 Stack 等 |
| `msmonitor_use_daemon` | msmonitor Daemon 模式 |
| `VLLM_LOGGING_LEVEL` 等 | 控制日志级别，名称按版本确认 |

Profile/Dump 可能产生大量文件、同步和性能开销。只在限定请求、时间和目录容量下开启，采集后恢复基线。

## 21. 环境变量迁移

vLLM-Ascend 正在将部分 `VLLM_ASCEND_*` 环境变量迁移到 `--additional-config`。例如：

```text
VLLM_ASCEND_ENABLE_FLASHCOMM1
→ additional_config.enable_flashcomm1

VLLM_ASCEND_BALANCE_SCHEDULING
→ additional_config.scheduler_config.enable_balance_scheduling
```

新部署优先使用 Additional Config。升级时检查弃用说明，避免环境变量和 JSON 同时配置同一字段造成优先级歧义。

## 22. 请求级参数

vLLM-Ascend 尽量复用 upstream OpenAI/Sampling 参数：Temperature、Top-p、Top-k、Max Tokens、Stop、Seed、Penalty、Logprobs、Structured Output 和 Tool Calling。

但以下能力必须查 Feature Matrix 和模型教程：

- Logprobs 与 Reduce Sample；
- Tool/Reasoning Parser；
- Structured Output Backend；
- LoRA；
- Speculative Decoding；
- 多模态；
- Prefix Cache；
- Sleep Mode；
- 特定量化与 Graph 组合。

API 字段被接受不等于执行语义与 NVIDIA 完全一致。

## 23. 常见现象与参数入口

| 现象 | 优先检查 |
|---|---|
| 未发现 NPU Platform | 包安装、Entry Point、vLLM/插件版本、环境 |
| Import/符号错误 | PyTorch/torch-npu/CANN/插件兼容矩阵 |
| 权重加载失败 | 模型支持、量化、load format、world/TP size |
| HBM OOM | memory utilization、KV、Graph、Workspace、HCCL Buffer |
| Graph Capture 失败 | compilation config、Capture Shape、Npugraph_ex、功能组合 |
| TTFT 高 | Queue、Tokenizer、Prefill Token Budget、Graph/HCCL |
| TPOT 高 | Decode Batch、ACLGraph Replay、Attention、慢 Rank |
| NPU 利用率低 | 请求到达、CPU Binding、输入准备、Graph 回退、HCCL |
| 多卡挂起 | Rank、设备逻辑 ID、网卡/IP、HCCL、首个失败进程 |
| 输出精度变化 | 权重/Tokenizer、量化、Fusion、Sampler、Reduce Sample |

## 24. 正确调参顺序

1. 固定官方兼容矩阵中的完整软件栈。
2. 固定模型、Tokenizer、量化制品和 Feature Matrix 条目。
3. 单卡/Eager 建立正确性基线。
4. 确定最小 TP/EP 与 HCCL 拓扑。
5. 调 HBM/KV、最大上下文和并发。
6. 调 Scheduler Token Budget 和 Chunked Prefill。
7. 开启 ACLGraph/Npugraph_ex，按真实 Shape 调 Capture。
8. 验证 CPU Binding 和各 Rank Timeline。
9. 再启用 FlashComm/MC2/EPLB/Spec/PD 等模型专项能力。
10. 完成精度、容量、故障和回滚测试。

## 25. 发布清单

```text
[ ] 驱动/固件/CANN/PyTorch/torch-npu/vLLM/vLLM-Ascend 兼容行已归档
[ ] vllm serve --help=all 和插件配置文档对应目标版本
[ ] 模型/Tokenizer/Chat Template/量化制品固定哈希
[ ] upstream CLI、additional-config、compilation-config 全部保存
[ ] ASCEND/HCCL/CANN/PyTorch/OS 环境变量全部保存
[ ] 启动日志确认 Platform、Attention Backend、Graph 与量化路径
[ ] HBM/KV/Graph/Workspace/HCCL 留有压力峰值余量
[ ] TTFT/TPOT/E2E/吞吐/错误率容量曲线完成
[ ] 各 HCCL Rank、CPU/NUMA、NPU Timeline 无持续瓶颈
[ ] 流式/停止/工具/结构化输出/Logprobs 完成契约测试
[ ] OOM、慢 Rank、NPU 故障、网络和滚动升级已演练
```

## 官方资料

- [vLLM-Ascend Additional Configuration](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/configuration/additional_config.html)
- [vLLM-Ascend Configuration Guide](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/configuration/)
- [vLLM-Ascend Graph Mode](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/feature_guide/graph_mode.html)
- [vLLM-Ascend Feature Matrix](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/feature_matrix.html)
- [vLLM Serve 参数](https://docs.vllm.ai/en/latest/cli/serve/)
- [vLLM-Ascend 模型教程](https://docs.vllm.ai/projects/ascend/en/latest/tutorials/models/)
