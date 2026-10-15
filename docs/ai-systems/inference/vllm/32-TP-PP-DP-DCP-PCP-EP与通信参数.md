---
title: "vLLM v0.31 TP、PP、DP、DCP、PCP、EP 与通信参数"
sidebar_label: "32. 并行与通信参数"
sidebar_position: 32
description: "系统解释 vLLM v0.31 的张量、流水线、数据、上下文和专家并行参数，以及 EPLB、DBO 和通信后端。"
tags: [vLLM, TP, PP, DP, DCP, PCP, EP, NCCL]
---

# vLLM v0.31 TP、PP、DP、DCP、PCP、EP 与通信参数

并行参数不是“卡数开关”。每一种并行都切分不同对象，并引入不同通信：

| 维度 | 切分对象 | 主要通信 | 解决的问题 |
|---|---|---|---|
| TP | 层内矩阵、Attention Head | All-Reduce/All-Gather | 单卡放不下或单副本吞吐 |
| PP | Transformer Layer | Stage 间激活传输 | 模型按层切分 |
| DP | 请求和模型副本 | 控制面同步/路由 | 扩展总吞吐 |
| DCP | Decode KV/Attention 上下文 | A2A 或 AG+RS | MLA/长上下文 Decode |
| PCP | Prefill 序列计算 | Context Parallel 通信 | 超长 Prompt Prefill |
| EP | MoE Expert | All-to-All | 切分专家权重与计算 |

## 1. 先画 Rank 坐标

启动前先写出逻辑坐标：

~~~text
node
└─ DP rank
   └─ PP stage
      └─ PCP rank
         └─ TP rank
            └─ DCP group（复用既有 rank）
~~~

EP 往往复用某些并行 Rank 来分布 Expert，而不是简单再乘一个独立进程维度。具体 World Size 以 v0.31 初始化日志为准。

## 2. 设备选择与 Executor

| 参数 | 含义 |
|---|---|
| `--device-ids` | 指定物理 GPU ID/UUID，同时保留完整拓扑可见性 |
| `--distributed-executor-backend` | 选择 multiprocessing、Ray 等执行器 |
| `--worker-cls` | Worker 实现 |
| `--worker-extension-cls` | 动态扩展 Worker |
| `--ray-workers-use-nsight` | 让 Ray Worker 进入 Nsight 分析 |
| `--disable-custom-all-reduce` | 禁用 vLLM 自定义 All-Reduce，回退 NCCL |

设备编号必须和容器可见设备、Kubernetes 分配结果、NCCL Rank 与物理拓扑对应。只看 `CUDA_VISIBLE_DEVICES` 中的逻辑编号不足以判断 GPU-NIC 亲和。

## 3. Tensor Parallel

`--tensor-parallel-size` / `-tp` 决定层内切分数。典型路径：

~~~text
输入激活
→ 各 TP Rank 执行局部 GEMM/Attention
→ Collective 合并局部结果
→ 下一层
~~~

TP 增大：

- 每卡权重减少；
- 单卡 KV Head 布局可能变化；
- 每层通信增多；
- 小 Batch 时通信更难摊薄；
- 跨 PCIe/跨 Socket/跨节点时 TPOT 可能恶化。

正确选择不是“有 8 卡就 TP=8”，而是先找到模型能放下的最小 TP，再比较更大 TP 的吞吐收益是否覆盖通信代价。

## 4. Pipeline Parallel

`--pipeline-parallel-size` / `-pp` 按 Layer 划分 Stage。主要问题：

- Stage 计算不均；
- Pipeline Bubble；
- Microbatch 太少无法填满流水线；
- Stage 间激活传输；
- 某一 Stage 显存或算子成为瓶颈。

PP 适合权重按层切分，但对在线小 Batch 可能不如 TP/DP 直接。应观察每个 Stage 的执行时间和空闲区间。

## 5. Data Parallel

| 参数 | 作用 |
|---|---|
| `--data-parallel-size` / `-dp` | 全局 DP 副本数 |
| `--data-parallel-size-local` | 当前节点承载的本地 DP Rank |
| `--data-parallel-start-rank` | 当前节点的首个全局 DP Rank |
| `--data-parallel-address` | DP 协调地址 |
| `--data-parallel-rpc-port` | DP 控制面端口 |
| `--data-parallel-backend` | 内部或外部负载均衡模式 |
| `--data-parallel-hybrid-lb` | 节点内由 vLLM 调度、节点间由外部 LB 的组合 |

DP 增加的是模型副本。它通常比继续扩大 TP 更适合扩总 QPS，但每个副本都要重新占用权重、KV 和 Graph 显存。

路由策略还会影响 Prefix Cache 命中。完全随机分发会把相同前缀打散到不同副本。

## 6. Decode Context Parallel

`--decode-context-parallel-size` / `-dcp` 将 Decode KV/Attention 上下文分片。v0.31 中 DCP 不直接扩大进程 World Size，而是复用 TP Rank；与 PCP 组合时按支持的轴形成组。

相关参数：

| 参数 | 含义 |
|---|---|
| `--dcp-comm-backend` | `ag_rs` 或 `a2a` 等通信路径 |
| `--dcp-q-replicate` | 复制 MLA Query Projection，减少每步 Query All-Gather |
| `--cp-kv-cache-interleave-size` | KV Token 在 CP Rank 间的交错粒度 |

