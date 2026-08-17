---
title: MindIE 整体架构与请求生命周期
sidebar_label: "01. MindIE 整体架构与请求生命周期"
sidebar_position: 1
tags: [MindIE, MindIE LLM, ATB Models, Scheduler, Ascend 910B]
description: 沿一次 OpenAI 请求解释 MindIE Server、LLM Manager、Text Generator、Modeling、CANN 与 910B 的职责和运行过程。
---

# MindIE 整体架构与请求生命周期

MindIE 经常与“昇腾推理软件”画上等号，但真实系统不止一个进程或一层库。要理解请求为什么慢、配置为什么冲突、模型为什么无法加载，必须先分清服务、调度、生成、模型和硬件运行时。

本文以 MindIE 2.3.0 官方架构为基线，沿一个请求建立可以用于部署和故障排查的组件地图。官方未公开的内部实现细节不会被写成源码事实；这类问题通过配置、日志、指标、Dump 和 Timeline 验证。

## 1. MindIE 在昇腾软件栈中的位置

```text
业务客户端 / 推理网关
        ↓
MindIE Service / Server / EndPoint
        ↓
MindIE LLM
  ├─ LLM Manager
  ├─ Text Generator
  └─ Modeling
        ↓
ATB / MindSpore / torch-npu（依后端与模型路径）
        ↓
CANN / HCCL
        ↓
Ascend 910B / HBM / HCCS / RoCE
```

### 容易混淆的产品边界

| 名称 | 主要定位 |
|---|---|
| MindIE Server/Service | 服务接入、API、网络、安全、连接、超时、管理和指标 |
| MindIE LLM | 大模型请求调度、KV Cache、模型执行、采样和结果返回 |
| MindIE Motor | 集群部署、推理解耦、路由和大规模服务编排相关能力 |
| ATB Models | 基于 Ascend Transformer Boost 的模型和高性能算子路径 |
| CANN | 昇腾设备运行时、算子、编译和工具链 |
| HCCL | 昇腾多卡/多机集合通信 |

MindIE 和 vLLM-Ascend 都可以运行在 910B 上，但它们的控制面、调度器、配置、模型实现和发布体系不同。

## 2. 官方四层架构

MindIE LLM 官方将系统分成四层：

```text
Server
  ↓
LLM Manager
  ↓
Text Generator
  ↓
Modeling
```

### 2.1 Server

Server 对外暴露推理服务。EndPoint 负责 RESTful API、协议与服务能力，可提供 OpenAI、vLLM-compatible 及其他兼容接口。

它关心：

- 服务 IP、管理 IP、端口和指标端口；
- HTTP/HTTPS、证书和安全边界；
- 请求体、JSON 深度和最大连接数；
- Token/E2E 超时；
- 模型名和请求协议适配；
- 流式返回和错误码。

Server 接受了 1000 个连接，不等于后端可以同时 Decode 1000 条序列。接入并发和模型 Batch 是两层不同的预算。

### 2.2 LLM Manager

LLM Manager 负责状态、调度、KV Cache 和跨设备执行协调。官方组件包括：

| 组件 | 责任 |
|---|---|
| LLM Manager Interface | 对外提供推理引擎接口 |
| Engine | 连接 Scheduler 与 Executor，组织请求执行 |
| Scheduler | 在 Prefill/Decode 阶段选择和批处理请求 |
| Block Manager | 管理 DP 域中的 KV Cache 资源和位置 |
| Executor | 将调度结果发送给 Text Generator，协调跨 Server/Device 任务 |

这层回答“哪些请求在本轮运行、使用哪些 KV 资源、发给哪些设备”。

### 2.3 Text Generator

Text Generator 负责真正的自回归生成流程：

| 组件 | 责任 |
|---|---|
| Preprocess | 将调度任务转换为模型输入 |
| Generator | 模型执行过程的统一抽象 |
| Sampler | 从 Logits 选 Token、检查停止条件、更新上下文 |

这层把 Scheduler 的执行意图转换为设备可执行输入，并将模型输出转换为 Token 结果。

