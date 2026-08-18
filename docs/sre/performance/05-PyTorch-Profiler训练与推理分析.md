---
title: "PyTorch Profiler 训练与推理分析"
sidebar_label: "05. PyTorch Profiler 训练与推理分析"
sidebar_position: 5
description: "使用 torch.profiler 分析训练与推理中的 CPU Operator、CUDA Kernel、输入 Shape、调用栈和 Tensor Memory，并控制采集窗口与开销。"
tags: [PyTorch, Profiler, CUDA, Operator, Memory, TensorBoard]
---

# PyTorch Profiler 训练与推理分析

PyTorch Profiler 位于框架语义和系统执行之间：

```text
Python Function
→ PyTorch Operator
→ ATen
→ CUDA Runtime
→ CUDA Kernel
```

它适合回答：

- 哪个 PyTorch Operator 最耗时？
- CPU 时间和 CUDA 时间是否匹配？
- 同一个 Operator 被调用多少次？
- 输入 Shape 是什么？
- Tensor Memory 在哪一步增长？
- DataLoader、Forward、Backward、Optimizer 如何分布？

它不能完全替代：

- Nsight Systems 的系统级多进程/通信时间线。
- Nsight Compute 的 Kernel 硬件计数器。
- perf/eBPF 的 Linux 内核分析。

## 1. CUDA 是异步的

Python 调用：

```python
y = torch.matmul(a, b)
```

通常只是向 CUDA Stream 提交工作，CPU 可能很快返回。

因此：

```text
CPU Operator Duration
≠ CUDA Kernel Duration
≠ 用户请求 Wall Time
```

Profiler 通过关联 CPU Operator 和 Device Activity 帮助理解异步关系。

手工计时时如果不做正确同步，结果可能只测到 Launch：

```python
start = time.perf_counter()
y = torch.matmul(a, b)
elapsed = time.perf_counter() - start
```

端到端基准可在边界同步，但不要在每个 Operator 后同步，因为会破坏真实 Pipeline。

## 2. 最小示例

```python
import torch
from torch.profiler import ProfilerActivity, profile

def workload():
    x = torch.randn(4096, 4096, device="cuda")
    w = torch.randn(4096, 4096, device="cuda")
    return x @ w

for _ in range(5):
    workload()

torch.cuda.synchronize()

with profile(
    activities=[
        ProfilerActivity.CPU,
        ProfilerActivity.CUDA,
    ],
) as prof:
    workload()
    torch.cuda.synchronize()

print(
    prof.key_averages().table(
        sort_by="self_cuda_time_total",
        row_limit=20,
    )
)
```

Warmup 用于排除：

- CUDA Context 初始化。
- Kernel/Library 首次加载。
- Allocator 初始行为。
- JIT/torch.compile 编译。
- Autotune。

## 3. `activities`

常见：

```python
activities=[
    ProfilerActivity.CPU,
    ProfilerActivity.CUDA,
]
```

当前 PyTorch 还可能支持 XPU 等 Activity，取决于构建和设备。

只分析 CPU 时不要无意义启用 Device Trace；只分析 CUDA 又通常仍应保留 CPU，用于
Operator 关联。

## 4. 使用 Schedule 控制窗口

长训练任务不能从头记录到尾。

```python
from torch.profiler import schedule

prof_schedule = schedule(
    wait=2,
    warmup=2,
    active=4,
    repeat=1,
)
```

含义：

```text
Step 0-1: WAIT
Step 2-3: WARMUP
Step 4-7: RECORD
```

必须每个 Step 调用：

```python
prof.step()
```

完整示例：

```python
import torch
from torch.profiler import ProfilerActivity, profile

with profile(
    activities=[
        ProfilerActivity.CPU,
        ProfilerActivity.CUDA,
    ],
    schedule=torch.profiler.schedule(
        wait=2,
        warmup=2,
        active=4,
        repeat=1,
    ),
    on_trace_ready=torch.profiler.tensorboard_trace_handler(
        "./profiler-traces"
    ),
) as prof:
    for step, batch in enumerate(data_loader):
        train_step(batch)
        prof.step()

        if step >= 7:
            break
```

如果忘记 `prof.step()`，Schedule 不会按训练迭代推进。

## 5. TensorBoard Trace

```python
on_trace_ready=torch.profiler.tensorboard_trace_handler(
    "./profiler-traces",
    worker_name="rank0",
)
```

查看：

```bash
tensorboard --logdir ./profiler-traces
```

可观察：

- Operator。
- CUDA Kernel。
- Stream。
- Trace View。
- Memory。
- 分布式 Worker（取决于 Trace 和插件支持）。

报告目录可能很大，应使用短窗口并设置保留策略。

## 6. `key_averages`

```python
table = prof.key_averages().table(
    sort_by="self_cuda_time_total",
    row_limit=30,
)
print(table)
```

常见列：

```text
Self CPU
CPU total
Self CUDA / Device
CUDA / Device total
Calls
CPU/CUDA time avg
```

