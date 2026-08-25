---
title: "KV Cache 抢占、重计算与运行中 OOM"
sidebar_label: "05. KV Cache 与运行中 OOM"
sidebar_position: 5
description: "从 KV Block 生命周期、Prefix Cache、抢占、重计算、长上下文与取消释放分析运行期排队、尾延迟和 OOM。"
tags: [KV Cache, Preemption, Recompute, OOM, Prefix Cache]
---

# KV Cache 抢占、重计算与运行中 OOM

模型启动成功只证明初始显存规划可以完成。在线运行后，请求长度、并发、Batch 和多模态输入会不断改变
激活与 KV Cache 压力。KV 不足可能先表现为排队和抢占，最后才出现 OOM。

## 1. KV Cache 保存什么

自回归生成需要重复使用历史 Token 的 Key/Value。没有 KV Cache，每生成一个 Token 都要重新计算全部历史。

近似主体：

```text
单 Token KV
≈ 2 × 层数 × KV Head × Head Dim × KV dtype 字节

请求 KV
≈ 单 Token KV × 已缓存 Token 数
```

混合模型、滑动窗口、跨层共享、量化 KV 和不同 TP 切分会改变公式，应使用框架报告的 Block 大小与容量校准。

## 2. KV Block 生命周期

```text
请求到达
→ 为 Prefill 分配 Block
→ 写入输入 Token KV
→ Decode 追加 KV
→ 请求完成/取消
→ Block 进入可复用或释放状态
```

Prefix Cache 开启时，请求结束后的某些 Block 可能保留哈希引用，供相同前缀复用；它们应能在内存压力下被回收，
不等于永久泄漏。

## 3. 需要区分的五种“缓存不足”

| 类型 | 现象 |
|---|---|
| 单请求长度过大 | 一个请求需要的 KV 超过可容纳上限 |
| 总并发 Token 过多 | 所有活跃请求累计 KV 超限 |
| 碎片/Block 粒度浪费 | 有剩余但无法有效满足分配 |
| Prefix Cache 占用 | 可复用块增加，回收策略影响容量 |
| 其他显存峰值挤压 | 激活、Graph、通信或新进程占用余量 |

“KV 使用率高”只是现象，需要确定哪种压力。

## 4. 抢占在做什么

当 Scheduler 无法为运行请求继续分配 KV 时，可能暂停或抢占部分请求，把资源让给其他请求。

常见恢复方式：

- **Recompute**：丢弃部分 KV，请求恢复时重新 Prefill。
- **Swap/Offload**：把状态移到 CPU 或其他层级，框架支持情况不同。
- **Reject/Abort**：直接拒绝或终止请求。

抢占不是 OOM，但会增加 Queue、TTFT 和额外计算。持续抢占说明服务运行在不健康容量区间。

## 5. 重计算为何放大负载

假设长请求已经 Prefill 20k Token，KV 被回收后恢复：

```text
第一次 Prefill 20k
+ 恢复时再次 Prefill 20k
= 额外算力和更长延迟
```

在过载时，重计算会消耗更多算力，可能形成：

```text
KV 压力
→ 抢占
→ 重计算
→ 有效吞吐下降
→ Queue 增长
→ 更多请求并存
→ KV 压力继续增加
```

所以不能把“没有 OOM”当作容量安全。

## 6. Prefix Cache 命中怎样看

Prefix Cache 适合大量请求共享稳定前缀，例如相同 System Prompt。评估时同时看：

- 可缓存 Token 数。
- 命中 Token 数。
- 命中率。
- 复用节省的 Prefill 时间。
- Cache Block 占用与回收。
- 租户隔离和哈希安全边界。

只看请求命中率可能误导：短前缀请求都命中，但节省 Token 很少；少量长前缀命中反而价值更高。

## 7. 运行中 OOM 的来源

```text
运行中显存
= 固定权重与 Context
+ KV Cache
+ 当前 Batch 激活
+ 临时 Kernel Workspace
+ Graph 私有内存
+ 通信 Buffer
+ 多模态 Encoder
+ 其他进程和分配器差额
```

启动 Profiling 只能覆盖它采用的形状和假设。真实请求超过最大图片、Batch Token 或并发边界时，仍可能出现新峰值。

## 8. OOM 发生阶段决定处理方法

