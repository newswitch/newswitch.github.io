---
title: "Executor、Worker 与 GPUModelRunner"
sidebar_position: 6
tags: [vLLM, V1, Executor, GPUModelRunner, 源码分析]
description: "沿 SchedulerOutput 分析 vLLM 多进程 Executor、Worker、GPUModelRunner 的职责、通信和一次执行。"
---

# Executor、Worker 与 GPUModelRunner

`Scheduler.schedule()` 的产物不是 CUDA Kernel，而是一份 `SchedulerOutput`。它描述本轮哪些请求要运行、各运行多少 token、使用哪些 KV Block，以及哪些请求刚加入或已经完成。

本篇回答：**这份调度结果如何跨过进程与 rank 边界，变成一次真正的 GPU 执行？**

> 源码基线：vLLM `v0.23.0`。不同执行后端的进程组织可能不同，但 Executor、Worker、ModelRunner 这三个职责边界是阅读主线。

---

## 1. 三层职责不要混淆

| 层次 | 主要职责 | 典型输入 | 典型输出 |
| --- | --- | --- | --- |
| Executor | 管理 worker/rank，广播执行命令，收集结果和处理失败 | `SchedulerOutput` | `ModelRunnerOutput` 或异步结果 |
| Worker | 初始化设备与分布式环境，管理本 rank 模型执行器 | RPC 方法和配置 | 本 rank 执行结果 |
| GPUModelRunner | 把调度增量变成 GPU Tensor，执行模型、Logits 和采样 | 调度状态、KV 映射 | token、logprob、草稿 token 等 |

可以把它类比为：

```text
Executor      = 车队调度中心
Worker        = 每辆车的驾驶与设备管理
GPUModelRunner= 车内真正执行计算的动力系统
```

Executor 不应该理解每种 Attention Kernel 的 Tensor 布局；GPUModelRunner 也不应该决定 HTTP 请求的租户限流。

---

## 2. 为什么需要 Executor 抽象

同一套 EngineCore 需要支持不同部署形态：

```text
单 GPU / 单进程
单机多 GPU / 多进程 TP
多机多 GPU
外部 launcher 或其他分布式执行后端
```

如果 Scheduler 直接调用具体 GPU 进程，它会被进程创建、消息队列、rank、超时和故障处理淹没。Executor 把这些差异封装成较稳定的执行接口：

```text
execute_model(scheduler_output)
sample_tokens(grammar_output)
collective_rpc(...)
check_health()
shutdown()
```

这也解释了为什么“GPU 没忙”不一定是模型 Kernel 问题：命令可能还没有成功穿过 Executor 边界。

---

## 3. 多进程 Executor 如何发起一次执行

在多进程实现中，`execute_model()` 的核心并不复杂：它通过 `collective_rpc()` 把同一份调度结果发送到各 Worker。

概念流程如下：

```text
EngineCore
  │ SchedulerOutput
  ▼
MultiprocExecutor.execute_model()
  │ 将 execute_model + 参数入广播消息队列
  ├──────────────┬──────────────┐
  ▼              ▼              ▼
Worker rank 0   Worker rank 1   Worker rank N
  │              │              │
  └──────── 各 rank 协同执行 ────┘
                 │
                 ▼
          指定 output rank 返回
```

`v0.23.0` 的多进程 Executor 会：

1. 检查 Executor 是否已失败；
2. 把方法名、参数和需要返回结果的 rank 入广播队列；
3. 从对应响应队列等待结果；
4. 应用执行超时；
5. 把 Worker 错误提升为 Engine 可感知的失败。

它还监控 Worker 进程存活。一旦任意 Worker 异常退出，不能把剩余 rank 当成健康副本继续服务，因为一次 TP 执行需要所有相关 rank 正确参与。

---

## 4. 为什么只从一个 output rank 返回

TP 场景中每个 rank 都参与模型计算，但并不需要让所有 rank 把同一份最终 token 结果传回 EngineCore。

输出 rank 通常是：

- 最后一个 PP Stage；
- 该 Stage 中指定的 TP rank。

例如 TP=8、PP=4，总 world size 为 32。前 24 个 rank 位于前三个 PP Stage，最终输出来自最后一个 Stage 的指定 rank。

注意两个不同的“同步”：

1. **计算同步**：各 rank 必须完成必要的 collective；
2. **结果返回**：只需一个 rank 把 `ModelRunnerOutput` 返回上层。

因此某个非输出 rank 变慢，依然会拖慢整次推理；“它没有返回 HTTP 数据”不代表它不在关键路径上。

