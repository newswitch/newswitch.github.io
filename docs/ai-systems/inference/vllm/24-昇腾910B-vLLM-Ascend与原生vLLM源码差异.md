---
title: "昇腾 910B 的 vLLM-Ascend 与原生 vLLM 有什么区别"
sidebar_label: "24. 昇腾 910B 的 vLLM-Ascend 与原生 vLLM 有什么区别"
sidebar_position: 24
tags: [vLLM, vLLM-Ascend, 昇腾910B, CANN, torch-npu, HCCL, 源码分析]
description: "沿一次请求的源码路径，分析 vLLM-Ascend 如何通过平台插件把 upstream vLLM 的 CUDA 执行面替换为昇腾 910B、CANN、ACLGraph 与 HCCL 执行面。"
---

# 昇腾 910B 的 vLLM-Ascend 与原生 vLLM 有什么区别

本文是 CUDA 与 Ascend 执行面的深度对照。若希望先建立 vLLM-Ascend 自身的组件地图和参数体系，请从 [vLLM-Ascend 学习路线](../vllm-ascend/00-vLLM-Ascend学习路线.md)开始；若需要与 SGLang、MindIE 一起选型，请阅读[四大推理框架对比与选型](/docs/ai-systems/inference/vLLM-vLLM-Ascend-SGLang-MindIE框架对比与选型)。

在外部看，NVIDIA 环境和昇腾 910B 环境可能使用近乎相同的命令：

```bash
vllm serve /model --tensor-parallel-size 4
```

客户端也都访问：

```text
POST /v1/chat/completions
→ HTTP 200
→ SSE 流式 Token
```

这很容易造成一个误解：**vLLM-Ascend 只是把 `cuda` 字符串替换成 `npu`。**

实际情况是：vLLM-Ascend 复用了 upstream vLLM 的协议、请求状态、调度和缓存管理框架，但把最接近硬件的执行面替换成了另一套实现。Attention、图捕获、融合算子、显存分配、集合通信、量化和性能工具都发生了变化。

可以先记住一句话：

```text
vLLM-Ascend 不是 vLLM 的一个启动参数，
而是通过 vLLM Platform Plugin 接口接入的一套昇腾硬件后端。
```

---

## 1. 本文中的“原生 vLLM”指什么

vLLM upstream 本身正在向多硬件平台演进。本文为了贴近现有生产环境，将两个名词定义为：

- **原生 vLLM**：upstream `vllm-project/vllm` 在 NVIDIA CUDA GPU 上的主流执行路径；
- **vLLM-Ascend**：upstream vLLM 加上独立仓库 `vllm-project/vllm-ascend`，在昇腾 NPU 上运行的硬件插件路径。

因此两者不是两个完全无关的推理框架：

```text
共同的 vLLM 控制面
├─ CUDA Platform → NVIDIA GPU 执行面
└─ Ascend Platform Plugin → 昇腾 NPU 执行面
```

本文源码概念沿用本模块的 upstream vLLM `v0.23.0` 基线。2026-08-17 查询官方资料时，vLLM-Ascend 已发布与 upstream `v0.23.0` 对齐的 `v0.23.0rc1` 文档。RC 版本信息只用于说明源码演进，生产应选择官方兼容矩阵中已经验证的完整版本组合，不能因为版本号一致就跳过压测与精度测试。

---

## 2. 两套完整软件栈

### 2.1 NVIDIA CUDA 路径

```text
OpenAI API Server
→ vLLM V1 EngineCore / Scheduler / KVCacheManager
→ GPU Worker / GPUModelRunner
→ PyTorch CUDA + vLLM CUDA/Triton Custom Ops
→ FlashAttention / FlashInfer / CUDA Kernel
→ CUDA Runtime / Driver
→ NCCL
→ NVIDIA GPU / HBM / PCIe / NVLink / NVSwitch
```

### 2.2 昇腾 910B 路径

```text
OpenAI API Server
→ vLLM V1 EngineCore / Scheduler / KVCacheManager
→ vLLM-Ascend Platform Plugin
→ NPU Worker / NPUModelRunner
→ PyTorch + torch_npu
→ Ascend Attention / Custom Ops / ATB 或 Triton Ascend 等路径
→ CANN / ACL Runtime / HDK
→ HCCL
→ Ascend 910B / HBM / HCCS / PCIe / RoCE
```

这里最重要的差别不是 GPU 与 NPU 的名称，而是：

| 层级 | NVIDIA 原生路径 | 昇腾 910B 路径 |
| --- | --- | --- |
| 设备适配 | upstream CUDA Platform | `vllm-ascend` Platform Plugin |
| PyTorch 设备 | `torch.cuda` | `torch.npu` / `torch_npu` |
| 基础运行时 | CUDA | CANN / ACL |
| Attention | CUDA 对应 Backend | Ascend Attention Backend |
| 图执行 | CUDA Graph | ACLGraph，外加 Npugraph_ex 等优化 |
| 集合通信 | NCCL | HCCL |
| 自定义算子 | CUDA C++、Triton、第三方库 | torch_npu、CANN/ATB、自定义 NPU 算子、Triton Ascend 等 |
| 设备观测 | `nvidia-smi`、DCGM、Nsight | `npu-smi`、msprof、msMonitor/msprobe 等 |
| K8s 设备注入 | NVIDIA Runtime/Device Plugin | Ascend Runtime/Device Plugin |

