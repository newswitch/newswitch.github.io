---
title: "vLLM 与大模型推理学习路线"
sidebar_position: 0
tags: [vLLM, LLM, 推理, KV Cache, PagedAttention, 学习路线]
description: "从 Transformer 推理、Prefill/Decode、KV Cache 和调度开始，系统学习 vLLM 架构、并行部署、性能分析与生产运维。"
---

# vLLM 与大模型推理学习路线

vLLM 不只是一个“启动大模型的命令行工具”。要真正部署、调优和排障，需要同时理解：

```text
HTTP / SSE 协议
→ Chat Template 与 Tokenization
→ Scheduler 与 Continuous Batching
→ Prefill / Decode
→ KV Cache / PagedAttention / Prefix Cache
→ CUDA Kernel
→ TP / PP / DP / EP
→ NCCL / NVLink / RDMA
→ Gateway / 路由 / 限流 / 扩缩容
→ 指标 / SLO / 发布 / 故障恢复
```

本模块分成两条学习线：

1. **源码线**：理解 vLLM 内部对象和算法如何实现。
2. **生产线**：理解请求路径、资源模型、部署架构、性能和可靠性。

---

## 1. 版本说明

原有六篇源码笔记基于 **vLLM 0.6.3**，主要描述 V0 架构：

- `LLMEngine`
- 旧 Scheduler 队列。
- `BlockSpaceManager`
- GPU/CPU KV Cache Swap。
- `PrefixCachingBlockAllocator`

这些文章适合学习设计思想和历史实现，但不能把所有类名、默认值和执行流程直接套到
当前 V1。

V1 源码主线固定以 **vLLM v0.23.0** 为阅读基线，并在文章末尾链接对应 tag 的源码。
这可以避免 `main` 分支开发中的目录和类名变化影响学习。工程概念仍尽量使用稳定边界；阅读其他
版本时，先比较 Release Note 和实际源码，再更新调用链。执行实验前仍要：

```bash
vllm --version
vllm serve --help
```

并固定镜像 Digest、模型 Revision、驱动和 CUDA 版本。

---

## 2. 学习前置

### 必须具备

- Python 和 PyTorch 基础。
- Transformer 自回归生成流程。
- GPU、HBM、PCIe、NVLink 基础。
- Kubernetes Deployment、Service、Probe 和 GPU 调度。
- Prometheus Counter、Gauge、Histogram。

### 推荐先读

