---
title: "CUDA Graph、Tensor Parallel 与通信融合稳定性分析"
sidebar_label: "26. CUDA Graph、TP 与通信融合稳定性"
sidebar_position: 26
description: "从捕获、重放、Rank一致性、Buffer地址和自定义AllReduce解释TP场景卡死与错误输出，并给出最小复现和根因验证矩阵。"
tags: [vLLM, CUDA Graph, Tensor Parallel, NCCL, Custom AllReduce, Debugging]
---

# CUDA Graph、Tensor Parallel 与通信融合稳定性分析

现象常常是：`TP=1` 正常，`TP>1 + CUDA Graph` 卡死或输出错误，关闭 Graph 后恢复。正确结论不是“CUDA Graph 有问题”，而是：

```text
Graph是触发条件
真正根因可能位于通信顺序、Buffer地址、Shape、Stream或自定义算子的Capture契约
```

关闭 Graph 会同时改变 Launch、内存、编译和通信执行路径。它是很有价值的隔离实验，但不能单独证明根因。

## 1. 先建立普通执行与 Graph 执行的差异

### 1.1 Eager

```text
每一轮Decode
→ CPU根据当前Shape准备参数
→ 逐个Launch计算与通信
→ Runtime可进行动态分配和分支
```

### 1.2 Capture 与 Replay

```text
Warmup目标Shape
→ 在指定Stream捕获Kernel、Memcpy和依赖
→ 实例化GraphExec
→ 新请求写入稳定输入Buffer
→ Replay同一执行拓扑
```

Replay 依赖预先记录的节点、依赖和参数关系。框架通常为若干 Batch/Token Shape 建立 Bucket；无法命中时回退 Eager 或进入其他 Graph 模式。

## 2. Capture、Instantiate、Replay 分别做什么

| 阶段 | 关键动作 | 常见失败 |
| --- | --- | --- |
| Warmup | 初始化库、分配稳定Buffer、触发编译/Autotune | 首次调用副作用未消除 |
| Capture | 记录Stream上的GPU工作和依赖 | 动态分配、Host同步、不支持的操作 |
| Instantiate | 把Graph转成可执行GraphExec | 参数或依赖不合法、资源不足 |
| Replay | 用稳定地址和拓扑反复执行 | 地址生命周期错误、Shape/Rank分歧、旧Buffer |

“Capture 成功”只说明捕获阶段没有立即报错，不保证 Replay 的数据、Rank 和生命周期正确。

## 3. 为什么地址稳定是核心约束

Graph 节点会关联输入、输出、Workspace 或通信 Buffer。框架常用固定地址的静态 Buffer：

```text
新请求动态Tensor
→ copy到静态Input Buffer
→ Graph读取静态地址
→ 输出写入静态Output Buffer
→ 框架读取有效区域
```

以下错误可能只在 Replay 暴露：

- 临时 Tensor Capture 后释放，地址被复用；
- 不同 Bucket 错用同一 Buffer；
- 自定义算子缓存了旧指针；
- View/Stride 变化但 Graph 仍按旧布局读取；
- 请求取消后 Buffer 提前归还；
- TP Rank 的注册 Buffer 地址表不一致。

## 4. TP 为什么让问题更复杂

TP 把一层计算分散到多个 Rank，并在固定位置执行 Collective：

```text
Rank0 GEMM shard ─┐
Rank1 GEMM shard ─┼→ AllReduce/ReduceScatter/AllGather → 下一层
RankN GEMM shard ─┘
```

Collective 的基本契约是：

- 所有参与 Rank 使用同一个 Communicator；
- 以相同顺序进入匹配的 Collective；
- Count、Dtype 和操作类型匹配；
- 输入/输出 Buffer 生命周期有效；
- Stream 和依赖保证数据已经准备好。

TP=1 没有这组跨 Rank 契约，所以“TP=1 正常”只能把范围缩到并行特有路径，不能证明模型 Kernel 全部正确。

## 5. NCCL 与 CUDA Graph 的额外约束

NCCL Collective 可以被 Graph 捕获，但“是否被捕获”对参与 Collective 的 Rank 是一致性属性。各 Rank 应以匹配方式捕获并 Replay。

典型风险：

- 一个 Rank 命中 Graph，另一个 Rank 回退 Eager；
- Rank 选择了不同 Graph Bucket；
- 某 Rank 因条件分支少执行或多执行一次 Collective；
- 多 Communicator Graph 从同一线程以不一致顺序 Launch；
- 单进程管理多 GPU 时，阻塞 Launch 造成互相等待；
- Graph Mixing、Stream Ordering 或 Buffer Registration 配置不一致。

