---
title: "GPU 服务器 Burn-in 压力测试与交付验收"
sidebar_label: "05. Burn-in 与交付验收"
sidebar_position: 5
description: "设计覆盖 CPU、内存、GPU、显存、互联、网卡和存储的分层 Burn-in，识别早期失效与慢节点。"
tags: [GPU, Burn-in, 验收, DCGM, NCCL]
---

# GPU 服务器 Burn-in 压力测试与交付验收

## 1. Burn-in 要证明什么

Burn-in 不是让 GPU 利用率达到 100% 截图。它要证明节点在持续高负载下：

- 计算结果正确；
- 显存没有不可接受的 ECC 错误；
- 温度、功耗和频率稳定；
- PCIe、NVLink/NVSwitch 没有链路错误或降级；
- NIC/RDMA 和 NVMe 在压力下稳定；
- 性能没有显著偏离同批次基线。

## 2. 分层测试矩阵

| 层级 | 测试目标 | 观察证据 |
| --- | --- | --- |
| CPU/内存 | NUMA、内存稳定性、Machine Check | EDAC/MCE、带宽、温度 |
| GPU 计算 | Tensor/FP 运算与持续功率 | 吞吐、Clock、Throttle Reason |
| 显存 | 容量、带宽、ECC | Correctable/Uncorrectable、错误地址 |
| PCIe | Link Speed/Width、P2P | AER、Replay、吞吐 |
| NVLink/NVSwitch | 卡间带宽和错误 | Link State、CRC/Recovery、P2P 基准 |
| NIC/RDMA | 单 Rail、双 Rail、拥塞下通信 | BER、丢包、ECN/PFC、perftest |
| 存储 | 系统盘、NVMe、远端存储 | SMART、IOPS、带宽、尾延迟 |
| 综合 | NCCL/HCCL 和真实模型 | BusBW、Step Time、错误日志 |

先做单组件测试，再做综合压力。直接运行全系统压力时，即使失败也难以判断根因。

## 3. 基线而不是固定阈值

不同机型和拓扑不能使用同一绝对吞吐阈值。更可靠的方法是：

1. 在已知健康节点建立同型号、同固件、同配置分布；
2. 记录中位数、离散度和尾部；
3. 对新节点按相同参数运行；
4. 同时判断绝对最低值和相对偏差；
5. 对离群节点重复测试并交换线缆/端口定位。

如果一个节点始终比同批次慢 10%，即使没有报错，也不应直接投入同步训练，因为它会成为所有 Rank 的慢节点。

## 4. 测试期间的观测

需要同步采集：

- BMC 温度、电源、风扇和 SEL；
- Kernel MCE、EDAC、AER、IOMMU；
- GPU Xid、ECC、温度、功耗、Clock、Throttle；
- NVLink、NIC 和交换机端口计数；
- NVMe SMART；
- 测试工具版本、参数、拓扑和退出码。

工具输出与指标使用统一时间源，才能将某次性能下降关联到链路重训或温控降频。

## 5. 安全执行

Burn-in 会长期占满功率、网络和存储，必须在隔离节点和受控网络执行。不要在承载业务的节点运行破坏性显存、磁盘写入或大规模 Collective。测试任务设置总时限、温度/功率停止条件，并限制每机架同时测试数量。

## 6. 验收报告

报告至少包含资产和序列号、软件/固件版本、拓扑、测试参数、开始结束时间、原始结果、基线对比、所有错误计数和最终结论。结论只有三种：通过、隔离复测、硬件维修；不能用“暂时观察”把未知节点加入生产池。

参考：[NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/dcgm-diagnostics.html)、[NCCL Tests](https://github.com/NVIDIA/nccl-tests)。
