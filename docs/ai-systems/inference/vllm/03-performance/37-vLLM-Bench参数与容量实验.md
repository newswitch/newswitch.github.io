---
title: "vLLM v0.31 Bench 参数、负载模型与容量实验"
sidebar_label: "37. Bench 参数与容量实验"
sidebar_position: 37
description: "解释 vllm bench serve、latency、throughput、startup 与 sweep 的参数语义，建立开放环压测、Goodput 和容量拐点方法。"
tags: [vLLM, Benchmark, 容量规划, TTFT, TPOT, Goodput]
---

# vLLM v0.31 Bench 参数、负载模型与容量实验

你最初记得的“bench size”并不是一个统一参数。vLLM Benchmark 中需要分别控制：

~~~text
input_len / output_len   请求长度
num_prompts              样本数量
request_rate             到达率
max_concurrency          在途请求上限
batch size               某些离线/单批测试中的批大小
~~~

这些维度不能互相替代。

## 1. Benchmark 子命令

| 命令 | 测量对象 | 不代表什么 |
|---|---|---|
| `vllm bench latency` | 单 Batch 延迟 | 在线排队与并发容量 |
| `vllm bench throughput` | 离线 Engine 吞吐 | HTTP、SSE 和开放环 SLO |
| `vllm bench serve` | 在线服务端到端性能 | 单 Kernel 峰值 |
| `vllm bench startup` | 启动、加载、编译和 Warmup | 稳态吞吐 |
| `vllm bench mm-processor` | 多模态 Processor | Vision Encoder GPU 时间 |
| `vllm bench sweep` | 扫描参数组合 | 自动得出生产最优值 |

应从线上 `serve` 发现问题，再向离线 Engine、单 Batch 或 Kernel 下钻。

## 2. 数据集参数

| 参数 | 作用 |
|---|---|
| `--dataset-name` | random、ShareGPT、Prefix Repetition、Timed Trace 等 |
| `--dataset-path` | 数据集文件或 HF 数据集 |
| `--num-prompts` | 总请求数 |
| `--input-len` | 通用输入 Token 长度入口 |
| `--output-len` | 通用输出 Token 长度入口 |
| `--tokenizer` / `--tokenizer-mode` | 生成或校验 Token 长度 |
| `--disable-shuffle` | 保留原始请求顺序 |
| `--no-oversample` | 样本不足时不重复 |
| `--skip-chat-template` | 不套 Chat Template |

随机固定长度只能用于控制实验。容量结论必须使用生产 Token 直方图、共享前缀、采样参数和到达过程。

## 3. Request Rate

`--request-rate` 控制请求发起速率：

- `inf`：尽快发送；
- 有限值：按合成到达过程发送。

`--burstiness` 控制有限速率时的间隔分布：

- `1`：Poisson 到达；
- 小于 1：更突发；
- 大于 1：更均匀。

平均 10 RPS 的均匀流量与突发流量对队列 P99 的影响完全不同。

## 4. Max Concurrency

`--max-concurrency` 限制客户端同时在途请求数。它模拟网关或客户端背压：

~~~text
生成到达事件
→ 若在途数 < max_concurrency：立即发送
→ 否则等待已有请求完成
~~~

因此在服务处理不过来时，实际发送 RPS 可能低于 `request_rate`。报告中必须同时保存目标 RPS、实际 RPS 和并发。

## 5. 开放环与闭环

| 模型 | 机制 | 适合 |
|---|---|---|
| 开放环 | 到达率与响应完成无关 | 验证排队、过载和 SLO |
| 闭环 | 完成一个再发下一个 | 测固定并发下吞吐 |
| 全突发 | 一次发送大量请求 | 极限吞吐与队列上限 |

只做闭环压测会隐藏过载：服务越慢，客户端发得越慢，观察到的请求率自动下降。

## 6. 后端与 Endpoint

| 参数 | 作用 |
|---|---|
| `--backend` | vLLM、OpenAI Chat、Responses、Embedding、Rerank 等协议 |
| `--base-url` / `--host` / `--port` | 目标服务 |
| `--endpoint` | 请求路径 |
| `--header` | 鉴权和自定义 Header |
| `--model` | Tokenizer/模型身份 |
| `--served-model-name` | API 请求使用的模型名 |

Chat Completions、Completions、Responses、Embedding 的前后处理和指标不同，不能直接混合比较。

## 7. Sampling 与输出

压测至少固定：

- Temperature、Top-P、Top-K；
- 最大输出长度；
- Stop；
- Ignore EOS；
- Logprobs；
- Structured Outputs；
- Tool Calling；
- LoRA 分布。

