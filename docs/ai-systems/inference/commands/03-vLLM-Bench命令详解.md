---
title: "vLLM bench 命令详解"
sidebar_position: 3
description: "掌握 vLLM bench serve、latency、throughput与startup，构建并发、请求率、Token分布和Goodput容量曲线。"
tags: [vLLM, Benchmark, TTFT, TPOT, Goodput, 容量规划]
---

# vLLM bench 命令详解

`vllm bench` 包含在线服务和离线引擎等不同测试。线上容量规划主要使用 `bench serve`；离线 `latency/throughput` 用于剥离网关和网络开销，两类结果不能直接混比。

## 1. 版本与子命令 `[R]`

```bash
vllm --version
vllm bench --help
vllm bench serve --help
vllm bench latency --help
vllm bench throughput --help
vllm bench startup --help
```

## 2. 在线基线 `[A]`

```bash
vllm bench serve \
  --backend openai-chat \
  --base-url http://service:8000 \
  --endpoint /v1/chat/completions \
  --model qwen-prod \
  --dataset-name random \
  --num-prompts 200 \
  --input-len 512 \
  --output-len 128 \
  --max-concurrency 8 \
  --request-rate 4 \
  --save-result
```

先预热，再测试；压测机CPU、网络和文件描述符必须有余量。结果至少保留成功数、错误、请求吞吐、输入/输出Token吞吐、TTFT、TPOT/ITL和E2E各分位数。

## 3. 工作负载参数

| 参数族 | 含义 |
|---|---|
| `--backend` | vLLM/OpenAI兼容的completions、chat、embeddings等后端 |
| `--base-url`、`--host`、`--port`、`--endpoint` | 目标端点 |
| `--model`、`--served-model-name` | 请求模型与报告标识 |
| `--dataset-name`、`--dataset-path` | random、ShareGPT、HF、自定义等数据源 |
| `--num-prompts` | 总请求数，必须为有限值 |
| `--input-len`、`--output-len` | 通用Token长度；具体数据集有专用参数 |
| `--request-rate` | 请求到达率；`inf`近似同时发出，生产模拟慎用 |
| `--burstiness` | 到达间隔分布的突发程度 |
| `--max-concurrency` | 客户端在途请求上限 |
| `--num-warmups` | 正式统计前预热请求 |
| `--seed`、`--disable-shuffle` | 提升测试可重复性 |
| `--header` | 额外Header；凭据不要进入结果文件 |
| `--no-stream` | 非流式测试；需要与流式分别建基线 |

## 4. 结果与SLO

```bash
vllm bench serve ... \
  --percentile-metrics ttft,tpot,itl,e2el \
  --metric-percentiles 50,90,95,99 \
  --goodput ttft:1000 tpot:50 e2el:10000
```

参数名以当前帮助为准。Goodput表示同时满足指定SLO的请求速率，比纯QPS更接近业务可用容量。不要把平均值作为容量结论。

## 5. 数据集与Token分布

真实流量至少按以下维度分桶：输入长度、输出长度、模型、流式/非流式、cache可复用前缀、工具调用/多模态、租户与优先级。公开数据集只用于可比基线，容量决策要使用脱敏后的真实分布。

`--trust-remote-code` 允许执行数据集/模型代码，只有审计来源才能使用。自定义数据集先验证格式和Token长度统计，避免“字符长度”代替Token长度。

## 6. 容量曲线方法

1. 固定服务配置和一组Token分布。
2. 以低并发预热到缓存、频率和功耗稳定。
3. 逐级增加请求率或并发，每档运行足够时长。
4. 记录客户端指标、服务waiting/KV/GPU/功耗/错误。
5. 找出SLO首次持续越界点和错误拐点。
6. 在拐点前保留故障、发布和流量波动余量。

并发扫描和到达率扫描回答不同问题：闭环并发测试会在服务变慢时自然降低发起速率；开放环请求率更接近真实排队，但必须设置并发上限防止客户端失控。

## 7. 离线测试边界

```bash
vllm bench latency --help
vllm bench throughput --help
```

离线模式直接驱动engine，适合比较Kernel、量化和调度，不包含HTTP、网关、序列化和客户端。与线上测试必须分表呈现。

## 8. 常见错误

| 错误做法 | 后果 |
|---|---|
| 只压10个短请求 | 只测到预热和随机波动 |
| 输入输出长度未固定 | 两次结果没有可比性 |
| 报告QPS不报告Token吞吐 | 输出长度变化造成虚假提升 |
| 从压测机直接读TTFT但代理缓冲 | TTFB/TTFT混淆 |
| 无限请求率且无并发上限 | 形成客户端队列和服务事故 |
| 压测同时模型下载/编译 | 把冷启动成本混入稳态容量 |

## 掌握标准

能设计可重复工作负载；能解释开放环和闭环；能用Goodput确定SLO容量；能把冷启动、稳态和故障降级分别测试；能发现客户端成为瓶颈。

## 官方资料

- [vLLM Benchmark CLI](https://docs.vllm.ai/en/stable/benchmarking/cli/)
- [vLLM bench serve](https://docs.vllm.ai/en/stable/cli/bench/serve/)