上层接口相似，是因为 vLLM-Ascend 有意复用 vLLM 的框架；底层不能直接互换，是因为每种加速器需要自己的 Kernel、图执行、通信和内存实现。

---

## 3. 哪些组件基本复用，哪些组件发生分叉

### 3.1 大体复用的控制面

以下主线主要来自 upstream vLLM：

```text
OpenAI-compatible API
→ Chat Template / Tokenizer
→ InputProcessor
→ AsyncLLM / EngineCoreClient
→ EngineCore
→ Scheduler
→ KVCacheManager / BlockPool
→ OutputProcessor / Detokenizer
```

因此两套环境可以共享很多知识：

- 请求如何从 messages 变成 Token ID；
- Continuous Batching 与 Chunked Prefill 的调度思想；
- 请求状态机；
- 逻辑 KV Block 分配与 Prefix Cache；
- TTFT、TPOT、E2E 和 Token 吞吐定义；
- OpenAI API、SSE、取消和超时；
- 网关、限流、排队和容量规划方法。

### 3.2 明显分叉的执行面

从 Executor 把 `SchedulerOutput` 发给 Worker 开始，硬件差异变得明显：

```text
SchedulerOutput
→ Platform-specific Worker
→ Platform-specific ModelRunner
→ Platform-specific input buffers / metadata
→ Platform-specific Attention Backend
→ Platform-specific graph / custom ops
→ Platform-specific collective communication
```

vLLM-Ascend 仓库当前包含这些关键目录和文件：

```text
vllm_ascend/
├─ platform.py
├─ worker/
│  ├─ worker.py
│  ├─ model_runner_v1.py
│  ├─ npu_input_batch.py
│  └─ block_table.py
├─ attention/
│  └─ attention_v1.py
├─ compilation/
│  └─ acl_graph.py
├─ distributed/
│  └─ device_communicators/
├─ ops/
├─ quantization/
├─ model_loader/
├─ models/
└─ envs.py / ascend_config.py
```

它不是只实现一个 `NPUDevice` 类，而是覆盖了从配置检查到热路径执行的多个扩展面。

---

## 4. vLLM 怎样发现昇腾插件

vLLM 使用 Python `entry_points` 发现外部平台插件。vLLM-Ascend 的安装配置注册了：

```text
group: vllm.platform_plugins
name:  ascend
value: vllm_ascend:register
```

启动时的概念流程是：

```text
Python 扫描 vllm.platform_plugins
→ 发现 ascend entry point
→ 调用 vllm_ascend.register()
→ 检测当前环境是否属于 Ascend
→ 返回 NPUPlatform 的完整类路径
→ vLLM 将 current_platform 设为 Ascend Platform
```

可以在镜像中验证插件是否真的注册：

```bash
python - <<'PY'
from importlib.metadata import entry_points

for item in entry_points(group="vllm.platform_plugins"):
    print(item.name, "->", item.value)
PY
```

预期能看到类似：

```text
ascend -> vllm_ascend:register
```

若只安装 upstream `vllm` 而没有安装匹配的 `vllm-ascend`，API 命令可能存在，但不会凭空拥有 910B 执行能力。

vLLM-Ascend 还注册 general plugins，用于扩展 KV Connector、模型加载器、模型和服务 Profiling。由此可以看出，适配范围已经超出单一 Platform 类。

---

## 5. NPUPlatform 到底改了什么

Platform 类是 upstream vLLM 与硬件插件之间的第一层契约。它不是负责执行全部算子，而是回答：

```text
设备类型是什么？
使用哪个 Worker / ModelRunner？
支持哪些 dtype、量化和编译模式？
怎样计算设备能力和可用内存？
怎样选择 Attention Backend？
怎样调整与拒绝不兼容配置？
分布式通信后端是什么？
```

在 CUDA 环境中，这些判断由 CUDA Platform 和 GPU 实现完成；在 910B 环境中，`vllm_ascend/platform.py` 的 `NPUPlatform` 接管相应决策。

这会产生一个很重要的现象：**同一个通用参数，在两个平台上的最终执行含义可能不同。**

例如 upstream 仍使用 `CompilationConfig.cudagraph_mode` 表达图模式，但在昇腾平台上：

```text
cudagraph_mode != NONE
→ 并不是调用 CUDA Graph
→ NPUPlatform 结合模型和 Backend 校验
→ 使用 ACLGraph 捕获/回放
→ 某些模式还会启用 Npugraph_ex 的 FX 图优化
```

参数名是上层公共协议，最终后端是平台实现。阅读日志时不能看到 `cudagraph_mode` 就认定环境执行了 CUDA。

---

## 6. 一句话进入服务后，在哪里开始分叉

假设请求为：

```json
{
  "model": "company-model-a",
  "messages": [{"role": "user", "content": "解释一下 KV Cache"}],
  "max_tokens": 128,
  "stream": true
}
```

### 阶段一：HTTP 与 Tokenization——基本相同

```text
JSON 校验
→ Chat Template
→ Tokenizer
→ prompt_token_ids
→ EngineCoreRequest
```

这一阶段通常在 API Server 的 CPU 上完成，与 CUDA/NPU 的差别不大。Tokenizer CPU 慢、事件循环拥塞或网关排队，会同时影响两种平台。

### 阶段二：EngineCore 与 Scheduler——算法主线相同

```text
请求进入 waiting/running 状态
→ Scheduler 计算 token budget
→ KVCacheManager 查 Prefix Cache
→ 分配逻辑 KV Block
→ 形成 SchedulerOutput
```

