---
title: "排队、Prefill、Decode 与性能指标联合分析"
sidebar_label: "03. 排队、Prefill 与 Decode"
sidebar_position: 3
description: "把客户端 TTFT、Queue Time、Prefill、Decode、ITL、吞吐、Goodput 与 GPU/NPU 指标放进同一套性能归因模型。"
tags: [TTFT, TPOT, ITL, Prefill, Decode, Goodput]
---

# 排队、Prefill、Decode 与性能指标联合分析

“延迟高”和“GPU 利用率低”都是结果，不是根因。模型服务的性能需要同时观察请求阶段、Token 分布、
调度状态和设备资源。

```text
客户端 E2E
├── 网络与网关
├── API / Tokenizer
├── Queue
├── Prefill / First Token
├── Decode
└── 输出与网络
```

## 1. 先统一指标口径

| 指标 | 常见定义 | 主要反映 |
|---|---|---|
| TTFT | 发出请求到首个 Token/事件 | 网络、排队、Prefill |
| Queue Time | 进入引擎到首次调度 | 准入、调度、容量 |
| Prefill Time | 处理输入并建立 KV | 输入长度、算力、Cache |
| ITL | 相邻输出 Token/事件间隔 | Decode 稳定性 |
| TPOT | 每个输出 Token 平均时间 | Decode 性能 |
| E2E Latency | 请求到完整响应 | 全链路 |
| Token Throughput | 单位时间处理的 Token | 总吞吐 |
| Request Throughput | 单位时间完成请求数 | 受长度分布影响 |
| Goodput | 满足 SLO 的完成请求率 | 有效容量 |

不同框架和压测工具的 TTFT 起点可能不同。客户端 TTFT 通常包含网络和网关，框架指标可能从请求进入引擎或被调度后开始。

## 2. 延迟分解模型

```text
TTFT_client
≈ T_network_in
+ T_gateway
+ T_frontend
+ T_queue
+ T_prefill
+ T_first_output
```

非流式请求端到端：

```text
E2E
≈ TTFT
+ T_decode
+ T_output_processing
+ T_network_out
```

近似的 Decode 时间：

```text
T_decode ≈ (output_tokens - 1) × mean_ITL
```

它忽略事件聚合、流水重叠和最后处理开销，只适合验证量级。

## 3. 为什么必须记录 Token 长度

Prompt 字符数不是 Token 数。性能至少按下面维度分桶：

```text
Input Token：0-512 / 513-2k / 2k-8k / 8k+
Output Token：0-64 / 65-256 / 256+
流式 / 非流式
Prefix Cache 命中 / 未命中
多模态类型和特征规模
```

否则业务流量从短 Prompt 变成长 Prompt 时，TTFT 上升会被误判为系统回归。

## 4. Queue Time 怎样解释

Queue Time 高通常说明容量或调度约束，而不是单个 Prompt 计算本身慢。

结合观察：

- Waiting Request 数。
- Running Request 数。
- Batch Token 使用量。
- KV Cache 使用率。
- 抢占和重计算。
- 最大并发/最大 Batch Token 参数。
- GPU/NPU 是否在执行有效工作。

判断矩阵：

| Queue | 设备利用率 | 可能方向 |
|---|---|---|
| 高 | 高 | 真实过载或算力已满 |
| 高 | 低 | 前端/调度、KV、慢 Rank、CPU 或限制参数 |
| 低 | 高 | 请求立即运行，关注计算性能 |
| 低 | 低 | 流量低、Batch 小或前端尚未提交 |

## 5. Prefill 的性能特征

Prefill 一次处理多个输入 Token，通常计算密度较高。主要影响因素：

- Input Token 数。
- 同批总 Token 数。
- Prefix Cache 命中。
- Chunked Prefill 配置。
- Attention Backend。
- 多模态 Encoder。
- TP 集合通信和慢 Rank。
- 设备频率与功耗。

分析 Prefill 时建议画：

```text
X：Input Token 数
Y：Prefill Time 或 TTFT（排除 Queue 后）
颜色：并发或 Cache 命中
```

不同 Token 桶出现平行上移，可能是设备或 Kernel 回归；仅长 Prompt 恶化，则更像长上下文路径、Chunking 或 Cache 问题。

## 6. Decode 的性能特征

Decode 每个 Step 的计算量相对小，但需要高频重复：

- Scheduler 组织活跃请求。
- Worker 执行一轮模型。
- TP/EP 进行集合通信。
- 采样和输出处理。

影响 ITL/TPOT：

- Decode Batch Size。
- Kernel Launch 和 Graph 命中。
- TP/EP 通信。
- Scheduler Step 间隙。
- 慢 Rank。
- GPU/NPU 降频。
- Python 输出处理和事件循环。

如果 TTFT 正常而 ITL 变差，应优先看 Decode，不要只调 Prefill Batch Token。

## 7. GPU 利用率为什么不能单独使用

设备利用率是采样窗口内是否有 Kernel 运行，不直接等于：

