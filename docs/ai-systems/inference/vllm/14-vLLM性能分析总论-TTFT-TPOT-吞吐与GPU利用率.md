---
title: "vLLM 性能分析总论：TTFT、TPOT、吞吐与 GPU 利用率"
sidebar_position: 14
tags: [vLLM, 性能分析, TTFT, TPOT, GPU]
description: "建立从业务 SLO 到排队、Prefill、Decode、GPU Timeline 和成本的 vLLM 性能分析方法。"
---

# vLLM 性能分析总论：TTFT、TPOT、吞吐与 GPU 利用率

vLLM 调优最常见的失败方式，是看到一个指标就改一个参数：GPU Util 低就加并发，TTFT 高就增大 `max_num_batched_tokens`，显存满就减小上下文。

正确方法是先建立时间和资源模型，再用实验排除瓶颈层。

---

## 1. 四个结果指标各回答什么

| 指标 | 用户感受 | 主要覆盖阶段 |
| --- | --- | --- |
| TTFT | 多久看到第一个 token | 准入、排队、Tokenization、首次调度、Prefill、首包传输 |
| TPOT/ITL | 后续 token 是否流畅 | Decode 调度、模型单步、采样、输出传输 |
| E2E | 整个请求多久完成 | TTFT + 全部 Decode + 尾部协议处理 |
| 吞吐 | 系统单位时间完成多少工作 | Prompt tokens/s、Generation tokens/s、Requests/s |

近似关系：

```text
E2E ≈ TTFT + (output_tokens - 1) × TPOT + tail_overhead
```

这个式子不能替代真实直方图，但能做一致性检查。如果公式估算与实测差距很大，往往存在客户端缓冲、排队统计口径或输出尾处理问题。

---

## 2. TTFT 必须继续拆分

```text
TTFT_client
= gateway_queue
+ request_parse
+ chat_template_and_tokenize
+ engine_ipc
+ scheduler_queue
+ prefill_compute
+ first_token_postprocess
+ server_and_network_flush
```

这些阶段没有任何一个等价于 GPU Util。

例如：请求在 Gateway 等了 800 ms，GPU 在这 800 ms 内完全可以在服务其他请求。用户 TTFT 已超标，但集群平均 GPU Util 可能很高，也可能很低。

因此必须建立至少四个时间点：

```text
客户端请求到达
Engine 接收
模型首 token ready
客户端首字节到达
```

进一步再把 Engine 内拆为 Tokenization、排队和 Prefill。

---

## 3. TPOT 也不只是模型时间

一次可见 token 间隔可能包含：

```text
等待下一次 Scheduler Step
→ GPUModelRunner 准备输入
→ 模型前向 / NCCL
→ Sampling
→ GPU 到 CPU 拷贝
→ Detokenization / JSON / SSE
→ Proxy / Client 缓冲
```

当 Decode Batch 很小，GPU Kernel 本身可能很短，CPU 准备、Kernel Launch 与同步会占据较大比例；这时单看 Kernel 性能会找错方向。

---

## 4. 三种吞吐不能混用

### Requests/s

适合请求长度接近的固定业务。若长短请求混合，QPS 会严重失真。

### Prompt tokens/s

衡量 Prefill 工作量。Prefix Cache 命中后，业务 Prompt token 与实际计算 Prompt token 可能不同。

### Generation tokens/s

衡量 Decode 产出，但仍受 Batch 大小、上下文长度与采样功能影响。

容量和成本建议至少同时保存：

```text
input token 分布
output token 分布
cached token 分布
requests/s
prompt compute tokens/s
generation tokens/s
GPU-seconds/request
GPU-seconds/1K tokens
```

---

## 5. GPU Util 到底表示什么

常见 GPU 利用率大致表示采样窗口内有无 Kernel 活动。它不能直接回答：

- Tensor Core 是否满载；
- Kernel 是否达到带宽上限；
- 请求是否在排队；
- 某个 rank 是否等待 NCCL；
- 工作是不是频繁被 CPU 打断；
- 单位 token 成本是否合理。

因此同样的 30% 可能是：

```text
A. 流量不足：没有足够请求
B. 上游饥饿：Tokenizer/EngineCore 没及时提交
C. 小批执行：Kernel 很短，间隙很多
D. 多卡等待：某些 rank 等待慢 rank
E. 周期平均：短时间打满、长时间空闲
F. 统计错位：看了节点平均或错误时间窗
```

GPU Util 是症状，不是根因。

---

## 6. 分层性能模型