调度器关心“本轮算哪些 Token、使用哪些逻辑 Block”，而不是 Kernel 使用 CUDA 还是 CANN。因此大部分调度思想可以迁移。

但功能是否完全可用仍要查 vLLM-Ascend Feature Matrix。例如某个模型在特定 910B 型号上的 Prefix Cache、Speculative Decoding、LoRA、PP 或图模式可能只有实验支持。

### 阶段三：Worker 初始化——第一次明显分叉

NVIDIA 路径：

```text
GPU Worker
→ 选择 CUDA Device
→ 初始化 CUDA Context
→ 初始化 NCCL Process Group
→ 创建 GPUModelRunner
```

910B 路径：

```text
NPU Worker
→ 通过 torch_npu 选择 NPU Device
→ 初始化 CANN/ACL 运行环境
→ 初始化 HCCL 通信
→ 创建 NPUModelRunner
```

所以 CUDA 环境中的 `Xid`、NCCL、CUDA Context 问题，在昇腾上会变成驱动/固件、CANN/ACL、HCCL 和 torch_npu 问题。两边错误堆栈不能按关键字一一翻译。

### 阶段四：输入准备——语义相同，布局与对齐不同

两种 Runner 都要准备：

- input IDs；
- positions；
- query/request 边界；
- Block Table；
- Slot Mapping；
- Attention Metadata；
- Sampling Metadata。

但是 NPUModelRunner 使用自己的 `NPUInputBatch`、NPU Tensor、对齐和 Metadata Builder。某些 NPU Kernel 对 Shape、Block Size、dtype 或 Padding 的最优区间与 CUDA 不同。

因此不能直接把 NVIDIA 上最优的：

```text
max_num_seqs
max_num_batched_tokens
block_size
graph capture sizes
```

复制到 910B，并期待同样的 TTFT/TPOT。

### 阶段五：模型前向与 Attention——热路径核心分叉

NVIDIA 常见路径：

```text
Q/K/V
→ CUDA Attention Backend
→ FlashAttention / FlashInfer / 其他 CUDA Kernel
→ CUDA HBM 中的 KV Cache
```

昇腾路径：

```text
Q/K/V
→ AscendAttentionBackend
→ Ascend Attention Metadata
→ torch_npu / NPU 融合 Attention 算子
→ CANN Runtime
→ NPU HBM 中的 KV Cache
```

当前 `vllm_ascend/attention/attention_v1.py` 注册了 Ascend 自定义 Attention Backend，并负责：

- 构造适合 NPU 的 Attention Metadata；
- 区分 Prefill、Decode 和特殊 Attention 路径；
- 读取 Block Table 和实际序列长度；
- 调用 torch_npu 的融合推理 Attention 算子；
- 在 ACLGraph Replay 前更新运行时参数；
- 处理 DCP、Sliding Window、Spec Decode 等受支持分支。

这正是 Paged KV 的“逻辑管理相同、物理执行不同”：

```text
EngineCore 中的逻辑 Block 所有权：主要复用
Worker 中 KV Tensor 的设备、布局和 Kernel：平台特有
```

### 阶段六：TP 通信——NCCL 与 HCCL 分叉

NVIDIA：

```text
Tensor Parallel Linear
→ NCCL AllReduce / AllGather / ReduceScatter
→ NVLink / NVSwitch / PCIe / RoCE
```

昇腾：

```text
Tensor Parallel Linear
→ HCCL Collective
→ HCCS / PCIe / RoCE 等实际拓扑
```

上层 TP/PP/DP/EP 的数学含义相同，但：

- 通信库不同；
- 网卡和设备拓扑发现不同；
- 环境变量不同；
- Rank 建链与超时日志不同；
- 融合通信算子不同；
- 最优并行策略与每组设备数量可能不同。

不能让 NVIDIA GPU Rank 和 Ascend NPU Rank 组成同一个 TP Group。异构资源池可以共享网关、存储和调度平台，但单个模型副本内部需要使用同构硬件与一致通信后端。

### 阶段七：采样和输出——再次汇合

Logits/采样中的部分算子可能有 NPU 适配，但采样 Token ID 返回 EngineCore 后，上层路径再次基本汇合：

```text
sampled token IDs
→ EngineCoreOutput
→ OutputProcessor
→ Detokenizer
→ SSE data chunk
```

所以同一网关可以把不同请求路由到 NVIDIA vLLM 或 vLLM-Ascend，并向调用方保持统一 OpenAI API。但内部功能、精度、延迟和容量不能因此视为相同。

---

## 7. GPUModelRunner 与 NPUModelRunner 的差异

两者扮演相似角色：把 `SchedulerOutput` 变成设备 Tensor，执行前向、Attention 和采样。但实现中关注的硬件细节不同。

| 维度 | GPUModelRunner | NPUModelRunner |
| --- | --- | --- |
| 设备 API | CUDA Tensor/Stream/Event | NPU Tensor/Stream/Event |
| Input Batch | upstream GPU 批处理结构 | `NPUInputBatch` 等 Ascend 结构 |
| Attention Metadata | CUDA Backend Builder | Ascend Metadata Builder |
| Graph Replay | CUDA Graph | ACLGraph |
| 图前参数更新 | CUDA Graph 对应机制 | Ascend Graph Param/Workspace 更新 |
| 编译优化 | torch.compile、Inductor、CUDA 图路径 | Ascend FX Pass、Npugraph_ex、ACLGraph 等 |
| 内存探测 | CUDA allocator/device memory | torch_npu/CANN/NPU HBM 探测与预留 |
| Profiling | PyTorch/CUDA、Nsight | torch_npu、msprof/msMonitor/msprobe |

