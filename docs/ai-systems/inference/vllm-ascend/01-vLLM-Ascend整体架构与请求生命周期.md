---
title: vLLM-Ascend 整体架构与请求生命周期
sidebar_position: 1
tags: [vLLM-Ascend, Ascend 910B, NPUModelRunner, ACLGraph, HCCL]
description: 从平台插件到 NPUModelRunner，沿一次请求解释 vLLM-Ascend 如何复用 vLLM 控制面并替换昇腾执行面。
---

# vLLM-Ascend 整体架构与请求生命周期

学习 vLLM-Ascend 最容易走向两个极端：

- 认为它与 vLLM 完全一样，只是设备换成 NPU；
- 认为它是另一套完全独立的推理引擎，upstream vLLM 知识全部失效。

正确模型处在两者之间：**vLLM-Ascend 是 vLLM 的 out-of-tree 硬件平台插件。它复用上层控制面，但为昇腾实现完整的设备执行面。**

## 1. 两个仓库，一条运行链路

```text
upstream vLLM repository
  ├─ OpenAI API / Input Processing
  ├─ EngineCore / Request State
  ├─ Scheduler / KV Cache Manager
  ├─ Config / Metrics / Distributed abstraction
  └─ Plugin interfaces
              ↓ Python entry point
vLLM-Ascend repository
  ├─ NPUPlatform
  ├─ NPU Executor / Worker
  ├─ NPUModelRunner
  ├─ Ascend Attention Backend
  ├─ ACLGraph / Npugraph_ex
  ├─ Ascend Custom Ops / Quantization
  └─ HCCL communication integration
              ↓
torch_npu → CANN → HCCL → Ascend 910B
```

安装 `vllm-ascend` 后，包通过 Python `entry_points` 注册平台插件。upstream vLLM 在启动时发现 Ascend 平台并调用插件实现，而不是在主仓库中到处编写 `if device == npu`。

## 2. 共同控制面与分叉执行面

### 2.1 主要复用的部分

- OpenAI-compatible API；
- Prompt、Chat Template、Tokenizer 与 Sampling 参数；
- V1 EngineCore 请求状态；
- Scheduler 的基本 Token Budget 思路；
- KV Cache Block 的逻辑管理框架；
- Continuous Batching、Prefix Cache 等上层能力；
- TP/DP/PP/EP 的配置抽象；
- TTFT、TPOT、E2E、吞吐等服务指标定义。

### 2.2 必须适配的部分

- 设备发现、设备名和环境检查；
- Worker/ModelRunner；
- Tensor、Stream、Event 与内存 API；
- Attention Backend 和 KV Cache 物理布局；
- 权重加载、量化和自定义算子；
- Graph 编译、捕获与回放；
- HCCL 集合通信；
- NPU Profiling、Dump 与调试工具；
- 特定模型和特性的支持矩阵。

所以同一个 `vllm serve` 参数可能在两边进入相同 Config，但最后由不同平台逻辑解释和落地。

## 3. 启动入口为什么看起来相同

```bash
vllm serve /models/Qwen \
  --served-model-name qwen-prod \
  --tensor-parallel-size 4 \
  --gpu-memory-utilization 0.9
```

即使在 NPU 上仍然看到 `gpu_memory_utilization`、`cudagraph_mode` 等通用名称。这是 upstream 公共 Config 的历史和兼容接口，不代表底层使用 CUDA。插件会在平台检查和配置更新阶段将公共参数映射到 Ascend 行为。

判断实际执行面要看：

- 启动日志识别出的 Platform；
- `vllm-ascend` 插件版本；
- NPU Worker/ModelRunner；
- Attention Backend；
- ACLGraph/Npugraph_ex 模式；
- CANN/HCCL 日志；
- NPU Timeline。

## 4. 启动生命周期

