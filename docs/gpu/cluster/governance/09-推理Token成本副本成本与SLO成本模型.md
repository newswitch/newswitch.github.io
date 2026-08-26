---
title: "推理 Token 成本、副本成本与 SLO 成本模型"
sidebar_label: "09. 推理 Token 与 SLO 成本"
sidebar_position: 9
description: "把模型副本、输入输出 Token、缓存、批处理和冗余容量转化为可比较的推理单位经济性。"
tags: [LLM推理, Token成本, SLO, 容量规划, FinOps]
---

# 推理 Token 成本、副本成本与 SLO 成本模型

## 1. 两个常用单位

```text
每百万输出Token成本 = 服务总成本 / 有效输出Token × 1,000,000
每成功请求成本 = 服务总成本 / 满足SLO的成功请求数
```

必须说明是否包含输入 Token、缓存命中、网关、CPU、网络、存储和 N+1 备用容量。

## 2. 副本成本

副本固定占用模型权重、Runtime 和可能预留的 KV Cache。低流量时成本主要由常驻副本决定；高流量时由饱和点和扩容决定。

```text
副本小时成本
= GPU/NPU + CPU/内存 + 节点分摊 + 平台分摊
```

TP=4 的副本不仅是 4 张卡，还包含跨卡通信和故障时整副本损失。

## 3. 输入与输出不同

Prefill 处理输入 Token，通常更偏 Compute；Decode 按步生成输出 Token，常更受 HBM/KV 和调度影响。将二者合成一个 Token 单价会掩盖长 Prompt 和长输出成本差异。

建议至少按 Input/Output Token、Context Bucket、模型、Dtype/Quant、并发和缓存命中分层。

## 4. SLO 成本曲线

提高 Batch 可提高吞吐，但可能增加排队和 TTFT；提高副本余量降低尾延迟，却增加空闲成本。应绘制：

```text
并发/到达率
→ TTFT、TPOT、Goodput、Token/s
→ GPU数量与单位成本
```

选择满足 SLO 的最低成本点，而不是最大吞吐点。

## 5. 无效成本

- 客户端取消后继续生成；
- 超时结果被丢弃；
- 重试导致重复 Prefill；
- Padding 和不合理 Batch；
- Cache Thrash/Preemption；
- 冷启动期间卡已分配但未 Ready；
- 故障副本反复拉起。

单独统计无效 Token 和失败 GPU 时间，才能找到优化收益。

## 6. 多硬件比较

比较 GPU/NPU 时使用相同模型、精度、输入分布、输出长度、并发、质量和 SLO。只比较标称 TFLOPS 或单卡价格不构成业务成本结论。

参考：[vLLM Benchmarking](https://docs.vllm.ai/en/latest/contributing/benchmarks.html)、[NVIDIA GenAI-Perf](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/genai-perf.html)。