### 2.4 Modeling

Modeling 提供调优后的模块与模型实现。官方文档列出的后端包括 ATB Models 与 MindSpore Models。

内置模块包含 Attention、Embedding、ColumnLinear、RowLinear、MLP 等；模型完成组网、编译和优化后，在昇腾 NPU 上执行加速图。

这层回答“Transformer 的每一层具体怎样计算”。

## 3. 配置如何映射到四层

`mindie-service/conf/config.json` 是服务化部署的核心入口：

```json
{
  "Version": "1.0.0",
  "ServerConfig": {},
  "BackendConfig": {
    "ModelDeployConfig": {
      "ModelConfig": [],
      "ScheduleConfig": {}
    }
  },
  "LogConfig": {}
}
```

概念映射：

| 配置块 | 主要组件 |
|---|---|
| `ServerConfig` | Server/EndPoint |
| `BackendConfig` | LLM Manager、设备和多机环境 |
| `ModelDeployConfig` | 模型级长度边界和实例 |
| `ModelConfig` | Text Generator/Modeling、权重与 KV 内存 |
| `ScheduleConfig` | Scheduler/Block Manager |
| `LogConfig` | 全链路日志 |

完整字段见[MindIE config.json 生产参数参考](./02-MindIE-config生产参数参考.md)。

## 4. 服务启动生命周期

典型启动前先加载环境：

```bash
source /usr/local/Ascend/cann/set_env.sh
source /usr/local/Ascend/nnal/atb/set_env.sh
source /usr/local/Ascend/atb-models/set_env.sh
source /usr/local/Ascend/mindie/latest/mindie-llm/set_env.sh
source /usr/local/Ascend/mindie/latest/mindie-service/set_env.sh
```

然后启动：

```bash
./bin/mindieservice_daemon
```

概念阶段如下：

```text
读取 config.json
  ↓ 语法、范围、路径与权限检查
初始化 Server/管理面/证书
  ↓
初始化 Backend 与 Tokenizer 进程
  ↓
解析 NPU Device / Rank / 多机配置
  ↓ CANN/HCCL 初始化
创建模型实例
  ↓ 加载、切分、量化权重
创建 KV Cache / Block Manager
  ↓
初始化 Scheduler / Executor / Text Generator
  ↓ 模型编译、图和算子准备
服务与指标端口 Ready
```

### 启动卡住的证据映射

| 阶段 | 常见问题 |
|---|---|
| 配置读取 | JSON、字段版本、范围、文件大小、权限 |
| Server | IP/端口、TLS 证书、KMC、绑定策略 |
| NPU 初始化 | Device ID、可见设备、驱动/CANN、容器挂载 |
| 多机初始化 | Ranktable、HCCL、网卡、证书、端口 |
| 权重加载 | 路径权限、模型支持、dtype、量化、worldSize |
| KV 分配 | `npuMemSize`、权重峰值、Workspace、模型结构 |
| 图/算子 | ATB/CANN 版本、Shape、模型实现、编译缓存 |

## 5. 一个请求进入 Server

请求示例：

```json
{
  "model": "qwen-prod",
  "messages": [
    {"role": "user", "content": "请解释 PageAttention"}
  ],
  "temperature": 0.2,
  "max_tokens": 128,
  "stream": true
}
```

Server/EndPoint 先完成：

1. 网络连接和 TLS 验证；
2. 请求体大小与 JSON 深度检查；
3. API 协议解析；
4. 模型名和字段校验；
5. Chat Template/工具调用/多模态安全处理；
6. 将合法请求提交给后端。

`openAiSupport` 会影响 OpenAI 接口兼容语义。接口路径相同并不代表所有字段、错误码、工具调用或流式 Chunk 与 vLLM 位级一致，必须用契约测试验证。

## 6. Tokenizer 和输入长度边界

BackendConfig 中的 Tokenizer 进程将文本转换为 Token ID。随后会遇到多重长度限制：