源码阅读时不要强行寻找“每个 CUDA 类在 Ascend 中同名的替代类”。插件可能：

- 直接继承 upstream 接口；
- 组合 upstream 对象；
- 注册 Backend；
- 在 Platform 中改写配置；
- 为特定模型注册额外实现；
- 通过自定义算子而不是 Python 类完成优化。

应该沿对象契约阅读，而不是按文件名机械配对。

---

## 8. CUDA Graph 与 ACLGraph 为什么不是简单改名

两者都试图减少 Python 和 Kernel Launch 开销：

```text
先捕获一组可复用执行图
→ 运行时只更新必要输入/地址/元数据
→ Replay
→ 减少每个 Decode Step 的 Host 开销
```

但在 Ascend 上，当前默认图路径包含两个阶段：

```text
编译阶段：FX Graph 优化 / Npugraph_ex 融合
→ 运行阶段：ACLGraph Capture / Replay
```

官方文档说明：

- `FULL` / `FULL_DECODE_ONLY` 可启用 Npugraph_ex，再由 ACLGraph 捕获；
- `PIECEWISE` 使用较基础的 FX Fusion，再进行 ACLGraph 捕获；
- `NONE` 走 Eager；
- Platform 会根据模型和 Attention Backend 调整最终有效模式；
- 捕获 Shape 太多可能耗尽 Stream 等运行时资源；
- Runtime Batch 超出捕获范围时可能回退 Eager。

这会带来三个生产结论。

### 8.1 启动更慢不一定是加载权重慢

启动可能在执行：

```text
Dummy Run
→ FX Compile
→ Graph Capture
→ Workspace 分配
→ 多个 Batch Size Warmup
```

应把权重加载、KV 初始化和图捕获分别计时。

### 8.2 Graph 开启不等于所有请求都 Replay

Shape、模型特性、Attention Backend 或 Batch 超出覆盖范围，可能导致某些 Step 走 Eager。表现为平均性能尚可、P99 抖动明显。

### 8.3 `--enforce-eager` 是定位工具，不是最终调优答案

若 Eager 能稳定运行而 Graph 模式报错或抖动，说明问题范围缩小到编译/捕获/Replay；但生产是否长期 Eager，要用 TTFT、TPOT、吞吐和 CPU 空洞压测决定。

---

## 9. 算子生态差异

### 9.1 NVIDIA 路径

常见实现来源：

- upstream vLLM C++/CUDA Custom Ops；
- Triton Kernel；
- FlashAttention；
- FlashInfer；
- CUTLASS 或架构专用实现；
- NCCL 与融合通信 Kernel。

### 9.2 昇腾路径

常见实现来源：

- PyTorch 原生算子经 torch_npu 下沉；
- torch_npu 融合 NPU 算子；
- CANN / ACLNN；
- ATB/NNAL 路径；
- vLLM-Ascend 自定义 CANN Ops；
- Triton Ascend；
- 面向特定模型、MoE、Attention 与通信的融合实现。

所以“模型结构在 upstream vLLM 已支持”不自动推出“910B 上该模型全部功能和性能已支持”。还需要检查：

```text
模型层是否可复用
→ 每个关键算子是否有 NPU 实现
→ dtype / quantization 是否支持
→ Attention Backend 是否覆盖
→ 图模式是否覆盖
→ TP/EP/PD 等组合是否验证
```

功能矩阵中的“支持模型”和“支持功能”应交叉阅读，不能只看到模型名称有勾就上线全部特性。

---

## 10. 权重与量化制品能否直接复用

### 10.1 BF16/FP16 权重

标准 Hugging Face BF16/FP16 权重在模型架构和加载器都受支持时，可能由两个平台共享。但仍需验证：

- 模型 Revision；
- Transformers 与 Remote Code；
- 权重布局与 TP 切分；
- 位置编码、MoE 和多模态算子；
- 精度回归。

### 10.2 量化权重

通常不能把“同为 8 bit”理解成可移植格式。

NVIDIA 环境常见：

```text
AWQ / GPTQ / FP8 / Marlin / bitsandbytes / NVFP4 等
```

vLLM-Ascend 官方矩阵当前列出 W8A8、W4A8、W4A4 等 Ascend 路径，并且支持状态依模型和硬件而异。

量化制品包含的不只是数值位宽，还包括：

```text
group size
scale / zero point
per-tensor / per-channel
weight packing
activation quantization
smooth / calibration
Kernel 期望布局
硬件专用格式
```

正确资产模型是：

```text
同一个逻辑模型版本
├─ NVIDIA BF16/FP8/AWQ 制品 + Digest
└─ Ascend BF16/W8A8/W4A8 制品 + Digest
```

网关层可以把二者映射为同一个 `served_model_name`，发布平台仍必须记录不同 Artifact Digest 和精度报告。

---

## 11. KV Cache 的共同点与差异

共同点：

- 都用 Block 管理降低外部碎片；
- Scheduler/KVCacheManager 管理逻辑所有权；
- Prefix Cache 都基于可复用前缀；
- 容量仍受层数、KV Heads、Head Dim、dtype 和上下文长度影响。

差异：