卡死时最重要的不是“看到 NCCL 最后一行日志”，而是比较所有 Rank 的最后一个 Collective 序号、类型、Count、Stream 和 Graph 模式。

## 6. Custom AllReduce 为什么更容易暴露地址问题

推理框架可能为小消息 TP 通信提供自定义 AllReduce，使用 IPC、Peer Memory 或注册的共享 Buffer 减少开销。为了 Graph Replay，它往往需要预先登记固定 Buffer 地址。

检查点包括：

- 每个 Rank 登记了哪些本地/远端地址；
- Capture 和 Replay 是否使用同一内存池；
- Buffer 大小是否覆盖最大 Bucket；
- 地址表是否在所有 Rank 初始化完成后才使用；
- Graph 重建后旧地址是否失效；
- 自定义路径不支持目标拓扑时是否可靠回退 NCCL。

如果关闭 Custom AllReduce 后 `TP+Graph` 稳定，范围就从“所有 TP 通信”进一步收敛到自定义路径或其交互，但仍需用地址、Stream 和 Collective Trace 证明。

## 7. 算子替换发生在 Capture 前还是后

这是分析 Graph 问题时必须回答的问题。

### 7.1 Capture 前替换

```text
模型构建/编译Pass
→ 将普通算子替换为融合或自定义算子
→ Warmup
→ Capture替换后的真实执行路径
```

Graph 记录的是新算子。修复算子实现后，通常需要使旧编译产物和 Graph 失效并重新 Capture。

### 7.2 Capture 后替换

如果只修改 Python 调度对象，而 GraphExec 已经记录旧 Kernel/参数，Replay 可能继续执行旧图。除非使用受支持的 Graph Update 或间接参数机制，否则“代码对象换了”不等于 Graph 节点自动换了。

排查时记录：

- Pattern Rewrite/Module Replacement 的日志时间；
- Compile Cache Key；
- Warmup 与 Capture 时间；
- Graph Bucket 创建时间；
- Replay 实际 Kernel 名称；
- 修改后是否清理并重建相关缓存。

## 8. Graph 为什么可能只是暴露条件

### 8.1 原有 Race 被固定时间关系放大

Eager Launch 间隙可能碰巧提供足够同步；Graph Replay 更紧凑，使缺失 Event/Stream 依赖稳定暴露。

### 8.2 走了不同 Kernel

框架可能在 Graph 模式启用全图编译、融合 Pass、Custom AllReduce 或特定 Attention Backend。关闭 Graph 后不仅“不重放”，还换了实现。

### 8.3 地址从动态变为静态

错误缓存指针、Alias 或 Buffer 有效区问题只在静态复用中出现。

### 8.4 Rank 执行差异被放大

Eager 分支可以逐轮动态决定；Graph 要求参与 Rank 对 Bucket 和 Collective 序列形成一致协议。

因此根因描述应是“哪个契约被破坏”，而不是“开 Graph 就坏”。

## 9. 最小复现矩阵

从最少变量开始：

| 实验 | TP | Graph | 通信 | 目的 |
| --- | ---: | --- | --- | --- |
| A | 1 | Eager | 无TP Collective | 验证模型基础路径 |
| B | 1 | Graph | 无TP Collective | 验证单卡Capture/Replay |
| C | 2 | Eager | 默认 | 验证TP基础路径 |
| D | 2 | Graph | 默认 | 复现交互问题 |
| E | 2 | Graph | 禁用Custom AR/改用NCCL | 隔离自定义通信 |
| F | 2 | Eager | 与D同融合Kernel | 分离Graph与算子替换 |
| G | 2 | Graph | 固定单一Bucket | 排除Shape/Bucket分歧 |

每组固定模型、输入 Token、Batch、Dtype、Sampling、驱动、框架和拓扑，并保存每个 Rank 的独立日志。

## 10. 卡死时如何取证

### 10.1 框架层

- 每个 Rank 当前请求和 Scheduler Step；
- 选中的 Graph Mode/Bucket；
- Scheduler Output 中 Token 数是否一致；
- 是否有某 Rank 回退 Eager；
- Custom Op/AllReduce 选择日志。

### 10.2 通信层

- Communicator、Rank、Collective 序号；
- AllReduce/ReduceScatter 的 Count 和 Dtype；
- 各 Rank 最后一条成功的 Collective；
- NCCL Debug/Profiler Trace；
- NVLink/PCIe 错误计数和拓扑。

### 10.3 GPU 时间线

