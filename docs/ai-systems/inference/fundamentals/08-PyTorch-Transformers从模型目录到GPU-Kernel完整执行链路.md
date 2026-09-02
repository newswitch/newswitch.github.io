---
title: "PyTorch 与 Transformers：从模型目录到 GPU Kernel 的完整执行链路"
sidebar_label: "08. PyTorch/Transformers 完整执行链路"
sidebar_position: 8
description: "从 AutoModel.from_pretrained、nn.Module、ATen Dispatcher、CUDA/CANN Kernel、显存分配到 generate Decode 循环，建立模型执行与故障定位主线。"
tags: [PyTorch, Transformers, AutoModel, Dispatcher, CUDA, CANN, Kernel, 推理]
---

# PyTorch 与 Transformers：从模型目录到 GPU Kernel 的完整执行链路

`AutoModelForCausalLM.from_pretrained()`看起来只是一行Python，但它背后连接了模型制品、Python对象、PyTorch算子、设备运行时和GPU/NPU Kernel。只知道“Transformers加载模型、PyTorch负责计算”还不够；真正排查启动慢、显存高、算子回退、Graph Break或设备报错时，必须知道问题发生在哪一层。

本文以Hugging Face Transformers和PyTorch推理为主线，同时给出CUDA与CANN的对应关系。它解释的是原生Transformers/PyTorch执行路径；vLLM、SGLang和MindIE会复用模型语义与底层算子，但会替换`generate()`调度、KV Cache管理和部分模型执行实现。

## 1. 学习目标

完成本文后，应能：

1. 区分Transformers、PyTorch、CUDA/CANN和GPU/NPU的职责；
2. 解释`from_pretrained()`怎样把配置与权重变成设备上的参数；
3. 解释调用`model()`时为什么不应直接调用`forward()`；
4. 从一个`Linear`或Attention算子追到ATen Dispatcher和设备Kernel；
5. 解释CUDA异步执行、显存分配和同步点；
6. 解释`generate()`为什么是多轮模型调用而不是一个Kernel；
7. 判断故障属于制品、Python模型、PyTorch、编译器、运行时还是硬件层。

## 2. 先建立分层边界

| 层 | 主要职责 | 常见对象或组件 |
|---|---|---|
| Transformers | 识别模型架构、加载配置与权重、Tokenizer、Generation逻辑 | `AutoConfig`、`PreTrainedModel`、`GenerationMixin` |
| PyTorch Python | 组织Module树、Tensor、Autograd、AMP与设备迁移 | `nn.Module`、`Parameter`、`Tensor` |
| PyTorch算子层 | 定义并分派通用算子 | ATen、Dispatcher、Dispatch Key |
| 编译与融合层 | 捕获计算图、生成或选择融合Kernel | Dynamo、AOTAutograd、Inductor、Triton |
| 设备运行时 | 管理Context、Stream、事件、内存和Kernel Launch | CUDA Runtime、CANN Runtime |
| 通信层 | 多卡集合通信 | NCCL、HCCL |
| 硬件层 | 执行指令、访问HBM与片上缓存 | GPU SM、NPU AI Core、HBM |

最重要的边界是：

```text
Transformers定义“这是什么模型、怎样生成Token”
PyTorch定义“这些Tensor算子怎样组织和分派”
CUDA/CANN负责“怎样在设备上启动Kernel和管理资源”
GPU/NPU负责“真正执行指令”
```

## 3. 两条主路径不要混淆

模型服务有加载路径和请求执行路径。

```text
加载路径
模型目录/Hub
→ config与AutoClass映射
→ 创建nn.Module树
→ 读取权重分片
→ dtype转换与device放置
→ 参数进入CPU内存或HBM

请求执行路径
文本
→ Tokenizer
→ input_ids Tensor
→ model(...)或generate(...)
→ PyTorch算子
→ Dispatcher
→ CUDA/CANN Kernel
→ logits
→ 采样与下一Token
```

模型加载成功只说明参数可用，不说明请求执行路径、Attention Backend、量化Kernel或通信路径正确。

## 4. `from_pretrained()`到底做了什么