- 物理 Tensor 在 CUDA HBM 或 NPU HBM；
- KV 布局和 Block Size 受 Attention Kernel 约束；
- KV dtype 支持不同；
- Alignment、Padding 和 Workspace 不同；
- 图捕获额外预留不同；
- Offload/KV Connector 的后端和传输优化不同；
- 长上下文 DCP/CP 的支持组合不同。

因此相同模型、相同 `gpu_memory_utilization=0.9`，两套平台最终可分配 KV Block 数也可能不同。这里的参数名为了保持 upstream CLI 兼容仍包含 `gpu`，在 NPU 平台上应理解为由插件解释的设备 HBM 使用目标，而不是证明系统在使用 CUDA GPU。

容量规划必须读取启动日志中的实际：

```text
权重占用
运行时与图占用
可用于 KV Cache 的 HBM
KV Block 数
最大并发估算
```

再通过真实长度分布压测校准。

---

## 12. TP、EP 与多机通信差异

### 12.1 数学并行策略可以迁移

- TP：切分层内 Tensor；
- PP：切分模型层；
- DP：复制模型；
- EP：切分 MoE Expert；
- DCP：沿上下文/KV 维度分片的特定路径。

### 12.2 工程参数不能直接迁移

NVIDIA 通常围绕 NCCL、NVLink/NVSwitch 和 GPUDirect/RDMA；昇腾围绕 HCCL、HCCS/PCIe/RoCE、NPU 与 NIC 亲和性。

910B 环境要重新确认：

```text
每个 Rank 的 NPU ID
HCCL 使用的网卡/IP
NPU-NPU 与 NPU-NIC 拓扑
容器可见设备顺序
多机 Rank 映射
MTU / RoCE / PFC / ECN（若使用）
HCCL 超时与错误日志
CPU/NUMA 绑定
```

### 12.3 慢 Rank 的机制相同，证据工具不同

```text
一个 Rank 计算/通信变慢
→ 其他 Rank 在 Collective 等待
→ 所有设备平均利用率下降
→ TPOT/P99 上升
```

NVIDIA 用每 Rank Nsight/NCCL/DCGM 分析；昇腾用每 Rank NPU Timeline、HCCL 日志、`npu-smi`、msprof/msMonitor 等分析。

---

## 13. 版本兼容为什么更需要整体冻结

NVIDIA 环境已经需要匹配：

```text
vLLM ↔ PyTorch ↔ CUDA Runtime ↔ Driver ↔ GPU Architecture
```

昇腾环境还要把以下对象当成一个发布单元：

```text
Firmware / Driver / HDK
↕
CANN / NNAL / ATB
↕
torch-npu ↔ PyTorch
↕
vLLM-Ascend ↔ upstream vLLM
↕
Triton Ascend / Custom Ops
↕
模型与量化制品
```

官方安装文档明确要求从 Compatibility Matrix 中选择完整的一行。对 main 分支开发，还要求使用仓库记录的 verified vLLM commit，而不是任意 upstream commit。

生产发布记录至少包含：

| 层级 | 必须记录 |
| --- | --- |
| 硬件 | 910B 精确产品/SOC、NPU 数量、服务器拓扑 |
| 主机 | OS、Kernel、Firmware、Driver/HDK |
| 加速栈 | CANN、NNAL/ATB、相关补丁 |
| Python | Python、PyTorch、torch-npu |
| 引擎 | vLLM、vLLM-Ascend、源码 commit |
| 算子 | Triton Ascend/Custom Ops 构建信息 |
| 模型 | Revision、量化格式、Digest |
| 容器 | Image Digest、启动参数、环境变量 |

只升级 `pip install -U vllm` 很容易破坏已验证组合。

---

## 14. API 和参数兼容到什么程度

### 可以大体统一

- `/v1/models`；
- `/v1/completions`；
- `/v1/chat/completions`；
- Streaming SSE；
- 常用 Sampling 参数；
- `--tensor-parallel-size`；
- `--max-model-len`；
- `--max-num-seqs`；
- `--max-num-batched-tokens`；
- 大量 vLLM 指标和请求语义。

### 必须分别验证

- 支持的模型与多模态输入；
- Structured Output 与 Tool Calling 的具体组合；
- LoRA；
- Speculative Decoding；
- Attention Backend；
- 图模式；
- KV dtype 与 Offload；
- TP/PP/DP/EP/DCP；
- Prefill/Decode 分离；
- 量化格式；
- 自定义模型和 Remote Code。

vLLM-Ascend 还通过 `--additional-config` 暴露插件自己的配置。官方正在把部分 `VLLM_ASCEND_*` 环境变量迁移为 Additional Config，因此升级时要同时检查参数弃用与迁移说明。

统一 Helm Chart 时可以共享上层参数，但应分出平台 overlay：

```text
base values
├─ api / model name / probes / gateway
├─ scheduler common settings
└─ platform overlay
   ├─ nvidia: image, resource key, CUDA/NCCL, quant artifact
   └─ ascend: image, resource key, CANN/HCCL, additional_config, quant artifact
```

---

## 15. 可观测性为什么不能只复制 Dashboard

### 15.1 可以共享的服务指标

- Request success/error；
- waiting/running 请求数；
- Prompt/Generation Token；
- TTFT、TPOT/ITL、E2E；
- KV Cache 使用率；
- Prefix Cache 命中；
- Preemption；
- Queue time；
- Streaming 完成率。