- 各 Rank Graph Launch 时间；
- Graph 内通信 Kernel 是否出现；
- 某 Rank 是否停在计算、通信或 Host 等待；
- Stream/Event 依赖；
- 是否出现非法内存访问后异步挂起。

日志要按 Rank 分开保存并对齐单调时钟，混成一个文件很难识别谁先偏离。

## 11. 错误输出时如何取证

用逐层哨点寻找第一个不同 Tensor：

```text
输入Token/Position
→ Attention Metadata
→ QKV/RoPE
→ KV写入位置
→ TP线性层本地输出
→ Collective后输出
→ MLP/MoE
→ Logits/Sampling
```

每个哨点记录 Shape、Stride、Dtype、有效区 Hash 和有限数量统计值。不要把完整用户输入或 Tensor 无保护写入日志。

若 Eager 与 Graph 的第一个差异发生在 Collective 前，优先查静态 Buffer、Kernel 或 Metadata；若 Collective 输入相同、输出首次不同，优先查通信 Count、地址和 Rank 顺序。

## 12. 修复与回归

修复必须匹配根因：

| 根因 | 修复方向 |
| --- | --- |
| Rank Bucket 不一致 | 在进入 Graph 前形成全 Rank 一致的 Shape/模式协议 |
| 旧地址/生命周期 | 使用稳定内存池，重建地址表和 Graph，增加生命周期断言 |
| 缺失 Stream 依赖 | 明确 Event/Stream 顺序，移除对偶然 Host 延迟的依赖 |
| Collective 序列分歧 | 去除 Rank-local 控制分支或在分支前达成一致 |
| 自定义通信不支持拓扑 | 明确禁用并回退受支持路径 |
| 算子替换与旧图不一致 | 使编译缓存和 GraphExec 一起失效重建 |

回归覆盖：多 Bucket、不同 Batch、混合 Prefill/Decode、并发请求、取消、压力、Graph 重建、进程重启和目标多机拓扑。

## 13. 性能结论如何表达

关闭 Graph 后问题消失，通常也会增加 CPU Launch 开销或改变融合路径。因此可先将“关闭 Graph”作为止损手段，再分别报告：

- 稳定性是否恢复；
- TTFT/TPOT/吞吐损失；
- 受影响 Shape 和流量比例；
- 修复后 Graph 路径是否恢复原性能；
- 是否仍有 Eager 回退。

不能把“关闭开关能跑”写成最终根因，也不能为了性能保留无法证明正确的路径。

## 14. 自测题与答案

### 14.1 为什么 TP=1 正常、TP=2+Graph 卡死，不能直接判定是 NCCL Bug？

TP=2 新增了 Collective、Rank 一致性、共享/注册 Buffer 和并行分支；Graph 又改变地址、Launch 和执行路径。根因可能在框架 Bucket、自定义 AllReduce、Stream 依赖或算子，而不是 NCCL 本身。需要比较各 Rank Collective 序列和最小复现矩阵。

### 14.2 Capture 和 Replay 的根本区别是什么？

Capture 记录一次 GPU 工作拓扑、参数关系和依赖；Replay 使用已经实例化的 GraphExec 重复执行。Capture 成功不代表 Replay 时的地址生命周期、输入有效区和 Rank 协议正确。

### 14.3 为什么关闭 Graph 后问题消失，Graph 仍可能不是根因？

关闭 Graph 可能同时换回 Eager Kernel、禁用融合或自定义通信、恢复动态地址并增加 Launch 间隙。它改变了多个条件，可能只是避开了真正的 Race、旧指针或 Rank 分歧。

### 14.4 算子替换为什么要关心发生在 Capture 前还是后？

Capture 前替换会让新算子进入 Graph；Capture 后仅修改上层对象时，已有 GraphExec 可能继续执行旧节点。修复必须确保编译产物、静态 Buffer 和 Graph 一起失效并重建。

### 14.5 如何区分 Graph 的性能收益与通信融合收益？

固定 Shape 和其他配置，分别测试 Eager+默认通信、Graph+默认通信、Eager+融合通信、Graph+融合通信，并用时间线确认各路径实际命中。没有这组消融，不能单独归因。

## 15. 参考资料

- [vLLM CUDA Graphs Design](https://docs.vllm.ai/en/latest/design/cuda_graphs/)
- [NCCL: Using NCCL with CUDA Graphs](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/cudagraph.html)
- [CUDA Graphs](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#cuda-graphs)
- [vLLM Parallel State API](https://docs.vllm.ai/en/latest/api/vllm/distributed/parallel_state/)