具体名称随 PyTorch 版本和设备 Activity 演进。

### 6.1 Self 与 Total {/* #self-与-total */}

```text
Self：当前 Operator 自身，不含子 Operator
Total：包含子 Operator
```

与 perf report 的 Self/Children 思路相似。

### 6.2 按 Shape 分组 {/* #按-shape-分组 */}

启用：

```python
record_shapes=True
```

然后：

```python
prof.key_averages(
    group_by_input_shape=True
)
```

同一个 `aten::mm` 在不同 Shape 下性能完全不同，不能只看聚合平均。

## 7. `record_function`

给代码增加语义范围：

```python
from torch.profiler import record_function

with record_function("DATA_TO_DEVICE"):
    batch = move_to_device(batch)

with record_function("MODEL_FORWARD"):
    output = model(batch)

with record_function("LOSS"):
    loss = criterion(output, target)

with record_function("BACKWARD"):
    loss.backward()
```

推理：

```python
with record_function("PREFILL"):
    prefill()

with record_function("DECODE_STEP"):
    decode_step()
```

名称使用低基数，不放用户输入。

## 8. Shape 与 Stack

```python
with profile(
    activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
    record_shapes=True,
    with_stack=True,
) as prof:
    workload()
```

- `record_shapes`：记录输入 Shape。
- `with_stack`：记录调用栈/源码位置。

开销：

- 更多元数据。
- Stack Unwind。
- `record_shapes=True` 可能暂时持有 Tensor 引用，影响引用计数和某些优化。

只在需要定位 Source/Shape 时开启。

## 9. FLOPs

```python
with_flops=True
```

Profiler 可为部分 Operator（如矩阵乘/卷积）估算 FLOPs。

限制：

- 不是所有 Operator 都支持。
- 理论 FLOPs 不等于硬件实际指令。
- 稀疏、量化、Fusion 可能需要专门解释。
- 不能仅用 FLOPs 判断内存受限操作。

Roofline 的硬件流量和峰值分析仍使用 Nsight Compute。

## 10. Memory Profiling

```python
with profile(
    activities=[
        ProfilerActivity.CPU,
        ProfilerActivity.CUDA,
    ],
    profile_memory=True,
    record_shapes=True,
    with_stack=True,
) as prof:
    workload()
```

可分析：

- Tensor Allocate/Free。
- Operator 内存变化。
- 峰值阶段。
- 生命周期。

注意区分：

```text
Tensor Allocated Memory
PyTorch Caching Allocator Reserved Memory
CUDA Context/Library/Graph/NCCL Memory
vLLM KV Cache Pool
```

PyTorch Profiler 的 Tensor Memory 不能代表 `nvidia-smi` 的全部显存。

### 10.1 Memory Timeline {/* #memory-timeline */}

PyTorch 版本支持时可导出：

```python
prof.export_memory_timeline("memory.html")
```

所需选项和格式以当前 API 文档为准。

## 11. 导出 Chrome Trace

```python
prof.export_chrome_trace("trace.json")
```

可在支持 Chrome Trace Format 的查看器中打开。

使用 Schedule 多周期时，通常通过 `on_trace_ready` 为每个周期生成独立文件，避免覆盖。

## 12. 训练分析

建议范围：

```text
DATA_LOAD
H2D
FORWARD
LOSS
BACKWARD
OPTIMIZER
ZERO_GRAD
CHECKPOINT
```

### 12.1 DataLoader 瓶颈 {/* #dataloader-瓶颈 */}

症状：

- GPU 时间线周期性空洞。
- CPU DataLoader Range 很长。
- H2D 不能连续供给。

检查：

- `num_workers`。
- Prefetch。
- Pinned Memory。
- 数据解码。
- 小文件/共享存储。
- CPU Affinity/NUMA。

### 12.2 H2D {/* #h2d */}

检查：

- `.to(device, non_blocking=True)`。
- Host Tensor 是否 Pinned。
- Copy Stream。
- Compute/Copy 是否重叠。

### 12.3 Backward {/* #backward */}

关注：

- Operator 和 Kernel。
- Gradient Bucket。
- NCCL AllReduce。
- Compute/Communication Overlap。
- Rank Straggler。

## 13. 推理分析

范围：

```text
TOKENIZE
PREFILL
DECODE_STEP
SAMPLE
OUTPUT_PROCESS
```

### 13.1 Prefill {/* #prefill */}

按 Input Shape 分组：

- Prompt Length。
- Batch。
- Attention Backend。

### 13.2 Decode {/* #decode */}

按：

- Running Sequences。
- Context Length。
- TP Size。
- KV dtype。

对比。

### 13.3 vLLM {/* #vllm */}

vLLM 使用多进程、定制 CUDA/Triton Kernel 和独立 Engine Loop。

PyTorch Profiler 可以分析部分 Worker/ModelRunner 路径，但完整请求还要结合：

- vLLM Metrics。
- NVTX。
- Nsight Systems。
- 每个 Worker Rank。