### 15.2 需要平台化的设备指标

| NVIDIA | 昇腾 910B |
| --- | --- |
| SM/ Tensor Core 活跃 | AI Core/Vector 等 NPU 执行指标 |
| CUDA HBM 使用/带宽 | NPU HBM 使用/带宽 |
| CUDA Graph 命中 | ACLGraph 捕获/Replay/Eager 回退 |
| NCCL Collective | HCCL Collective |
| NVLink/NVSwitch | HCCS/对应互联 |
| Xid / ECC | NPU/驱动/硬件错误码 |
| DCGM | Ascend 设备与运行时监控体系 |
| Nsight Systems | msprof 等 NPU Profiling |

### 15.3 指标名称相同也可能口径不同

例如“device utilization”在两种工具中的采样周期、忙定义和聚合方式可能不同。不要直接用 `GPU 60%` 与 `NPU 60%` 判断哪边快；最终比较应落到相同业务输入下的 TTFT、TPOT、吞吐、错误、精度和成本。

---

## 16. 性能调优不能照搬哪些结论

### 16.1 Batch Size

两边都受 Batch 提高并行度的收益，但 Kernel Shape、Padding、图捕获桶和通信拐点不同。NVIDIA 上的最优 `max_num_seqs` 只可作为昇腾实验起点。

### 16.2 Chunked Prefill

调度目标一致，但 NPU Prefill Attention、图模式、Token 对齐和 Decode 干扰曲线不同。重新测长短 Prompt 混部的 TTFT/TPOT。

### 16.3 Graph

CUDA Graph 的捕获大小经验不能直接映射为 ACLGraph。910B 应分别测：

```text
Eager
FULL_DECODE_ONLY
FULL
PIECEWISE
实际 Feature Matrix 允许的模式
```

并记录启动时间、HBM、Replay 覆盖、TTFT/TPOT 和错误。

### 16.4 TP 大小

TP 增大都能降低单卡权重，但通信成本由不同互联决定。分别测试 TP=1/2/4/8（以实际设备为准），不能用 NVIDIA NVLink 结论估算 HCCL。

### 16.5 CPU 绑定

两边都可能 Host Bound。昇腾还要考虑 NPU、CPU NUMA 和 NIC 亲和性，错误绑定会让 Input Preparation 或 HCCL 建链/通信抖动。

---

## 17. 同一个故障在两套平台上的定位差异

| 现象 | upstream NVIDIA 优先层 | vLLM-Ascend 优先层 |
| --- | --- | --- |
| 启动时找不到设备 | Runtime/Device Plugin、CUDA Driver | Ascend Runtime/Device Plugin、Firmware/Driver、torch_npu |
| import/符号错误 | PyTorch/CUDA/vLLM Wheel | PyTorch/torch-npu/CANN/vLLM-Ascend 兼容矩阵 |
| 算子不存在 | CUDA arch、Custom Ops、FlashAttention | CANN/NNAL、torch_npu、Custom Ops、SOC 构建目标 |
| 图捕获失败 | CUDA Graph Shape/显存/特性 | ACLGraph Stream 资源、Capture Size、Backend 兼容 |
| 多卡卡住 | Rank、NCCL、NVLink/RDMA | Rank、HCCL、HCCS/RoCE、NIC 选择 |
| HBM OOM | CUDA allocator、Graph、KV | torch_npu allocator、ACLGraph、Workspace、KV |
| GPU/NPU 利用率低 | Scheduler、CPU、CUDA 空洞 | Scheduler、CPU 绑定、NPU Input、ACLGraph 回退、HCCL |
| 结果精度异常 | Kernel/量化/模型 Revision | Ascend 算子/量化/图模式/模型适配与 Revision |

故障树应从共同层开始，再在 Worker 边界分叉：

```text
请求是否进入？
→ Tokenizer 是否完成？
→ Scheduler 是否持续有工作？
→ Executor 是否成功下发？
→ 从这里开始判断 CUDA Worker 还是 NPU Worker
```

这样不会因为硬件不同，就重复排查整个 HTTP 和调度层。

---

## 18. 典型问题：NPU 利用率只有 30%，TTFT 却超标

不要第一时间增大 Batch。按时间线分层：

### 18.1 请求到 Scheduler

```text
Gateway queue
Tokenizer CPU
EngineCore queue
Scheduler waiting time
```

若主要耗时在这里，NPU 低利用率是结果，不是硬件原因。

### 18.2 Scheduler 到 NPU Step

检查：

- NPUModelRunner 输入准备是否占用大量 CPU；
- CPU 是否绑定错误或被 cgroup throttle；
- 每步之间是否有 Host 空洞；
- Batch Shape 是否频繁变化；
- 图 Replay 是否频繁回退 Eager；
- Graph Capture Size 是否覆盖真实并发；
- HBM/KV 是否导致 Preemption 或 Recompute。

### 18.3 NPU Kernel 内部

检查：

- Prefill Attention/GEMM 是否连续；
- Padding/对齐是否浪费计算；
- 算子之间是否大量空洞；
- 是否使用预期融合算子；
- 某个 Rank 是否变慢；
- HCCL 是否占据关键路径；
- Kernel 是否受内存带宽限制。

### 18.4 实验顺序

```text
固定请求分布和版本
→ 单卡 Eager 基线
→ 单卡 Graph 基线
→ TP 多卡 Eager
→ TP 多卡 Graph
→ 增加并发
→ 长短 Prompt 混部
```