```text
实际输入长度
≤ maxInputTokenLen
≤ maxSeqLen - 1
≤ 模型 max_position_embeddings（应按模型约束）
```

若 `truncation=false`，超限请求应报错；若开启截断，需要明确保留头部还是尾部及业务语义，不能把“服务不报错”当成正确答案。

Tokenizer 可能成为瓶颈的证据：

- NPU 空闲但后端接收 Token 请求速率低；
- CPU 某些核持续满载；
- 长文本或复杂模板下 TTFT 增长；
- 增加 `tokenizerProcessNumber` 后吞吐改善；
- Queue 在 Server/Tokenizer 层，而 Scheduler 尚未饱和。

## 7. LLM Manager 创建请求状态

进入 LLM Manager 后，请求需要保存：

- 输入 Token 与目标输出上限；
- 到达时间、超时和请求 ID；
- Sampling/Stop 参数；
- Prefill/Decode 状态；
- KV Cache Block 映射；
- 模型实例和并行域；
- 流式返回状态。

Engine 将请求交给 Scheduler，Block Manager 评估 KV 资源，Executor 为设备执行准备任务。

## 8. Scheduler 的 Prefill 与 Decode 决策

MindIE ScheduleConfig 明确区分多种预算：

| 预算 | 含义 |
|---|---|
| `maxPrefillBatchSize` | 一轮 Prefill 最多包含多少请求 |
| `maxPrefillTokens` | 一轮 Prefill 输入 Token 总量 |
| `maxBatchSize` | Decode 最大 Batch |
| `maxQueueDelayMicroseconds` | 未凑满 Batch 时最多等待多久 |
| `maxFirstTokenWaitTime` | 首 Token 排队保护阈值 |
| `maxPreemptCount` | 每轮最多允许抢占多少请求 |

调度循环可抽象为：

```text
接收新请求
  ↓
检查输入/输出长度与 KV 需求
  ↓
选择 Prefill 或 Decode
  ↓
按请求数、Token、Block 和等待时间组成 Batch
  ↓
Executor 下发 Text Generator
  ↓
更新输出、状态和 KV
  ↓
完成/继续/抢占/释放
```

### `supportSelectBatch`

在 Prefill/Decode 混部场景，关闭时更偏向先执行 Prefill；开启后，调度器可结合 Prefill/Decode 请求数及估计时间动态选择下一阶段。估计参数不符合实际硬件和模型时，可能导致 Decode 被长 Prefill 干扰或 GPU/NPU 泡沫增加。

## 9. Block Manager 和 KV Cache

KV Cache 容量近似受以下因素影响：

```text
每 Token KV 字节
≈ 2 × 层数 × KV Heads × Head Dim × dtype bytes
```

再结合 TP/模型结构、Block 对齐、量化和实现开销。MindIE 用 `cacheBlockSize` 指定每个 KV Block 的 Token 数，用 `npuMemSize` 或自动预算决定 NPU 上 KV 空间，用 `cpuMemSize` 支持需要的 CPU KV/抢占路径。

三种容量不要混淆：

- `maxLinkNum`：Server 接入层；
- `maxBatchSize`：Decode 调度层；
- KV 可容纳请求数：Block Manager 资源层。

真实并发上限是三者及 Token 分布、SLO 的共同最小值。

## 10. Executor 如何下发设备任务

Scheduler 只决定“本轮算什么”，Executor 负责“在哪些设备和 Server 上执行”。它需要处理：

- 模型实例选择；
- DP/TP/EP/CP/SP 域；
- 跨设备任务和同步；
- Prefill/Decode 分离时的角色；
- HCCL 通信；
- 结果汇聚和错误返回。

在多卡场景中，整体 Step 受最慢 Rank 限制。HCCL Timeline 中某 Rank 晚到集合通信，根因可能是该 Rank 计算慢、CPU 下发慢或硬件异常，而不一定是 HCCL 算法本身。

## 11. Text Generator 的一次前向

Preprocess 将调度任务转换为模型输入：Token、Position、Mask、KV 地址、Batch/Sequence Metadata 等。

