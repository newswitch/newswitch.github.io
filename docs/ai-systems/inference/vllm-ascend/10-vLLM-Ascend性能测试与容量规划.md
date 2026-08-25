---
title: "vLLM-Ascend 性能测试与容量规划"
sidebar_label: "10. 性能测试与容量规划"
sidebar_position: 10
description: "用真实Token分布建立TTFT、TPOT、吞吐、HBM和N-1容量曲线，确定910B推理副本的安全承载能力。"
tags: [vLLM-Ascend, 性能测试, 容量规划, TTFT, TPOT]
---

# vLLM-Ascend 性能测试与容量规划

容量不是“服务最多能返回多少QPS”，而是满足质量、错误率和延迟SLO时能够长期承载的流量。

对vLLM-Ascend，一个副本的安全容量取多个瓶颈中的最小值：

```text
C_replica
= min(
  C_prefill_compute,
  C_decode_compute,
  C_cache,
  C_host,
  C_hccl,
  C_network,
  C_slo
)
```

## 1. 先固定测试对象

性能数据只有在以下坐标固定时才能比较：

- Atlas服务器、NPU型号、设备数量和拓扑；
- 驱动、固件、CANN、torch-npu、vLLM与插件；
- 镜像Digest；
- 模型和Tokenizer Revision、dtype与量化；
- TP/DP/PP/EP；
- Graph模式、Capture Size和Additional Config；
- CPU/NUMA绑定；
- 输入/输出Token联合分布；
- 请求到达模型与压测客户端位置。

只写“Qwen 27B、TP=2、并发64”无法复现实验。

## 2. 六个核心指标

| 指标 | 定义 | 主要受什么影响 |
| --- | --- | --- |
| TTFT | 请求发出到首Token | 排队、Tokenizer、Prefill、HCCL、网络 |
| TPOT | 首Token后每输出Token平均时间 | Decode Batch、Graph、Kernel、HCCL |
| ITL | 相邻流式Token间隔 | 调度抖动、流式批量、代理Buffer |
| E2E | 完整请求耗时 | TTFT + 输出长度 × TPOT + 返回路径 |
| Throughput | 单位时间完成请求或Token | 工作负载、Batch和设备利用 |
| Goodput | 满足SLO的有效请求吞吐 | 延迟尾部、错误和超时 |

峰值Token吞吐高但P99 TTFT超标时，不能把峰值当成可售容量。

## 3. 为什么要使用开环压测

闭环客户端通常等待上一个请求完成才发下一个请求。服务变慢后，客户端自动降低到达率，会掩盖排队崩溃。

开环测试按目标速率发请求：

```text
到达率持续增加
→ Queue开始增长
→ TTFT先恶化
→ Cache/调度压力增加
→ 超时和错误出现
```

这更接近真实突发和容量边界。每一档应运行到队列与Cache进入稳定状态，并覆盖长请求。

## 4. 真实Token分布

至少保留：

```text
arrival_time
input_tokens_after_chat_template
output_tokens
cached_tokens
cancelled_or_completed
tenant_or_workload_class
```

容量必须使用`P(input_tokens, output_tokens)`联合分布。把输入P95和输出P95拼成一个请求，可能制造生产中不存在的组合；只用平均值又会漏掉长尾。

## 5. 基准测试流程

### 5.1 正确性基线 {/* #正确性基线 */}

1. 单请求、Eager模式启动。
2. 验证非流式和流式接口。
3. 固定样本检查输出、停止条件和错误处理。
4. 再启用Graph和生产优化，对比语义。

### 5.2 单用户延迟 {/* #单用户延迟 */}

分别测试短/长输入与短/长输出，得到无排队时的Prefill和Decode基线。

### 5.3 阶梯负载 {/* #阶梯负载 */}

```text
低负载 → 预期容量50% → 70% → 85% → 100% → 过载
```

每档记录客户端指标、vLLM指标、NPU、CPU、HBM、Cache、Graph与HCCL。

示意命令：