一个最小示例：

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model_dir = "/models/example"
tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
model = AutoModelForCausalLM.from_pretrained(
    model_dir,
    torch_dtype="auto",
    local_files_only=True,
)
```

### 4.1 读取配置并确定Python类

`AutoConfig`读取`config.json`，关注：

- `model_type`和`architectures`；
- 层数、隐藏维度、Attention Head、KV Head；
- 词表大小、位置编码和最大长度；
- dtype、量化配置和Remote Code声明。

AutoClass不是一个万能模型类，而是根据配置映射到具体实现，例如某个`XxxForCausalLM`。如果模型需要仓库中的自定义Python代码，`trust_remote_code=True`会改变安全边界：模型制品不再只是数据，也包含可执行代码。生产中应固定Revision、审计代码并使用只读制品。

### 4.2 先创建Module树

具体模型类继承`PreTrainedModel`，最终仍是`torch.nn.Module`。初始化阶段会创建：

```text
Model
├── Embedding
├── DecoderLayer × N
│   ├── Attention
│   │   ├── Q/K/V/O Projection
│   │   └── RoPE与Attention实现
│   ├── MLP或MoE
│   └── Norm
└── LM Head
```

每个线性层、归一化层和Embedding都包含Parameter。大模型加载需要避免“先完整创建随机参数，再完整加载权重”造成双份内存峰值，因此现代加载路径可能使用Meta Device、分片加载、低CPU内存模式或Accelerate的设备放置策略。具体行为受Transformers、Accelerate和参数组合影响，不能仅凭API名称推断峰值。

### 4.3 解析权重索引与分片

大模型通常由多个`safetensors`分片组成，索引文件把参数名映射到分片：

```text
model.safetensors.index.json
├── model.embed_tokens.weight → shard-00001
├── model.layers.0.*          → shard-00001
├── model.layers.20.*         → shard-00004
└── lm_head.weight            → shard-00008
```

加载器逐个打开分片，把磁盘中的字节解释为具有shape和dtype的Tensor，再根据目标策略放到CPU、GPU/NPU或临时位置。这里可能发生：

- 文件读取、Page Cache和内存映射；
- dtype保持或转换；
- 参数名校验与Missing/Unexpected Key检查；
- tied weight绑定；
- CPU到设备的异步或同步复制；
- 量化权重的Packed Layout恢复或后处理。

### 4.4 `device_map`不是Tensor Parallel

`device_map="auto"`可把不同Module放到不同设备，也可能把部分权重放到CPU或磁盘，但它不等价于推理框架的Tensor Parallel：

| 方式 | 典型行为 |
|---|---|
| Device Map | 按Module切分或Offload，层之间传递激活 |
| Tensor Parallel | 同一层权重按维度切分，多Rank共同计算并通信 |
| Pipeline Parallel | 不同层放在不同Stage，按流水线传递激活 |

如果只是为了“放得下”而启用自动Device Map，性能可能受跨设备复制或CPU Offload限制。

### 4.5 加载完成后还没有执行推理

权重进入设备并不代表Kernel已经充分预热。第一次请求还可能触发：

- CUDA/CANN Context初始化；
- 算法选择与Workspace分配；
- JIT或Triton编译；
- `torch.compile`图捕获与编译；
- CUDA Graph或ACL Graph捕获；
- 通信域初始化；
- KV Cache或其他运行时Buffer分配。

因此应分别记录模型文件读取、权重装载、设备初始化、编译、Warmup和Ready时间。

## 5. Tokenizer怎样把文本变成Tensor

Tokenizer不在GPU上执行大部分工作，它通常在CPU完成：

```text
messages
→ Chat Template渲染
→ 文本规范化与切分
→ Token ID
→ attention_mask等输入
→ PyTorch Tensor
```

```python
inputs = tokenizer("hello", return_tensors="pt")
inputs = {name: value.to(model.device) for name, value in inputs.items()}
```

`.to(model.device)`会触发设备内存分配和主机到设备复制。Pinned Memory配合`non_blocking=True`可为异步H2D复制创造条件，但是否真正重叠还取决于Pinned Buffer、Stream和后续同步关系。

## 6. 为什么调用`model()`而不是`model.forward()`

PyTorch Module推荐通过：

```python
outputs = model(**inputs)
```

而不是直接调用：

```python
outputs = model.forward(**inputs)
```

`model(...)`进入`nn.Module.__call__`相关逻辑，再调用`forward()`。这条外层路径负责Module Hook、编译包装和框架约定。直接调用`forward()`可能绕过Forward Pre Hook、Forward Hook等机制，使Profiler、量化、调试或框架扩展行为与预期不同。

模型的`forward()`不是一个底层Kernel，它是由多个Tensor算子组成的Python计算过程。例如一个Decoder Layer大致会执行：

```text
RMSNorm
→ Q/K/V Linear
→ RoPE
→ Attention
→ O Projection
→ Residual Add
→ RMSNorm
→ MLP/MoE
→ Residual Add
```

## 7. 一个PyTorch算子怎样找到GPU Kernel

以线性层为例：

```text
nn.Linear.forward
→ torch.nn.functional.linear
→ ATen算子
→ PyTorch Dispatcher
→ 根据Tensor设备、dtype和功能Key选择实现
→ CUDA/CPU/PrivateUse1等Backend Kernel
→ cuBLAS/cuBLASLt、自定义CUDA Kernel或融合Kernel
```

### 7.1 Dispatcher根据什么分派

Dispatcher综合Tensor与当前上下文决定走哪条实现，常见维度包括：

- 设备：CPU、CUDA、Meta或厂商Backend；
- dtype与布局；
- Autograd是否开启；
- Autocast是否开启；
- Functionalization、Tracing或其他功能层；
- 算子是否有目标Backend注册实现。

在昇腾PyTorch中，`torch_npu`通过PyTorch扩展与设备Backend把算子映射到CANN/Ascend实现。若算子没有NPU实现，可能直接报错，也可能因上层代码发生CPU回退或额外数据搬运；是否回退必须用Profiler和Tensor Device验证，不能只看最终结果正确。

### 7.2 ATen算子不等于一个Kernel

一个ATen算子可能：

- 对应一个设备Kernel；
- 调用一个高性能库并由其启动多个Kernel；
- 被编译器与相邻算子融合；
- 根据shape、dtype和架构选择不同实现；
- 因不支持而分解成多个算子。

所以“模型有300个PyTorch算子”不能直接推导“每步启动300个Kernel”。真实Kernel边界必须通过Profiler或设备Trace确认。

## 8. CUDA执行为什么看起来是异步的

CPU线程调用CUDA算子时，通常把工作提交到CUDA Stream后继续运行：

```text
Python/CPU
→ Kernel Launch进入Stream队列
→ CPU继续提交后续工作
→ GPU按依赖执行Kernel
```

因此下面的CPU计时可能只测到提交时间：

```python
start = time.perf_counter()
output = model(**inputs)
elapsed = time.perf_counter() - start
```

需要显式同步才能测到完整设备执行时间：

```python
torch.cuda.synchronize()
start = time.perf_counter()
output = model(**inputs)
torch.cuda.synchronize()
elapsed = time.perf_counter() - start
```

生产性能分析优先使用CUDA Event、PyTorch Profiler、Nsight Systems等工具，避免频繁同步改变真实并行关系。昇腾环境同样需要理解异步任务队列与同步边界。

## 9. 显存是在什么时候分配的

显存不是只在加载权重时分配。一次原生Transformers推理可能包含：

| 类型 | 生命周期 |
|---|---|
| 模型权重 | 模型进程生命周期 |
| CUDA/CANN Context与库Workspace | 运行时或算子生命周期 |
| 输入Tensor | 单次请求或Batch |
| 中间激活 | 某层或某次Forward |
| KV Cache | 生成序列生命周期 |
| 编译/Graph Buffer | 编译结果或图实例生命周期 |
| PyTorch缓存分配器Reserved块 | 可能跨多次请求保留 |

PyTorch缓存分配器会把已释放Tensor对应的块保留以便复用，所以：

```text
Tensor已经释放
≠ nvidia-smi立刻下降
```

应区分框架的Allocated、Reserved和设备总占用。

## 10. `generate()`不是一次Forward

`model.generate()`通常由Transformers的Generation逻辑控制。自回归生成可简化为：

```text
准备输入和生成配置
→ 第一次Forward：Prefill全部Prompt
→ 得到最后位置logits和KV Cache
→ Logits Processor / Warper
→ Greedy、Sampling或Beam选择Token
→ 把新Token加入序列
→ 下一次Forward：通常只输入最新Token并复用KV
→ 重复直到停止条件
```

原生`generate()`中，Python控制循环、模型Forward、采样和停止条件共同组成生成过程。每轮Forward内部又会启动许多Kernel。它与vLLM的区别在于：

| 原生Transformers | vLLM等推理引擎 |
|---|---|
| 通常以一次调用中的Batch为中心 | 跨请求持续调度与Continuous Batching |
| KV Cache跟随模型调用管理 | Paged/Block化KV Cache管理 |
| Python Generation循环控制明显 | Engine/Scheduler控制Decode迭代 |
| 适合验证、研究和较简单服务 | 面向多请求吞吐、SLO与生产服务 |

理解原生链路仍然重要，因为Tokenizer、模型结构、权重、算子、dtype和Kernel问题会继续出现在推理引擎中。

## 11. Eager与`torch.compile`路径的区别

Eager模式下，Python执行到一个算子就通过Dispatcher提交对应实现：

```text
Python → ATen → Dispatcher → Kernel
```

`torch.compile`尝试把Python区域捕获为图：

```text
Python Frame
→ TorchDynamo捕获FX Graph
→ Guards约束输入和状态
→ AOTAutograd（训练时生成前后向图）
→ Inductor优化与融合
→ Triton/C++/设备Backend生成Kernel
→ 缓存编译结果
```

需要掌握四个现象：

1. **首次慢**：捕获、编译、Autotune和缓存写入；
2. **Graph Break**：不支持的Python行为把图切成多个区域；
3. **Recompile**：shape、dtype、Python常量或状态不满足已有Guard；
4. **Fallback**：达到重编译限制或Backend不支持时退回其他路径。

排查命令示意：

```bash
TORCH_LOGS="graph_breaks,recompiles,guards" python infer.py
```

日志名称与可用项随PyTorch版本变化，应先记录`torch.__version__`并对照该版本官方文档。

## 12. CUDA与CANN路径对照

| NVIDIA路径 | 昇腾路径 | 共同语义 |
|---|---|---|
| PyTorch CUDA Backend | torch-npu/Ascend Backend | 算子Backend |
| CUDA Runtime/Driver | CANN Runtime/Driver | 任务、Stream、内存 |
| cuBLAS/cuDNN/FlashAttention | Ascend库、ATB或CANN算子 | 高性能算子实现 |
| CUDA/Triton Kernel | AI Core/Vector Core Kernel | 设备执行 |
| NCCL | HCCL | 多卡集合通信 |
| Nsight/PyTorch Profiler | Ascend Profiler/Msprof | 时间线与热点分析 |

“API能运行”不代表两种硬件走相同Kernel。硬件适配必须处理算子注册、数据布局、图模式、通信库、编译器和Profiler接口。

## 13. 一条请求的完整执行地图

```text
模型启动
模型目录
→ AutoConfig与AutoClass
→ nn.Module树
→ 权重分片读取
→ Parameter绑定
→ CPU/GPU/NPU放置
→ Context、Workspace、编译与Warmup

