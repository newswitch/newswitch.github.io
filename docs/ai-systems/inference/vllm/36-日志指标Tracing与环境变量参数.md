---
title: "vLLM v0.31 日志、指标、Tracing 与环境变量"
sidebar_label: "36. 可观测性与环境变量"
sidebar_position: 36
description: "解释 vLLM v0.31 ObservabilityConfig、Prometheus、OpenTelemetry、日志配置和 VLLM/CUDA/NCCL 环境变量的生效边界。"
tags: [vLLM, Prometheus, OpenTelemetry, 日志, 环境变量]
---

# vLLM v0.31 日志、指标、Tracing 与环境变量

参数只有在能够证明“是否生效、改变了什么”时才可运维。vLLM 的观测面包括：

~~~text
启动日志：解析后的模型、Backend、KV Block、Graph
周期日志：Running、Waiting、Token/s、KV 使用
Prometheus：聚合容量、延迟、缓存、抢占
OpenTelemetry：单请求跨组件路径
Profiler/NVTX：Kernel、Layer、通信和 CPU-GPU Timeline
~~~

## 1. 日志参数

| 参数 | 作用 | 风险 |
|---|---|---|
| `--disable-log-stats` | 关闭周期统计日志 | 同时会让部分依赖统计器的观测能力不可用 |
| `--enable-log-requests` | 记录请求信息 | DEBUG 可能包含输入 |
| `--enable-log-outputs` | 记录输出 | 可能泄露敏感信息 |
| `--enable-log-deltas` | 记录流式 Delta | 日志量大 |
| `--max-log-len` | 截断请求日志 | 截断不等于脱敏 |
| `--aggregate-engine-logging` | DP 时聚合 Engine 统计 | 便于总览，但排查慢 Rank 仍需分 Rank |
| `--logging-config.*` | v0.31 新日志配置族 | CLI/YAML 优先于历史环境变量 |

历史 `--log-config-file` 已进入弃用路径，v0.31 新配置应使用 `--logging-config.pylogging_config_file` 等字段，并在升级前查看目标版本帮助。

## 2. 日志应该回答什么

启动日志至少应能确认：

- vLLM 和平台版本；
- 模型、dtype、量化和最大长度；
- TP/PP/DP/EP Rank；
- Attention/Kernel Backend；
- KV Cache 字节、Block Size 和 Block 数；
- Chunked Prefill、Prefix Cache；
- CompilationConfig 与 CUDA Graph；
- Connector、LoRA 和 Speculative；
- 实际监听地址。

不要只保存最后一百行。真正决定参数是否生效的信息通常在初始化早期。

## 3. Prometheus 指标分层

| 层 | 关键问题 | 代表指标类型 |
|---|---|---|
| 接入 | 请求是否进入、失败在哪里 | 请求数、HTTP 错误 |
| 队列 | 容量是否不足 | Waiting/Running |
| 调度 | 每步做了多少工作 | Iteration Token、Batch |
| KV | 是否接近容量边界 | Cache Usage、Prefix Hit、Preemption |
| Prefill | 输入阶段是否慢 | Prompt Token/s、TTFT |
| Decode | 每 Token 是否慢 | Generation Token/s、ITL/TPOT |
| 端到端 | 用户是否达标 | E2E Histogram |

Counter 必须用 `rate()` 或 `increase()`；Gauge 看当前值；Histogram 通过 Bucket 计算分位数。不能对分位数再求平均。

## 4. ObservabilityConfig

| 参数 | 作用 |
|---|---|
| `--otlp-traces-endpoint` | OpenTelemetry Collector 地址 |
| `--collect-detailed-traces` | 指定详细 Trace 模块 |
| `--collect-model-forward-time` | 收集 Forward 时间 |
| `--collect-model-execute-time` | 收集 Execute 时间 |
| `--show-hidden-metrics-for-version` | 临时恢复某版本后隐藏的旧指标 |
| `--cudagraph-metrics` | 收集 Graph Padding/Runtime 等指标 |
| `--kv-cache-metrics` | 采样 Block 生命周期、空闲和复用间隔 |
| `--kv-cache-metrics-sample` | KV 指标采样比例 |
| `--enable-mfu-metrics` | 收集 MFU |
| `--enable-mm-processor-stats` | 收集多模态 Processor 耗时 |
| `--enable-layerwise-nvtx-tracing` | Layer 级 NVTX |
| `--jit-monitor-mode` | Warmup 后再发生 JIT 时告警或报错 |

详细观测会增加 CPU、内存、日志、Trace 导出和 GPU 标记开销。应在受控窗口开启并测量开销。

## 5. Trace 时间怎样理解

~~~text
E2E
= Gateway
 + API/Template/Tokenizer
 + Queue
 + Scheduler
 + Model Execute
 + Output/Parser
 + Network Flush
~~~

Model Forward 与 Execute 不一定相同。Execute 还可能包含 Worker 协调、输入准备、通信、Sampling 或设备同步，具体以 v0.31 Trace Span 定义为准。