| 阶段 | 典型原因 | 优先方向 |
|---|---|---|
| 请求准入 | 单请求声明超过上限 | 明确拒绝和限制 |
| Prefill | 长 Prompt/多模态激活峰值 | 长度、Chunk、批处理、输入限制 |
| KV 分配 | 总 Token/并发过高 | 准入、KV 预算、扩容 |
| Decode | KV 持续增长、临时工作区 | 输出上限、并发、Kernel |
| 通信 | NCCL/HCCL Buffer 增长 | 并行配置和通信库 |
| 输出/取消后 | 资源未释放 | 生命周期和泄漏排查 |

降低 `max_num_seqs` 可能缓解总并发 KV，但不能让模型权重本身变小。

## 9. 启动 OOM 与运行 OOM

启动 OOM 通常发生在权重、Profiling、KV 初始化或 Graph Capture；运行 OOM 与具体 Request、Batch 和取消生命周期相关。

运行 OOM 证据必须包含：

- Request ID 和 Token 长度。
- 当时 Running/Waiting 数。
- Scheduled Token 和 Batch 构成。
- KV 使用率与抢占。
- 每个 Rank 的显存。
- 第一条 OOM 所在 Rank 和算子。
- 同时刻设备/节点事件。

## 10. 请求取消后的 KV 释放

理想状态：

```text
client disconnect
→ API abort
→ Scheduler 移除请求
→ Worker 不再执行
→ KV Block 引用释放
→ 可用 Block 恢复
```

验证方法：

1. 记录取消前 KV 使用量和 Running 数。
2. 主动取消长请求。
3. 确认 Request 从引擎状态消失。
4. 等待异步清理窗口。
5. 确认 KV Block 和显存恢复到合理基线。

Caching Allocator 可能继续保留 `reserved`，所以设备总显存不一定立即下降；应同时看框架可用 Block 和活跃请求。

## 11. “显存没有下降”不一定是泄漏

需要区分：

- 活跃 Tensor `allocated`。
- PyTorch Allocator `reserved`。
- 框架预分配 KV Pool。
- Prefix Cache 可回收 Block。
- Graph 和通信固定内存。
- 真正无法释放的引用。

预分配 KV Pool 在服务生命周期内保持稳定是设计行为。泄漏更常表现为相同工作负载循环后，可用 Block 或活跃分配持续单向恶化。

## 12. 关键指标

请求：

```text
input/output tokens
queue, TTFT, prefill, decode
finish_reason, cancelled
```

缓存和调度：

```text
KV usage / free blocks
running / waiting requests
preemption / recompute count
prefix cache hit tokens
scheduled tokens
```

设备：

```text
per-rank memory used
allocator allocated/reserved
device utilization
OOM / ECC / Xid / UCE
```

## 13. 容量拐点实验

固定模型、输入/输出 Token 分布，逐级增加并发：

| 并发 | Queue P99 | TTFT P99 | KV 使用率 | 抢占率 | Goodput |
|---:|---:|---:|---:|---:|---:|
| 1 | | | | | |
| 2 | | | | | |
| 4 | | | | | |
| 8 | | | | | |

安全容量应位于抢占和 Queue 快速上升之前，并保留异常输入和 N-1 余量。

## 14. 调参顺序

1. 确认模型、KV dtype、上下文和并行配置。
2. 使用真实 Token 分布复现。
3. 找到是单请求、并发还是激活峰值。
4. 先设置输入、输出、并发和 Batch Token 准入边界。
5. 再评估 KV 预算、Chunked Prefill、Cache 和框架参数。
6. 用 Goodput、尾延迟和错误率验证，不只看 OOM 是否消失。

## 15. 常见错误

- 把理论最大并发当成生产并发。
- 只看设备显存百分比，不看 KV Block 和 Request 状态。
- 通过无限排队避免拒绝，导致 TTFT 全部超标。
- 取消请求后不验证 Engine Abort。
- 把预分配 KV Pool 当作显存泄漏。
- 同时修改上下文、并发、显存比例和 Batch Token，无法归因。

## 16. 延伸阅读

- [Prefill、Decode 与 KV Cache 资源模型](../vllm/08-Prefill-Decode与KV-Cache资源模型.md)
- [Scheduler、Batch、KV Cache 与抢占实验](../vllm/18-Scheduler-Batch-KVCache与抢占性能实验.md)
- [vLLM GPU 显存组成与容量规划](../serving/02-vLLM%20GPU%20显存组成与容量规划.md)
- [CUDA OOM 排查与优化](../../../gpu/cluster/troubleshooting/05-CUDA%20OOM%20排查与优化.md)