单次请求
文本/messages
→ Chat Template与Tokenizer（CPU）
→ input_ids/attention_mask
→ H2D复制
→ Module.__call__
→ forward
→ ATen算子
→ Dispatcher
→ CUDA/CANN Backend
→ Kernel与通信
→ logits
→ 采样
→ 新Token
→ KV Cache复用并进入下一轮
→ Detokenize
```

## 14. 分层排障方法

| 现象 | 优先检查层 |
|---|---|
| 找不到模型类、配置字段错误 | Transformers配置与版本 |
| Missing/Unexpected Key | 模型架构、权重Revision、参数名 |
| 加载阶段CPU内存爆炸 | 分片加载、Meta初始化、dtype转换、并发加载 |
| `.to("cuda")`或`.to("npu")`失败 | Driver、Runtime、PyTorch设备Backend |
| 某算子Not Implemented | Dispatcher注册与目标Backend支持 |
| 第一轮很慢，后续正常 | Context、JIT、Autotune、图编译、Cache |
| shape变化后周期性卡顿 | Guard失败与Recompile |
| GPU/NPU利用率低而CPU高 | Tokenizer、Python循环、CPU回退、同步或小Batch |
| 显存持续上升 | KV Cache、引用未释放、输入积压、Graph/Allocator |
| 结果正确但性能差 | 慢Kernel、融合缺失、dtype、布局、通信、CPU回退 |

### 14.1 固定版本与设备信息

```python
import torch
import transformers

