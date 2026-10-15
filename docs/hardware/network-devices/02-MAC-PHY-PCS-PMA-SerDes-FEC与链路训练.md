---
title: "MAC、PHY、PCS、PMA、SerDes、FEC 与链路训练"
sidebar_label: "02. MAC、PHY、SerDes 与 FEC"
sidebar_position: 2
description: "解释以太网 MAC、PCS、FEC、PMA、PMD、SerDes 的分层职责，以及自协商、链路训练和误码定位。"
tags: [MAC, PHY, PCS, PMA, SerDes, FEC]
---

# MAC、PHY、PCS、PMA、SerDes、FEC 与链路训练

“PHY 有问题”经常被当作笼统结论。实际物理层还包括编码、Lane 分发、FEC、SerDes、电气或光学接口。只有区分这些职责，才能读懂 Link Flap、CRC、Symbol Error 和 FEC Counter。

## 1. 简化分层

```text
Ethernet Frame
→ MAC：帧、地址、CRC、流控
→ Reconciliation / Interface
→ PCS：编码、Lane 分发、Marker、FEC 关联
→ PMA：SerDes、Lane 复用、时钟恢复
→ PMD：电气/光学发送接收接口
→ 铜缆、DAC/AOC、光模块与光纤
```

实现中部分功能可能在 NIC ASIC、独立 PHY 或光模块内部，逻辑职责比芯片边界更重要。

## 2. MAC 做什么

MAC 处理以太网帧层能力：

- Source/Destination MAC；
- EtherType/Length；
- VLAN、Pause/PFC 等控制帧；
- Frame Check Sequence；
- 帧间隙和发送/接收规则。

CRC Error 表示接收端看到帧校验失败，但根因可能在发送器、线缆、模块、接收器或中间连接，不能自动归咎接收网卡。

## 3. PCS、PMA 与 PMD

- PCS：Physical Coding Sublayer，完成线路编码、Block/Lane 对齐等；
- FEC：通过冗余码纠正一定数量的 Bit Error；
- PMA：Physical Medium Attachment，负责 SerDes、Clock Recovery 和 Lane 复用；
- PMD：Physical Medium Dependent，面向实际电气或光学介质。

多 Lane 链路还要处理 Deskew：不同 Lane 传播时间不同，接收端需重新对齐。

## 4. SerDes 与信号

SerDes 把芯片内部并行数据转换为高速串行信号，接收端再恢复。高速链路关注：

- Insertion Loss、Return Loss；
- Crosstalk 与噪声；
- Jitter 与 Eye Diagram；
- TX Equalization、RX CTLE/DFE；
- Connector、Trace、Cable 和 Module 的损耗预算。

链路能建立不代表眼图裕量充足。温度、弯折或器件老化可能让边缘链路在压力下出现误码。

## 5. Auto-Negotiation 与 Link Training

Auto-Negotiation 用于交换能力并选择速率、双工、FEC 等参数；某些高速接口还需要 Link Training 调整发送和接收均衡。

常见不兼容包括：

- 一端强制速率，另一端自动协商；
- FEC 模式不一致；
- Breakout 配置不一致；
- 端口和模块不支持目标组合；
- 模块固件或厂商编码被平台拒绝。

“手工强制后 Link Up”只是隔离信号，仍需确认双方配置和支持矩阵。

## 6. FEC 能做什么

FEC 在发送数据中加入冗余，接收端可纠正有限数量错误：

```text
原始数据 + 校验冗余
→ 经过有少量 Bit Error 的链路
→ 接收端纠正
→ 上层仍得到完整数据
```

- Corrected Codeword 增长：链路存在误码，但尚在纠错能力内；
- Uncorrectable 增长：错误超过 FEC 能力，上层会看到丢包/坏帧；
- FEC 不是免费：带来编码开销和少量延迟；
- 持续快速增长的 Corrected 不是“没问题”，而是信号裕量下降的预警。

## 7. PCS 与 MAC 计数怎样关联

```text
光/电误码
→ FEC 尝试纠正
→ 纠正成功：MAC 可能看不到 CRC Error
→ 纠正失败：PCS/PHY 错误、CRC、丢帧可能增长
```

只看 MAC CRC 会漏掉已被 FEC 掩盖的物理劣化，因此高速链路必须同时观察 Pre-FEC/FEC 相关统计和模块 DOM。

## 8. 排障顺序

1. 确认双方端口速率、Lane/Breakout 和 FEC；
2. 核对模块、线缆、距离、波长和平台兼容性；
3. 查看 Link Flap、PCS、FEC、CRC 和 Symbol Error；
4. 读取温度、光功率、Bias 等 DOM；
5. 清零或记录基线后观察增长速率；
6. 交叉替换端口、模块、跳纤和线缆；
7. 排除污染、弯折、极性和配线架问题；
8. 修复后做持续流量与温度回归。

## 9. 练习与答案

**问题：FEC Corrected 持续增长，但业务零丢包，可以忽略吗？**

答案：不能。业务暂时被 FEC 保护，但增长速率说明物理链路存在误码；若裕量继续下降会转为不可纠正错误。应建立正常基线并检查模块、光功率和介质。

**问题：为什么模块两端都支持同一速率仍可能无法 Link Up？**

答案：还可能存在 FEC、Breakout、Lane、Auto-Negotiation、波长、光纤类型、极性或平台白名单不匹配。