```text
CLI parse
  ↓
构造 VllmConfig
  ↓
加载平台插件 → NPUPlatform
  ↓
校验/修正设备相关 Config
  ↓
启动 API Server 与 EngineCore
  ↓
创建 Executor / NPU Worker
  ↓
初始化 torch_npu、NPU Device、HCCL Rank
  ↓
创建 NPUModelRunner
  ↓
加载/切分/量化权重
  ↓
Profile HBM 与创建 KV Cache
  ↓
编译、Warmup、ACLGraph Capture
  ↓
服务 Ready
```

这里有三个版本边界：

1. **服务层**：upstream vLLM 与 vLLM-Ascend 是否对齐；
2. **框架层**：PyTorch 与 torch-npu 是否匹配；
3. **设备层**：torch-npu、CANN、驱动和固件是否匹配。

版本号“看起来接近”不够，必须来自官方兼容矩阵中的同一行。

## 5. NPUPlatform 的职责

Platform 是 upstream 引擎理解硬件的入口。NPUPlatform 通常需要回答：

- 当前设备类型和可用设备是什么；
- 使用哪个 Worker/Executor；
- 支持哪些 dtype、Quantization 和 Attention Backend；
- 默认 Block Size、Device Name 与通信 Backend；
- 编译与 Graph Config 怎样更新；
- 哪些功能组合需要拒绝、降级或回退；
- 如何查询 HBM、Capability 和环境信息。

Platform 本身不负责执行每一层模型。它负责选择和约束正确的执行路径。

## 6. 一句话进入服务后的共同路径

用户请求：

```json
{
  "model": "qwen-prod",
  "messages": [{"role": "user", "content": "请解释 HCCL"}],
  "max_tokens": 128,
  "stream": true
}
```

在进入设备前，请求通常仍经过 upstream 路径：

```text
HTTP request
→ OpenAI protocol validation
→ Chat Template
→ Tokenization
→ SamplingParams
→ EngineCoreRequest
→ EngineCore input queue
→ Scheduler
```

因此这些问题与 NVIDIA 路径的定位方法基本相同：

- Chat Template 不正确；
- Prompt Token 数超限；
- Sampling 参数无效；
- API Server CPU 饱和；
- Waiting Queue 过长；
- Scheduler Token Budget 不合理。

## 7. Scheduler 怎样决定本轮工作

Scheduler 维护 Waiting/Running 请求和 KV Cache Block。每轮需要决定：

- 哪些新请求执行 Prefill；
- 哪些运行请求执行 Decode；
- 长 Prefill 是否分块；
- 每轮 Token 总量；
- 哪些请求需要抢占、重算或恢复；
- Prefix Cache 是否能复用；
- 当前 KV Block 是否足够。

它输出 `SchedulerOutput`，描述本轮需要执行的请求和缓存变化。到这里仍属于共同控制面，但配置的安全区不能从 NVIDIA 直接复制，因为 NPU Kernel、图模式、Workspace、HBM 和 HCCL 成本不同。

## 8. 第一次核心分叉：NPU Worker

Executor 将 SchedulerOutput 送到各 Worker。昇腾路径中的 NPU Worker 负责：

- 选择并设置 NPU Device；
- 初始化分布式进程组和 HCCL；
- 管理 Worker/Rank 生命周期；
- 创建 NPUModelRunner；
- 加载模型并创建 KV Cache；
- 执行 Profile、Warmup、Graph Capture；
- 接收每轮执行计划并返回采样结果。

故障映射：

| 现象 | 优先检查 |
|---|---|
| 某 Rank 启动失败 | Device 可见性、Rank、HCCL、容器设备挂载 |
| 所有 Rank 等待 | 首个失败 Rank、Rendezvous、网卡/IP、端口 |
| 权重后 OOM | HBM 预算、Graph/Workspace、KV Cache、量化格式 |
| 单 Rank 长期慢 | CPU/NUMA、NPU 健康、HCCL 链路、输入 Shape |

## 9. NPUModelRunner 的职责

NPUModelRunner 是设备热路径的组织者。它不是一个单独的算子，而是连接调度结果、设备 Tensor、模型前向和输出的执行框架。

