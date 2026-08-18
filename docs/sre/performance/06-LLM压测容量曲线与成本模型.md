---
title: "LLM 压测、容量曲线与成本模型"
sidebar_label: "06. LLM 压测、容量曲线与成本模型"
sidebar_position: 6
description: "设计符合真实 Token 分布和到达模型的 LLM 在线压测，绘制过载曲线，计算 SLO 容量、冗余、副本数和单位 Token 成本。"
tags: [LLM, vLLM, 压测, 容量规划, TTFT, TPOT, 成本]
---

# LLM 压测、容量曲线与成本模型

“8 张 GPU 每秒能生成多少 token”不能直接回答生产容量。

生产真正关心：

> 在目标输入/输出分布、并发、流式比例和 SLO 下，一个模型实例能稳定承载多少流量？

完整结果至少包括：

- 最大可接受到达率。
- TTFT/TPOT/E2E 分布。
- Prompt/Generation tokens/s。
- Queue、KV Cache 和拒绝率。
- 故障后剩余容量。
- 每百万 token/每请求成本。

## 1. 先区分三个基准

### 1.1 离线吞吐 {/* #离线吞吐 */}

```text
所有请求已准备好
→ 尽可能喂满 GPU
→ 测最大 tokens/s
```

适合：

- 比较 Kernel/量化。
- 批处理能力。
- 理论吞吐。

不能代表在线排队和 TTFT。

### 1.2 单请求延迟 {/* #单请求延迟 */}

```text
concurrency = 1
```

适合：

- 最低 TTFT/TPOT。
- 硬件/模型基线。

不能代表高并发 Batch。

### 1.3 在线 Serving {/* #在线-serving */}

请求按到达过程进入：

```text
request rate / concurrency
→ Queue
→ Continuous Batching
→ 流式响应
```

生产容量必须以在线基准为主。

## 2. Open-loop 与 Closed-loop

### 2.1 Closed-loop {/* #closed-loop */}

每个客户端等待响应完成后再发送：

```text
send → wait → complete → next send
```

当服务变慢时，客户端自动降低发送速率，可能掩盖过载。

### 2.2 Open-loop {/* #open-loop */}

按外部到达率发送：

```text
λ = 10, 20, 30 ... requests/s
```

服务变慢时仍按计划到达，能观察 Queue 和崩溃点。

在线容量测试应主要使用 Open-loop，并设置最大未完成请求，避免压测器本身失控。

Closed-loop 可用于并发用户模型，但必须报告实际到达率。

## 3. 工作负载模型

### 3.1 Token 分布

至少记录：

```text
input_tokens P50/P90/P95/P99/max
output_tokens P50/P90/P95/P99/max
input-output correlation
```

不能只用平均值。

示例：

| 类别 | 比例 | Input | Output |
| --- | ---: | ---: | ---: |
| short-chat | 60% | 128～512 | 64～256 |
| RAG | 30% | 2K～8K | 128～512 |
| long-summary | 10% | 16K～64K | 512～2K |

### 3.2 到达过程

需要模拟：

- 稳态。
- 随机到达。
- 突发。
- 日周期。
- 单租户热点。

### 3.3 Cache

分开：

```text
Prefix Cache cold
Prefix Cache warm
真实命中混合
```

只测重复 Prompt 会夸大性能。

### 3.4 参数

固定或记录：

- Stream。
- Temperature/Top-P。
- `max_tokens`。
- Structured Output。
- Tool Calling。
- LoRA。
- 多模态。

它们可能改变 CPU/GPU 和输出长度。

## 4. 环境记录

```yaml
model:
  name: llama-70b
  revision: sha256:...
  dtype: bf16
  quantization: none

runtime:
  vllm_version: ...
  image_digest: sha256:...
  max_num_seqs: ...
  max_num_batched_tokens: ...
  gpu_memory_utilization: ...
  tp: 8
  pp: 1
  dp: 1

hardware:
  gpu: H100-80GB
  gpu_count: 8
  topology: NVSwitch
  cpu: ...
  memory: ...
  nic: ...

software:
  driver: ...
  cuda: ...
  kernel: ...
```

如果环境不可复现，结果不能作为容量基线。

## 5. 使用 vLLM Bench

当前 vLLM CLI 提供：

```text
vllm bench latency
vllm bench throughput
vllm bench serve
```

