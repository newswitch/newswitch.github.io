---
title: "交换 ASIC、Parser 与 Match-Action Pipeline"
sidebar_label: "01. ASIC 与 Match-Action Pipeline"
sidebar_position: 1
description: "追踪报文在交换 ASIC 中的解析、查表、动作、流量管理和改写过程，并理解 PPS、流水线与 Recirculation。"
tags: [交换ASIC, Parser, Match-Action, Pipeline, PPS]
---

# 交换 ASIC、Parser 与 Match-Action Pipeline

交换 ASIC 的目标是在确定的时钟和流水线预算内持续处理报文。它擅长对已支持的 Header 和 Key 做并行查表，却不等于可以像通用 CPU 一样无限增加逻辑。

## 1. ASIC 与通用 CPU

| 维度 | 交换 ASIC | 通用 CPU |
| --- | --- | --- |
| 目标 | 线速、确定性、高并行 | 通用、灵活、复杂控制 |
| 数据结构 | 固定/可编程 Pipeline 与硬件表 | Cache/内存中的软件结构 |
| 单包预算 | 严格、按 Stage 处理 | 可执行复杂分支与循环 |
| 适合任务 | 转发、ACL、QoS、封装 | 路由协议、管理、异常报文 |

交换机控制面 CPU 计算路由和管理设备，ASIC 数据面转发大多数报文。Punt 到 CPU 的流量过多会形成独立故障。

## 2. 入口解析

Parser 从比特流识别 Header 和字段：

```text
Ethernet
→ VLAN
→ IPv4/IPv6
→ TCP/UDP
→ VXLAN/Geneve
→ Inner Ethernet/IP
```

解析结果形成元数据，后续 Stage 用 Key 查表。未支持、层数过深或异常组合可能被丢弃、降级处理或送 CPU。

## 3. Match-Action

一个 Stage 的抽象：

```text
Key = {Ingress Port, VLAN, Dst IP, DSCP, Metadata...}
→ Match Table
→ Action = {Forward, Drop, Rewrite, Mark, Count, Mirror...}
→ New Metadata
```

多个 Stage 串联后完成二层、三层、ACL、QoS 和 Tunnel 功能。动作通常不能任意复杂，受 Stage、ALU、字段和写回能力限制。

## 4. 查表结果怎样串联

例如三层转发：

1. Port/VLAN 表确认入口逻辑域；
2. L2/L3 决定 Bridge 或 Route；
3. LPM 查找目的前缀；
4. Next Hop 解析出邻居和出口；
5. ACL/QoS 决定 Permit、Remark、Queue；
6. Egress Rewrite 修改 MAC、TTL、VLAN；
7. Traffic Manager 选择发送时机。

CLI 中的一条配置可能展开为多个硬件对象，删除顺序和引用计数也会影响资源释放。

## 5. Cut-Through 与 Store-and-Forward

- Store-and-Forward：接收完整帧并校验后再转发，隔离坏帧但延迟更高；
- Cut-Through：解析到足够字段后开始发送，降低延迟，但可能把后来才发现有 CRC 错误的帧传播一部分；
- 实际平台可能根据速率、拥塞和功能采用混合方式。

端到端延迟还包含 PHY/FEC、序列化、Buffer 和链路传播，不能只看 ASIC 宣称延迟。

## 6. PPS 与最小包

端口带宽相同，小包意味着每秒处理更多 Packet：

```text
PPS ≈ 线速位率 / 每个报文在线路上的总 Bit 数
```

总 Bit 数不仅是 Payload，还包括 Header、Preamble、IFG 和编码等开销。ASIC 可能达到大包线速，却在极端最小包、复杂功能或 Recirculation 下受 PPS 限制。

## 7. Recirculation

当一次 Pipeline 无法完成全部处理，报文可回到入口再次经过部分 Stage。代价包括：

- 消耗额外内部带宽；
- 降低有效 PPS；
- 增加延迟；
- 与其他需要 Recirculation 的 Feature 竞争。

复杂隧道、Telemetry 或多层编辑是否需要回流，应以具体 ASIC/系统文档为准。

## 8. Mirror、Sample 与 Counter

镜像、采样和计数也消耗硬件资源：

- Mirror Session 数量有限；
- Counter Bank 与表项绑定；
- 全量镜像可能堵塞镜像出口；
- Sample 在硬件还是 CPU 执行决定性能影响；
- Counter 读取可能是累计、缓存或近似值。

观测能力不是无限且无成本，部署前要做资源预算。

## 9. 故障边界

| 现象 | 可能层次 |
| --- | --- |
| 特定协议不通 | Parser、ACL Key、Tunnel 支持 |
| 新 Feature 开启后 PPS 下降 | Pipeline Stage、Recirculation |
| 数据面不通但管理正常 | ASIC、端口、表项、Fabric |
| 大量 Unknown 报文打满 CPU | Punt/Trap/CoPP |
| 计数器与抓包不一致 | 计数点、采样、Cut-Through、Offload |

## 10. 练习与答案

**问题：控制面路由表中已有前缀，是否证明硬件已经可以转发？**

答案：不能。还需成功下载到 ASIC，并建立 Next Hop、邻居、出口和相关 ACL/QoS 对象。控制面 RIB、FIB 与硬件表是不同阶段。

**问题：为什么开启一个看似简单的功能可能影响吞吐？**

答案：它可能增加 Key 宽度、占用新的 Stage、触发 Recirculation 或把异常流量 Punt 到 CPU，改变了硬件执行路径。