Generator 调用 Modeling：

```text
Embedding
→ Transformer Layers
   ├─ Norm
   ├─ Q/K/V Projection
   ├─ RoPE
   ├─ Attention / PageAttention / FlashDecoding
   ├─ O Projection + HCCL
   └─ MLP 或 MoE + HCCL
→ LM Head
→ Logits
```

Sampler 对 Logits 执行 Temperature、Top-k、Top-p 等策略，选择 Token，并检查 EOS、Stop 和最大输出长度。

## 12. Modeling、ATB 与 CANN

`backendType=atb` 时使用 ATB 加速路径；`backendType=ms` 时走支持的 MindSpore 路径。二者依赖、模型实现和能力约束不同。

ATB Models 提供适配昇腾的 Transformer 模型和模块，底层依赖 CANN 算子与运行时。性能问题可继续下钻：

```text
MindIE Scheduler
→ Text Generator
→ Model graph / ATB operation
→ CANN operator
→ NPU Stream
→ HBM / HCCL / hardware
```

仅凭 Server 日志无法证明算子是否高效，需要结合 NPU Timeline、算子统计、HCCL 记录和硬件指标。

## 13. 结果返回

每轮生成 Token 后：

1. Sampler 更新生成状态；
2. Text Generator 将 Token 结果返回 LLM Manager；
3. Scheduler 判断继续或完成并释放/保留 KV；
4. Tokenizer/后处理将 Token 转换为文本；
5. EndPoint 转为目标 API 格式；
6. 流式请求输出 Chunk，最终返回 Finish Reason 和 Usage。

如果 NPU 已产生 Token，但客户端仍慢，应检查反分词、Server 线程、TLS、代理 Buffer、网络和客户端读取，而不是只看 NPU 利用率。

## 14. 完整请求链路

```text
HTTP JSON
  ↓ ServerConfig: 协议/安全/限制
EndPoint request
  ↓ Tokenizer
Token IDs + generation config
  ↓ LLM Manager Engine
Request state
  ↓ Scheduler + Block Manager
Prefill/Decode batch + KV mapping
  ↓ Executor
Text Generator task
  ↓ Preprocess
Model inputs
  ↓ Modeling (ATB/MindSpore)
CANN graph/operators + HCCL
  ↓ Ascend 910B
Logits
  ↓ Sampler
Token ID
  ↓ LLM Manager / detokenize
Streaming text
  ↓ EndPoint
HTTP SSE / JSON
```

## 15. 性能指标映射

| 现象 | 优先组件 | 需要的证据 |
|---|---|---|
| 连接被拒绝 | Server/EndPoint | `maxLinkNum`、队列、错误码、连接指标 |
| 400/协议不兼容 | EndPoint | 请求体、`openAiSupport`、模型能力 |
| TTFT 高、Scheduler 不忙 | Tokenizer/Server | CPU、Tokenizer 进程、模板耗时 |
| TTFT 高、Prefill Queue 高 | Scheduler | Waiting、Prefill Batch/Token、KV Block |
| TPOT 高 | Decode/Modeling | Batch、NPU Timeline、Graph/算子、HCCL |
| HBM OOM | Model/Block/Graph | 权重、`npuMemSize`、KV、Workspace |
| 多卡利用率不均 | Executor/HCCL | Rank Timeline、拓扑、CPU/NUMA、硬件健康 |
| 流式卡顿 | 后处理/Server/网络 | Token 产生时间、Chunk 发送和代理 Buffer |

## 16. 典型问题：NPU 利用率低但 TTFT 高

排查树：

