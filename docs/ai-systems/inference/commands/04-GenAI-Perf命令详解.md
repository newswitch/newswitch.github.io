---
title: "GenAI-Perf 命令详解"
sidebar_position: 4
description: "使用 NVIDIA GenAI-Perf 对大模型、嵌入和重排端点生成负载，分析TTFT、ITL、Token吞吐与请求吞吐。"
tags: [GenAI-Perf, NVIDIA, LLM, Benchmark, TTFT, ITL]
---

# GenAI-Perf 命令详解

GenAI-Perf面向生成式AI、Embedding和Ranking服务，能够生成并发或请求率负载，并输出TTFT、ITL、输出Token吞吐、请求吞吐等指标。CLI版本和参数变化较快，优先使用与服务栈匹配的SDK容器。

## 1. 环境与帮助 `[R]`

```bash
genai-perf --version
genai-perf --help
genai-perf profile --help
```

保存压测工具容器摘要、Python包版本和服务版本。不同版本可能将配置放在 `profile` 子命令或顶层，本文使用参数族说明。

## 2. OpenAI兼容端点基线 `[A]`

```bash
genai-perf profile \
  --model qwen-prod \
  --service-kind openai \
  --endpoint-type chat \
  --url http://service:8000 \
  --concurrency 8 \
  --synthetic-input-tokens-mean 512 \
  --output-tokens-mean 128 \
  --measurement-interval 10000 \
  --profile-export-file results.json
```

准确拼写以当前 `--help` 为准。开始前先用curl验证endpoint、model和认证Header，避免压测结果全是协议错误。

## 3. 参数分组

| 参数族 | 作用 |
|---|---|
| `--model` | 请求模型名称，需与服务暴露名称一致 |
| `--service-kind` | Triton、OpenAI兼容等服务类型 |
| `--endpoint-type` | `chat`、`completions`、`embeddings`、`rankings`等 |
| `--url`、`--endpoint` | 服务地址和具体路径 |
| `--header` | 鉴权或租户Header，输出与进程列表需脱敏 |
| `--concurrency` | 在途请求并发，可提供多个值做扫描 |
| `--request-rate` | 开放环到达率，需同时控制最大并发 |
| `--input-file` | 使用真实/脱敏输入数据 |
| `--synthetic-input-tokens-*` | 合成输入长度分布 |
| `--output-tokens-*` | 输出长度目标分布 |
| `--measurement-interval` | 测量窗口长度 |
| `--stability-percentage` | 稳定判据，避免只取瞬时峰值 |
| `--warmup-request-count` | 预热请求数量 |
| `--profile-export-file` | 保存结构化结果供比较 |

## 4. 指标解释

| 指标 | 含义 |
|---|---|
| TTFT | 发出请求到收到首个生成Token，含网络/排队/Prefill |
| ITL | 连续输出Token到达间隔 |
| TPOT | 每输出Token时间，具体统计口径需看工具版本 |
| Request latency | 请求到完整响应结束 |
| Output token throughput | 单位时间输出Token总量 |
| Request throughput | 单位时间成功完成请求数 |

对流式和非流式分别测试；确认工具如何识别Token、首Token和结束。服务端Tokenizer与工具侧估算不一致时，记录双方计数。

## 5. 数据与稳定性

- 合成数据用于控制长度分布，但不能替代真实chat template、多轮前缀和工具调用。
- 真实输入必须脱敏，压测输出和日志按敏感数据管理。
- 预热到模型加载、CUDA Graph、JIT和频率稳定后再统计。
- 每档并发重复多次，报告置信区间或至少min/median/max。
- 同时抓取服务waiting、KV、GPU利用率、功耗和错误，解释拐点。

## 6. 故障矩阵

| 现象 | 证据 |
|---|---|
| 结果0请求 | endpoint、协议类型、认证、model名称 |
| Token计数异常 | Tokenizer、chat template、输出终止和多模态字段 |
| 压测机CPU满 | 客户端进程、序列化、TLS、网卡；水平扩展客户端 |
| TTFT突增 | 服务排队、Prefill长度、网关、连接复用 |
| 吞吐增加但Goodput下降 | 进入饱和区，尾延迟已越SLO |
| 不同工具结果差异大 | 到达模型、Token分布、流式口径、预热和指标定义不同 |

## 掌握标准

能选择正确endpoint type；能构造输入输出Token分布；能读懂TTFT/ITL/吞吐并与服务指标对齐；能识别客户端瓶颈和不稳定窗口；能输出可复现的结果包。

## 官方资料

- [NVIDIA GenAI-Perf](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/genai-perf/README.html)
