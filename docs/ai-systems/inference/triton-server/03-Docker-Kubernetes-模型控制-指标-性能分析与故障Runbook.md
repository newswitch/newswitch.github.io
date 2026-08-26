---
title: "Triton Docker、Kubernetes、模型控制、指标、性能分析与故障 Runbook"
sidebar_label: "03. 部署、性能与故障 Runbook"
sidebar_position: 3
description: "部署 Triton 并使用模型控制、Metrics、Trace、Perf Analyzer 和 Model Analyzer 完成生产调优与排障。"
tags: [Triton Inference Server, Kubernetes, Perf Analyzer, Troubleshooting]
---

# Triton Docker、Kubernetes、模型控制、指标、性能分析与故障 Runbook

## 1. 版本与镜像

Triton 容器通常按年月发布，并捆绑 CUDA、TensorRT、Backend 和 Python 版本。必须保存镜像 Digest、GPU Driver、CUDA Compatibility、模型 Backend、Client 和 Model Config 的兼容矩阵。

```bash
docker run --rm --gpus all --shm-size=1g \
  -p 8000:8000 -p 8001:8001 -p 8002:8002 \
  -v "$PWD/models:/models:ro" \
  nvcr.io/nvidia/tritonserver:<release>-py3 \
  tritonserver --model-repository=/models --model-control-mode=none
```

固定实际 Release；示例占位符不能直接执行。共享内存过小会影响 Python Backend 和数据搬运。

## 2. 模型控制模式

| 模式 | 行为 | 风险 |
| --- | --- | --- |
| `none` | 启动时加载，之后不轮询 | 配置稳定、变更需重启 |
| `poll` | 周期扫描仓库 | 对象存储一致性和半成品版本风险 |
| `explicit` | Repository API 显式 Load/Unload | 需可靠发布控制面 |

模型发布应先上传不可变版本和完整校验，再原子更新可见入口，最后 Load。不能让 Poll 扫描到只上传了一半的目录。

## 3. Kubernetes

GPU Triton Pod 应设置 GPU、CPU、内存、共享内存、Node Affinity 和拓扑；模型仓库可来自镜像、PVC、对象存储同步或节点缓存。Readiness 使用 Server/Model Ready，但不要把大模型首次加载放进过短 Liveness 导致重启循环。

滚动升级需要额外 GPU 容量或使用受控 Recreate/蓝绿。Pod Ready 前运行真实样例请求和数值校验，模型加载成功不等于输出正确。

## 4. 性能证据

Triton 指标将请求分为 Queue、Compute Input、Compute Infer 和 Compute Output。Perf Analyzer 产生固定并发或请求率，Model Analyzer 搜索 Batch、Instance 和 GPU 配置。

```bash
perf_analyzer -m MODEL -u localhost:8001 -i grpc --concurrency-range 1:64:4
model-analyzer profile --model-repository /models --profile-models MODEL
```

压测客户端不能与 Server 争用同一 CPU/GPU；同时保存模型版本、输入分布、Batch、协议和 SLO。平均延迟没有 P99 与错误率不能用于容量结论。

## 5. Runbook

| 现象 | 第一证据 | 常见方向 |
| --- | --- | --- |
| Server Ready 但 Model 不 Ready | Repository Index、Server Log | Backend、配置、文件、显存 |
| Queue 高、Infer 稳定 | Pending Count、Queue Duration | 并发过载、实例不足、Batch |
| Infer 高 | Backend Trace、GPU Profile | Engine、Shape、Kernel、GPU |
| Compute Input 高 | 输入字节、Pinned Memory、NUMA | 拷贝和预处理 |
| 动态 Batch 很小 | Request Rate、Queue Delay | 流量不足或等待设置 |
| 模型 Reload 后错误 | Repository Version、Config Diff | 半成品发布和兼容 |

参考：[Triton Optimization](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/optimization.html)、[Metrics](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/metrics.html)。
