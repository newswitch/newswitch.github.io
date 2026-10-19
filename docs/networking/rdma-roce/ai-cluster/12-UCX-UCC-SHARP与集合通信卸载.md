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

发行集合的定位见 [HPC-X 组件与版本契约](./15-HPC-X组件分层动态装载与版本契约.md)。HCOLL 与 UCC 是需要分别核对的集合组件，不能因为两者随包交付，就假定同一次操作串联经过两者；MPI 的点对点 PML 选择也不能代替 Collective 组件选择证据。

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

传统 AllReduce 在端点和网络中转发数据；SHARP 可让支持的交换网络参与 Reduction，减少端点和链路负担。是否生效受相应 Fabric 管理、交换机能力、作业树、数据类型、操作和规模限制。此处应核对 IB Subnet Manager、SHARP Aggregation Manager 等角色，不是把 NVSwitch 的 Fabric Manager 当作 SHARP 的统一控制服务。

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

## 8. 进度与完成不是同一个状态

应用提交通信请求后，库可能立即完成，也可能返回需要后续推进的请求。Endpoint 已创建、请求已入队、本地 Buffer 可复用、远端数据可消费，以及整个 Collective 完成，具有不同语义。上层必须按具体 API 的完成条件建立依赖。

如果某个 Rank 不再推进通信或提前退出，其他 Rank 的等待可能表现为集体超时；这不必然是交换机故障。先核对所有成员、调用顺序、数据类型和请求生命周期，再向下定位 Transport。

## 9. 算法与卸载分层

UCX 提供通信抽象与传输选择，UCC 对 Collective 组织组件，SHARP 将受支持运算放到网络内归约。某应用链接三者，不代表每个算子都经过全部层，也不代表任何数据类型和消息规模都适合卸载。

教学反例：大消息 AllReduce 获益，小消息时延增加。可能是建立资源、算法选择或固定开销占主导；不能用一个最好结果替换整条消息规模曲线。应观察实际组件选择、资源分配和回退证据，再判断数据路径。

## 10. 三类管理器

InfiniBand SM 管理子网路由等状态；SHARP AM 管理其卸载资源；NVLink FM/NVLSM 管理相应 GPU 互联。职责名称相似不等于管理同一对象，见[UFM 管理边界](../../ai-fabric/production/11-UFM对象模型遥测与Fabric管理.md)。

恢复一个管理进程不保证所有应用通信自动恢复。应用可能已将错误记入请求状态，成员也可能退出，因此还要判断是继续、重建通信上下文还是整组恢复。

协议和进度引擎的具体设计见 [UCX Eager、Rendezvous 与 Progress 源码](./14-UCX协议选择Eager-Rendezvous与Progress源码.md)，结合 v1.20.1 区分 inline 快路径、新旧协议分支和实际推进函数。

接收端的匹配语义另见 [MPI Tag Matching 与 UCX 接收源码](./16-MPI标签匹配队列硬件卸载与源码.md)。标签匹配卸载解决匹配与放置相关工作，SHARP 解决受支持归约的网络内计算，两者的功能、硬件条件和性能证据不能混用。

## 11. 掌握检查

能说明库存在、优化被选择、硬件路径生效和端到端获益四种证据的区别；能为一个 Collective Timeout 列出上层成员不一致、进度不足、底层链路和卸载资源四类假设，并说明如何否定它们。

参考：[OpenUCX](https://openucx.org/documentation/)、[UCC](https://github.com/openucx/ucc)、[NVIDIA SHARP](https://docs.nvidia.com/networking/display/sharpv3100)、[UFM 管理组件](https://docs.nvidia.com/networking/display/UFMEnterpriseUMv6171/ufm-software-architecture.pdf)。
