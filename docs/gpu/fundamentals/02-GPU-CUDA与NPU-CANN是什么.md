---
title: "GPU、CUDA 与 NPU、CANN 是什么"
sidebar_label: "02. GPU、CUDA 与 NPU、CANN 是什么"
sidebar_position: 2
description: "从硬件、驱动、计算平台、框架适配和推理引擎五个层次，对照 NVIDIA GPU/CUDA 与昇腾 NPU/CANN 的完整软件调用链。"
tags: [GPU, CUDA, NPU, CANN, torch-npu, Ascend]
---

# GPU、CUDA 与 NPU、CANN 是什么

GPU 不是 CUDA，NPU 也不是 CANN。前者是计算硬件，后者是让应用能够使用硬件的软件平台。

以常见的大模型环境为例：

```text
NVIDIA 路线：GPU → NVIDIA Driver → CUDA → PyTorch → vLLM/SGLang
昇腾路线： NPU → Ascend Driver/Firmware → CANN → torch-npu → vLLM-Ascend/MindIE
```

这篇文章先建立两套技术栈的共同层次，再解释它们为什么不能简单地逐项改名。

## 1. 先记住四个定义

| 名称 | 类型 | 一句话解释 |
| --- | --- | --- |
| GPU | 硬件处理器类别 | 最初面向图形并行计算，现在广泛用于 AI、科学计算和通用并行计算 |
| CUDA | NVIDIA 软件平台与编程模型 | 让程序管理 NVIDIA GPU 的设备、内存、Stream，并提交 Kernel 执行 |
| NPU | AI 加速处理器类别 | 以神经网络中的矩阵、向量和张量计算为重点设计的处理器 |
| CANN | 昇腾异构计算软件平台 | 向上连接 PyTorch 等框架，向下管理昇腾 NPU 的运行时、算子、图和设备资源 |

`NPU` 是一个通用类别，不只指华为产品；本文后续谈到的 NPU 主要指昇腾 NPU。`Ascend 910B` 是芯片/设备，`Atlas 800I A2` 是包含 CPU、内存、NPU、网卡和磁盘的服务器产品。

## 2. 为什么 GPU 适合大模型

CPU 擅长复杂控制、操作系统和串行逻辑；GPU 把更多硬件资源用于大量相似数据的并行处理。大模型的大部分计算最终可以归结为矩阵乘法、向量运算、归一化、Attention 和数据搬运，因此适合在大量并行计算单元上执行。

NVIDIA GPU 可从 CUDA 视角简化为：

```text
GPU
├── 多个 SM（Streaming Multiprocessor）
│   ├── CUDA Core：通用浮点、整数和逻辑运算
│   ├── Tensor Core：矩阵乘加和低精度 AI 计算
│   ├── Warp Scheduler
│   ├── Register
│   └── Shared Memory / L1 Cache
├── L2 Cache
└── HBM / GDDR 显存
```

CUDA 线程按照 Thread、Block、Grid 组织，并由 SM 调度执行。深度学习框架通常不要求运维人员手写 CUDA Kernel，但性能分析仍需要理解 Kernel、Stream、同步和显存层次。

详细原理见[GPU 基础知识：从计算核心到显存](./01-GPU基础知识：从计算核心到显存.md)和[CUDA 执行模型与 Kernel 性能基础](../cuda/01-CUDA执行模型与Kernel性能基础.md)。

## 3. NPU 解决什么问题

NPU 是面向神经网络计算优化的处理器。不同厂商和芯片架构内部名称不同，但通常会围绕以下工作优化：

- 矩阵和张量乘加；
- 向量、标量与归一化计算；
- 低精度数据类型；
- 高带宽设备内存；
- 算子融合与计算图执行；
- 多设备集合通信；
- AI 数据预处理和推理服务。

在昇腾体系中，经常看到以下概念：

| 概念 | 作用 |
| --- | --- |
| AI Core | 执行主要的矩阵、向量和 AI 算子计算 |
| AI CPU | 承担部分控制或特定算子任务，不等于服务器 CPU |
| HBM | 保存权重、KV Cache、激活和运行时缓冲区 |
| HCCS | 同机 NPU 高速互联能力，实际路径取决于产品拓扑 |
| HCCL | 多 Rank 集合通信库 |
| CANN | 运行时、算子、图编译和工具组成的软件平台 |