每次只改变一个变量，记录 TTFT/TPOT/E2E P50/P95/P99、Prompt/Generation tokens/s、NPU Timeline、CPU、HBM、KV、Graph 和 HCCL。

---

## 19. 怎样公平比较 910B 与 NVIDIA vLLM

必须固定：

```text
模型语义与 Revision
精度或量化方案
Tokenizer / Chat Template
输入 Token 与输出 Token 联合分布
并发到达模型
Prefix Cache 命中率
Sampling 参数
TP/PP/DP 目标与副本故障域
服务 SLO
测试时长与预热
```

然后分别寻找两套平台自己的安全最优参数，而不是强制同一 Batch 参数。

结果至少报告：

| 类别 | 指标 |
| --- | --- |
| 正确性 | 基准集精度、输出一致性、错误率 |
| 延迟 | TTFT、TPOT/ITL、E2E P50/P95/P99 |
| 吞吐 | Prompt/Generation tokens/s、请求/s |
| 容量 | 满足 SLO 的并发与 Token 预算 |
| 资源 | HBM、CPU、设备利用、通信、功耗 |
| 运维 | 冷启动、故障恢复、镜像和版本复杂度 |
| 成本 | 每百万 Token、N-1 冗余与闲置成本 |

“峰值 Token/s 更高”不能代表生产更优。如果 P99、精度、冷启动或故障恢复不满足要求，该配置就不是安全容量。

---

## 20. 一套可执行的对照实验

### 实验 A：确认插件边界

分别在两个镜像执行：

```bash
python - <<'PY'
from importlib.metadata import version, entry_points

for pkg in ["vllm", "vllm-ascend", "torch", "torch-npu"]:
    try:
        print(pkg, version(pkg))
    except Exception:
        print(pkg, "NOT_INSTALLED")

print("platform plugins:")
for item in entry_points(group="vllm.platform_plugins"):
    print(" ", item.name, item.value)
PY
```

记录 Image Digest、驱动、CUDA/CANN 和硬件产品。

### 实验 B：同一请求生命周期

对两套服务发送固定 Token 的 Greedy 请求，分别记录：

```text
HTTP receive
tokenization done
engine enqueue
first scheduled
first device step begin/end
first token emitted
request finished
```

比较共同层和设备层耗时，不只比较总耗时。

### 实验 C：Eager 与 Graph

在各自平台比较 Eager 与图模式。昇腾额外记录 ACLGraph 的最终有效模式、捕获大小、捕获耗时、Stream 资源错误和 Eager 回退。

### 实验 D：TP 慢 Rank

固定 TP，逐 Rank 采集计算与 Collective 时间。验证设备顺序、互联拓扑和 NIC 绑定，判断是计算、通信还是 Host 喂数不均。

### 实验 E：容量曲线

逐步增加并发和 Prompt 长度，记录 KV Block、Preemption、TTFT/TPOT 和 HBM。分别寻找 NVIDIA 和 910B 的 SLO 拐点。

### 实验 F：精度与量化

用同一验证集比较 BF16 基线与各平台量化制品。必须包含长上下文、Tool Call/结构化输出和目标模型的关键任务，不只检查“能生成中文”。

---

## 21. 源码阅读路线

### 第一组：先看插件怎样接入

1. upstream `docs/design/plugin_system.md`；
2. vLLM-Ascend `setup.py` 的 entry points；
3. `vllm_ascend/__init__.py` 的注册函数；
4. `vllm_ascend/platform.py` 的 `NPUPlatform`。

回答：vLLM 在何时知道自己运行在 Ascend？Platform 改写了哪些配置？

### 第二组：看 SchedulerOutput 怎样进入 NPU

1. upstream Executor 抽象；
2. `vllm_ascend/worker/worker.py`；
3. `vllm_ascend/worker/model_runner_v1.py`；
4. `vllm_ascend/worker/npu_input_batch.py`；
5. `vllm_ascend/worker/block_table.py`。

回答：请求状态怎样变成 NPU Tensor、Block Table 和本轮执行 Shape？

### 第三组：看 Attention 热路径

1. upstream Attention Backend 接口；
2. `vllm_ascend/attention/attention_v1.py`；
3. `vllm_ascend/attention/utils.py`；
4. `vllm_ascend/device/device_op.py`；
5. `vllm_ascend/ops/` 与自定义算子。

回答：KV 写到哪里、历史 KV 怎样读取、最终调用哪个 NPU 算子？

### 第四组：看图执行

1. upstream `CompilationConfig`；
2. vLLM-Ascend Graph Mode 文档；
3. `vllm_ascend/compilation/acl_graph.py`；
4. Npugraph_ex/FX 优化相关实现；
5. Attention Graph 参数更新逻辑。

回答：哪些 Shape 被捕获，哪些 Step 回退 Eager，Graph 参数怎样安全更新？

### 第五组：看通信和量化

1. upstream Parallel State；
2. `vllm_ascend/distributed/device_communicators/`；
3. `vllm_ascend/distributed/parallel_state.py`；
4. `vllm_ascend/quantization/`；
5. 目标模型的官方 Feature Matrix 和 Tutorial。

回答：Collective 在哪里发生，量化权重由哪个 Kernel 消费？

---

## 22. 常见误区

### 误区一：API 相同，所以功能完全相同

API 兼容只说明协议一致。模型、量化、图模式、并行和高级功能必须查具体版本矩阵。