如果模型提前产生 EOS，实际输出短于 `output_len`，吞吐会看起来更高。需要使用可控请求或相应选项保证输出分布符合目标。

## 8. LoRA 压测

`--lora-modules` 指定可用 Adapter，`--lora-assignment` 控制随机或轮询分配。

需要分别测试：

1. 全部请求同一个 LoRA；
2. 多 LoRA 均匀；
3. 热点 LoRA；
4. LoRA 换入；
5. 基座模型和 LoRA 混合。

否则无法看到 Batch 异质性和 Cache 的影响。

## 9. 指标

| 指标 | 含义 |
|---|---|
| Request Throughput | 完成请求数/秒 |
| Input Token Throughput | 输入 Token/s |
| Output Token Throughput | 输出 Token/s |
| TTFT | 到首 Token |
| TPOT | 首 Token 后平均每输出 Token 时间 |
| ITL | 相邻流式 Token 间隔 |
| E2E | 请求端到端时间 |
| Goodput | 同时满足指定 SLO 的完成请求率 |

平均值不能代替 P95/P99。长尾请求、排队和客户端取消都会改变结论。

## 10. Goodput

`--goodput` 可以定义请求级 SLO，例如：

~~~bash
--goodput ttft:800 tpot:50 e2el:15000
~~~

只有同时满足对应阈值的请求才计入 Goodput。高 Token/s 但大量请求 TTFT 超标，不是高质量容量。

## 11. Probe Request

`--probe-request-rate` 在主负载之外发送单 Token 探针，用来测量重负载是否拖慢无关小请求。探针绕开普通并发限制，适合观察：

- 大 Prefill 是否阻塞小请求；
- 过载时排队；
- P/D 分离是否改善 Decode 尾延迟；
- Chunked Prefill 调整前后差异。

## 12. Ramp-up

Ramp-up 参数逐步提高 RPS：

- `--ramp-up-strategy`；
- `--ramp-up-start-rps`；
- `--ramp-up-end-rps`；
- 持续时间或步长相关参数，以帮助为准。

它比直接压到最大更容易找到：

~~~text
吞吐仍增长
→ TTFT 开始弯曲
→ Waiting 持续累积
→ Goodput 下降
→ 错误/超时
~~~

生产容量应选在拐点之前并保留故障余量。

## 13. 一套可复现的在线实验

~~~bash
vllm bench serve \
  --backend openai-chat \
  --base-url http://127.0.0.1:8000 \
  --model /models/Qwen \
  --served-model-name qwen-prod \
  --dataset-name random \
  --input-len 1024 \
  --output-len 256 \
  --num-prompts 2000 \
  --request-rate 8 \
  --burstiness 1 \
  --max-concurrency 64 \
  --metric-percentiles 50,90,95,99 \
  --goodput ttft:800 tpot:50 \
  --save-result
~~~

这只是受控点位。随后扫描请求率、并发、输入/输出长度和共享前缀。

## 14. 容量实验矩阵

| 维度 | 建议取值 |
|---|---|
| 输入 | P50、P95、P99、最大 |
| 输出 | 短、中、长、业务分布 |
| 到达 | 均匀、Poisson、突发 |
| 并发 | 1、拐点前、拐点、过载 |
| Prefix | 冷、热、真实共享比例 |
| Sampling | Greedy、生产温度、Structured |
| 功能 | 基线、LoRA、Spec、Tool |
| 故障 | N-1、冷副本、限流、客户端取消 |

## 15. 常见错误

- 用 `request_rate=inf` 的最大吞吐代替在线容量；
- 只测固定 128/128 Token；
- 客户端和服务端位于同一受限 CPU，互相争抢；
- 没有预热就把编译时间算入稳态；
- 只看请求数，不看 Token；
- 不保存实际输入/输出长度；
- 把服务端排队时间误认为纯模型时间；
- 用单次结果做结论。

## 16. 验收题与答案

**问题：`request_rate=20` 为什么实际可能只有 12 RPS？**

答案：如果同时设置了 `max_concurrency`，在途请求达到上限后客户端会等待；服务处理速度不足时实际发送率被背压限制。

**问题：为什么最大吞吐点通常不是生产容量点？**

答案：最大吞吐附近队列和尾延迟可能已经急剧上升，Goodput 反而下降；生产需要满足 SLO 并保留 N-1 和突发余量。

## 17. 官方资料

- [vLLM v0.31.0 Benchmark CLI](https://docs.vllm.ai/en/v0.31.0/benchmarking/cli/)
- [vLLM Bench Serve](https://docs.vllm.ai/en/v0.31.0/cli/bench/serve/)
- [vLLM Bench 子命令](https://docs.vllm.ai/en/v0.31.0/cli/bench/)
