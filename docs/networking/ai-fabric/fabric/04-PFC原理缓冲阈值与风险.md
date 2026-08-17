---
title: PFC 原理、缓冲阈值与风险
sidebar_label: "04. PFC 原理、缓冲阈值与风险"
sidebar_position: 4
tags: [PFC, IEEE 802.1Qbb, Xoff, Xon, Headroom, Pause Storm]
description: 理解按优先级暂停、Xoff/Xon、Headroom、Pause 传播、PFC Storm、死锁与 Watchdog。
---

# PFC 原理、缓冲阈值与风险

Priority Flow Control 在某优先级的接收缓冲接近耗尽时，向上游发送 Pause，暂时停止该
Priority 的传输。它降低瞬时溢出丢包，但会传播反压，不能代替容量和 ECN。

## 1. 为什么不是 802.3x 全局 Pause

全局 Pause 会暂停端口全部流量，造成严重 Head-of-Line Blocking。PFC 可对 0～7 的
Priority 分别暂停，让 Lossless 类与其他业务分离。

```text
Priority 3 缓冲接近 Xoff
→ 下游向上游发送 PFC Pause(P3)
→ 上游停止发送 P3
→ 其他 Priority 仍可发送
```

前提是每一跳 Priority 和 Queue 映射一致。

## 2. Xoff、Xon 与 Headroom

- Xoff：达到阈值时发送 Pause；
- Xon：缓冲下降到恢复阈值后恢复发送；
- Headroom：Pause 生效前容纳在途数据的保留空间。

Headroom 至少要覆盖：

```text
链路传播中的数据
+ 对端收到 Pause 前继续发送的数据
+ 本端处理和调度延迟
+ 最大帧
+ 设备实现和安全余量
```

概念估算：

```text
在途字节 ≈ 链路速率(bit/s) × 反应时间(s) / 8
```

实际阈值必须使用交换 ASIC/NIC 厂商的 Buffer 模型、线缆距离、端口速率和 MTU 计算。
不能把另一型号交换机的 Xoff/Xon 数值直接复制。

## 3. Pause 如何传播

下游端口拥塞：

```text
Receiver/Leaf Queue 满
→ Pause 上游 Spine
→ Spine 对相应输入/上游继续反压
→ Pause 可能传播到更多发送端
```

如果拥塞是短暂微突发，Pause 很快解除；如果接收端卡死或容量长期不足，Pause 会持续扩散。

## 4. PFC Storm

PFC Storm 表现为某 Priority 长时间或高频 Pause，可能由：

- 接收端口/主机停止消费；
- 错误线缆/链路降速；
- 下游队列映射错误；
- 持续 Incast 超过出口容量；
- Pause 帧或 PFC 配置异常；
- 共享 Buffer 被其他队列耗尽；
- PFC Deadlock。

影响不仅是“发送慢”，还可能让无关流经过共享上游时一起阻塞。

## 5. PFC Deadlock

多个端口/队列形成循环等待，每个都等待下游释放 Credit/Buffer。

风险与以下因素有关：

- 循环拓扑和流量依赖；
- Priority/Virtual Lane 数量；
- 路由；
- PFC 域过大；
- 缓冲分配；
- 恢复/Watchdog 机制。

避免策略：

- 尽量使用无环 Clos 转发和合理路由；
- 限制 PFC 只在必要 Priority 和域；
- ECN 提前降速；
- 监控长 Pause；
- 使用平台支持的 Deadlock Detection/Recovery；
- 故障恢复行为经过演练。

## 6. PFC Watchdog

Watchdog 可检测队列持续被 Pause，并采取恢复动作，例如临时让队列变为 Lossy 或丢弃以打破死锁。

这是可用性和无损性的权衡：

- 不恢复：可能无限阻塞；
- 恢复并丢包：RC 重试或作业失败，但 Fabric 恢复流动。

阈值和动作必须与作业超时、RC 重试和告警联动。

## 7. PFC 不是越多越好

只在承载目标 RDMA 流量的 Priority 启用。不要：

- 对所有 8 个 Priority 启用；
- 把普通 TCP、管理、存储全部放入同一 Lossless Queue；
- 只开 PFC 不开/不调 ECN；
- 把持续 Pause 当成“零丢包成功”；
- 忽略 Pause Duration，只看 Frame Count。

PFC 持续增加通常说明容量、拥塞控制或接收端存在问题。

## 8. 关键指标

每端口、每 Priority：

```text
PFC Rx Frames / Duration
PFC Tx Frames / Duration
Queue Current / Max Watermark
No-buffer Discards
ECN Marked Packets
CNP Packets
RoCE Retransmission / Error
端口吞吐和 Link State
```

解释方向：

- 设备 Tx PFC：它让上游暂停，说明本地/下游拥塞；
- 设备 Rx PFC：它被下游要求暂停；
- 计数方向定义以厂商文档为准。

## 9. 故障树

```text
PFC Tx 持续增长
├── 本端出口是否拥塞
├── 下游是否回发 Pause
├── 接收主机是否消费
├── 端口是否降速
├── Queue/Buffer 映射是否正确
├── ECN 是否提前生效
└── 是否形成拥塞树/死锁
```

不要只在告警端口改阈值。告警端口可能只是拥塞传播链中的中间节点。

## 10. 实验

在隔离 Fabric：

1. 保存 PFC/Queue/ECN 初始计数。
2. 制造短时 Incast，观察 Xoff/Pause/恢复。
3. 制造持续接收端瓶颈，观察 Pause 传播。
4. 错配一跳 PFC Priority，观察丢包和重试。
5. 触发 Watchdog 测试，记录恢复和作业行为。
6. 开启/调整 ECN 后对比 PFC Duration。
7. 恢复配置并清除实验状态。

不能在承载生产训练的 Fabric 上随意制造 PFC Storm。

## 11. 掌握标准

能够根据端口速率和反应时间解释 Headroom 需求；看到 PFC 告警时沿下游寻找真正拥塞点；
能说明为什么持续 Pause 是风险信号，而不是“无损网络工作正常”的证明。

## 参考资料

- [NVIDIA Priority Flow Control Documentation](https://docs.nvidia.com/networking/display/nvidiaonyxusermanualv3104606lts/priority%2Bflow%2Bcontrol%2B%28pfc%29)
- [IEEE 802.1Qbb Priority-based Flow Control](https://1.ieee802.org/dcb/802-1qbb/)