在线示例：

```bash
vllm bench serve \
  --model /models/llama \
  --host <server-host> \
  --port 8000 \
  --dataset-name random \
  --random-input-len 1024 \
  --random-output-len 256 \
  --request-rate 10 \
  --num-prompts 1000
```

CLI 参数会随版本变化，运行：

```bash
vllm bench serve --help
```

生产测试尽量使用脱敏后的真实 Token 长度分布，而不是永远固定长度。

## 6. 压测器本身也要监控

压测客户端可能成为瓶颈：

- CPU/JSON 解析。
- 网络带宽。
- Socket/FD。
- 单 Event Loop。
- TLS。
- 结果写盘。

监控：

```text
offered requests
actually sent
client queue
client CPU
client network
connection errors
response parse time
```

压测器与被测服务最好分开节点，时间同步。

## 7. 核心指标

### 7.1 请求 {/* #请求 */}

```text
offered_rps
accepted_rps
completed_rps
rejected_rps
error_rate
stream_completion_rate
```

### 7.2 Token {/* #token */}

```text
prompt_tokens_per_second
generation_tokens_per_second
total_tokens_per_second
```

Prompt Token 与 Generation Token 成本不同，不能只加总比较。

### 7.3 延迟 {/* #延迟 */}

```text
queue_time
TTFT
TPOT/ITL
E2E
```

报告 P50/P90/P95/P99，而不是只报平均。

### 7.4 资源 {/* #资源 */}

```text
running/waiting
KV Cache
preemption
GPU SM/Tensor/Memory
HBM
power
NCCL
CPU/network/storage
```

## 8. 测试阶段

### 8.1 功能验证

- API 正确。
- Stream 完整。
- Token 统计一致。
- 错误分类正确。

### 8.2 Warmup

等待：

- 模型完全加载。
- CUDA Graph/Kernel Warmup。
- JIT/Autotune。
- Cache 达到目标状态。
- GPU 时钟稳定。

### 8.3 阶梯负载

```text
5 rps  → 10 min
10 rps → 10 min
15 rps → 10 min
...
```

每阶持续到指标稳定，长请求服务可能需要更长。

### 8.4 稳态 Soak

在候选容量运行 1～4 小时或更长，观察：

- Memory Leak。
- 累积 Queue。
- Thermal/Power。
- Cache 变化。
- 错误和尾延迟。

### 8.5 突发

瞬间 2×/5×，观察：

- 拒绝。
- Queue。
- 恢复时间。
- Autoscaling。

### 8.6 故障

- 删除一个 Replica。
- 隔离一个 GPU 节点。
- 降低网络/存储能力。
- Canary 回滚。

只在隔离测试环境执行故障注入。

## 9. 绘制过载曲线

X 轴：

```text
offered request rate
或 offered token rate
```

Y 轴：

- Accepted Throughput。
- TTFT P99。
- TPOT P99。
- Error/Reject。
- Queue。
- KV。

典型：

```text
Throughput
   /
  /
 /____  ← 饱和后不再增长

TTFT
____
    \
     \_____ ← 接近饱和后快速上升
```

容量不是吞吐最高点，而是最后一个同时满足全部 SLO 的点。

## 10. SLO 容量

定义：

```text
C_slo =
  max offered_load
  subject to:
    availability >= target
    TTFT_good_ratio >= target
    TPOT_good_ratio >= target
    stream_completion >= target
    no_unbounded_queue
```

示例：

```text
Availability >= 99.9%
99% TTFT <= 2s
99% TPOT <= 80ms
Queue 在稳态不持续增长
```

在不同负载点逐一判断。

## 11. 安全水位

生产目标不能等于实验最大 SLO 容量。

```text
safe_capacity =
  measured_slo_capacity
  × headroom_factor
```

例如 Headroom 70%：

```text
safe_capacity = C_slo × 0.7
```

Headroom 用于：

- 流量波动。
- 长尾 Token。
- 硬件差异。
- Cache 冷热。
- 发布/维护。
- 单实例故障。

比例必须来自风险和故障演练，不是固定行业常数。

## 12. Little 定律

```text
L = λW
```

如果：

```text
λ = 10 requests/s
平均 E2E W = 5s
```

则系统平均有：

```text
L = 10 × 5 = 50 requests
```

这些请求包括排队和运行。

用途：

