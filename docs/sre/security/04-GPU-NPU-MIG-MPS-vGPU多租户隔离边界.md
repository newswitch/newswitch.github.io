---
title: "GPU、NPU、MIG、MPS、vGPU 多租户隔离边界"
sidebar_label: "04. 加速器多租户隔离"
sidebar_position: 4
description: "比较整卡、MIG、MPS、时间切片和 vGPU 的资源与安全隔离，不把调度份额误当成硬件边界。"
tags: [GPU, NPU, MIG, MPS, vGPU, 多租户]
---

# GPU、NPU、MIG、MPS、vGPU 多租户隔离边界

## 1. 共享方式

| 方式 | 隔离单位 | 优点 | 主要边界 |
| --- | --- | --- | --- |
| 整卡独占 | 物理 GPU/NPU | 最清晰、性能稳定 | 颗粒度大 |
| MIG | 硬件实例 | 显存/计算等硬件分区 | 型号支持、拓扑和重配置 |
| MPS | 多进程共享执行 | 提高小任务并发 | 故障、QoS和安全边界弱于硬分区 |
| 时间切片 | 时间份额 | 简单提高可用副本 | 显存和故障域仍可能共享 |
| vGPU | 虚拟机/产品定义实例 | VM 集成、策略丰富 | License、Hypervisor 和版本矩阵 |

NPU 的虚拟化与切分能力由具体产品和驱动定义，应使用同一维度评估，不直接套用 MIG 名称。

## 2. 隔离的六个维度

- 显存容量和地址空间；
- SM/AI Core 计算份额；
- Copy Engine、Encoder 等 Engine；
- Cache、内存带宽和功耗；
- Reset、ECC、Xid 等故障域；
- 性能侧信道和资源争用。

Kubernetes Extended Resource 数量只代表调度资源，不能证明上述六项全部隔离。

## 3. MIG

MIG 把受支持 GPU 划分为 GPU Instance/Compute Instance。生产关注：Profile、设备 UUID、拓扑、重配置是否需要停止任务、监控指标如何归属、节点标签和 Device Plugin 策略。

MIG 实例之间隔离更强，但 PCIe、整卡功耗和部分管理故障仍属于同一物理 GPU 故障域。

## 4. MPS 与时间切片

MPS 允许多个 CUDA 进程更高效共享 GPU。它适合受信任工作负载的利用率优化，不应默认作为强租户安全边界。时间切片可能让每个 Pod 看到完整逻辑设备，显存超分和性能抖动需额外治理。

## 5. 设备残留

工作负载结束后，驱动通常负责清理 Context 和显存，但安全要求高的环境还需评估 Reset、ECC 状态、持久化缓存、节点转租户和设备故障后的残留。不能通过读取上一租户显存的实验在生产进行；应使用厂商支持的隔离证明和测试环境验证。

## 6. 调度策略

- 不同信任等级使用不同节点池；
- 敏感训练优先整卡或独占节点；
- MIG Profile 与工作负载显存/计算需求匹配；
- 共享模式设置并发和租户上限；
- 监控以物理卡和实例两个层级聚合；
- 一个物理 GPU 故障时正确计算受影响实例数。

参考：[NVIDIA MIG User Guide](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/)、[NVIDIA MPS](https://docs.nvidia.com/deploy/mps/)。