---

## 5. Worker 负责设备和进程局部状态

Worker 是进程边界内的执行入口，通常负责：

- 设置 CUDA Device；
- 初始化分布式进程组；
- 确认 TP/PP/DP rank；
- 加载本 rank 权重分片；
- 初始化或绑定 KV Cache；
- 创建 `GPUModelRunner`；
- 响应 Executor 的执行、健康检查和关闭命令。

启动故障可以按阶段划分：

```text
进程未启动
→ CUDA Device 不可用
→ 分布式组网失败
→ 权重分片加载失败
→ KV Cache 初始化失败
→ CUDA Graph / Dummy Run 失败
→ 服务才可能 Ready
```

这也是 Kubernetes readiness 不能只检查“端口能连接”的原因。API 进程存活时，后端某个 Worker 可能仍未完成初始化，甚至已经死亡。

---

## 6. GPUModelRunner 内部保存什么

`GPUModelRunner` 是状态很重的对象。理解它时可按四类状态分组：

### 6.1 配置边界

- 模型 dtype、最大长度；
- KV Cache dtype；
- `max_num_batched_tokens`；
- `max_num_seqs`；
- TP/PP/DCP 等并行配置；
- 编译与 CUDA Graph 配置。

### 6.2 CPU 侧请求状态

- 当前活跃 request ID 到内部索引的映射；
- 各请求 token、已计算位置与采样参数；
- 本轮新增、恢复、继续和完成的请求。

### 6.3 预分配 CPU/GPU Buffer

- input IDs；
- positions；
- slot mapping；
- query start location；
- sampling metadata；
- 输出 token 与有效长度。

预分配的意义是减少每个 Step 的 Python 对象创建和 CUDA allocation。

### 6.4 模型与执行状态

- 模型权重；
- KV Cache Tensor；
- Attention Backend 元数据；
- CUDA Graph；
- 异步输出拷贝与执行间临时状态。

所以 ModelRunner 不是一个无状态 `model(input_ids)` 包装器，而是调度状态到 GPU 执行状态的适配层。

---

## 7. 一次 `execute_model` 的五个阶段

不同模型和特性会插入额外分支，但主干可以稳定地分成五步。

### 阶段一：合并调度增量

ModelRunner 不会每轮重建全部请求。它消费 SchedulerOutput 中的增量：

```text
新请求      → 建立 CPU 侧状态
继续运行请求 → 更新已计算 token 和 Block 映射
恢复请求    → 重建必要状态
完成请求    → 移除索引与缓存
```

如果这一步 CPU 很慢，GPU 会在两次执行之间出现空洞。

### 阶段二：准备输入与 Slot Mapping

为本轮实际 token 准备：

- `input_ids`；
- `positions`；
- 请求边界；
- token 到物理 KV Block/Slot 的映射；
- Attention Backend 所需 metadata。

Prefill 和 Decode 可以在同一个调度批次中共存，但每条请求本轮 token 数不同，不能简单把它当作传统等长 Batch。

### 阶段三：选择执行形状

实际 token 数不一定等于编译或 CUDA Graph 的捕获形状。Runner 可能把输入 Pad 到可复用形状，也可能对不支持的动态情况走 Eager 路径。

```text
本轮形状命中已捕获 Graph → Graph Replay
形状或特性不兼容         → Eager / 新编译路径
```

频繁落入 Eager 不一定报错，但会表现为 Kernel Launch 空洞、CPU 开销上升和尾延迟抖动。

### 阶段四：模型前向与 Logits

模型执行读取权重和历史 KV，写入新 token 的 KV，并产生 Hidden States/Logits。Attention Backend 根据模型、GPU、dtype 和配置选择具体 Kernel。

TP 模式下，层间会发生 collective；MoE/EP 还可能加入 All-to-All。慢 rank 会把所有 rank 拖到同步点。

### 阶段五：采样与输出拷贝

Logits 经过采样约束后得到 token。为了减少同步，Runner 可以把 GPU 到 CPU 的结果复制放到独立 Stream，并在上层真正读取时同步。

这一步若发生频繁小 Tensor 同步，也会造成：

- GPU Util 看似不高；
- CPU 线程等待 CUDA Event；
- Timeline 出现很多短 Kernel 与空隙；
- TPOT 尾部抖动。

---

## 8. `execute_model()` 与 `sample_tokens()` 为什么可能分开

在结构化输出、推测解码或异步调度等路径中，模型前向与最终采样可能被拆开。`GPUModelRunner` 会保存一次短生命周期的 `ExecuteModelState`，其中包含：

