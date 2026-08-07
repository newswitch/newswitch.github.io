---
title: vLLM Tensor Parallel 多卡部署
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["vLLM", "Tensor Parallel", "NCCL", "Kubernetes", "学习路线"]
---

# vLLM Tensor Parallel 多卡部署

> **版本提示**：固定 **vLLM 镜像、驱动、GPU Operator**；示例基于 Deployment + OpenAI 兼容服务，勿用 `latest`。

模型放不进单卡、但能放进**同一台**多卡时，优先 Tensor Parallel（如 `--tensor-parallel-size 4`）。能放进单卡则优先单卡；跨节点再组合 Pipeline Parallel。显存见 [第 24 篇](./02-vLLM%20GPU%20显存组成与容量规划.md)；拓扑见 [第 02 篇](../../../foundations/compute/gpu/03-GPU%20服务器硬件拓扑与%20NUMA.md)。

---

## 1. 学习目标

理解 TP 与多副本差异；K8s 申请多卡；单节点多卡部署；验证进程/显存；NVLink/PCIe 影响；NCCL 与 `/dev/shm`；判断何时不该再加大 TP。

---

## 2. 原理与代价

大矩阵切到多卡并行计算，经 NCCL 聚合。好处：降单卡权重、撑更大模型。代价：层间跨卡通信、依赖 PCIe/NVLink、卡数增加不一定线性加速。

| | Tensor Parallel | 多副本 |
|--|-----------------|--------|
| 形态 | 1 个模型副本用 N 卡，一请求由 N 卡共同处理 | N 个副本各 1 卡，不同请求进不同副本 |
| 配置 | `--tensor-parallel-size N` | `replicas=N`，每 Pod `gpu: 1` |
| 选型 | 模型放不进单卡 | 模型能进单卡、要提总吞吐 |

---

## 3. 部署前检查

```bash
nvidia-smi -L
nvidia-smi topo -m
nvidia-smi topo -p2p r
nvidia-smi topo -p2p w
kubectl get nodes -o custom-columns='NODE:.metadata.name,GPU:.status.allocatable.nvidia\.com/gpu'
```

目标节点至少有 4 张可分配同型号/同显存 GPU；驱动正常；CPU/内存与模型存储足够。

---

## 4. 单节点四卡 Deployment（要点）

- `replicas: 1`；`limits.nvidia.com/gpu: 4` **等于** `--tensor-parallel-size 4`  
- `nodeSelector` + GPU Toleration（见 [13](../../../platform/gpu-cluster/scheduling-sharing/01-Kubernetes%20GPU%20节点标签与调度策略.md) / [14](../../../platform/gpu-cluster/scheduling-sharing/02-GPU%20节点%20Taint%20与%20Toleration%20实践.md)）  
- 镜像固定版本；挂模型 PVC；**挂足够 `/dev/shm`**（如 `emptyDir` Memory `sizeLimit: 16Gi`）  
- 单节点可用 `--distributed-executor-backend mp`；多节点常用 Ray  

常见错误：`gpu: 2` 却 `tensor-parallel-size: 4` → 可见设备不足 / NCCL 失败。

---

## 5. 验证

```bash
kubectl logs -n ai-model <POD> | grep -Ei 'tensor|rank|nccl|cache|worker'
kubectl exec -n ai-model <POD> -- nvidia-smi
kubectl exec -n ai-model <POD> -- nvidia-smi pmon
kubectl exec -n ai-model <POD> -- \
  nvidia-smi --query-gpu=index,memory.total,memory.used,utilization.gpu --format=csv
kubectl exec -n ai-model <POD> -- df -h /dev/shm
```

预期：四卡可见、每卡有 Worker、显存大致接近。仅一卡占用大 → 查 TP 是否生效、可见 GPU 数、进程是否部分失败。

Service + `curl .../v1/models` 与 chat completions 做接口验证。

---

## 6. 拓扑与 NCCL

TP 频繁跨卡通信，优先 NVLink/NVSwitch 组合，避免跨 NUMA 的 `SYS`。无 NVLink 时，某些模型高 TP 通信开销大，Pipeline Parallel 可能更合适。

排障可临时设 `NCCL_DEBUG=INFO`、`NCCL_SOCKET_IFNAME`、对比 `NCCL_IB_DISABLE=1`——作排障工具，勿不经验证永久写死。

---

## 7. 常见问题

| 问题 | 说明 |
|------|------|
| Pending `Insufficient nvidia.com/gpu` | 需**单节点**同时空闲 4 卡；集群合计 4 卡分散在多节点不够 |
| NCCL 卡住 | 拓扑、shm、驱动/NCCL、P2P、残留进程 |
| 四卡比两卡慢 | 模型小、通信开销大、无 NVLink、Batch/并发低、跨 NUMA |
| 权重无法均匀切 | Head/量化可能要求 TP 整除；试 TP=2/4、PP、其他量化 |

模型能进单卡、请求量大、延迟已够 → 更宜多副本而非盲目加大 TP。

---

## 8. 本篇总结

```text
确认放不进单卡 → 查数量与拓扑 → Pod 申请 N 卡
→ tensor-parallel-size=N → 足够 /dev/shm → 验证每卡进程/显存 → 测 NCCL
```

关键：`Pod GPU 数 = tensor-parallel-size`；**TP 越大 ≠ 一定更快**。

下一篇：[探针设计](./04-大模型服务%20Kubernetes%20探针设计.md)。

---

## 参考与致谢

- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/)
- [Using Kubernetes - vLLM](https://docs.vllm.ai/en/latest/deployment/k8s/)

本文按 vLLM 官方并行与部署文档整理，并按本系列做了交叉链接。