NPU 不是“只能执行神经网络的黑盒”。应用仍然需要 CPU 处理 HTTP、Tokenizer、调度和部分数据准备，然后由运行时把计算任务提交到 NPU。

## 4. CUDA 到底包含什么

NVIDIA 官方将 CUDA 定义为并行计算平台和编程模型。日常讨论中的“CUDA”可能指不同范围，必须结合上下文区分：

| 说法 | 实际可能表示 |
| --- | --- |
| CUDA Driver | 用户态驱动接口与内核驱动共同提供设备控制能力 |
| CUDA Runtime | 应用常用的运行时 API，例如内存分配、Stream 和 Kernel Launch |
| CUDA Toolkit | 编译器、头文件、运行库、调试与性能工具的开发套件 |
| CUDA Libraries | cuBLAS、cuDNN、cuFFT、NCCL 等加速库 |
| CUDA Version | 可能是驱动支持上限、Toolkit 版本或 PyTorch 构建版本，三者不是同一字段 |

一个 PyTorch 矩阵乘法大致经过：

```text
Python: torch.matmul
→ PyTorch Dispatcher / ATen
→ CUDA 后端实现
→ cuBLAS、CUTLASS 或框架 Kernel
→ CUDA Runtime / Driver
→ GPU Stream 中的 Kernel
→ SM / Tensor Core 执行
→ 结果保存在 GPU 显存
```

`nvidia-smi` 顶部显示的 `CUDA Version` 通常表示当前驱动可支持的最高 CUDA 兼容版本，不等于容器里已经安装同版本 Toolkit。容器可以自带 CUDA Runtime，但宿主机仍需要兼容的 NVIDIA 驱动。

## 5. CANN 到底包含什么

CANN 全称 Compute Architecture for Neural Networks，是面向昇腾 AI 处理器的异构计算软件平台。它不是一张 NPU，也不是单独一个动态库。

常见组成可按职责理解：

| 组件 | 作用 |
| --- | --- |
| Runtime | Device、Context、Stream、Event、内存和任务执行管理 |
| AscendCL | 面向应用的设备、内存、模型、算子和媒体处理 API |
| 算子包/Kernels | 提供可在 NPU 上执行的算子实现 |
| 图引擎与编译能力 | 优化、编译和执行计算图 |
| NNAL/ATB 等加速库 | 为神经网络和大模型提供优化实现 |
| Profiling/日志/调试工具 | 分析 Host、Runtime、算子、通信和设备行为 |

PyTorch 本身不能直接把所有 CUDA 实现原封不动地放到昇腾上运行。`torch-npu` 作为 PyTorch 的昇腾适配插件，把 PyTorch 设备语义和算子连接到 CANN：

```text
Python: torch.matmul
→ PyTorch Dispatcher / ATen
→ torch-npu 设备实现
→ ACLNN、ATB、自定义算子或编译图
→ CANN Runtime
→ NPU Stream 中的 Task/Kernel
→ AI Core 执行
→ 结果保存在 NPU HBM
```

详细执行过程见[torch-npu 与 CANN 异步执行链路](../../ai-systems/inference/vllm-ascend/07-torch-npu与CANN异步执行链路.md)。

## 6. 两套技术栈的分层对照

两套体系可以按层次对照，但不能认为每个组件都严格一对一：

