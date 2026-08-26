---
title: "TensorRT-LLM LLM API、PyExecutor、Scheduler、KVCacheManager 与一次生成路径"
sidebar_label: "01. 架构与生成路径"
sidebar_position: 1
description: "从 LLM API 到每 Rank Worker、请求调度、KV 分配、模型前向和采样，理解 TensorRT-LLM Runtime。"
tags: [TensorRT-LLM, PyExecutor, Scheduler, KV Cache]
---

# TensorRT-LLM LLM API、PyExecutor、Scheduler、KVCacheManager 与一次生成路径

## 1. 核心对象

| 对象 | 职责 |
| --- | --- |
| `LLM` API | 模型初始化、请求入口和生成接口 |
| Executor/Worker | 每个 Rank 的执行循环和分布式协调 |
| Scheduler | 每一轮选择可运行请求与 Token Budget |
| KVCacheManager | 分配、释放、复用和转移 KV Block |
| ModelEngine | 加载模型并执行 GPU Forward |
| Sampler | 从 Logits 进行 Greedy/Top-k/Top-p 等采样 |

## 2. 初始化路径

```text
LLM(model=..., parallel_config=...)
→ 解析模型与硬件能力
→ 创建world_size个Worker/PyExecutor
→ 初始化NCCL通信组
→ 加载Checkpoint或TensorRT Engine
→ 分配权重、Workspace、KV Cache
→ 建立CUDA Graph/执行Profile
→ Ready
```

启动慢要分解模型下载、CPU 读取、反序列化、Host→GPU 搬运、量化/构建、通信初始化、KV 分配和 CUDA Graph 捕获。只看总启动时间无法确定优化点。

## 3. 请求与 Prefill

```text
Prompt → Tokenizer → Request Queue
→ Scheduler选择请求并预算Token/Block
→ KVCacheManager为Prompt分配Block
→ ModelEngine执行Prefill Forward
→ 产生首个Token Logits
→ Sampler生成Token
```

TTFT 包含入口排队和 Prefill，不等于单次 GPU Forward。长 Prompt 会占更多 Token Budget、KV Block 和计算时间，可能阻塞短请求。

## 4. Decode 循环

```text
每轮：拉取新请求
→ 选择Running/Prefill/Decode请求
→ 准备KV Page与输入Tensor
→ GPU Forward得到下一Token
→ CPU/GPU Sampling与停止条件
→ 完成请求释放KV，未完成进入下一轮
```

Continuous/Inflight Batching 允许每个 Decode Step 重组 Batch，完成的槽位立即被新请求使用。TPOT 受模型带宽、Batch、KV 访问、通信和 CPU 调度共同影响。

## 5. Overlap Scheduler

Overlap Scheduler 让 GPU 执行第 `n+1` 轮时，CPU 处理第 `n` 轮输出、停止条件与响应，从而隐藏 Host 端开销。它可能多执行一个投机式 Step，收益取决于 CPU 瓶颈和批次。

CUDA Graph 用缓存的执行图减少 Kernel Launch 开销；实际 Batch 不匹配捕获尺寸时可 Pad 到附近 Graph，或回退其他路径。要监控 Graph 命中和 Padding 浪费。

## 6. 取消与流式响应

客户端断开后，请求取消必须传播到 Server 和 Executor，及时从 Scheduler 删除并释放 KV。否则 GPU 继续为无人接收的请求生成 Token。流式完成需要最终标志、Usage 和 Finish Reason 正确，网络断开不等于模型执行已经停止。

参考：[TensorRT-LLM Architecture](https://nvidia.github.io/TensorRT-LLM/architecture/overview.html)、[Paged Attention and Request Scheduling](https://nvidia.github.io/TensorRT-LLM/features/paged-attention-ifb-scheduler.html)。