```text
TTFT 高
├─ Server Queue 高
│   ├─ maxLinkNum/过载保护
│   └─ TLS/请求解析/连接
├─ Tokenizer 慢
│   ├─ tokenizerProcessNumber
│   ├─ CPU Cgroup/NUMA
│   └─ 长文本/模板/多模态
├─ Scheduler Queue 高
│   ├─ maxPrefillTokens 太小
│   ├─ maxPrefillBatchSize 太小
│   ├─ KV Block 不足
│   └─ Prefill/Decode 策略不合理
├─ NPU Kernel 之间空洞
│   ├─ 输入准备/CPU 下发
│   ├─ Shape/Graph
│   └─ 跨 Rank 等待
└─ 单次 Prefill 慢
    ├─ 模型/算子/量化
    ├─ HCCL
    └─ 过长 Prompt
```

平均利用率只能作为现象，Timeline 才能区分“没有任务”和“有任务但在等待”。

## 17. PD 分离时链路怎样变化

`inferMode=dmi` 等 Prefill/Decode 分离场景会把链路拆成：

```text
Request
→ Prefill Instance
→ 生成 Prompt KV
→ KV Transfer / Inter-instance communication
→ Decode Instance
→ Autoregressive Decode
→ Response
```

新增故障面包括：

- P/D 路由和角色；
- KV 传输网络与连接；
- `kv_trans_timeout`、`kv_link_timeout`；
- P/D 两边长度、模型和协议配置一致性；
- KV 到达前的 Decode 排队；
- 故障恢复与重复请求。

只有当 Prefill 和 Decode 资源曲线明显不同，且网络与运维复杂度可控时，分离才可能带来收益。

## 18. 与 vLLM-Ascend 的边界

| 维度 | vLLM-Ascend | MindIE |
|---|---|---|
| 控制面 | upstream vLLM V1 | MindIE LLM Manager |
| 配置入口 | vLLM CLI + Additional Config + env | `config.json` + env |
| 调度/缓存 | vLLM Scheduler/KV Cache Manager | MindIE Scheduler/Block Manager |
| 模型执行 | NPUModelRunner + Ascend Backend | Text Generator + Modeling |
| 模型后端 | vLLM-Ascend 模型/算子 | ATB Models 或 MindSpore Models |
| 服务生态 | vLLM OpenAI Server | MindIE Server/EndPoint/Motor |

两者可以提供相似 API，但参数不能逐字复制，性能报告也必须按相同模型制品、请求分布和 SLO 重新测量。

## 19. 生产验收清单

```text
[ ] MindIE/CANN/ATB/驱动/固件来自目标版本兼容组合
[ ] 模型、Tokenizer、量化制品和配置文件固定并留存哈希
[ ] Server、管理、指标平面 IP/端口与 TLS 边界明确
[ ] npuDeviceIds、worldSize、Ranktable 与物理拓扑一致
[ ] maxSeqLen/maxInputTokenLen/maxIterTimes 形成正确长度边界
[ ] npuMemSize、cacheBlockSize 与 KV Block 容量完成复算
[ ] maxLinkNum 与后端并发/限流分层设计
[ ] 短/长/共享前缀/高并发流量完成容量曲线
[ ] OpenAI 兼容、流式结束、工具调用和错误码完成契约测试
[ ] NPU/HCCL/CPU/服务指标和日志可关联请求 ID
[ ] OOM、慢 Rank、进程退出、网络故障和滚动升级完成演练
```

## 20. 总结

MindIE 的一次请求不是直接从 HTTP 跳到 NPU，而是经过：

```text
Server/EndPoint
→ LLM Manager（Engine/Scheduler/Block Manager/Executor）
→ Text Generator（Preprocess/Generator/Sampler）
→ Modeling（ATB/MindSpore）
→ CANN/HCCL/Ascend 910B
→ 反向返回结果
```

排障的第一步永远是确定最后一个正常层。只有在 Server、Tokenizer、Scheduler 和 Executor 都有任务证据后，才应把问题归因到 NPU 算子或硬件。

## 官方资料

- [MindIE LLM 架构介绍](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0001.html)
- [MindIE 服务化配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_service0285.html)
- [MindIE 模型侧配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0503.html)
- [MindIE 推理快速开始](https://www.hiascend.com/document/detail/zh/mindie/230/quickstart/mindie_quickstart_0004.html)
- [OpenAI-compatible API](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_service0319.html)
