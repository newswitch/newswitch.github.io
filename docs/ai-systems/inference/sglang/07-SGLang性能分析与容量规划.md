---
title: "SGLang 性能分析与容量规划"
sidebar_label: "07. 性能分析与容量规划"
sidebar_position: 7
description: "使用SGLang分层Benchmark、真实Token与共享前缀分布，建立满足TTFT和TPOT SLO的安全容量。"
tags: [SGLang, 性能分析, 容量规划, Benchmark, Goodput]
---

# SGLang 性能分析与容量规划

SGLang性能测试必须把Radix命中、调度、Graph和Kernel Backend固定下来。否则两次Benchmark比较的可能不是同一执行路径。

## 1. 四层Benchmark

| 工具层 | 包含HTTP | 包含Scheduler | 用途 |
| --- | --- | --- | --- |
| Serving | 是 | 是 | 生产容量、TTFT、TPOT、ITL |
| One Batch Server | 是 | 是 | 单Batch端到端延迟 |
| Offline Throughput | 否 | 是 | 排除HTTP后的引擎吞吐 |
| One Batch/ModelRunner | 否 | 否或最少 | Kernel和固定Shape |

从Serving发现问题，再向下隔离。不能用One Batch峰值代替在线容量。

## 2. 固定变量

- 镜像Digest、SGLang/PyTorch/CUDA/Kernel；
- GPU、NVLink、CPU/NUMA；
- 模型、Tokenizer、量化；
- TP/DP/EP/PP；
- `mem_fraction_static`、运行请求上限；
- Radix开关和调度策略；
- Chunked Prefill；
- CUDA Graph与Backend；
- 输入/输出Token和共享前缀分布。

## 3. Serving基线

示意：

```bash
python -m sglang.bench_serving \
  --backend sglang-oai-chat \
  --model qwen-prod \
  --dataset-name random \
  --num-prompts 1000 \
  --random-input-len 1024 \
  --random-output-len 256 \
  --max-concurrency 32
```

官方建议请求数应足够让系统进入稳态；短暂10个请求通常只能做Smoke Test。命令入口会随版本迁移，应以目标镜像`--help`为准。

## 4. 同时控制到达率和并发

- 最大并发控制客户端在途上限；
- Request Rate控制开环到达强度；
- 两者共同决定排队与压力。

只设并发的闭环测试会在服务变慢时自动降低请求速率，掩盖过载。生产容量使用开环阶梯，并记录未完成、失败和超时请求。

## 5. Radix Cache工作负载

至少三组：

```text
无共享前缀
固定大公共前缀
多组前缀+Zipf/真实热度分布
```

每组测冷态和热态，并报告：

- 实际命中Token；
- Prefill计算Token；
- Cache占用/淘汰；
- TTFT和Goodput；
- FCFS/LPM公平性；
- 新副本冷启动结果。

## 6. 静态内存预算

`mem_fraction_static`控制权重、KV Pool等静态设备内存规划的重要边界。太高可能挤压激活、CUDA Graph和Kernel Workspace；太低则减少KV容量，导致Retract和并发不足。

逐步调整并记录：

```text
启动后固定显存
Graph后显存
可用KV Token/Slot
长Prefill峰值
高并发稳态峰值
Retract与OOM
```

## 7. Prefill与Decode曲线

```text
Prefill需求 ≈ 到达率 × E[未命中Prompt Token]
Decode需求  ≈ 到达率 × E[输出Token]
```

测试长Prompt时观察TTFT、激活和Chunking；测试长输出时观察TPOT、KV和运行Batch。最后使用真实混合负载，因为两阶段共享设备。

## 8. Graph和Backend A/B

对每组候选保存：

| 项目 | 基线 | 候选 |
| --- | ---: | ---: |
| 启动时间 |  |  |
| 固定显存 |  |  |
| Replay覆盖率 |  |  |
| TTFT P99 |  |  |
| TPOT P99 |  |  |
| tok/s |  |  |
| 输出回归 |  |  |

仅在相同请求序列、相同Cache状态和相同硬件上比较。

## 9. 找到SLO拐点

每个Request Rate档位运行到稳态：

```text
低负载
→ Queue接近0
→ Queue出现但能回落
→ P99开始非线性增长
→ Queue持续累积
→ 超时/OOM/撤回
```

最后一个满足TTFT、TPOT、错误率和公平性目标的稳定档位，再减安全余量，作为单副本容量。

## 10. 故障容量

必须测：

- 一个副本摘除；
- 一个节点丢失；
- 新副本冷Cache；
- 模型重新加载与Graph Capture；
- 流量重平衡导致前缀亲和变化；
- GPU/NCCL故障后的请求取消。

Radix Cache使热副本更快，也意味着故障转移后的冷副本可能比正常报告更慢。

## 11. 结果解释

| 现象 | 主要方向 |
| --- | --- |
| TTFT高、TPOT稳 | Waiting/Prefill/Tokenizer |
| TPOT高 | Running Batch/Graph/Kernel/NCCL |
| GPU低、Queue高 | Scheduler/IPC/Host Bound |
| Cache命中高但慢 | Decode或排队才是瓶颈 |
| Retract增长 | KV Pool或并发过激 |
| TP增加但性能下降 | 通信大于计算收益 |

## 12. 官方资料

- [SGLang Benchmark and Profiling](https://github.com/sgl-project/sglang/blob/main/docs/developer_guide/benchmark_and_profiling.md)
- [SGLang Bench Serving](https://docs.sglang.io/developer_guide/bench_serving.html)
- [SGLang Production Metrics](https://docs.sglang.io/references/production_metrics.html)