`cp_kv_cache_interleave_size` 必须与 `block_size` 满足版本要求，例如不能大于 Block，通常还要求可整除。它改变 KV 的物理布局与传输粒度。

DCP 的收益高度依赖模型是否为 MLA、上下文长度、互联带宽和 Decode Batch。

## 7. Prefill Context Parallel

`--prefill-context-parallel-size` / `-pcp` 切分长 Prompt 的 Prefill 计算。与 DCP 不同，PCP 会扩展计算 Rank 轴。

它解决的是单条超长 Prompt Prefill 的计算与显存压力，而不是普通请求总 QPS。代价包括：

- Context Parallel 通信；
- 更多 Rank 协调；
- 小 Prompt 下并行开销无法摊薄；
- 与 TP、DCP 组合后的拓扑约束。

## 8. Expert Parallel

`--enable-expert-parallel` 让 MoE Expert 分布在 EP Rank 上。Token 经 Router 得到 Top-K Expert 后，需要进行 Dispatch 与 Combine：

~~~text
Token
→ Router Top-K
→ All-to-All Dispatch
→ 本地 Expert GEMM
→ All-to-All Combine
→ 恢复 Token 顺序
~~~

相关参数：

- `--all2all-backend`：MoE All-to-All 实现；
- `--expert-placement-strategy`：`linear` 或 `round_robin`；
- Expert TP/Shared Expert 相关配置：取值需按模型和当前帮助确认。

EP 性能不只由总 Token 数决定，还由每个 Expert 的 Token 分布决定。

## 9. EPLB

`--enable-eplb` 开启 Expert Parallel Load Balancer。`--eplb-config` 关键字段：

| 字段 | 含义 |
|---|---|
| `window_size` | 收集多少 Engine Step 的负载 |
| `step_interval` | 隔多少 Step 重平衡 |
| `num_redundant_experts` | 增加多少物理 Expert 副本 |
| `log_balancedness` | 输出 Expert 平衡指标 |
| `use_async` | 异步执行重平衡 |
| `policy` | 重平衡策略 |
| `communicator` | Expert 权重迁移 Backend |

冗余 Expert 会占用 HBM：

~~~text
额外显存
≈ MoE 层数 × 单 Expert 字节 × 冗余 Expert 数 / EP Rank 数
~~~

EPLB 是“用额外权重副本和迁移复杂度换热点均衡”，不是免费优化。

## 10. Dual Batch Overlap

DBO 将 Batch 切成 Microbatch，使计算与通信更好重叠。相关参数：

- `--enable-dbo`；
- `--dbo-decode-token-threshold`；
- `--dbo-prefill-token-threshold`。

低于阈值的请求保持单 Batch，超过阈值才切分。阈值过低会让小请求也承担 Microbatch 调度开销；过高则无法覆盖真实大请求。

## 11. DP 同步与通信后端

`--disable-nccl-for-dp-synchronization` 会让部分 DP 同步使用 Gloo 而不是 NCCL。它不意味着所有模型通信都改用 Gloo。

通信排障必须分清：

~~~text
TP Collective
PP Stage 传输
DP 控制同步
CP Attention 通信
EP All-to-All
EPLB Expert 权重迁移
KV Transfer
~~~

不同通道可能使用不同 Backend、NIC 和端口。

## 12. 拓扑选择

常见优先级：

1. TP Group 尽量放在 NVLink/NVSwitch 域。
2. 跨 Socket 前确认 PCIe Root Complex 与 NUMA。
3. EP All-to-All 需要高双向带宽和低拥塞。
4. 多节点 Rank 绑定到本地 NIC/NUMA。
5. DP 副本可跨较弱互联，但入口负载均衡需感知容量。

不能只通过 `nvidia-smi` 中 GPU 数量判断并行策略。

## 13. 指标与故障

| 现象 | 可能层 |
|---|---|
| TP 增大后 TPOT 变差 | 每层 Collective、跨 NUMA/跨节点 |
| 只有某个 Rank 慢 | GPU 降频、拓扑、NIC、Kernel Shape |
| MoE 吞吐周期性抖动 | Expert 热点、EPLB 重平衡、All-to-All |
| DP 副本冷热不均 | 路由、Prefix Cache、请求长度偏斜 |
| DCP 没收益 | 上下文太短、通信占比高、Backend 不适配 |
| PCP 小请求更慢 | 切分和同步成本无法摊薄 |

## 14. 验收题与答案

**问题：DCP=2 是否一定多创建两倍进程？**

答案：不一定。v0.31 的 DCP 会复用既有 Rank，不直接扩大 World Size；组合 PCP 时应以初始化后的 Rank 组为准。

**问题：为什么 EP Rank 负载仍可能不均？**

答案：模型 Router 对真实流量的 Expert 选择会偏斜，Expert 数量平均分配不等于 Token 负载平均。

## 15. 官方资料

- [Parallelism and Scaling](https://docs.vllm.ai/en/v0.31.0/serving/parallelism_scaling/)
- [Context Parallel Deployment](https://docs.vllm.ai/en/v0.31.0/serving/context_parallel_deployment/)
- [Expert Parallel Deployment](https://docs.vllm.ai/en/v0.31.0/serving/expert_parallel_deployment/)
- [vLLM v0.31.0 Serve CLI](https://docs.vllm.ai/en/v0.31.0/cli/serve/)
