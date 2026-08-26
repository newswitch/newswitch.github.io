---
title: "UCX、UCC、SHARP 与集合通信卸载"
sidebar_label: "12. UCX、UCC 与 SHARP"
sidebar_position: 12
description: "理解统一通信抽象、集合通信库与交换网络内归约的分层，并建立回退和性能排查方法。"
tags: [UCX, UCC, SHARP, Collective, RDMA]
---

# UCX、UCC、SHARP 与集合通信卸载

## 1. 三层定位

| 技术 | 主要作用 |
| --- | --- |
| UCX | 统一使用 Shared Memory、TCP、RDMA、GPU Memory 等传输能力 |
| UCC | 在 UCX/NCCL/SHARP 等组件上提供统一 Collective API/Team |
| SHARP | 在受支持 InfiniBand Fabric 中卸载/加速部分 Collective Reduction |

应用、MPI、框架和版本可能选择不同集成路径。看到 UCX Library 不代表当前 Collective 一定经过 SHARP。

## 2. UCX 对象

```text
Context：启用Features并发现Transport
→ Worker：进度引擎
→ Endpoint：远端连接
→ Memory Registration/RKey
→ Tag、Stream、RMA、Atomic等操作
```

UCX 根据设备和配置选择 Lane/Transport。跨机性能异常时检查实际选择，而不是只检查 HCA 存在。

## 3. UCC

UCC 通过 Context、Team 和 Collective Request 组织通信。Team 可映射不同 Rank Group；算法和 TL/CL 组件根据消息、拓扑和能力选择。错误 Team 或进程成员不一致会导致 Collective 阻塞。

## 4. SHARP

传统 AllReduce 在端点和网络中转发数据；SHARP 可让支持的交换网络参与 Reduction，减少端点和链路负担。是否生效受 Fabric Manager、交换机能力、作业树、数据类型、操作和规模限制。

它不是“所有通信都在交换机完成”，且不适用于任意算子或拓扑。

## 5. 回退

生产必须知道优化路径不可用时：失败、自动回退到软件 Collective，还是性能静默下降。监控实际算法/Transport、Fallback 计数和性能基线。

## 6. 版本栈

```text
Application/Framework
→ MPI/UCC/NCCL
→ UCX/SHARP Client
→ rdma-core/OFED
→ NIC Firmware
→ Fabric Manager/Switch Firmware
```

升级任一层都要重新做功能、正确性和目标规模基准。

## 7. 排障顺序

1. TCP/基础 MPI；
2. RDMA perftest；
3. UCX `ucx_info` 和 Perftest；
4. UCC/MPI Collective；
5. 确认 SHARP 资源分配和实际卸载；
6. 真实消息分布与训练规模。

参考：[OpenUCX](https://openucx.org/documentation/)、[UCC](https://github.com/openucx/ucc)、[NVIDIA SHARP](https://docs.nvidia.com/networking/display/sharpv3100)。