```bash
vllm bench serve \
  --backend openai-chat \
  --model Qwen3.5-27B \
  --endpoint /v1/chat/completions \
  --dataset-name random \
  --random-input-len 1024 \
  --random-output-len 256 \
  --num-prompts 1000 \
  --request-rate 4
```

Random数据只适合建立基线，正式容量必须用脱敏Trace或能代表生产联合分布的数据集。

## 6. 把Prefill与Decode拆开

```text
required_prefill_tok_s
≈ request_rate × E[实际计算的Prompt Token]

required_decode_tok_s
≈ request_rate × E[最终输出Token]
```

Prefix Cache命中会减少Prefill计算，但冷启动、新副本、发布和流量重平衡时命中率会下降。容量报告要同时给出热缓存和冷缓存结果。

Prefill与Decode共享设备，混合负载的容量不能由两个离线峰值简单相加。长Prefill可能阻塞交互Decode，必须测混合干扰。

## 7. HBM与并发边界

逐档记录：

- 权重与Graph后的固定HBM；
- 可用Cache Block/Token；
- 活跃与等待请求；
- Cache使用率和Prefix命中；
- 抢占、重算或拒绝；
- 最长上下文和输出长尾。

安全点应位于OOM或严重抢占之前，并保留发布、诊断和流量波动余量。

## 8. 判断瓶颈在哪层

| 现象 | 主要假设 | 下一步证据 |
| --- | --- | --- |
| TTFT升高、TPOT稳定 | 排队或Prefill饱和 | Queue、Prefill tok/s、Tokenizer |
| TTFT与TPOT都升高 | 设备、HCCL或混合干扰 | Timeline、各Rank、Batch |
| NPU低、CPU单核高 | Host Bound | CPU火焰图、Graph空洞 |
| HBM高、抢占增加 | Cache容量不足 | Cache Block、驻留Token |
| TP增大后更慢 | 通信占比过高 | HCCL时长、慢Rank、拓扑 |
| 客户端慢、服务端正常 | 网关/网络/SSE | 分段Trace和代理Buffer |

“NPU利用率30%但TTFT超标”首先看Queue和Timeline，而不是立即继续增加并发。

## 9. 找到SLO拐点

绘制：

```text
X轴：到达率或输入/输出Token速率
Y轴：TTFT P50/P95/P99、TPOT、Goodput、Queue、错误率
```

通常在某一档之后Queue不再回落，TTFT呈非线性增长。上一稳定档减去安全余量，才是单副本容量。

```text
C_sellable = C_last_stable × (1 - safety_margin)
```

余量应覆盖工作负载误差、硬件差异、版本波动和故障接管，不是固定百分比。

## 10. 集群容量与N-1

若有`R`个相同副本：

```text
C_normal ≈ R × C_replica × routing_efficiency
C_n_minus_1 ≈ (R - 1) × C_replica × routing_efficiency
```

但还要考虑：

- 新副本模型加载与Graph捕获时间；
- 冷Cache造成的TTFT回归；
- 节点故障可能一次损失多个副本；
- 路由不均与长请求粘滞；
- 故障后剩余副本是否有HBM和队列余量。

生产最低要求是峰值业务在定义的故障域损失后仍满足降级SLO。

## 11. 输出容量报告

| 项目 | 结果 | 证据 |
| --- | ---: | --- |
| 模型/镜像/版本 |  | 制品清单 |
| 硬件/拓扑/TP |  | 节点拓扑 |
| 工作负载分布 |  | Trace版本 |
| 单副本安全req/s |  | 阶梯压测 |
| 输入/输出tok/s |  | 客户端结果 |
| TTFT/TPOT P99 |  | Histogram |
| 固定/峰值HBM |  | NPU指标 |
| Cache与抢占 |  | Engine指标 |
| 冷启动Ready时间 |  | 发布时间线 |
| N-1集群容量 |  | 故障演练 |

## 12. 官方资料

- [vLLM-Ascend Performance Benchmark](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/evaluation/performance_benchmark.html)
- [vLLM Benchmark CLI](https://docs.vllm.ai/en/latest/cli/bench/serve.html)
- [vLLM-Ascend Service Profiling](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/performance_and_debug/service_profiling_guide.html)