主要职责包括：

1. 将 SchedulerOutput 转成 NPU Input Batch；
2. 准备 Token、Position、Slot Mapping 和 Attention Metadata；
3. 更新 Graph Replay 所需运行时 Buffer；
4. 调用 Ascend 模型实现和 Attention Backend；
5. 组织 TP/EP 通信；
6. 处理 Logits、Sampling 和 Speculative Decoding；
7. 将结果转换回 upstream 能理解的输出。

概念数据流：

```text
SchedulerOutput
  ↓
NPUInputBatch / request states
  ↓
input_ids / positions / slot_mapping / attention metadata
  ↓
ACLGraph Replay 或 Eager Forward
  ↓
Ascend Attention + CANN Ops + HCCL
  ↓
logits / sampled token ids
  ↓
ModelRunnerOutput
```

## 10. 输入准备为什么可能成为瓶颈

设备只执行 Tensor。Scheduler 输出仍包含动态请求信息，ModelRunner 需要：

- 合并不同长度请求；
- 计算 Query 起止位置；
- 建立 KV Block/Slot 映射；
- Padding 到 Kernel 或 Graph 支持的 Shape；
- 把 Metadata 放到 NPU；
- 同步 Graph 使用的固定 Buffer。

因此 `NPU 利用率 30%` 可能不是 NPU 算力不足，而是每轮执行前 CPU 准备过久。证据是 Timeline 中 NPU Kernel 短、Kernel 之间空洞大，同时 Worker CPU 或 H2D/同步明显。

## 11. Attention Backend

逻辑上 Attention 仍然计算：

```text
Q = XWq
K = XWk
V = XWv
Attention(Q, K_cache, V_cache)
```

物理执行却与 CUDA 路径不同：

- KV Cache Tensor 布局和 Block Size；
- Prefill/Decode Kernel；
- Paged Attention Metadata；
- MLA、GQA、MHA 等模型结构；
- CANN/ACLNN 或自定义融合算子；
- Shape、dtype、量化和硬件代际约束。

功能是否可用要查 vLLM-Ascend Feature Matrix 与具体模型教程。不能只因为 upstream vLLM 支持某功能，就推定 910B 路径也支持同一组合。

## 12. ACLGraph 与 Npugraph_ex

### 12.1 三个概念

- **Eager**：每轮按普通执行方式发起算子，动态性强，便于定位问题；
- **Npugraph_ex/编译优化**：在图编译阶段对 FX Graph 做融合与变换；
- **ACLGraph**：捕获一段设备执行并在运行时 Replay，减少 CPU Launch 开销。

它们不是同一个层级。常见路径是先完成编译变换，再由 ACLGraph 捕获并回放。

### 12.2 `cudagraph_mode` 名称为什么还存在

该字段来自 upstream 通用 CompilationConfig。Ascend 插件解释它并选择自己的图执行路径。排障时应该记录最终有效模式，而不是只看命令行字符串。

### 12.3 Graph 的代价

- 启动捕获时间；
- 固定 Shape/Capture Size 集合；
- 额外 Workspace/HBM；
- 某些动态功能不兼容；
- 未命中 Shape 回退 Eager；
- 升级后重新编译或重新捕获。

Graph 是否更快要看 Replay 覆盖率和真实 Batch 分布。捕获大量几乎不出现的 Batch Size 只会增加启动与内存成本。

## 13. KV Cache 的逻辑相同与物理不同

### 共同逻辑

- 每个 Token 需要保存各层 K/V；
- Block/页实现离散分配；
- 上下文和并发争夺缓存；
- Prefix Cache 可以复用公共前缀；
- 缓存不足会限制并发或触发抢占/重算。

### Ascend 物理差异

- NPU Tensor 与内存分配器；
- Attention Kernel 需要的布局和对齐；
- Graph 固定 Buffer；
- 量化 KV 和 Scale；
- `enable_kv_nz` 等插件优化；
- HBM 预留和算子 Workspace。