- 检查指标是否自洽。
- 估算并发。
- 规划连接和队列。

它不替代详细 Token/KV 容量，因为请求成本不同。

## 13. Token 到达率

请求率相同但 Token 成本不同。

```text
prompt_token_arrival_rate =
  request_rate × average_input_tokens

reserved_decode_arrival_rate =
  request_rate × expected_output_tokens
```

还应按分布而不是只按平均：

```text
P50/P95/P99 workload classes
```

Gateway 准入可使用 Cost Unit，容量规划则使用目标混合流量压测校准。

## 14. 副本数

单副本安全容量：

```text
C_replica_safe
```

业务峰值：

```text
L_peak
```

不考虑故障：

```text
replicas = ceil(L_peak / C_replica_safe)
```

考虑同时失去 `F` 个副本：

```text
replicas_total =
  ceil(L_peak / C_replica_safe) + F
```

更严格应验证：

```text
(replicas_total - F) × C_replica_safe >= L_peak
```

如果单副本冷启动很慢，还要有预热 Spare。

## 15. 模型并行实例

TP=8 的一个 Replica 占 8 GPU：

```text
gpu_count =
  replicas × TP × PP
```

例如：

```text
3 Replicas × TP 8 × PP 1 = 24 GPU
```

DP 内部部署也要明确：

- DP Rank 是否独立容量单元。
- Gateway 如何路由。
- KV Cache 是否独立。
- 单 Rank/节点故障影响。

## 16. 故障容量

正常 4 Replica，每个安全容量 10 rps：

```text
normal = 40 rps
lose 1 = 30 rps
```

业务峰值 32 rps：

```text
正常满足
单副本故障不满足
```

需要：

- 增加副本。
- 提高单副本安全容量。
- 故障时降级/限流。
- 跨区域切流。

容量评审必须同时报：

```text
Normal Capacity
N-1 Capacity
Maintenance Capacity
Disaster Capacity
```

## 17. Autoscaling 容量

扩容不是瞬时：

```text
T_scale =
  metric delay
  + decision
  + scheduling
  + image/model load
  + H2D
  + warmup
  + endpoint discovery
```

需要计算在 `T_scale` 内队列增长：

```text
queue_growth ≈
  (arrival_rate - current_capacity)
  × T_scale
```

如果 Queue Deadline 远小于 `T_scale`，必须：

- 预热容量。
- 预测扩容。
- 有界拒绝。
- 降级。

## 18. 单位成本

### 18.1 GPU 成本 {/* #gpu-成本 */}

```text
test_gpu_cost =
  gpu_hour_price
  × gpu_count
  × test_duration_hours
```

### 18.2 每百万输出 Token {/* #每百万输出-token */}

```text
cost_per_million_output_tokens =
  total_cost
  / completed_output_tokens
  × 1,000,000
```

### 18.3 每百万总 Token {/* #每百万总-token */}

```text
cost_per_million_total_tokens =
  total_cost
  / (prompt_tokens + output_tokens)
  × 1,000,000
```

必须明确分母，否则不同报告不可比。

### 18.4 每请求 {/* #每请求 */}

```text
cost_per_request =
  total_cost / completed_requests
```

失败和拒绝消耗的资源也应进入总成本。

## 19. 完整成本

不只 GPU：

```text
total_cost =
  GPU
  + CPU/Memory
  + Local/Shared Storage
  + Network
  + Gateway/Observability
  + Idle Headroom
  + Failure/Canary Capacity
  + Energy
  + License/Operations
```

如果只按 GPU 满载小时计算，会低估：

- 预热副本。
- 夜间低谷。
- N+1。
- 冷启动。
- Canary。
- 故障容量。

## 20. 功耗与能效

采集：

```text
GPU power draw
CPU/node power（如果可用）
duration
completed tokens
```

近似：

```text
energy_joules =
  average_power_watts × duration_seconds
```

```text
joules_per_output_token =
  energy_joules / output_tokens
```

单看 Watts 没有意义；更高功耗如果大幅提高有效吞吐，单位 token 能耗可能下降。

## 21. 一个计算示例

假设：

```text
TP=4
2 Replicas
总 GPU=8
GPU 单价=20 元/小时
测试时间=2 小时
完成输出 Token=120,000,000
完成请求=300,000
```

GPU 成本：

```text
8 × 20 × 2 = 320 元
```