- Tensor Core 使用效率。
- 显存带宽利用率。
- 有效 Token 吞吐。
- 所有 Rank 是否平衡。
- 请求是否满足 SLO。

30% 利用率可能来自：

- 请求在 Tokenizer 或 Queue 前等待。
- Batch 太小，Decode Kernel 短且间隔大。
- Scheduler/CPU 无法持续喂给设备。
- 某个 Rank 慢，其他 Rank 等待通信。
- 网关把流量集中到少数副本。
- 监控采样粒度掩盖短脉冲。

## 8. Goodput 比吞吐更接近业务容量

假设服务完成 20 req/s，但只有 12 req/s 同时满足：

```text
TTFT < 1 s
ITL < 50 ms
错误率 < 0.1%
```

则 Goodput 是 12 req/s，而不是 20 req/s。继续提高并发可能增加总吞吐，却让更多请求超过 SLO，Goodput 反而下降。

## 9. 常见组合一：TTFT 高、Queue 高

重点判断：

1. 到达率是否超过完成率。
2. Waiting 是否持续增长而非短时峰值。
3. Running、Batch Token 和 KV 是否达到限制。
4. 是否有长 Prompt 占用 Prefill 预算。
5. 是否频繁抢占和重计算。

处置方向：准入、扩容、请求分级、长短隔离、调整容量参数。不要先升级 Attention Kernel。

## 10. 常见组合二：TTFT 高、Queue 低、Prefill 高

说明请求很快被调度，但输入阶段慢。检查：

- Input Token 分布是否变化。
- Prefix Cache 命中是否下降。
- Chunked Prefill 是否改变。
- 多模态输入是否变大。
- Attention Backend 是否回退。
- TP Rank 是否出现计算或通信慢点。
- GPU/NPU 时钟、功耗和温度。

## 11. 常见组合三：TTFT 正常、ITL 高

检查：

- Decode Batch Size 是否过小或波动。
- CUDA/ACL Graph 是否回退。
- Scheduler Step 是否有长间隙。
- TP/EP 通信时间是否增加。
- 某个 Rank 是否降频或报错。
- 输出 Parser、Detokenizer 或 SSE 是否阻塞。

## 12. 常见组合四：Queue 高、GPU 利用率低

这是最容易误判的组合。依次检查：

```text
请求是否已完成 Tokenization？
→ Scheduler 是否持续 Step？
→ KV 是否有可分配 Block？
→ 是否受到 max_num_seqs / batch token 等限制？
→ 是否有 Rank 未就绪或慢 Rank？
→ 是否频繁抢占与重计算？
→ API 与 EngineCore IPC 是否堵塞？
```

相关完整案例见[TTFT 超标但 GPU 利用率低](../vllm/15-TTFT超标但GPU利用率低完整排查案例.md)。

## 13. 直方图和分位数

平均值会掩盖尾延迟。应同时观察：

- P50：典型体验。
- P95/P99：容量边缘、长请求和异常路径。
- Max：用于发现极端值，但对偶发噪声敏感。
- Bucket Count：确认分位数有足够样本。

Prometheus Histogram 分位数还受 Bucket 边界影响。修改 Bucket 或窗口后，不能直接与历史数值比较。

## 14. 性能分析的最小指标集

请求：

```text
request rate, error rate
input/output tokens
TTFT, ITL/TPOT, E2E
queue, prefill, decode
```

引擎：

```text
waiting/running requests
scheduled tokens
KV cache usage
preemption/recompute
prefix cache hit
```

资源：

```text
CPU, RSS
GPU/NPU utilization, memory, clock, power
PCIe/NVLink/HCCS/RDMA
per-rank step/communication time
```

## 15. 单变量实验

建议顺序：

1. 固定模型、镜像和输入/输出 Token 分布。
2. 并发从 1 开始逐级增加。
3. 每级达到稳定状态后记录分位数。
4. 观察 Goodput 拐点、Queue 增长和 KV 压力。
5. 只修改一个调度或缓存参数。
6. 重复实验并对比误差范围。

不能用随机 Prompt、随机输出长度和不断变化的并发验证一个参数效果。

## 16. 一个结论应包含什么

不要只写“GPU 利用率低”。完整结论应是：

```text
在输入 P50=2k、输出 P50=128、并发 32 时，P99 TTFT 从 800ms 升到 2.4s；
其中 Queue P99 增加 1.3s，Prefill 无显著变化。Waiting 持续增长，KV 使用率 96%，
并出现抢占。降低单实例准入并增加副本后，Queue P99 恢复到 180ms，Goodput 恢复。
```

它同时包含条件、现象、阶段证据、资源证据、动作和验证。

## 17. 参考资料

- [vLLM Production Metrics](https://docs.vllm.ai/en/latest/design/metrics/)
- [NVIDIA GenAI-Perf Metrics](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/genai-perf/README.html)
- [GenAI-Perf Goodput](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/genai-perf/docs/goodput.html)
- [vLLM 性能分析总论](../vllm/14-vLLM性能分析总论-TTFT-TPOT-吞吐与GPU利用率.md)