| 层级 | NVIDIA 路线 | 昇腾路线 | 主要职责 |
| --- | --- | --- | --- |
| 服务器 | DGX/HGX/厂商 GPU 服务器 | Atlas 800I A2 等 | CPU、内存、设备、网卡、磁盘、供电和散热 |
| 加速器 | A100、H100 等 GPU | Ascend 910B 等 NPU | 执行 AI 计算 |
| 设备内存 | HBM/GDDR | HBM | 权重、KV Cache、激活和 Buffer |
| 固件/驱动 | GPU Firmware、NVIDIA Driver | Ascend Firmware、NPU Driver | 初始化、设备控制、资源和错误上报 |
| 计算平台 | CUDA Runtime/Toolkit/Libraries | CANN Runtime/Toolkit/Kernels/NNAL | 内存、Stream、算子、图与工具 |
| PyTorch 适配 | PyTorch CUDA Backend | torch-npu | 将框架算子分派到目标设备 |
| 集合通信 | NCCL | HCCL | 多 Rank 的 AllReduce、AllGather 等 |
| 推理引擎 | vLLM、SGLang、TensorRT-LLM | vLLM-Ascend、MindIE、SGLang Ascend 路径 | 调度、KV Cache、批处理和模型执行 |
| 设备观测 | nvidia-smi、DCGM、Nsight | npu-smi、msprof、Ascend-DMI 等 | 状态、指标、诊断和性能分析 |
| Kubernetes 接入 | NVIDIA Device Plugin/GPU Operator | Ascend Device Plugin/MindCluster 相关组件 | 资源发现、分配、健康和容器注入 |

“CANN 类似 CUDA”适合建立第一印象，但 CANN 的软件包划分、图编译、算子体系和版本关系具有自己的边界，不能照搬 CUDA 参数或故障结论。

## 7. 一句 Python 代码怎样到达设备

### 7.1 NVIDIA GPU

```python
import torch

x = torch.randn(1024, 1024, device="cuda:0", dtype=torch.float16)
y = x @ x
torch.cuda.synchronize()
```

可以拆成：

```text
Python创建Tensor
→ PyTorch选择CUDA设备后端
→ CUDA分配显存
→ 矩阵乘算子选择对应Kernel/加速库
→ Host向CUDA Stream提交任务
→ GPU异步执行
→ synchronize等待任务完成并返回错误
```

### 7.2 昇腾 NPU

```python
import torch
import torch_npu

x = torch.randn(1024, 1024, device="npu:0", dtype=torch.float16)
y = x @ x
torch.npu.synchronize()
```

可以拆成：

```text
Python创建Tensor
→ torch-npu选择NPU设备实现
→ CANN Runtime分配HBM
→ 算子选择ACLNN/ATB/编译图等路径
→ Host向NPU Stream/Task Queue提交任务
→ NPU异步执行
→ synchronize等待任务完成并返回错误
```

两段程序的上层语义相似，但底层 Kernel、编译器、算子库、环境变量和错误日志不同。

## 8. 为什么错误经常出现在“后一个算子”

GPU 和 NPU 都大量采用异步执行：

```text
Host提交A → 立即返回
Host提交B → 立即返回
Device执行A、B
Host在C处同步
此前B的错误在C处被观察到
```

因此 Python Traceback 的最后一行可能是错误观察点，不一定是最初触发点。

| NVIDIA | 昇腾 | 用途 |
| --- | --- | --- |
| `CUDA_LAUNCH_BLOCKING=1` | `ASCEND_LAUNCH_BLOCKING=1` | 诊断时暂时同步执行，使错误更靠近触发位置 |
| `torch.cuda.synchronize()` | `torch.npu.synchronize()` | 明确建立同步边界 |

同步模式会改变性能和时序，只适合受控复现，不应作为生产常态。

## 9. 显存与 HBM 怎样理解

无论 GPU 还是 NPU，大模型服务的设备内存通常包括：

```text
设备内存
= 权重分片
 + KV Cache
 + 激活峰值
 + 图捕获/编译工作区
 + 通信缓冲区
 + 运行时和分配器
 + 安全余量
```

“NPU 有 HBM，所以 HBM 就是 NPU”同样错误。HBM 是设备旁的高带宽内存，NPU/GPU 是执行计算的处理器。

`--gpu-memory-utilization` 是 vLLM 的公共参数名；在 vLLM-Ascend 中它实际约束的是 NPU 设备内存规划。参数保留 `gpu` 字样，不代表底层设备变成了 NVIDIA GPU。

## 10. 多卡通信怎样对照

```text
NVIDIA：Rank → NCCL → NVLink/NVSwitch、PCIe 或 RoCE/IB
昇腾： Rank → HCCL → HCCS/PCIe 或 RoCE
```

NCCL/HCCL 是集合通信软件库，NVLink/HCCS/RoCE 是数据可能经过的硬件或网络路径。看到通信超时，应找第一个异常 Rank、物理设备映射和真实链路，不能只修改通信超时参数。