只在 API Server 进程开启 Profiler，可能采不到 GPU Worker。

## 14. 多进程与分布式

每个 Rank 写独立 Trace：

```python
worker_name = f"rank-{rank}"
```

需要保存：

```text
global_rank
local_rank
node
gpu_uuid
tp/pp/dp/ep group
clock/time base
```

分析 NCCL 时：

- 找最晚进入 Collective 的 Rank。
- 不只看 NCCL Kernel Duration。
- 关联前序 Operator 和 CPU Launch。

大规模任务不要所有 Rank 同时开启重型 Stack/Shape/Memory，先采代表 Rank 和异常 Rank。

## 15. `torch.compile`

编译模式会产生：

- Graph Capture。
- Compilation。
- Autotune。
- Generated/Triton Kernel。
- Fusion。

采集时分开：

```text
Compile/Warmup Phase
Steady-state Phase
```

如果把第一次运行计入稳态，会夸大延迟。

优化前后要比较：

- Kernel 数量。
- Launch Gap。
- Fusion 后 Memory Traffic。
- Compile 成本。
- 动态 Shape Recompile。

## 16. 常见同步陷阱

这些操作可能触发 CPU 等待 GPU：

- 某些 `.item()`。
- 将 CUDA Tensor 转到 CPU。
- 需要 Host 值的控制流。
- 显式 `torch.cuda.synchronize()`。
- Debug/Memory 操作。

Profiler 时间线上可以看到 CPU Operator 与 CUDA 同步 API 的对应关系。

并不是所有 `.item()` 都应删除；需要重新设计异步依赖和正确性。

## 17. Profiler 开销

从低到高通常：

```text
CPU/CUDA Activity
→ + Shape
→ + Memory
→ + Stack
→ 长窗口/全 Rank
```

量化开销：

```text
overhead =
  profiled_throughput / baseline_throughput - 1
```

也比较：

- Step Time。
- Memory。
- Report Size。
- CPU Usage。

Profiler 结果用于定位，最终性能数字来自无 Profiler 的独立基准。

## 18. 分析流程

1. 无 Profiler 建立稳态基线。
2. 用 Metrics/Trace 确定异常阶段。
3. 只选择少量 Step。
4. 先启用 CPU+CUDA Activity。
5. 看 `key_averages`。
6. 需要时增加 Shape/Stack/Memory。
7. 用 Trace View 看异步和重叠。
8. 对热点 CUDA Kernel 转到 Nsight Compute。
9. 单变量优化。
10. 无 Profiler A/B 复测。

## 19. 常见错误

### 19.1 没有 Warmup {/* #没有-warmup */}

把 CUDA 初始化、编译和 Autotune 当稳态。

### 19.2 忘记 `prof.step()` {/* #忘记-profstep */}

Schedule 不推进。

### 19.3 全程开启 Stack/Shape/Memory {/* #全程开启-stackshapememory */}

开销和报告过大。

### 19.4 CPU 时间当 GPU 时间 {/* #cpu-时间当-gpu-时间 */}

忽略异步 Launch。

### 19.5 为计时每步 synchronize {/* #为计时每步-synchronize */}

破坏重叠和真实执行。

### 19.6 只看 Operator 平均 {/* #只看-operator-平均 */}

不同 Shape 和阶段被聚合。

### 19.7 Profiler 下收益当生产收益 {/* #profiler-下收益当生产收益 */}

采集本身改变执行。

## 20. 实验

1. 对矩阵乘运行最小 Profiler。
2. 比较 CPU 与 CUDA Duration。
3. 使用 Schedule 只采 4 个 Step。
4. 用 `record_function` 标记 Forward/Backward。
5. 启用 Shape 并按 Shape 分组。
6. 启用 Memory Timeline，观察 Tensor 生命周期。
7. 故意加入 `.item()`，观察同步。
8. 对 `torch.compile` 分开首轮和稳态。
9. 导出 Trace。
10. 记录 Profiler 开销并无采集复测。

## 21. 验收清单

- [ ] 能解释 CUDA 异步对计时的影响。
- [ ] 能正确配置 Activity、Schedule 和 `prof.step()`。
- [ ] 能读 Self/Total CPU/CUDA。
- [ ] 能按 Input Shape 分组。
- [ ] 能使用 `record_function` 建立阶段语义。
- [ ] 能控制 Shape/Stack/Memory 的开销。
- [ ] 能区分 Tensor Memory 与进程总显存。
- [ ] 能分析 DataLoader/H2D/Forward/Backward/NCCL。
- [ ] 能为多 Rank 生成独立 Trace。
- [ ] 能把热点 Kernel 交给 Nsight Compute。

## 22. 官方资料

- [PyTorch Profiler API](https://docs.pytorch.org/docs/stable/profiler.html)
- [PyTorch Profiler Recipe](https://docs.pytorch.org/tutorials/recipes/recipes/profiler_recipe.html)

下一篇用可重复的在线压测把这些内部证据转成最大 SLO 容量、安全水位和单位成本。
