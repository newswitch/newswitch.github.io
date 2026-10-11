---
title: "ECN、CNP 与 DCQCN 拥塞控制"
sidebar_label: "05. ECN、CNP 与 DCQCN 拥塞控制"
sidebar_position: 5
description: "理解交换机 CE 标记、接收端 CNP、发送端速率控制，以及 ECN 阈值与 PFC 的协同。"
tags: [ECN, CNP, DCQCN, RoCE, Congestion Control]
---

# ECN、CNP 与 DCQCN 拥塞控制

PFC 在缓冲接近危险水位时暂停上游；ECN/DCQCN 的目标是更早把拥塞反馈给发送端，
让源端降速。健康设计通常希望 ECN 经常承担调节，而 PFC 只处理难以完全避免的瞬时突发。

## 1. 闭环

```mermaid
sequenceDiagram
    participant S as Sender NIC
    participant Q as Congested Switch Queue
    participant R as Receiver NIC
    S->>Q: RoCEv2 Data (ECT)
    Note over Q: Queue 达到 ECN Threshold
    Q->>R: CE Marked Data
    R-->>S: CNP
    Note over S: DCQCN 降低发送速率
    S->>Q: Lower Rate Data
    Note over S: 无持续 CNP 时逐步恢复
```

三个角色：

- 交换机：在拥塞 Queue 上标记 CE；
- 接收 NIC：看到 CE 后生成 CNP；
- 发送 NIC：根据 CNP 和算法调整速率。

## 2. ECN 位

IP ECN 字段有 ECT/CE 等状态。发送端必须发出可 ECN 标记的报文，交换机才可把它标为 CE；
不支持 ECN 的流量通常仍按普通丢弃策略处理。

检查抓包：

```text
发送数据是否 ECT
拥塞点之后是否出现 CE
CNP 是否从接收端返回发送端
```

## 3. 交换机标记

常见 Profile 按 Queue 水位设置：

- `Kmin`：开始概率标记；
- `Kmax`：达到更高标记概率/全部标记；
- `Pmax`：概率上限；
- 或按绝对阈值、动态阈值等 ASIC 模型。

概念：

```text
Queue < Kmin       不标记
Kmin～Kmax         按概率增加标记
Queue ≥ Kmax       高概率或全部标记
```

具体语义、单位和动态 Buffer 关系依赖交换芯片。使用厂商推荐起点，再用真实突发验证。

## 4. DCQCN 的发送端行为

DCQCN 面向 RoCEv2 数据中心量化拥塞通知，核心行为是：

- 收到 CNP 后降低发送速率；
- 维护目标/当前速率；
- 在一段无拥塞反馈后逐步恢复；
- 平衡快速响应与稳定利用。

算法参数通常由 NIC 驱动/固件配置。参数过激会导致带宽锯齿和利用率低，过缓会让队列持续高水位、
触发 PFC 或丢包。

### 4.1 CNP 如何改变 α、当前速率和目标速率

按 DCQCN 原论文的基本 RP 模型，设当前速率为 RC、恢复目标为 RT、拥塞历史因子为 α、平滑系数为 g。收到 CNP 时，按下列顺序处理；这里的降速使用更新前的 α：

```text
RT ← RC
RC ← RC·(1-α/2)
α  ← (1-g)·α+g
无反馈的 α 更新周期：α ← (1-g)·α
```

设 `RC=100 Gbit/s`、α=0.5、g=1/16，则 RT=100，RC 降到 75，α 增到 0.53125。若之后经过一个无反馈 α 周期，α 变为 `0.53125·15/16≈0.49805`。历史 α 影响下一次降速，不是把每个 CE 包直接当一个固定百分比的速率削减；接收端还会限制 CNP 产生频率。[DCQCN 原论文 §3.1](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/dcqcn-sigcomm15.pdf)

### 4.2 恢复不是瞬间回到链路速率

Fast recovery 用 `RC ← (RT+RC)/2` 逐步靠近保存的 RT。上述例子连续三次恢复为 87.5、93.75、96.875 Gbit/s；若没有新降速，差值按二分衰减。Additive increase 再增加 RT，并把 RC 向新目标推进；持续无拥塞可进入更积极的 hyper-increase 阶段。恢复由 timer 和发送字节计数共同驱动，不是每收到 ACK 都增速。

这个状态划分用于理解原算法。真实 NIC 的 α 更新、第一次 CNP 行为、最小速率、计时器和增量有版本与固件差异，不能把论文参数当所有设备的默认值。调大增量可能提升空闲带宽探索，也会增加超调，必须连同反馈延迟和队列一起考虑。

## 5. CNP 返回路径

CNP 必须及时回到发送端：

- 路由可达；
- QoS 分类正确；
- 不被拥塞数据 Queue 长时间阻塞；
- 不被 ACL/策略误丢；
- 两端 NIC 支持并启用相应拥塞控制；
- 多 Rail 时返回到正确设备/连接。

有 CE 无 CNP：检查接收 NIC；
有 CNP 但发送速率不变：检查发送 NIC 的 DCQCN/固件/统计。

## 6. ECN 与 PFC 阈值关系

理想顺序：

```text
Queue 开始上升
→ ECN 开始标记
→ Sender 收到 CNP 并降速
→ Queue 下降
→ 不触发 PFC
```

若突发过快或反馈 RTT 较长：

```text
Queue 继续上升
→ 达到 Xoff
→ PFC 作为最后保护
```

