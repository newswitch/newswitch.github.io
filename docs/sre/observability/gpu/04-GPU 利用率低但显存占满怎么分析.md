---
title: "GPU 利用率低但显存占满怎么分析"
sidebar_label: "04. GPU 利用率低但显存占满怎么分析"
sidebar_position: 4
description: "值班常见矛盾现象：FBUSED 很高，GPUUTIL / GRENGINEACTIVE 却长期很低。卡被「占着」但不干活，既浪费钱又拖死调度。本文给出用 DCGM + 业务指标的分析路径。前置：第 38、第 40 篇。"
tags: ["DCGM", "GPU", "利用率", "显存", "排障", "学习路线"]
date: 2026-07-22 18:45:00
categories: 云原生
---

# GPU 利用率低但显存占满怎么分析

值班常见矛盾现象：**`FB_USED` 很高，`GPU_UTIL` / `GR_ENGINE_ACTIVE` 却长期很低**。卡被「占着」但不干活，既浪费钱又拖死调度。本文给出用 DCGM + 业务指标的分析路径。前置：[第 38](./01-DCGM%20Exporter%20GPU%20监控指标详解.md)、[第 40](./03-Grafana%20GPU%20集群总览看板设计.md) 篇。

## 1. 先确认指标含义

| 信号 | 常见指标 | 解读 |
|------|----------|------|
| 显存满 | `DCGM_FI_DEV_FB_USED` 高、`FB_FREE` 低 | 权重 / KV / 激活 / 碎片占住显存 |
| 算力闲 | `DCGM_FI_DEV_GPU_UTIL`、`PROF_GR_ENGINE_ACTIVE` 低 | SM 很少在算 |
| 可选 | `PIPE_TENSOR_ACTIVE` 低 | 没有矩阵密集计算 |
| 可选 | 功耗接近空闲、时钟可能降频 | 侧面印证「没在猛算」 |

「利用率」在 DCGM 里有多套（传统 UTIL vs profiling active），看板要固定用同一套做判断。

## 2. 决策树

```text
显存高 + 利用率低
        │
        ├─ 推理服务？
        │     ├─ 有请求但 waiting 高 → 排队/KV/调度，不是「空闲」
        │     ├─ 几乎无请求 → 冷模型常驻，权重占显存（预期行为或该缩容）
        │     └─ KV 高 + util 低 → 可能卡在 CPU/网络/死锁
        │
        ├─ 训练？
        │     ├─ 数据加载慢 / CPU 瓶颈 → GPU 等 batch
        │     ├─ NCCL 等待 → 通信 hang（查 33/48）
        │     └─ 某 rank 已挂，其它空转占显存
        │
        └─ 未知 Pod
              → 查 namespace/pod 标签，看进程是否僵尸
```

## 3. 常见根因与证据

### 3.1 大模型权重常驻（推理）

- 现象：部署后无流量，显存已占大半，util ≈ 0
- 证据：vLLM/进程在，`num_requests_running/waiting≈0`
- 处理：HPA/缩容到 0、多模型共享、量化、分时加载；成本看板单独统计「空闲常驻」

### 3.2 KV Cache 占满但算不动

- 现象：`kv_cache_usage` 高，TTFT 差，GPU util 不一定高
- 证据：业务指标 + FB_USED
- 处理：降并发、扩副本、查前缀缓存；见 [28](../../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)、[42](./05-大模型业务指标与%20GPU%20指标关联分析.md)

### 3.3 数据与 CPU 瓶颈（训练）

- 现象：步间歇很长，util 锯齿：尖峰一下又掉零
- 证据：CPU 打满、磁盘延迟高、DataLoader worker 少
- 处理：加 workers、缓存、更快存储（第 36 篇）

### 3.4 集合通信等待

- 现象：多卡 util 同步掉零，长时间无 step
- 证据：NCCL timeout 日志、IB 计数；DCGM 上多卡同时「闲」
- 处理：[48](../../../gpu/cluster/troubleshooting/07-NCCL%20Timeout%20排查流程.md)

### 3.5 僵尸 / 半死进程

- 现象：进程在、不接请求、显存不释放
- 证据：Pod Ready 但业务探针失败；或 Python 卡在死锁
- 处理：按 Runbook 重启 Pod，并修正业务探针与优雅退出流程

### 3.6 共享 / MIG / Time-Slicing 错觉

- 多容器「看到」显存统计方式不同；util 被时间片稀释
- 对照第 19～22 篇共享方案，避免误判

## 4. 推荐查询（PromQL 示意）

```promql
# 高显存低利用率的卡（阈值按环境改）
(
  DCGM_FI_DEV_FB_USED > 8000
)
and
(
  DCGM_FI_DEV_GPU_UTIL < 10
)

# 若有 pod 标签：按租户聚合浪费时长
avg_over_time(
  (
    DCGM_FI_DEV_GPU_UTIL{namespace="inference"} < 5
    and DCGM_FI_DEV_FB_USED > 4000
  )[1h:]
)
```

告警模板见 [第 39 篇](./02-Prometheus%20GPU%20告警策略设计.md) 的 `GPUIdleButAllocated`。

## 5. 现场命令补充

```bash
nvidia-smi          # 进程列表与显存
nvidia-smi pmon -c 5
kubectl top pod -n <ns>
kubectl logs <pod> --tail=100
# 推理
curl localhost:8000/metrics | grep -E 'waiting|kv_cache|num_requests'
```

## 6. 优化方向速查

| 根因 | 动作 |
|------|------|
| 无流量常驻 | 缩容 / 休眠（若支持 sleep） / 共享节点池 |
| 请求不足 | 并流量、降副本 |
| 数据慢 | 存储与 DataLoader |
| NCCL | 修网络/拓扑后再谈利用率 |
| 死锁僵尸 | 重启 + 修代码/探针 |
| 显存碎片 | 重启释放；调整并发与序列长 |

## 7. 小结

| 问题 | 答案 |
|------|------|
| 显存满一定在算吗？ | 不一定，权重和 KV 都能「静静占满」 |
| 先看什么？ | 有没有请求 / 是否在等通信 / 是否僵尸 |
| 和成本关系？ | 低 util 高 FB 是最贵的浪费形态之一 |

下一篇：[业务指标与 GPU 指标关联分析](./05-大模型业务指标与%20GPU%20指标关联分析.md)。

## 8. 参考与致谢 {/* #参考与致谢 */}

- [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)
- [DCGM Exporter](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/dcgm-exporter.html)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)

本文把 DCGM 现象与推理/训练场景对策串成可执行分析树。