### 误区二：给 upstream vLLM 安装 torch_npu 就能运行

torch_npu 只解决 PyTorch 到 NPU 的设备适配。vLLM 仍需要 Platform、Worker、Attention、Graph、通信和算子等 vLLM-Ascend 实现。

### 误区三：版本号相同就一定兼容

还要匹配 PyTorch、torch-npu、CANN、HDK、算子包和模型制品。选择官方 Compatibility Matrix 的完整一行。

### 误区四：同一个 BF16 模型能启动，量化包也能复用

量化格式与 Kernel 布局强相关。应为不同平台独立构建、校验和发布量化制品。

### 误区五：NPU 低利用率就是 910B 算力不足

可能是 Tokenizer、EngineCore、NPUModelRunner、ACLGraph 回退、HCCL 等待或 Batch 太小。先看 Timeline。

### 误区六：同一组 TP 可以混用 GPU 和 NPU

两者使用不同设备 Tensor、Kernel 和 Collective，不能组成同一个同步模型实例。

### 误区七：所有 `VLLM_ASCEND_*` 环境变量可以永久保留

官方正在把部分变量迁移至 `--additional-config`。升级前检查迁移表、弃用项和最终生效配置。

---

## 23. 生产发布检查表

```text
[硬件与底座]
[ ] 910B 精确产品/SOC、Firmware、Driver/HDK 已记录
[ ] npu-smi 与最小 torch_npu Pod 通过
[ ] NPU、CPU NUMA、NIC 与互联拓扑已记录

[兼容矩阵]
[ ] vLLM/vLLM-Ascend/PyTorch/torch-npu/CANN 来自同一兼容行
[ ] Image、Model、Quant Artifact 使用 Digest
[ ] 模型与功能矩阵逐项核对

[源码与执行]
[ ] Ascend Platform Plugin 已被发现
[ ] 实际 Worker/ModelRunner/Attention Backend 已从日志确认
[ ] 最终有效 Graph 模式和 Capture Size 已确认
[ ] HCCL Rank 与可见 NPU 一致

[正确性]
[ ] BF16 基线通过
[ ] 量化精度回归通过
[ ] 长上下文、Tool Call、Structured Output 按需验证

[性能与容量]
[ ] 使用真实 Prompt/Output 联合分布
[ ] TTFT/TPOT/E2E P95/P99 达标
[ ] KV、HBM、Graph、HCCL 和 CPU 有余量
[ ] 单卡、TP、Eager/Graph 对照实验完成

[生产运维]
[ ] startup/readiness 能识别 NPU Worker 未就绪
[ ] NPU/HCCL/CANN 日志与监控已接入
[ ] 摘流、重启、故障卡、慢 Rank 和回滚已演练
[ ] 与 NVIDIA 资源池禁止跨硬件组成同一副本
```

---

## 24. 最终结论

vLLM-Ascend 与 NVIDIA 原生 vLLM 的关系可以概括为：

```text
相同的请求与调度思想
+ 相同的 vLLM V1 控制面主线
+ 不同的硬件执行面
```

真正的源码分界点是 Platform/Worker/ModelRunner/Attention Backend：

```text
HTTP、Tokenizer、EngineCore、Scheduler、逻辑 KV 管理
                    │
                    ├─ CUDA Worker → CUDA Graph → CUDA Ops → NCCL → NVIDIA
                    │
                    └─ NPU Worker  → ACLGraph  → CANN Ops → HCCL → Ascend 910B
```

所以学习时不需要把 upstream vLLM 的知识推倒重来。应先掌握共同控制面，再沿 vLLM-Ascend 插件进入 NPU 执行面。部署时则恰好相反：必须把整套昇腾软件栈作为不可拆分的兼容与发布单元，重新验证模型功能、量化精度、图模式、并行通信、容量和故障恢复。

---

## 参考资料与源码入口

- [vLLM Plugin System](https://github.com/vllm-project/vllm/blob/main/docs/design/plugin_system.md)
- [vLLM-Ascend 官方文档](https://docs.vllm.ai/projects/ascend/en/latest/)
- [vLLM-Ascend 安装与兼容矩阵说明](https://docs.vllm.ai/projects/ascend/en/main/installation.html)
- [vLLM-Ascend Feature Matrix](https://docs.vllm.ai/projects/ascend/en/main/user_guide/support_matrix/feature_matrix.html)
- [vLLM-Ascend Supported Models](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/supported_models.html)
- [vLLM-Ascend Graph Mode](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/feature_guide/graph_mode.html)
- [vLLM-Ascend Additional Configuration](https://docs.vllm.ai/projects/ascend/en/main/user_guide/configuration/additional_config.html)
- [vLLM-Ascend Platform 源码](https://github.com/vllm-project/vllm-ascend/blob/main/vllm_ascend/platform.py)
- [vLLM-Ascend NPUModelRunner 源码](https://github.com/vllm-project/vllm-ascend/blob/main/vllm_ascend/worker/model_runner_v1.py)
- [vLLM-Ascend Attention Backend 源码](https://github.com/vllm-project/vllm-ascend/blob/main/vllm_ascend/attention/attention_v1.py)
- [vLLM-Ascend 分布式通信源码目录](https://github.com/vllm-project/vllm-ascend/tree/main/vllm_ascend/distributed)
- [vLLM-Ascend Performance and Debug](https://docs.vllm.ai/projects/ascend/en/main/developer_guide/performance_and_debug/index.html)
