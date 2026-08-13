---
title: "tritonserver 命令详解"
sidebar_position: 5
description: "掌握 Triton Inference Server 模型仓库、控制模式、HTTP/gRPC、指标、Trace、后端和生产安全配置。"
tags: [Triton, tritonserver, NVIDIA, 模型仓库, 推理服务]
---

# tritonserver 命令详解

Triton将模型仓库中的一个或多个模型通过KServe V2风格HTTP/gRPC协议暴露，并提供动态Batch、模型实例、指标、Trace和模型控制能力。模型仓库可能包含Python backend等可执行代码，因此仓库写权限等同于服务代码发布权限。

## 1. 版本与帮助 `[R]`

```bash
tritonserver --version
tritonserver --help
```

推荐使用固定月度版本的官方容器并记录镜像摘要；server、backend、CUDA、TensorRT和client工具尽量使用同一发布系列。

## 2. 最小启动 `[A]`

```bash
tritonserver \
  --model-repository=/models \
  --model-control-mode=none \
  --strict-readiness=true \
  --exit-on-error=true
```

探测：

```bash
curl -fsS http://127.0.0.1:8000/v2/health/live
curl -fsS http://127.0.0.1:8000/v2/health/ready
curl -fsS http://127.0.0.1:8000/v2
curl -fsS http://127.0.0.1:8000/v2/repository/index | jq .
curl -fsS http://127.0.0.1:8002/metrics | head
```

## 3. 模型仓库与控制模式

| 模式 | 行为 | 生产建议 |
|---|---|---|
| `none` | 启动加载选定模型，运行中忽略仓库变化 | 默认首选，发布通过新Pod/新制品 |
| `poll` | 周期扫描仓库变化 | 共享存储非原子更新可能加载半成品，慎用 |
| `explicit` | 通过API加载/卸载模型 | API必须强认证和隔离，仓库仍只允许受信制品 |

相关参数：

```bash
--model-repository=/models
--model-control-mode=none|poll|explicit
--repository-poll-secs=<seconds>
--load-model=<name>
--strict-model-config=true
--disable-auto-complete-config
```

动态更新模型仓库可能导致任意代码执行；除明确需求外使用 `none`。需要explicit时，将模型控制API与普通推理流量分离授权。

## 4. HTTP、gRPC与指标

| 参数族 | 用途 |
|---|---|
| `--allow-http`、`--http-address`、`--http-port` | HTTP开关与监听 |
| `--allow-grpc`、`--grpc-address`、`--grpc-port` | gRPC开关与监听 |
| `--grpc-use-ssl`、证书/私钥/CA参数 | gRPC TLS/mTLS |
| `--allow-metrics`、`--metrics-address`、`--metrics-port` | Prometheus指标 |
| `--allow-gpu-metrics`、`--allow-cpu-metrics` | 设备/CPU指标开关 |
| `--metrics-interval-ms` | 指标采样间隔 |

不使用的协议端口应关闭。监听 `0.0.0.0` 不是访问控制；在集群内配合NetworkPolicy、Gateway认证和TLS。

## 5. 日志与Trace

```bash
tritonserver ... \
  --log-info=true \
  --log-warning=true \
  --log-error=true \
  --log-verbose=0
```

Trace参数族通常包含 `--trace-config`，旧版本也可能提供 `--trace-file`、`--trace-level`、`--trace-rate`、`--trace-count`、`--log-frequency`。Trace可能记录张量、时间线和敏感输入，限制采样、数量、路径权限和保留时间。

## 6. 后端与内存

| 参数族 | 用途 |
|---|---|
| `--backend-directory` | 后端目录，必须来自受控镜像 |
| `--backend-config=<backend>,<key>=<value>` | 后端配置，按对应backend文档验证 |
| `--repoagent-directory` | Repository Agent目录，可执行代码 |
| `--pinned-memory-pool-byte-size` | CPU pinned内存池 |
| `--cuda-memory-pool-byte-size=<gpu>:<bytes>` | 指定GPU CUDA内存池 |
| `--response-cache-byte-size` | 响应缓存大小，需评估数据隔离和命中语义 |
| `--buffer-manager-thread-count` | Buffer管理线程数 |

共享内存、pinned内存和GPU内存都可能受容器限制。Kubernetes中同时检查 `/dev/shm`、IPC、memlock、Pod内存限制和GPU实际可用显存。

## 7. 就绪语义

`--strict-readiness=true` 时，所选模型都成功加载才Ready。关闭严格就绪可能让部分模型不可用时仍返回Ready；多模型服务必须明确业务是否允许部分可用。

`--exit-on-error=true` 能在初始化异常时直接退出，便于编排系统重启和阻断发布。无限重启会掩盖根因，应配合启动日志和回退策略。

## 8. 故障矩阵

| 现象 | 首要检查 |
|---|---|
| live成功、ready失败 | repository index、模型加载日志、配置和backend |
| 模型UNAVAILABLE | 版本目录、文件名、config.pbtxt、shape/dtype、backend依赖 |
| 动态Batch无效果 | 模型配置、请求shape、队列延迟和并发是否满足 |
| GPU OOM | instance_group数量、模型副本、workspace和并发 |
| explicit加载失败 | 控制模式、API权限、仓库原子性和错误详情 |
| HTTP正常、gRPC失败 | 端口、TLS、HTTP/2、Service协议和客户端版本 |
| 指标缺GPU | GPU metrics开关、DCGM/NVML/权限和容器设备 |

## 掌握标准

能解释三种模型控制模式；能设计不可变仓库发布；能区分live、ready和模型业务验证；能收紧协议与动态加载边界；能将模型配置、实例数和内存池映射到GPU容量。

## 官方资料

- [Triton documentation](https://docs.nvidia.com/deeplearning/triton-inference-server/)
- [Secure deployment considerations](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/customization_guide/deploy.html)
- [Model management](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_management.html)
