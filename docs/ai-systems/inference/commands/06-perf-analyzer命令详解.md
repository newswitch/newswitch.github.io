---
title: "Triton perfanalyzer 命令详解"
sidebar_label: "06. Triton perfanalyzer 命令详解"
sidebar_position: 6
description: "使用 perf_analyzer 构造并发、请求率和自定义到达负载，通过稳定窗口分析客户端与Triton服务端延迟。"
tags: [Triton, perf_analyzer, Benchmark, 延迟, 吞吐]
---

# Triton perfanalyzer 命令详解

`perf_analyzer` 是Triton生态的通用负载发生器，可测试HTTP/gRPC端点，也支持部分非Triton服务类型。它会在测量窗口内反复采样，直到吞吐/延迟达到稳定条件或超过尝试上限。

## 1. 版本与帮助 `[R]`

```bash
perf_analyzer --help
```

官方SDK容器通常包含客户端工具。记录SDK容器摘要，并确认它和server协议/版本兼容。

## 2. 最小测试 `[A]`

```bash
perf_analyzer \
  -m resnet50 \
  -u triton:8000 \
  -i http \
  --concurrency-range 1:16:1 \
  --measurement-interval 10000 \
  --percentile 95 \
  -f result.csv
```

核心参数：

| 参数 | 含义 |
|---|---|
| `-m` | 模型名，必需 |
| `-x` | 模型版本 |
| `-u` | 服务URL |
| `-i` | `http`或`grpc` |
| `--service-kind` | Triton、TF Serving、TorchServe、动态gRPC等 |
| `-b/--batch-size` | 客户端请求Batch |
| `--concurrency-range START:END:STEP` | 闭环并发扫描 |
| `--request-rate-range` | 开放环请求率扫描 |
| `--request-distribution` | 到达分布，如constant/poisson，按帮助为准 |
| `--request-intervals` | 从文件读取自定义请求间隔 |
| `--measurement-mode` | time_windows或count_windows |
| `--measurement-interval` | 时间窗口长度或计数窗口参数 |
| `--stability-percentage` | 稳定阈值 |
| `--max-trials` | 最大稳定尝试数 |
| `--percentile` | 用指定分位数判定与报告延迟 |

## 3. 输入数据

```bash
perf_analyzer -m model --input-data input.json ...
perf_analyzer -m model --input-data zero ...
perf_analyzer -m model --input-data random ...
```

数据格式必须与模型metadata/config的输入名、shape和dtype一致。动态shape、String、Sequence和共享内存有额外参数；生产基线使用脱敏真实分布，不用全零输入代表真实计算路径。

## 4. 同步、异步与流式

| 参数 | 作用 |
|---|---|
| `--async` | 异步请求，较少线程维持高并发 |
| `--sync` | 同步线程模式 |
| `--streaming` | gRPC双向流，适合支持的sequence/stream场景 |

客户端模式会影响CPU和连接行为。对比结果时保持一致，并监控压测端CPU、网卡、连接数和事件循环。

## 5. 服务端指标与报告

```bash
perf_analyzer ... \
  --collect-metrics \
  --metrics-url triton:8002/metrics \
  --metrics-interval 1000 \
  --verbose-csv \
  -f result.csv \
  --profile-export-file profile.json
```

服务端分解通常包含queue、compute input、compute infer和compute output；客户端还包含发送、等待和接收。指标采集本身会增加请求，间隔不要过低。

## 6. 搜索与停止条件

部分版本支持二分搜索或延迟阈值：达到目标吞吐、超过延迟或错误条件后停止。必须同时设置最大并发/请求率与目标延迟，避免持续把已过载服务推向更高压力。

## 7. TLS与认证

工具支持的HTTP/gRPC SSL参数随版本变化，包括CA、客户端证书、私钥、SNI/Host和Header。认证值不得写入CSV、Shell历史或进程列表；复杂网关链路先用curl/grpcurl验证，再运行压测。

## 8. C API模式边界

```bash
perf_analyzer -m model \
  --service-kind=triton_c_api \
  --triton-server-directory=/opt/tritonserver \
  --model-repository=/models
```

C API模式绕过HTTP/gRPC，用于测Triton内核路径，不代表生产端到端延迟，且部分异步/协议功能不支持。单独标记结果。

## 9. 故障矩阵

| 现象 | 首要证据 |
|---|---|
| 无法稳定 | 窗口太短、服务抖动、预热不足、客户端瓶颈 |
| 输入shape错误 | metadata/config与input-data结构 |
| 并发增加但吞吐不升 | server饱和、client CPU/网络、动态Batch或单实例限制 |
| client延迟高、server延迟低 | 网络、网关、序列化、排队位置或客户端 |
| queue时间持续上升 | 到达率超过服务能力，已经进入不稳定区 |
| CSV缺服务指标 | metrics URL、verbose CSV、访问控制和采样开关 |

## 10. 掌握标准 {/* #掌握标准 */}

能区分并发与请求率模式；能设置稳定窗口和停止边界；能读取客户端/服务端延迟分解；能证明输入数据代表真实路径；能识别压测端瓶颈。

## 11. 官方资料 {/* #官方资料 */}

- [Perf Analyzer documentation](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/docs/README.html)
- [Perf Analyzer CLI](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/docs/cli.html)