print("torch", torch.__version__)
print("transformers", transformers.__version__)
print("cuda", torch.version.cuda)
print("device", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu")
```

昇腾环境还需记录`torch_npu`、CANN、固件和驱动版本。

### 14.2 验证Tensor实际位置

```python
print(next(model.parameters()).device)
print(next(model.parameters()).dtype)
print(inputs["input_ids"].device)
```

不能只看启动参数里的`device`字符串。

### 14.3 分离加载、Prefill和Decode

分别记录：

- `from_pretrained()`耗时和峰值CPU内存；
- 权重进入设备后的显存；
- 第一次Forward与第二次Forward；
- Prompt长度固定时的Prefill；
- 每Token Decode延迟；
- Tokenizer和Detokenize耗时。

## 15. 最小学习实验

选择一个能在本机运行的小型Causal LM，完成以下实验：

1. 固定模型Revision和Transformers/PyTorch版本；
2. 记录模型目录文件与Checksum；
3. 分别测量Tokenizer、加载、第一次Forward、第二次Forward；
4. 打印Parameter的Device和dtype；
5. 用Profiler找出耗时最大的ATen算子和设备Kernel；
6. 改变Prompt长度，观察Prefill耗时；
7. 固定Prompt并增加输出Token，观察Decode时间和KV Cache；
8. 开启`torch.compile`，记录首次编译、稳定执行和Recompile；
9. 如果有两种设备，比较算子名、Kernel和回退行为，不只比较总耗时。

## 16. 常见误区

1. **Transformers就是推理引擎**：它提供模型和生成抽象，但不等于vLLM式多请求调度系统。
2. **一个Module对应一个Kernel**：Module由多个算子组成，算子又可能分解或融合。
3. **一个ATen算子对应一个Kernel**：实际可能调用多个Kernel或外部库。
4. **CPU计时就是GPU执行时间**：设备执行异步，需要正确同步或使用Event/Profiler。
5. **权重加载后显存就是最终峰值**：请求阶段还有KV、激活、Workspace和Graph Buffer。
6. **`device_map="auto"`等于Tensor Parallel**：两者切分与通信方式不同。
7. **`torch.compile`一定更快**：小模型、动态shape、Graph Break和频繁Recompile可能抵消收益。
8. **CUDA能跑，NPU只需改设备名**：算子、布局、图、通信与工具链都需要适配。

## 17. 课后练习

1. Transformers与PyTorch在模型加载和执行中分别负责什么？
2. `from_pretrained()`为什么可能出现两份权重内存峰值？
3. 为什么`model()`比直接调用`forward()`更完整？
4. PyTorch Dispatcher根据哪些信息选择Kernel？
5. `generate()`为什么不是一个GPU Kernel？
6. 为什么第一次请求慢而第二次正常？
7. CPU计时为什么可能低估GPU耗时？
8. `device_map="auto"`为什么不等于Tensor Parallel？
9. Graph Break和Recompile分别意味着什么？
10. 如何证明某个算子发生CPU回退？

### 17.1 参考答案

1. Transformers负责配置、模型类、Tokenizer、权重加载协议与Generation语义；PyTorch负责Module、Tensor、算子分派、Autograd/AMP、编译和设备Backend连接。
2. 如果先以真实Storage创建完整随机参数，再读取完整Checkpoint并复制到目标参数，会同时存在初始化参数、读取Buffer和最终参数；Meta初始化与分片加载用于降低该峰值。
3. `model()`经过Module调用包装，能够执行Hook和编译等框架逻辑，再进入`forward()`；直接调用`forward()`可能绕过这些机制。
4. Dispatcher综合算子Schema、Tensor设备、dtype、布局、Autograd、Autocast及其他Dispatch Key选择注册实现。
5. 自回归生成包含Prefill、逐Token Forward、KV复用、Logits处理、采样和停止条件，且每次Forward内部又包含多个Kernel。
6. 第一次请求可能初始化Context、选择算法、分配Workspace、编译Kernel、捕获Graph和建立Cache；这些结果可被后续请求复用。
7. CPU通常只把Kernel提交到异步Stream便继续执行；若无同步，计时可能在GPU完成前结束。
8. Device Map通常按Module放置或Offload；Tensor Parallel在同一层内切分权重并通过多Rank通信协同计算。
9. Graph Break把不可捕获代码分隔到图外；Recompile表示已有Guard不适用于新输入或状态，需要生成新的编译版本。
10. 同时检查Tensor Device、PyTorch Profiler的CPU/CUDA或NPU事件、设备时间线、H2D/D2H复制和目标Backend的算子注册/日志；不能只凭GPU利用率猜测。

## 18. 参考资料

- [Hugging Face Transformers：Loading models](https://huggingface.co/docs/transformers/models)
- [Hugging Face Transformers：PreTrainedModel](https://huggingface.co/docs/transformers/main_classes/model)
- [PyTorch：torch.nn.Module](https://docs.pytorch.org/docs/stable/generated/torch.nn.Module.html)
- [PyTorch：Extending PyTorch与Dispatcher](https://docs.pytorch.org/docs/stable/notes/extending.html)
- [PyTorch：torch.compile](https://docs.pytorch.org/docs/stable/generated/torch.compile)
- [PyTorch：torch.compile Programming Model](https://docs.pytorch.org/docs/main/user_guide/torch_compiler/compile/programming_model.html)

继续阅读：[PyTorch Dispatcher、Autograd与算子执行路径](../../../gpu/compiler-kernels/01-PyTorch-Dispatcher-Autograd与算子执行路径.md)、[模型服务从启动命令到接口就绪](../startup-troubleshooting/01-一个模型服务从启动命令到接口就绪经历了什么.md)和[从启动日志重建模型显存使用情况](../startup-troubleshooting/03-从启动日志重建模型显存使用情况.md)。