## 11. 容器和 Kubernetes 中怎样使用设备

### 11.1 NVIDIA 路线

```text
宿主机 NVIDIA Driver
→ NVIDIA Device Plugin 上报 nvidia.com/gpu
→ Scheduler选择节点
→ kubelet/Device Plugin分配GPU
→ NVIDIA Container Toolkit注入设备和驱动库
→ 容器内CUDA/PyTorch使用GPU
```

### 11.2 昇腾路线

```text
宿主机Ascend Driver/Firmware
→ Ascend Device Plugin上报NPU扩展资源
→ Scheduler选择节点
→ kubelet/Device Plugin分配NPU
→ 容器运行时注入设备文件和宿主机能力
→ 容器内CANN/torch-npu使用NPU
```

资源键、注解和注入方式取决于实际 Device Plugin 版本。不要在 Kubernetes 中绕过设备插件手工指定物理设备，否则调度器、监控和故障隔离可能看到不同的设备归属。

## 12. 推理框架为什么要做硬件适配

先记住结论：**可以复用的是请求管理和调度思想，必须适配的是在设备上真正执行模型的部分。** GPU 和 NPU 都能完成矩阵计算，但它们使用不同的运行时、算子实现、图执行机制、内存接口和集合通信库。CUDA Kernel 不能直接交给昇腾 NPU 执行，CANN 算子也不能直接在 NVIDIA GPU 上运行。

### 12.1 把推理框架分成控制层和执行层

```text
控制层：大部分可以复用
用户请求
→ OpenAI API Server
→ Tokenizer
→ Scheduler / Continuous Batching
→ 决定本轮运行哪些请求、使用哪些 KV Block

执行层：必须适配硬件
→ 创建并放置 Tensor
→ 分配设备内存
→ 执行 Attention、MatMul、RMSNorm 等算子
→ 执行多卡集合通信
→ 返回 Logits
```

Scheduler 只需要知道请求长度、优先级、可用 KV Block 和本轮 Batch，不必理解矩阵乘法最终使用哪种芯片指令；Model Runner 则需要真正申请设备内存、调用算子和启动通信，因此必须认识目标硬件。

### 12.2 同一个 Token 在 GPU 和 NPU 上怎样执行

两种后端共用上层请求路径，进入模型执行阶段后开始分叉：

```text
同一批请求和 KV Block Table
                 │
          Model Runner
          ┌──────┴──────┐
          │             │
   NVIDIA GPU        昇腾 NPU
   torch.cuda        torch_npu
   CUDA Runtime      CANN / ACL Runtime
   CUDA Kernel       CANN / ATB 等算子
   CUDA Graph        ACLGraph / npugraph_ex 等图能力
   NCCL              HCCL
```

例如 Python 层都可以表达 `attention(query, key, value)`，但继续向下执行时，NVIDIA 路径会选择适合 CUDA 的 Attention/融合 Kernel，昇腾路径则要选择适合 CANN 和 NPU 数据布局的算子。函数表达的数学目标相同，真正执行它的程序并不相同。这与同一份程序需要分别编译为 x86 和 ARM 指令是同一类问题。

### 12.3 KV Cache 哪些部分能复用

“KV Cache 可以跨设备复用”不是说同一套底层实现可以直接运行，而是指它的**管理思想**可以复用：

| 可以复用的逻辑 | 必须适配的实现 |
| --- | --- |
| 请求需要多少 KV Block | KV Cache 分配在哪种设备内存中 |
| Block 的占用、释放和复用 | 数据类型、对齐方式和物理布局 |
| Prefix Cache 的命中关系 | Attention 算子怎样读取 Block Table |
| Scheduler 何时回收 Block | 多卡场景怎样访问或交换 KV 数据 |

因此更准确的说法是：**KV Cache 的块管理可以复用，KV Cache 的内存分配、数据布局和算子访问仍需硬件适配。**

### 12.4 为什么启动参数看起来相似

下面这些参数描述的是推理目标，而不是底层硬件指令：

```bash
--tensor-parallel-size 2
--dtype bfloat16
--max-model-len 32768
--gpu-memory-utilization 0.85
```