- [GPU 基础知识](../../../gpu/fundamentals/01-GPU基础知识：从计算核心到显存.md)
- [HBM 显存原理](../../../gpu/memory/01-HBM显存原理：容量、带宽与访问效率.md)
- [CPU 与 GPU 之间的数据搬运](../../../gpu/pcie-numa/05-CPU与GPU之间的数据搬运.md)
- [NVLink 与 NVSwitch](../../../gpu/nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
- [Kubernetes 部署 vLLM](../serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)

---

## 3. 第一阶段：建立 V1 组件与源码主线

目标：不从大段代码开始，而是用“一句话如何完成推理”串起进程、组件、数据对象和 Engine Step。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 01 | [vLLM V1 整体架构与组件职责](./01-vLLM-V1整体架构与组件职责.md) | 能画出 API Server、EngineCore、GPU Worker 及组件边界 |
| 02 | [执行 vllm serve 后发生了什么](./02-vllm-serve启动与初始化全流程.md) | 能解释权重加载、显存探测、KV Cache 与 CUDA Graph 初始化 |
| 03 | [一句话如何变成 EngineCoreRequest](./03-一句话如何变成EngineCoreRequest.md) | 能追踪 JSON、Chat Template、Token ID 和请求对象变化 |
| 04 | [EngineCore 主循环与请求状态机](./04-EngineCore主循环与请求状态机.md) | 能解释 Schedule、Execute、Update 和统一 Token 调度 |
| 05 | [KVCacheManager、BlockPool 与 Prefix Cache](./05-KVCacheManager-BlockPool与PrefixCache.md) | 能解释命中、Block 分配、释放、缓存与抢占 |
| 06 | [Executor、Worker 与 GPUModelRunner](./06-Executor-Worker与GPUModelRunner.md) | 能追踪 SchedulerOutput 如何跨进程和 rank 变成 GPU 执行 |
| 07 | [Model、Attention Backend 与 Sampling](./12-Model-AttentionBackend与Sampling.md) | 能解释模型前向、KV 写入、Attention Backend、Logits 与采样 |
| 08 | [OutputProcessor、Detokenizer 与流式返回](./13-OutputProcessor-Detokenizer与流式返回.md) | 能解释 token 到增量文本、SSE、取消和资源释放 |

这八篇是源码主线。学习时以组件接口、状态变化和一次请求为主，不需要先背诵大段实现代码。

### 硬件平台分叉阅读

完成上述共同控制面后，再学习硬件执行面：

| 文章 | 学习成果 |
| --- | --- |
| [昇腾 910B 的 vLLM-Ascend 与原生 vLLM 有什么区别](./24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md) | 能从 Platform Plugin、NPU Worker、Attention、ACLGraph、HCCL 和 CANN 解释一次请求在何处与 CUDA 路径分叉 |
| [vLLM Serve 生产参数参考](./25-vLLM-Serve生产参数参考.md) | 能将服务、模型、显存、调度、并行、编译和请求参数映射到组件、资源预算与 SLO |

这篇文章不是重复部署步骤，而是将已有 V1 源码主线映射到昇腾 910B 执行面。阅读后应能判断一个问题属于共同的 API/EngineCore/Scheduler 层，还是属于 vLLM-Ascend、torch_npu、CANN、ACLGraph 或 HCCL 层。

---

## 4. 第二阶段：一次推理到底发生了什么

目标：能从 HTTP 请求一直讲到首 token 和流式结束。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 01 | [推理请求从 HTTP 到首个 Token 的完整生命周期](./07-推理请求从HTTP到首个Token的完整生命周期.md) | 能画出 Gateway、API Server、EngineCore、Worker、GPU 和 SSE 路径 |
| 02 | [Prefill、Decode 与 KV Cache 资源模型](./08-Prefill-Decode与KV-Cache资源模型.md) | 能解释 TTFT、TPOT、显存和吞吐的来源 |
| 03 | [Continuous Batching 与 Chunked Prefill](./09-Continuous-Batching与Chunked-Prefill.md) | 能解释调度预算、长短请求干扰和尾延迟 |

完成后应能回答：

- 为什么长 Prompt 主要影响 TTFT？
- 为什么 Decode 常常受显存带宽限制？
- 为什么 HTTP 200 不代表流式请求完成？
- 为什么 KV Cache 满不等于 CUDA OOM？
- 为什么大 Prefill 会影响正在 Decode 的请求？

---

## 5. V0 历史源码笔记

下面是原有 V0 源码笔记，放在完成 V1 主线之后作为历史对照阅读：

| 顺序 | 文章 | 版本定位 |
| --- | --- | --- |
| 01 | [整体代码架构](./vLLM学习笔记（一）整体代码架构.md) | V0 `LLMEngine` 与 Worker |
| 02 | [调度前的预处理工作](./vLLM学习笔记（二）vLLM调度前的预处理工作.md) | V0 输入处理与请求对象 |
| 03 | [调度器策略](./vLLM学习笔记（三）vLLM调度器策略.md) | V0 Scheduler |
| 04 | [BlockSpaceManager](./vLLM学习笔记（四）BlockSpaceManager.md) | V0 KV Block 管理 |
| 05 | [PrefixCachingBlockAllocator](./vLLM学习笔记（五）PrefixCachingBlockAllocator.md) | V0 Prefix Cache 实现 |
| 06 | [参数使用](./vLLM学习笔记（六）参数使用.md) | 旧版本参数，需要与当前 CLI 核对 |

### V1 源码阅读入口

```text
OpenAI API Server
→ AsyncLLM / EngineClient
→ EngineCore
→ Scheduler
→ KVCacheManager
→ ModelExecutor
→ Worker / ModelRunner
→ Attention Backend / CUDA Kernel
→ OutputProcessor
```

源码阅读不要从整个仓库第一行开始。先用一次请求建立调用链，再对照指标和日志定位对象。

---

## 6. 第三阶段：显存与缓存

需要掌握：

- 模型权重。
- CUDA Context。
- 激活值和临时 Workspace。
- KV Cache。
- CUDA Graph。
- NCCL Buffer。
- Prefix Cache。
- KV Cache quantization。

已有文章：

- [vLLM GPU 显存组成与容量规划](../serving/02-vLLM%20GPU%20显存组成与容量规划.md)
- [CUDA OOM 排查与优化](../../../gpu/cluster/troubleshooting/05-CUDA%20OOM%20排查与优化.md)

本模块已经在 [KVCacheManager、BlockPool 与 Prefix Cache](./05-KVCacheManager-BlockPool与PrefixCache.md)
中补齐 Automatic Prefix Caching 的哈希、Block、缓存和回收主线。KV Cache Offload、外部
KV Connector 及 Prefill/Decode 分离属于进阶架构；采用前需要结合所用 vLLM 版本和实际存储、
网络链路单独验证。

---

## 7. 第四阶段：并行推理

| 策略 | 解决问题 |
| --- | --- |
| TP | 单卡放不下模型，按层内张量切分 |
| PP | 按层切成多个流水线 Stage |
| DP | 复制模型，独立处理不同请求批次 |
| EP | MoE Expert 分布到不同设备 |
| DP Attention | Attention 复制/分组，Expert 使用 EP |

学习文章：

- [TP、PP、DP、EP 与 MoE 推理并行策略](./10-TP-PP-DP-EP与MoE推理并行策略.md)
- [vLLM Tensor Parallel 多卡部署](../serving/03-vLLM%20Tensor%20Parallel%20多卡部署.md)
- [NCCL 通信原理](../../training/distributed/05-NCCL%20通信原理与常见问题.md)
- [多机训练的完整路径](../../../projects/ai-infra-end-to-end/04-多机训练的完整路径.md)

---

## 8. 第五阶段：生产服务

| 文章 | 技术重点 |
| --- | --- |
| [推理网关、准入控制与过载保护](./11-推理网关准入控制与过载保护.md) | 队列、并发、Token 预算、超时、限流、负载感知路由 |
| [大模型推理服务性能指标](../serving/06-大模型推理服务性能指标设计.md) | TTFT、TPOT、E2E、waiting、KV Cache |
| [探针设计](../serving/04-大模型服务%20Kubernetes%20探针设计.md) | startup/readiness/liveness |
| [滚动升级与优雅退出](../serving/05-大模型推理服务滚动升级与优雅退出.md) | 摘流、Drain、SSE、回滚 |
| [LLM 服务 SLI/SLO](../../../sre/reliability/01-LLM服务SLI-SLO-SLA工程化.md) | 可用性、流式完成、延迟 SLO |

---

## 9. 第六阶段：性能分析与源码归因

目标：不仅知道指标异常，还能把异常映射到 Gateway、Tokenizer、EngineCore、KV、
GPUModelRunner、Kernel、NCCL 或输出层。

| 顺序 | 文章 | 能解决的问题 |
| --- | --- | --- |
| 01 | [vLLM 性能分析总论](./14-vLLM性能分析总论-TTFT-TPOT-吞吐与GPU利用率.md) | 建立 TTFT、TPOT、吞吐、GPU 利用率与饱和点模型 |
| 02 | [TTFT 超标但 GPU 利用率低](./15-TTFT超标但GPU利用率低完整排查案例.md) | 对 GPU 30%、TTFT 超标做端到端证据排查 |
| 03 | [指标到 V1 组件与源码映射](./16-vLLM指标到V1组件与源码映射.md) | 从 Dashboard 快速找到组件、状态和源码入口 |
| 04 | [CPU、Tokenizer 与 EngineCore 饥饿](./17-CPU-Tokenizer与EngineCore饥饿分析.md) | 识别 CPU 单核、事件循环、Throttle 与 GPU 空洞 |
| 05 | [Scheduler、Batch、KV Cache 与抢占实验](./18-Scheduler-Batch-KVCache与抢占性能实验.md) | 用控制变量确定调度参数的 SLO 安全区 |
| 06 | [GPUModelRunner、CUDA Graph 与 Kernel 空洞](./19-GPUModelRunner-CUDAGraph与Kernel空洞分析.md) | 用 CPU-GPU Timeline 区分上游饥饿和 Kernel 瓶颈 |
| 07 | [TP 慢 Rank、NVLink 与 NCCL 排障](./20-TP慢Rank-NVLink与NCCL推理故障排查.md) | 定位多卡慢 rank、链路、拓扑与 collective 问题 |

一次调优必须固定模型 Revision、镜像、硬件、并行策略、真实输入/输出 Token 联合分布、
到达模型、Prefix 命中和 Scheduler 参数。结果同时比较 TTFT/TPOT/E2E P50/P95/P99、
Prompt/Generation tokens/s、错误与流式完成、资源余量和 token 成本。

---

## 10. 第七阶段：容量规划与生产故障

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 01 | [按真实 Token 分布完成单副本容量规划](./21-按真实Token分布完成单副本容量规划.md) | 从权重、KV、计算、CPU 与 SLO 得到单副本安全容量 |
| 02 | [多副本、N-1、冷启动与扩缩容容量规划](./22-多副本-N-1-冷启动与扩缩容容量规划.md) | 把单副本容量扩展到故障域、发布、冷缓存与自动扩缩容 |
| 03 | [vLLM 生产故障排查 Runbook](./23-vLLM生产故障排查Runbook.md) | 能在 5/15/60 分钟内完成分流、缓解、取证和恢复验证 |

容量以满足 SLO 的安全工作率为准，不以最大无错误 QPS 或显存装满为准。生产故障结束条件
也不只是“重启恢复”，还要恢复流式完成、尾延迟、N-1 余量并形成可复验根因。

---

## 11. 建议实验

### 实验 A：请求生命周期

1. 启动单卡小模型。
2. 分别发送流式和非流式请求。
3. 为 Gateway、API Server 和 Engine 加 Trace。
4. 标注排队、Prefill、首 token、Decode 和完成时间。

### 实验 B：长短请求干扰

1. 固定短请求流量。
2. 注入一个长 Prompt。
3. 对比启用和调整 Chunked Prefill 前后的 TTFT/ITL。

### 实验 C：KV Cache

1. 逐步增加并发和上下文。
2. 观察 KV Cache、waiting、preemption 和错误。
3. 重复相同 System Prompt，验证 Prefix Cache 命中。

### 实验 D：并行策略

在相同 8 GPU 节点对比：

```text
TP=8
TP=4, PP=2
TP=2, DP=4
```

记录显存、通信、吞吐和尾延迟，而不是只判断“能否启动”。

---

## 12. 模块验收

- [ ] 能画出一次流式请求的端到端路径。
- [ ] 能解释 TTFT、TPOT、E2E 分别由哪些阶段组成。
- [ ] 能估算权重和 KV Cache 显存。
- [ ] 能解释 PagedAttention 和 Prefix Cache 的作用。
- [ ] 能说明 Continuous Batching 如何提高吞吐。
- [ ] 能判断何时选择 TP、PP、DP 或 EP。
- [ ] 能设计有界队列、准入控制、超时和过载降级。
- [ ] 能建立以 waiting、TTFT、KV Cache 为核心的看板。
- [ ] 能完成压测、发布、回滚和故障注入。
- [ ] 能回答 GPU 利用率 30% 但 TTFT 超标可能在哪一层，并用时间戳和 Timeline 证明。
- [ ] 能按真实 Token 联合分布计算单副本容量，并覆盖 N-1 与冷启动。
- [ ] 能把一次异常从指标映射到 V1 组件、源码入口和可逆缓解动作。

## 13. 官方资料

- [vLLM V1 User Guide](https://docs.vllm.ai/en/latest/getting_started/v1_user_guide.html)
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)
- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)

官方文档和 CLI 是版本事实来源；本系列负责把零散参数和组件串成可理解、可验证的
工程路径。
