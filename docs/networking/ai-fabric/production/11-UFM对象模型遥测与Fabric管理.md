---
title: "UFM 对象模型遥测与 Fabric 管理"
sidebar_label: "11. UFM 对象模型遥测与 Fabric 管理"
sidebar_position: 11
description: "区分 UFM 管理、InfiniBand Subnet Manager、性能采集与 SHARP 资源管理，建立端口到作业的关联。"
tags: [UFM, InfiniBand, Telemetry, SHARP]
---

# UFM 对象模型遥测与 Fabric 管理

UFM 将 InfiniBand Fabric 的发现、管理与观测组织起来。它不是一个 GPU Kernel Profiler，也不能通过界面可访问证明每条训练路径正常。前置阅读[InfiniBand Fabric 原理](../../rdma-roce/ai-cluster/04-InfiniBand-Fabric原理.md)。

## 1. 组件职责

UFM Server 提供管理状态与接口，Subnet Manager 处理子网发现和路由等管理，性能组件采集设备数据，Device Manager 对接设备管理能力；SHARP Aggregation Manager 则管理相应卸载资源。这些逻辑模块不应被机械当作一一对应的进程。

架构以 UFM Enterprise 6.17.1 文档为解释基线，不据此推荐旧版本部署。实际升级要固定发行版本、设备/固件支持、许可证和 HA 模式。NVLink 的 FM/NVLSM 属于另一个 Fabric，不应使用本篇的 IB 配置替换它。

## 2. 稳定身份与易变地址

用设备与端口 GUID 关联 HCA、交换机、端口、线缆和物理位置，再关联主机与作业 Rank。LID 等地址可能随子网管理变化，不能只按一次地址表永久归档。

教学场景：两次故障都指向同一交换端口，但关联到不同主机，可能是线缆或端口映射记录过期。先确认真实拓扑和资产变更，再判断故障范围，不把旧标签当成设备事实。

## 3. 遥测与链路速率

计算带宽前确认计数器单位、采样间隔、端口宽度和重置行为；同名计数未必直接以字节为单位。错误率还需要分母与时间窗口，累计历史错误数不能自动表示当前链路正在退化。

只看总吞吐可能漏掉热点和尾部 Rank。对照实际路径、拥塞等待、错误增量、重训和应用时间线，判断是单链路问题、路由负载还是共同存储影响。

## 4. 控制与数据的恢复边界

管理 API 不可达、SM 不可用、遥测停止和业务流量中断是不同故障。已有路由下部分业务可能暂时继续，但不能推导节点变化、故障重路由和新连接都仍安全。HA 设计应确保有效主服务与状态一致，不是随意启动两个独立主实例。

变更 Partition、路由、拥塞策略或固件时，要先确定受影响端口与作业，并保留配置和带外恢复。恢复后同时验证管理、路由、遥测新鲜度与目标规模的通信，不只验证 WebUI。

深入机制见 [SM 选举、重扫与路由收敛](./12-SubnetManager选举重扫与路由收敛.md)：同一进程可用、主角色确定、路由生效和上层请求恢复，不能被压缩成一个“管理服务正常”。

## 5. 掌握检查

某作业慢、UFM 无错误，能否排除网络？不能，采集覆盖和性能问题未必表现为错误事件。SM 进程恢复但训练仍超时，应继续检查路由、端口和应用成员，而不是循环重启管理服务。

## 6. 参考资料

- [UFM Enterprise 6.17.1 软件架构](https://docs.nvidia.com/networking/display/UFMEnterpriseUMv6171/ufm-software-architecture.pdf)
- [NVSwitch 管理边界](../../../gpu/nvlink-nvswitch/02-Fabric-Manager-NVLSM初始化与故障分析.md)