例如 `--tensor-parallel-size 2` 都表示使用两个设备执行 Tensor Parallel，但后端动作不同：

```text
原生 vLLM
→ 创建 CUDA Worker
→ 在 GPU 上分片模型
→ 使用 NCCL 完成集合通信

vLLM-Ascend
→ 创建 NPU Worker
→ 在 NPU 上分片模型
→ 使用 HCCL 完成集合通信
```

同理，`bfloat16` 在两种环境里表达相同的数据精度目标，但算子支持、内存布局、图编译和性能表现仍需分别验证。参数名字相近只能说明上层使用方式相似，不能说明底层实现相同。

### 12.5 没有适配层会发生什么

直接在昇腾机器上运行只包含 CUDA 后端的原生 vLLM，可能在不同阶段失败：

```text
设备初始化：找不到 CUDA Device 或 CUDA Runtime
加载阶段：CUDA 自定义算子无法加载
执行阶段：Attention、量化或融合算子没有 NPU 实现
图模式：CUDA Graph 无法用于 NPU
多卡阶段：NCCL 无法管理 HCCL 设备和链路
```

即使通用 PyTorch 算子能够让部分模型运行，缺少设备专用融合算子和图优化时也可能出现吞吐很低、时延很高或显存/HBM利用不合理。因此硬件适配不仅解决“能不能启动”，还决定执行是否正确、性能是否可用以及故障是否能够定位。

最终可以这样理解：

```text
vLLM 核心框架负责决定“这轮算哪些请求”
硬件适配层负责完成“这些计算怎样在目标设备上执行”
```

所以原生 vLLM 与 vLLM-Ascend 的命令大部分相似，但镜像、版本矩阵、算子、图模式、通信、性能特征和故障日志不同。详细差异见[昇腾 910B、vLLM-Ascend 与原生 vLLM 源码差异](../../ai-systems/inference/vllm/24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md)。

## 13. 常见命令对照

| 目标 | NVIDIA GPU | 昇腾 NPU |
| --- | --- | --- |
| 查看总体状态 | `nvidia-smi` | `npu-smi info` |
| 查看利用率/内存 | `nvidia-smi dmon`、DCGM | `npu-smi info -t usages` |
| 查看健康 | `nvidia-smi -q`、`dcgmi health --check` | `npu-smi info -t health` |
| 查看 ECC | `nvidia-smi -q -d ECC,ROW_REMAPPER` | `npu-smi info -t ecc -i DEVICE_ID` |
| 查看进程 | `nvidia-smi pmon` | `npu-smi info`/目标版本支持的进程查询 |
| 性能分析 | Nsight Systems/Compute | msprof/目标 CANN Profiling 工具 |
| 集合通信测试 | `nccl-tests` | HCCL Test/目标版本配套工具 |

命令不是完全等价替换。先执行帮助命令确认当前版本支持的字段：

```bash
nvidia-smi --help
npu-smi info -h
```

## 14. 版本矩阵为什么重要

两套环境都不能只检查一个版本号：

```text
NVIDIA：GPU架构 ↔ Driver ↔ CUDA Runtime/Toolkit ↔ PyTorch ↔ 推理框架
昇腾： NPU型号 ↔ Firmware ↔ Driver ↔ CANN ↔ torch-npu/PyTorch ↔ 推理框架
```

容器镜像隔离了用户态软件，但不能替代宿主机驱动、固件和物理设备。遇到“同一个镜像在某节点失败”时，要比较完整矩阵、镜像 digest 和设备型号，而不是只比较 Python 包。

## 15. 故障怎样按层定位

| 现象 | 优先检查层 | NVIDIA 证据 | 昇腾证据 |
| --- | --- | --- | --- |
| 设备完全看不见 | PCIe、驱动、设备注入 | `lspci`、`nvidia-smi`、Device Plugin | `lspci`、`npu-smi info`、Device Plugin |
| 程序报 OOM | 权重、KV、激活、分配器 | PyTorch allocator、HBM、框架指标 | torch-npu allocator、HBM、框架指标 |
| 多卡卡住 | 首个 Rank、集合通信、链路 | NCCL、NVLink/RoCE、Xid | HCCL、HCCS/RoCE、设备错误 |
| 设备错误后服务假活 | Worker、设备健康、探针 | Xid、DCGM、Worker 日志 | UCE/health/ECC、CANN、Worker 日志 |
| 利用率低但排队高 | Host、调度、KV、慢 Rank | CPU/Timeline/DCGM | CPU/Timeline/NPU 指标 |
| 性能突然下降 | 温度、功耗、频率、拓扑 | clocks/throttle/DCGM | temp/power/usage、拓扑与设备日志 |