- 本轮 `SchedulerOutput`；
- logits；
- hidden states；
- speculative decode metadata；
- CUDA Graph 统计或 Slot Mapping 等执行信息。

这说明源码阅读不能强行假设：

```text
execute_model() 返回值 == 最终 token
```

更稳妥的理解是：执行阶段产生足够的模型结果，采样阶段再结合 grammar/约束形成最终 token 输出。

---

## 9. 性能问题怎样定位到这一层

| 证据 | 更可能的位置 | 下一步 |
| --- | --- | --- |
| Scheduler 有工作，但执行调用之间空洞大 | ModelRunner CPU 准备、IPC、Python 或同步 | Nsight Systems + CPU Profiling |
| 所有 rank 同时空闲 | 上游没有及时提交，或共同等待 CPU/队列 | 查 EngineCore、Tokenizer、Executor 队列 |
| 一个 rank 晚、其他 rank 卡在 collective | 慢 rank、拓扑、PCIe/NVLink/NCCL | 分 rank 时间线与链路计数器 |
| Graph Replay 少、Eager 多 | Shape 波动、特性不兼容、Graph 配置 | 统计 Batch Shape 与 Graph 命中 |
| GPU Kernel 连续但 TPOT 高 | 单步计算或通信真的慢 | Kernel/带宽/collective 分解 |
| Worker 偶发退出 | OOM、驱动 Xid、进程异常、健康监控 | 对齐 Worker 日志、dmesg/DCGM |

“GPU 利用率 30%”在这一层至少有四种完全不同的含义：

1. Scheduler 没有给够工作；
2. Executor/ModelRunner CPU 准备太慢；
3. GPU 每次工作很短，中间同步很多；
4. 多卡某个 rank 变慢，其他 GPU 等待。

必须用时间线区分，不能只改 `max_num_seqs`。

---

## 10. 故障边界与健康检查

生产上建议把健康状态拆成：

| 状态 | 说明 |
| --- | --- |
| API Alive | HTTP 进程仍存活 |
| Engine Connected | Engine client 与 EngineCore 通道可用 |
| All Workers Alive | 相关 rank 进程都存活 |
| Model Ready | 权重、KV Cache、必要 warmup 完成 |
| Serving Ready | 能接受真实请求且未处于过载摘流状态 |

如果 Worker Monitor 报告任意进程死亡，通常应摘除整个副本，而不是继续向同一个 TP Group 发流量。

超时也要区分：

- HTTP 客户端超时；
- Gateway 排队超时；
- Executor RPC 超时；
- NCCL collective 超时；
- Kubernetes termination grace period。

相同的“timeout”字符串可能来自完全不同层。

---

## 11. 源码阅读路标

建议顺序：

1. `vllm/v1/executor/abstract.py`：先看稳定接口；
2. `vllm/v1/executor/multiproc_executor.py`：看 `execute_model()` 与 `collective_rpc()`；
3. `vllm/v1/worker/gpu_worker.py`：看设备、模型和 KV Cache 初始化；
4. `vllm/v1/worker/gpu_model_runner.py`：搜索 `GPUModelRunner`、执行状态和输出拷贝；
5. 回到 Nsight Systems 时间线，把 CPU、CUDA 与 NCCL 事件对齐。

固定版本源码：

- [multiproc_executor.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/executor/multiproc_executor.py)
- [gpu_worker.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/worker/gpu_worker.py)
- [gpu_model_runner.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/worker/gpu_model_runner.py)

延伸阅读：

- [Nsight Systems 端到端时间线分析](../../../sre/performance/03-Nsight-Systems端到端时间线分析.md)
- [TP、PP、DP、EP 与 MoE 推理并行策略](./10-TP-PP-DP-EP与MoE推理并行策略.md)

---

## 12. 学完后的验收题

1. Executor、Worker、GPUModelRunner 的职责分别是什么？
2. 为什么多卡只返回一个 output rank，慢的非输出 rank 仍会拖慢请求？
3. `SchedulerOutput` 到模型前向之间还有哪些 CPU 工作？
4. 为什么 CUDA Graph 未命中可能表现为低 GPU 利用率？
5. 为什么 API 端口可用不等于推理副本 Ready？
6. 怎样用 Timeline 区分上游饥饿、CPU 准备慢和 NCCL 等待？

下一篇继续深入 GPU 内部边界：模型层如何调用 Attention Backend，Logits 又如何经过 Sampling 变成 token。
