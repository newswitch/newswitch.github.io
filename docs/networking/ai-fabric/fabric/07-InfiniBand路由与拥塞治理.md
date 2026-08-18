---
title: "InfiniBand 路由与拥塞治理"
sidebar_label: "07. InfiniBand 路由与拥塞治理"
sidebar_position: 7
description: "理解 IB Fat-Tree 路由、LID Path、SL/VL、Credit 反压、Adaptive Routing 和拥塞定位。"
tags: [InfiniBand, Fat-Tree, Adaptive Routing, Credit, SL, VL]
---

# InfiniBand 路由与拥塞治理

InfiniBand 使用 SM 计算和下发路径。高带宽链路本身不会保证均匀流量；确定性路由、
通信矩阵和 Credit 反压同样会形成热点。

## 1. 路由输入

SM 需要：

- Node/Port GUID 和拓扑；
- Link Speed/Width；
- LID/LMC；
- PKey Partition；
- SL/VL/QoS；
- 所选路由算法；
- 故障端口和管理策略。

输出包括交换机按目的 LID 的转发表和相关端口配置。

## 2. Fat-Tree 目标

Fat-Tree 路由希望：

- 在等价上行之间均匀分配；
- 避免同一源/目的组合长期堆在单链路；
- 保持下行可达；
- 处理链路故障；
- 支持 Rail/Partition 约束。

实际分布取决于 LID 分配、LMC、路由算法和通信矩阵。用 `ibnetdiscover`、路由转发表和端口计数验证。

## 3. Credit-Based Flow Control

接收端为某 VL 提供可用 Credit；发送端只有获得足够 Credit 才能发送。

优点：

- 链路层避免接收 Buffer 溢出；
- 不依赖以太网 PFC。

风险：

- 下游无 Credit 时上游停止；
- 拥塞沿路径传播；
- 不同流共享 VL 时出现 HOL；
- 路由依赖循环可能造成死锁。

所以 IB 仍需要容量、VL 隔离、路由和拥塞治理。

## 4. SL/VL

Path 选择 SL，每一跳将 SL 映射为 VL。VL 具有独立 Credit 和仲裁。

设计用途：

- 隔离管理与数据；
- 给不同服务等级独立资源；
- 避免依赖循环；
- 配合 Partition 和应用。

错误映射表现：

- 期望隔离的业务共用 VL；
- 某 VL 长时间等待；
- 其他 VL 正常但某类 Collective 抖动；
- 变更后部分路径的映射不一致。

## 5. Static 与 Adaptive Routing

静态路由按预计算路径转发，行为稳定、易预测，但遇到瞬时热点不会主动绕开。

Adaptive Routing 可根据局部拥塞/队列状态在允许路径间动态选择，可能改善不规则流量，
但也需要：

- 硬件、固件和 SM 支持；
- 正确的 Adaptive Routing Group；
- 防止乱序或与 Transport 不兼容；
- 监控实际路径；
- 与 SHIELD/故障路由等机制区分。

具体能力依平台而异。不能因为设备有多个路径就认定 AR 已启用。

## 6. Congestion Control

IB 拥塞控制机制与 RoCE ECN/DCQCN 不同，可能包括交换机标记、端点反馈和注入速率调节。

设计时确认：

- 哪种 CC 由 HCA/交换机/SM 支持；
- 是否已下发 CCT/参数；
- 哪类流量/SL 生效；
- 遥测暴露哪些标记和速率状态；
- 与 Adaptive Routing 如何协同。

避免把 RoCE 的 PFC/CNP 命令套到 IB Fabric。

## 7. Collective Offload

某些 IB 平台支持在网络中加速归约等 Collective（例如 SHARP 类能力）。

使用前区分：

- 是否由 NCCL Plugin 实际启用；
- 支持哪些 Collective、消息大小和拓扑；
- 管理组件是否健康；
- 失败时回退行为；
- 性能数字是否包含 Offload。

基线必须注明是否启用，否则无法比较。

## 8. 故障与热点定位

```text
作业慢
→ 确认 Rank/Node/HCA
→ 找到 IB Port/LID/Path
→ 检查 Link Speed/Width 和 Error
→ 检查端口吞吐/等待/Credit
→ 检查 SL/VL 与 Partition
→ 检查路由分布/AR
→ 检查接收端和下游
```

典型模式：

| 现象 | 优先检查 |
|---|---|
| 单个 Port Wait 高 | 下游拥塞、VL Credit |
| 多上行负载不均 | 路由算法、LID/通信矩阵 |
| 链路故障后长时间慢 | SM 重路由、剩余容量 |
| 只有某 Partition 慢 | PKey、SL/VL、作业映射 |
| 启用 AR 后抖动 | AR Group、路径、乱序/固件 |

## 9. 变更风险

SM、路由算法、Partition、SL/VL 或 AR 变更可能重编程整个 Fabric。

必须：

- 保存 SM 配置、拓扑和转发表；
- 在相同拓扑实验；
- 选择 Canary Partition/节点；
- 设置作业冻结或 Drain；
- 监控 SM、Port State、路由和训练；
- 定义恢复旧配置的时间和步骤；
- 主备 SM 配置一致。

## 10. 实验

1. 导出 Fat-Tree 拓扑和 LID 路由。
2. 运行多对多 RDMA，检查上行分布。
3. 制造一个通信热点。
4. 对比平台支持的静态/自适应路径策略。
5. 断开一条上行，记录 SM 收敛和性能。
6. 检查 SL→VL 映射和 Credit/Wait 指标。
7. 恢复后验证路由分布和无残留错误。

## 11. 掌握标准

能够区分 IB Credit 流控与 RoCE PFC；能从 Rank/HCA 找到 LID 路由、SL/VL 和热点端口；
能解释 Adaptive Routing 的收益、前提和验证方法。

## 12. 参考资料 {/* #参考资料 */}

- [NVIDIA Subnet Manager Documentation](https://docs.nvidia.com/networking/display/NVIDIAMLNXOSUserManualv3122002/subnet-manager.pdf)
- [OpenSM](https://github.com/linux-rdma/opensm)