因此 ECN Threshold 要给反馈闭环留出时间和 Buffer。过高会来不及降速，过低可能频繁限速、降低利用率。

### 6.1 手算反馈期间的队列超调

在队列非空、输出容量为 C 的流体模型中，`dQ/dt=Σri-C`，Q 不能小于零。若标记后总输入为 800 Gbit/s、出口为 400 Gbit/s，闭环延迟 τ=20 μs，在所有发送端开始降速之前额外排队约：

```text
ΔQ = (800-400)·10^9·20·10^-6 / 8
   = 1000000 bytes ≈ 976.6 KiB
```

ECN 到 Xoff 的空间若仅几百 KiB，这个构造下可能还没收到反馈就触发 PFC。阈值间隔需要容纳这段超调和突发，但还取决于动态 buffer、其他流量、标记概率及降速并非同时发生。PFC headroom 另需覆盖 pause 生效前的在途字节，不能用 ECN 闭环 τ 机械替代 pause 反应时间。

## 7. RTT 与拓扑

从标记到发送端降速存在闭环延迟：

```text
拥塞点→接收端数据传播
+ 接收端生成 CNP
+ CNP 返回发送端
+ NIC 处理和新速率生效
```

Fabric 跳数、线缆、队列和 CNP 调度都会改变延迟。不能为单交换机实验和多级 Clos 使用完全相同阈值而不验证。

### 7.1 为什么“更快降速”也可能振荡

先看一个明确简化、**不是 DCQCN 稳定性定理**的延迟反馈模型。设队列扰动为 δq，控制增益为 k，`δq'(t)=-k·δq(t-τ)`。它的特征方程是 `λ+k·exp(-λτ)=0`。令边界根 λ=iω，分离实虚部得到 `cos(ωτ)=0`、`ω=k·sin(ωτ)`，首次边界为 `kτ=π/2`；该标量模型在 `0<kτ<π/2` 时渐近稳定。

物理含义是控制器看到旧队列，若增益大而延迟长，队列已回落时仍继续降速，随后又过度恢复。实际 DCQCN 有多流、概率标记、速率限制、α 与 timer 状态，不能把这里的 k 等同于 g，也不能凭这个条件认证一套 NIC 参数。它解释的是为何必须联合考察闭环延迟、增益、队列超调和恢复时间，而不是只看 CNP 数量多不多。

## 8. 关键指标

### 8.1 交换机 {/* #交换机 */}

- ECN Marked Packets；
- Queue Current/Max；
- PFC Tx/Rx Frames 与 Duration；
- Buffer Discard；
- 每 TC 吞吐。

### 8.2 接收 NIC {/* #接收-nic */}

- 收到 CE/拥塞相关计数；
- 生成/发送 CNP；
- RoCE RX Packet/Error。

### 8.3 发送 NIC {/* #发送-nic */}

- 收到 CNP；
- Congestion/Rate Reduction；
- Retransmission；
- 每 QP/TC 吞吐（平台支持时）。

### 8.4 应用 {/* #应用 */}

- perftest 时延/吞吐抖动；
- NCCL P95/P99；
- 训练 Step Time。

## 9. 判断模式

| 现象 | 含义 |
|---|---|
| 队列低、无 ECN/PFC | 可能无拥塞 |
| ECN/CNP 增加、PFC 很少 | 拥塞控制在提前调节 |
| ECN 高且 PFC 持续 | 容量不足、阈值或闭环有问题 |
| 队列高但无 ECN | 分类/Profile/ECT 错误 |
| CE 有、CNP 无 | 接收端配置/计数/生成问题 |
| CNP 有、源端不降速 | 发送 NIC DCQCN/固件问题 |
| 无 ECN但有丢包 | 流量未进入目标 Queue、阈值过高或 Lossy 路径 |

## 10. 调优方法

1. 固定拓扑、消息矩阵和背景流量。
2. 保存交换机/NIC 参数与计数基线。
3. 从厂商推荐 Profile 起步。
4. 只调整一个变量或一组强相关阈值。
5. 同时观察 Queue、ECN、CNP、PFC、吞吐和 P99。
6. 测短突发、持续负载、Incast 和 N-1 故障。
7. 观察恢复过程，防止速率长期过低或振荡。
8. 记录硬件、固件和驱动版本。

## 11. 实验

在隔离 RoCE Fabric 中：

1. 单流不拥塞，验证无异常标记。
2. 多发送端制造 Incast。
3. 观察 Queue→ECN→CNP→发送速率变化。
4. 临时把 ECN 阈值调得过高，观察 PFC/丢包增加。
5. 临时把阈值调得过低，观察吞吐和 CNP。
6. 恢复合理 Profile，验证 P99 和利用率。
7. 断开一条 ECMP 链路，测试 N-1 突发。

## 12. 掌握标准

能够从 Queue 水位开始，证明哪台交换机标记 CE、哪张接收 NIC 产生 CNP、哪张发送 NIC
执行降速；能解释 ECN 与 PFC 阈值为什么必须协同，而不是独立复制默认值。

还应能手算一次 CNP 的速率更新、无反馈的恢复序列和反馈延迟造成的排队字节；说明上述延迟模型为何能解释振荡，却不能替代 DCQCN 多流稳定性分析。

## 13. 参考资料 {/* #参考资料 */}

- [RFC 3168：Explicit Congestion Notification](https://www.rfc-editor.org/rfc/rfc3168)
- [NVIDIA RoCE Counters](https://docs.nvidia.com/networking/display/nvidiaonyxusermanualv3104006/roce%2Bcommands)