因此同一模型、相同 `gpu_memory_utilization=0.9`，两类硬件得到的 KV Block 数和稳定并发都可能不同。

## 14. 权重、模型和量化

BF16/FP16 Hugging Face 权重通常具有较高的逻辑可移植性，但仍需要 Ascend 模型实现和算子支持。量化制品更不能默认互换：

- 量化方法和 Scale 布局；
- 权重 Packing；
- Kernel 期望格式；
- 模型架构和 TP 分片；
- 转换工具版本；
- 精度校准数据。

Ascend 常见启动会使用 `--quantization ascend`，但这不是一个通用格式转换器。制品必须与模型教程和支持矩阵匹配。

## 15. TP、EP 与 HCCL

数学上的 TP/EP 概念可以复用，设备通信实现不同：

```text
NVIDIA: NCCL + NVLink/PCIe/RDMA
Ascend:  HCCL + HCCS/PCIe/RoCE（依硬件拓扑）
```

每层计算时间可近似为：

```text
T_step = max(T_compute_rank_i) + T_collective + T_sync + T_bubble
```

一个 Rank 变慢会通过集合通信放大到整个实例。多卡低利用率且所有 Rank 同步出现空洞时，应检查慢 Rank、HCCL 和 CPU 输入准备，而不是只增加 Batch。

同一个 TP Group 不能混用 NVIDIA GPU 和 Ascend NPU。双资源池只能在服务/网关层路由请求。

## 16. Sampling 后怎样回到共同路径

NPUModelRunner 得到 Token ID 后，会转换为 upstream 预期的 ModelRunnerOutput。EngineCore 更新请求状态、停止条件与 KV 资源，OutputProcessor/Detokenizer 将 Token 转成文本，API Server 输出 SSE。

```text
NPU sampled token ids
→ upstream request state
→ stop/length/abort check
→ detokenize
→ OpenAI-compatible response
```

这也是两种硬件后端能够保持相似客户端接口的原因。但相似接口不保证工具调用、Logprobs、结构化输出、Speculative Decoding 和量化功能完全一致。

## 17. 参数分为三层

| 层 | 示例 | 来源 |
|---|---|---|
| upstream 通用参数 | `max-model-len`、`max-num-seqs`、`tensor-parallel-size` | vLLM CLI/Config |
| Ascend Additional Config | `enable_cpu_binding`、`ascend_compilation_config`、`enable_flashcomm1` | `--additional-config` |
| 系统/运行时环境 | `ASCEND_RT_VISIBLE_DEVICES`、HCCL、CANN、内存分配器 | 昇腾运行环境 |

三层都影响结果。只保存 `vllm serve` 命令而不保存环境变量和版本矩阵，无法复现实例。完整参数释义见[生产参数参考](./02-vLLM-Ascend生产参数参考.md)。

## 18. 指标到组件映射

| 指标/现象 | 可能组件 |
|---|---|
| Queue Time | 网关、API Server、EngineCore、Scheduler 容量 |
| Tokenize Time | Tokenizer、Chat Template、CPU/NUMA |
| TTFT | Queue + Tokenize + Prefill + HCCL + 返回路径 |
| TPOT | Decode Batch、ACLGraph、Attention、HCCL、慢 Rank |
| HBM 使用 | 权重、KV、Graph、Workspace、通信 Buffer |
| NPU 利用率 | Batch、Kernel、Graph、CPU 空洞、同步等待 |
| Prefix 命中 | 输入共享分布、Cache 配置、淘汰 |
| Preemption | KV 预算、上下文/输出长度、调度参数 |

## 19. 典型故障：TTFT 高但 NPU 利用率低

按顺序验证：