一条错误通常会向上传导：

```text
物理设备或链路
→ 驱动/Runtime错误
→ Worker或Rank退出
→ Engine无法推进
→ API超时或流式中断
→ Kubernetes探针和业务告警
```

排障时既要从用户请求向下追，也要从第一条设备错误向上还原影响。

## 16. 三个容易混淆的问题

### 16.1 GPU 是 CUDA 吗

不是。GPU 是硬件，CUDA 是 NVIDIA 围绕 GPU 提供的软件平台和编程模型。没有兼容的驱动和用户态运行库，GPU 硬件存在也不代表 PyTorch 能使用。

### 16.2 NPU 是 CANN 吗

不是。NPU 是硬件类别，Ascend 910B 是具体 NPU，CANN 是服务昇腾硬件的软件平台，`torch-npu` 是 PyTorch 到 CANN 的适配层。

### 16.3 NPU 是把 GPU 改了名字吗

不是。二者都能执行大规模并行 AI 计算，也都有设备内存、运行时、算子和通信库，但硬件指令、计算单元、编译器、算子实现和工具链不同。应用框架需要单独适配和验证。

## 17. 建议完成的实验

### 17.1 识别完整软件栈

NVIDIA 节点记录：

```bash
nvidia-smi
nvcc --version 2>/dev/null || true
python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

昇腾节点记录：

```bash
npu-smi info
cat /usr/local/Ascend/driver/version.info 2>/dev/null
cat /usr/local/Ascend/firmware/version.info 2>/dev/null
python -c "import torch, torch_npu; print(torch.__version__, torch_npu.__version__, torch.npu.is_available())"
```

### 17.2 观察异步执行

分别运行一个小矩阵乘法，在计算后加入显式同步，比较错误出现位置和执行耗时。不要在生产设备上故意制造非法访问。

### 17.3 建立设备映射

记录：

```text
Kubernetes Node
→ Pod UID
→ 容器逻辑设备ID
→ 宿主机物理设备ID
→ GPU UUID/PCI BDF 或 NPU物理ID
```

这个映射是后续 ECC、UCE、掉卡和慢 Rank 排障的基础。

## 18. 学完后的判断标准

读完本文后，应当能够独立回答：

1. 为什么 GPU 不等于 CUDA，NPU 不等于 CANN？
2. `torch.cuda` 和 `torch.npu` 分别通过什么软件栈到达设备？
3. CUDA Version、Driver Version、CANN Version 为什么不能混为一谈？
4. 为什么 GPU/NPU 的 Python 错误栈可能滞后？
5. NCCL/HCCL 与 NVLink/HCCS/RoCE 分别处在哪一层？
6. 为什么容器有 CUDA/CANN 库仍然离不开宿主机驱动？
7. vLLM-Ascend 为什么不能只把原生 vLLM 的 `cuda` 字符串替换成 `npu`？
8. 如何把一个故障 Worker 映射到宿主机物理加速卡？

如果这些问题能讲清楚，就已经建立了从硬件到推理框架的共同地图。后续再分别深入 CUDA Kernel、CANN 图执行、设备通信和硬件故障排查。

## 19. 参考资料

- [NVIDIA CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)
- [CUDA Programming Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html)
- [CANN 社区版文档入口](https://www.hiascend.com/document/detail/en/CANNCommunityEdition/850/index/index.html)
- [Ascend Extension for PyTorch 安装架构](https://www.hiascend.com/document/detail/en/Pytorch/2600/configandinstg/instg/docs/en/installation_guide/installation_description.md)
- [Atlas 800I A2 与 Ascend 910B 软硬件架构](../../ai-systems/inference/vllm-ascend/05-Atlas-800I-A2与Ascend-910B软硬件架构.md)