| 层 | 关键问题 | 核心证据 |
| --- | --- | --- |
| Gateway | 是否限流、排队、重试或路由不均 | admission queue、route、retry、upstream timing |
| API/Tokenizer | JSON、Chat Template、Tokenizer 是否阻塞 | CPU profile、event loop lag、tokenize latency |
| EngineCore | 调度循环是否及时、waiting 是否增长 | scheduling interval、running/waiting、queue time |
| KV/Scheduler | Block 是否足够、是否抢占、长短干扰 | KV usage、preemption、batch tokens |
| ModelRunner | 输入准备、Graph 命中与同步是否有效 | CPU/CUDA Timeline、shape、Graph replay |
| GPU Kernel | GEMM/Attention 是否计算或带宽受限 | Kernel duration、SM/Tensor/DRAM counters |
| 多卡通信 | 是否存在慢 rank 或拓扑瓶颈 | rank timeline、NCCL、NVLink/PCIe counters |
| Output | Detokenize/SSE/Proxy 是否延迟首包 | engine/server/client timestamp |

每次分析只能在证据支持下向下一层钻取。

---

## 7. 基准测试必须固定的变量

没有工作负载定义，任何性能数字都无法复现。记录：

```text
模型 ID + revision
vLLM 版本和镜像 digest
GPU 型号、数量、功耗/频率状态
驱动、CUDA、NCCL
dtype、量化、KV dtype
TP/PP/DP/EP
max_model_len
max_num_seqs
max_num_batched_tokens
输入/输出 token P50/P95/P99
到达模型：closed-loop 或 open-loop
并发/QPS 与持续时间
Prefix Cache 命中分布
Sampling、logprobs、grammar、spec decode
网关和网络路径
```

### Open-loop 与 Closed-loop

Closed-loop：上一请求完成后才发下一请求。服务越慢，施加流量越低，容易掩盖过载。

Open-loop：按独立到达率发请求，更接近真实突发和排队，但必须明确超时与放弃策略。

容量测试建议用 Open-loop 找到 SLO 饱和点，再用真实 Trace Replay 验证。

---

## 8. 一次标准性能实验

### 第一步：建立单请求基线

- 固定 4 组输入/输出长度；
- 无 Gateway 或记录 Gateway 时间；
- 测冷启动与热态；
- 得到 Prefill 与 Decode 下限。

### 第二步：阶梯负载

```text
10 分钟低负载
→ 每阶增加 QPS/并发
→ 每阶稳定 10～20 分钟
→ 直到第一个 SLO 失守
```

每阶记录 TTFT/TPOT/E2E、running/waiting、KV、preemption、Batch token、GPU/NCCL、错误和取消。

### 第三步：只改一个变量

例如只改变 `max_num_batched_tokens`，其他变量保持不动。既看吞吐，也看 TTFT/TPOT P99，避免用平均吞吐掩盖交互延迟回退。

### 第四步：复验与回滚

- 重复至少三次；
- 交换实验顺序，避免热缓存偏差；
- 保存命令、配置、Trace 和原始结果；
- 若收益只在合成流量出现，不直接进入生产。

---

## 9. 饱和点怎样识别

系统真正的容量边界通常早于 OOM 或 100% GPU Util。

典型过程：

```text
负载增加
→ running 增加，吞吐近似线性
→ Batch 更有效，GPU Busy 上升
→ 某资源接近饱和
→ waiting/queue time 开始持续增长
→ TTFT P99 失守
→ 超时/取消/重试放大流量
```

所以“最大无错误 QPS”不是可售容量。可售容量应是满足延迟、错误、资源余量与 N-1 条件的最大负载。

---

## 10. 常见错误结论

| 错误结论 | 问题 |
| --- | --- |
| GPU Util 低，所以加大 Batch 一定有效 | 上游饥饿、通信等待和流量不足都不会被 Batch 参数自动修复 |
| 显存没满，所以还能继续加并发 | SLO 可能已被排队、CPU 或通信击穿 |
| 吞吐提升 20%，调优成功 | TTFT/TPOT P99、取消率和成本可能恶化 |
| Prefix Cache 命中率高，所以 Prefill 已解决 | 命中 token 占比和副本路由才决定收益 |
| 单次 curl 很快，所以生产没问题 | 没有排队、长短混合、突发和多租户干扰 |
| 平均延迟正常，所以服务健康 | LLM 业务通常被 P95/P99 和长尾决定 |

---

## 11. 性能报告最小模板

```text
目标：哪项 SLO/成本需要改善
基线：版本、硬件、工作负载、配置
现象：从哪个负载阶梯开始失守
分解：queue / prefill / decode / output
资源：CPU / KV / GPU / NCCL / network
假设：可证伪的瓶颈判断
实验：只改变一个变量
结果：P50/P95/P99 + 吞吐 + 成本 + 错误
副作用：公平性、长请求、冷启动、N-1
结论：采用/不采用与回滚条件
```

---

## 12. 学完后的验收题

1. TTFT 和 TPOT 各自应怎样拆分？
2. GPU Util 30% 至少可能代表哪四类问题？
3. 为什么 Requests/s 不能单独用于大模型容量规划？
4. Open-loop 为什么更容易暴露排队崩溃？
5. 什么是 SLO 饱和点，它为什么早于 OOM？
6. 怎样证明一次调优是有效因果，而不是缓存或流量差异？

下一篇用这一框架完整排查：GPU 利用率只有 30%，但 TTFT 已经超标。