1. **接入层**：请求是否在网关或 API Server 排队。
2. **Tokenizer**：长 Prompt、模板和 CPU 是否耗时。
3. **Scheduler**：Waiting 是否增长，`max_num_batched_tokens` 是否过小。
4. **输入准备**：Worker CPU 是否在每轮构造 Metadata。
5. **Graph**：实际是否 Replay，是否因 Shape/功能回退 Eager。
6. **Kernel**：算子是否过碎、Shape 是否低效。
7. **HCCL**：是否等待慢 Rank 或网络。
8. **返回路径**：Detokenize、SSE 和代理是否 Buffer。

每次只改变一个变量，并同时记录 TTFT/TPOT/E2E、Token 分布、NPU Timeline、CPU、HBM、KV、Graph 和 HCCL。

## 20. 源码阅读路线

| 顺序 | 入口 | 关注点 |
|---|---|---|
| 1 | vLLM-Ascend `setup.py` | 平台与 General Plugin 如何注册 |
| 2 | `vllm_ascend/platform.py` | NPUPlatform 如何选择 Worker 和更新 Config |
| 3 | `vllm_ascend/worker/` | Worker 生命周期、设备与分布式初始化 |
| 4 | `vllm_ascend/worker/model_runner_v1.py` | SchedulerOutput 怎样变成 NPU 执行输入 |
| 5 | `vllm_ascend/attention/` | Attention Backend、Metadata 和 KV 布局 |
| 6 | Graph/Compilation 相关目录 | Npugraph_ex 与 ACLGraph |
| 7 | `vllm_ascend/distributed/` | HCCL 与 Ascend 通信优化 |
| 8 | `vllm_ascend/quantization/` | Ascend 量化方法和算子 |

阅读时要与 upstream 的 EngineCore、Scheduler、Worker 接口对照，关注插件覆盖了什么，而不是试图从插件仓库寻找完整 API Server。

## 21. 生产检查清单

```text
[ ] 驱动/固件/CANN/PyTorch/torch-npu/vLLM/vLLM-Ascend 来自兼容矩阵
[ ] 固定镜像 Digest、模型 Revision、Tokenizer 与量化制品
[ ] Feature Matrix 支持目标模型、硬件和功能组合
[ ] 启动日志确认 NPU Platform、Attention Backend 与 Graph 模式
[ ] 保存所有 upstream、additional-config 和环境变量
[ ] 单请求非流式/流式/停止条件/工具调用验收
[ ] Eager 与 Graph 完成精度和性能对比
[ ] 短/长/共享前缀/高并发容量曲线完成
[ ] 各 HCCL Rank 无持续慢 Rank
[ ] TTFT/TPOT/E2E P95/P99 与错误率满足 SLO
[ ] OOM、Worker 退出、网络异常和滚动升级已演练
```

## 22. 总结

一句请求的完整路径是：

```text
upstream API/Tokenizer
→ EngineCore/Scheduler
→ vLLM-Ascend NPU Worker
→ NPUModelRunner
→ Ascend Attention/ACLGraph/CANN/HCCL
→ sampled token
→ upstream OutputProcessor/API
```

上半段决定“本轮让哪些请求算什么”，下半段决定“怎样在 910B 上高效地算”。性能排查必须先确定问题位于共同控制面还是 NPU 执行面，再进入对应工具和参数。

## 官方资料与源码

- [vLLM-Ascend 官方文档](https://docs.vllm.ai/projects/ascend/en/latest/)
- [Feature Matrix](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/feature_matrix.html)
- [Graph Mode](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/feature_guide/graph_mode.html)
- [Additional Configuration](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/configuration/additional_config.html)
- [Platform 源码](https://github.com/vllm-project/vllm-ascend/blob/main/vllm_ascend/platform.py)
- [NPUModelRunner 源码](https://github.com/vllm-project/vllm-ascend/blob/main/vllm_ascend/worker/model_runner_v1.py)
- [Attention 源码](https://github.com/vllm-project/vllm-ascend/tree/main/vllm_ascend/attention)
- [Distributed 源码](https://github.com/vllm-project/vllm-ascend/tree/main/vllm_ascend/distributed)