每百万输出 Token：

```text
320 / 120,000,000 × 1,000,000
= 2.67 元/百万输出 Token
```

每请求：

```text
320 / 300,000
= 0.00107 元/请求
```

这只是 GPU 直接成本，生产还需加入 Headroom 和其他基础设施。

## 22. 参数对比表

| Case | TP | DP/Replicas | Quant | Max Seq | Token Budget | TTFT P99 | TPOT P99 | Output tok/s | 成本/M |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 8 | 1 | BF16 | 128 | 8192 |  |  |  |  |
| B | 4 | 2 | BF16 | 128 | 8192 |  |  |  |  |
| C | 4 | 2 | FP8 | 256 | 16384 |  |  |  |  |

只有在相同请求分布、正确性和 SLO 下才可比较成本。

## 23. 统计可靠性

每个 Case：

- 至少重复 3 次。
- 报告均值/中位和离散程度。
- 丢弃 Warmup，但不要选择性丢弃坏结果。
- 记录异常原因。
- A/B 交替运行。

尾延迟需要足够样本。只有几十个请求时，P99 没有稳定统计意义。

建议保留原始请求级结果（脱敏）：

```text
arrival
accepted
first_token
completed
input_tokens
output_tokens
result
backend
```

## 24. 正确性门禁

性能优化可能改变：

- 量化误差。
- Sampling。
- Batch Invariance。
- Structured Output。
- Tool Call。
- 截断。

每个 Candidate 必须通过：

- API Schema。
- 固定数据集质量评测。
- 关键请求一致性/容差。
- Stream 完整性。
- 错误率。

不能用“输出更短”制造更快 TPOT/E2E。

## 25. 常见错误

### 25.1 只报最大 tokens/s {/* #只报最大-tokenss */}

可能处于 TTFT 已不可用的崩溃区。

### 25.2 固定平均 Token {/* #固定平均-token */}

忽略长尾和调度干扰。

### 25.3 只测热 Cache {/* #只测热-cache */}

无法代表发布、故障和新实例。

### 25.4 Closed-loop 掩盖过载 {/* #closed-loop-掩盖过载 */}

服务越慢，客户端发送越少。

### 25.5 不监控压测器 {/* #不监控压测器 */}

瓶颈可能在客户端。

### 25.6 容量等于最大值 {/* #容量等于最大值 */}

没有 Headroom、N-1 和维护容量。

### 25.7 只算 GPU 满载成本 {/* #只算-gpu-满载成本 */}

忽略 Idle、冗余和平台成本。

### 25.8 Profiler 与压测同时作为最终结果 {/* #profiler-与压测同时作为最终结果 */}

Profiler 会改变执行。

## 26. 实验任务

1. 建立真实 Token 分布。
2. 分别运行单请求、离线吞吐和在线基准。
3. 使用 Open-loop 阶梯提高 Request Rate。
4. 画出 Throughput、TTFT、TPOT、Queue 和 KV 曲线。
5. 找到最后一个满足全部 SLO 的点。
6. 乘 Headroom 得到安全容量。
7. 计算 N-1 副本数。
8. 测完整冷启动时间和 Queue 增长。
9. 计算每百万输出 Token 和每请求成本。
10. 用故障注入验证容量结论。

## 27. 验收清单

- [ ] 能区分离线吞吐、单请求和在线压测。
- [ ] 能解释 Open-loop 与 Closed-loop。
- [ ] 能构造真实 Token/到达/Cache 分布。
- [ ] 能监控压测器。
- [ ] 能画过载曲线。
- [ ] 能定义 SLO 容量和安全水位。
- [ ] 能使用 Little 定律检查并发。
- [ ] 能计算副本、GPU 数和 N-1 容量。
- [ ] 能计算单位 Token/请求成本。
- [ ] 能加入功耗、Headroom 和平台成本。
- [ ] 能通过正确性和故障测试验收。

## 28. 官方资料

- [vLLM CLI Benchmarks](https://docs.vllm.ai/en/stable/cli/)
- [vLLM Online Serving Benchmark API](https://docs.vllm.ai/en/stable/api/vllm/benchmarks/serve/)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)

完成本篇以后，性能工程的输出不再是“GPU 利用率高/低”，而是一套可复现的 SLO 容量、
瓶颈证据、故障余量和成本结论。
