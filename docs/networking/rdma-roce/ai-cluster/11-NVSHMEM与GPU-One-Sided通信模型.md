---
title: "NVSHMEM 与 GPU One-Sided 通信模型"
sidebar_label: "11. NVSHMEM 与 One-Sided 通信"
sidebar_position: 11
description: "理解对称堆、PE、Put/Get、Signal、Collective 与 GPU 发起通信，比较 NVSHMEM 和 NCCL。"
tags: [NVSHMEM, GPU, One-Sided, RDMA, PGAS]
---

# NVSHMEM 与 GPU One-Sided 通信模型

## 1. 定位

NVSHMEM 为 NVIDIA GPU 提供 Partitioned Global Address Space 风格的通信。每个 Processing Element（PE）拥有对称对象，程序可以从 Host 或 Device 发起对远端 PE 的 Put/Get、Atomic、Signal 和 Collective。

```text
GPU Kernel
→ NVSHMEM Device API
→ 对称堆地址与目标PE
→ NVLink/PCIe/GPUDirect RDMA Transport
→ 远端GPU内存
```

## 2. 对称堆

所有 PE 以相同顺序和大小分配 Symmetric Object，使同一地址偏移在每个 PE 表达对应对象。某个 PE 分配顺序不同会破坏地址语义。

对称堆大小需容纳通信 Buffer，并受启动参数、设备和 Transport 限制。容量规划不能只看模型显存。

## 3. One-Sided

Put/Get 不要求远端 CPU 同时调用匹配 Receive，但程序仍需使用 Fence、Quiet、Signal、Wait 或 Barrier 保证可见性和顺序。One-Sided 不代表没有同步，只是同步模型不同。

## 4. GPU Initiated Communication

通信可在 Kernel 内发起，有助于细粒度通信计算重叠和不规则访问，减少 Host 介入。但大量细小远端操作可能受事务、网络和同步开销限制，需要聚合和拓扑设计。

## 5. 与 NCCL

| NVSHMEM | NCCL |
| --- | --- |
| PGAS、Put/Get/Atomic/Signal、Collective | 高性能标准 Collective 和 P2P |
| 适合细粒度和自定义通信模式 | 适合 AllReduce/AllGather 等规则通信 |
| 应用控制数据位置与同步 | Library 选择 Collective 算法 |

它们可以在同一应用中承担不同部分，不是简单谁替代谁。

## 6. 启动与 Transport

PE 启动可与 MPI、PMIx、Slurm 等集成。Transport 可能使用 NVLink、IB/RoCE 等，需验证 GPU Direct、HCA、GID、拓扑和版本。容器必须暴露对应 GPU/RDMA Device 和 Library。

## 7. 排障

```text
初始化失败 → Bootstrap/PMIx/MPI/版本
对称分配失败 → Heap大小/分配顺序/HBM
Wait永久阻塞 → Signal顺序/目标PE/内存可见性
跨机很慢 → Transport回退/拓扑/RDMA
结果偶发错误 → Fence/Quiet/同步不足
```

## 8. 验证

先运行官方 Perftest/示例，分别测单机 NVLink 和跨机 RDMA，再测试真实访问粒度。报告操作大小、PE 数、拓扑、带宽、延迟和同步语义。

参考：[NVIDIA NVSHMEM Documentation](https://docs.nvidia.com/nvshmem/api/)。