## 6. 环境变量的生效时机

环境变量可能在不同时间读取：

| 时机 | 示例影响 |
|---|---|
| 安装/编译 | CUDA Home、编译并行度、目标架构 |
| Python Import | 插件、日志、平台选择 |
| 进程启动 | Host IP、通信、缓存目录 |
| Worker 初始化 | NCCL、CUDA Allocator、设备可见性 |
| Kernel 执行 | Backend 专用调试或调优开关 |

修改 Pod 环境变量后只重载 HTTP 配置通常不会生效，需要重建进程甚至镜像。

## 7. 环境变量分类

### 7.1 设备和平台

- `CUDA_VISIBLE_DEVICES`：限制进程可见 GPU；
- `CUDA_HOME`：编译/查找 Toolkit；
- ROCm/XPU/TPU 平台专用变量；
- `VLLM_TARGET_DEVICE` 等构建或平台变量，具体以版本源码为准。

### 7.2 通信

- `VLLM_HOST_IP`：vLLM 内部通信地址；
- `VLLM_PORT`：内部通信端口，不是 API Server `--port`；
- `VLLM_NCCL_SO_PATH`：显式指定 NCCL 库；
- `NCCL_SOCKET_IFNAME`、`NCCL_IB_HCA`、`NCCL_DEBUG`：NCCL 网络与诊断；
- Gloo、UCX、NIXL 和 RDMA 相关变量。

Kubernetes Service 不要命名为 `vllm`。Kubernetes 会为 Service 注入 `VLLM_SERVICE_HOST` 等变量，可能与框架的 `VLLM_*` 命名空间冲突。

### 7.3 日志和统计

- `VLLM_LOGGING_LEVEL`；
- `VLLM_LOGGING_CONFIG_PATH`；
- `VLLM_CONFIGURE_LOGGING`；
- `DO_NOT_TRACK`；
- `NO_COLOR`。

v0.31 对 Serve 日志更推荐 CLI/YAML LoggingConfig；环境变量主要保留默认或兼容入口。

### 7.4 编译与缓存

- Torch/Inductor/Triton Cache 目录；
- vLLM 配置与资产缓存目录；
- 编译并行 Worker；
- Kernel 下载/编译开关；
- 自定义算子和 Backend 调试变量。

缓存目录必须按版本、GPU 架构和镜像隔离，避免 ABI 不一致。

### 7.5 运行时与调试

- `VLLM_SERVER_DEV_MODE`：开放 Sleep/Collective RPC 等开发接口；
- `VLLM_USE_FASTOKENS`：替换兼容 Tokenizer 的 Rust BPE Backend；
- `VLLM_MAX_N_SEQUENCES`：约束请求参数 `n` 的最大值；
- Worker Multiprocessing、超时与 IPC 相关变量；
- CUDA/NCCL 同步和调试变量。

调试变量可能严重降低性能，例如强制同步会改变 Timeline，不能长期留在生产模板。

## 8. CLI 与环境变量冲突

常见错误：

~~~bash
export VLLM_PORT=8000
vllm serve /models/Qwen --port 8000
~~~

`VLLM_PORT` 用于框架内部通信，`--port` 用于 API Server；把两者设成同一含义可能产生端口冲突或错误判断。

配置审计应输出经过 Secret 脱敏的环境变量白名单，而不是把整个 `env` 原样写进日志。

## 9. 告警组合

单指标容易误报，应组合：

| 告警 | 条件示例 |
|---|---|
| 容量不足 | Waiting 上升 + Running 接近上限 + TTFT P99 超标 |
| KV 压力 | KV Usage 高 + Preemption 增长 |
| 前端瓶颈 | Queue 前耗时高 + GPU 空洞 + API CPU 高 |
| Decode 回归 | TPOT 上升 + Decode Batch 相近 + NCCL/Kernel 变慢 |
| Prefix 退化 | 共享前缀流量不变 + Hit Token 下降 |
| Graph 退化 | Eager 回退增加 + Host Launch Gap 增大 |

## 10. 验收题与答案

**问题：为什么不能用 GPU Util 单独判断 vLLM 是否健康？**

答案：GPU Util 不包含前端排队、Tokenizer、KV 抢占、尾延迟和输出协议。高 Util 可能已经过载，低 Util 也可能是前端饥饿或流量不足。

**问题：`VLLM_PORT` 是 API 服务端口吗？**

答案：不是。它用于 vLLM 内部通信；API 监听端口由 `--port` 控制。

## 11. 官方资料

- [vLLM v0.31.0 Production Metrics](https://docs.vllm.ai/en/v0.31.0/usage/metrics/)
- [vLLM v0.31.0 Metrics Design](https://docs.vllm.ai/en/v0.31.0/design/metrics/)
- [vLLM v0.31.0 Environment Variables](https://docs.vllm.ai/en/v0.31.0/configuration/env_vars/)
- [Logging Configuration](https://docs.vllm.ai/en/v0.31.0/examples/features/logging_configuration/)
