---
title: "RoCE QoS 分类与队列映射"
sidebar_label: "03. RoCE QoS 分类与队列映射"
sidebar_position: 3
description: "建立从 NIC Traffic Class、DSCP/PCP、交换优先级到硬件队列、PFC 和 ECN Profile 的端到端映射。"
tags: [RoCE, QoS, DSCP, PCP, Traffic Class, DCBX, ETS]
---

# RoCE QoS 分类与队列映射

PFC 和 ECN 都作用于特定优先级/队列。若分类错误，参数再正确也不会保护目标流量，
甚至会暂停错误业务。

## 1. 完整映射链

```text
RDMA 应用 / NIC Traffic Class
→ IP DSCP + ECN Bits
→ VLAN PCP（如使用）
→ 交换机入口 Trust
→ Switch Priority / Priority Group
→ Traffic Class
→ Egress Queue
→ Buffer Pool
→ PFC Priority
→ ECN Marking Profile
```

不同厂商名称和映射层次不同，实施前建立设备级映射表。

## 2. DSCP、ECN 与 PCP

IPv4/IPv6 Traffic Class 中：

```text
高 6 位：DSCP
低 2 位：ECN
```

修改 DSCP 时必须保留 ECN 位，反之亦然。

802.1Q VLAN Tag 中 PCP 为 3 位，可表达 0～7 的二层优先级。无 VLAN 报文没有 PCP 字段，
但交换机内部仍可根据 DSCP 映射优先级。

## 3. Trust Boundary

入口端口可以：

- Trust DSCP；
- Trust PCP；
- 不信任端点，统一重标记；
- 按应用/UDP 端口分类；
- 使用 DCBX 协商部分 DCB 参数。

训练节点通常属于受控基础设施，但仍要防止普通业务错误标记进入 Lossless Queue。

设计表：

| 入口类型 | Trust | RoCE 分类 | 普通业务 |
|---|---|---|---|
| GPU Node NIC | DSCP/PCP，按平台 | 映射 Lossless TC | Best Effort |
| 存储节点 | 单独类别 | 按协议和 SLO | 不自动进入 RoCE TC |
| 管理端口 | 不信任高优先 | 重标记 | 管理 TC |
| 外部边界 | 重标记 | 默认不信任 | 策略分类 |

## 4. Traffic Class 与 Queue

交换 ASIC 可能只有有限硬件 Queue。多个 Switch Priority 可以映射同一 TC/Queue。

需要明确：

- RoCE Data 在哪个 Queue；
- CNP 在哪个 Queue；
- Routing/Control 在哪个 Queue；
- Storage/Best Effort 在哪个 Queue；
- Queue 调度是 Strict Priority 还是 WRR/DWRR；
- 每个 Queue 的 Buffer Pool 和 ECN Threshold。

CNP 通常需要低延迟传回发送端，但严格优先队列必须有边界，避免错误流量饿死其他业务。

## 5. ETS

Enhanced Transmission Selection 为 Traffic Class 分配最小带宽/权重，并共享剩余带宽。

它解决拥塞时的调度，不保证报文不丢。与 PFC、ECN 分工：

```text
ETS：谁获得多少发送机会
ECN：队列拥塞时反馈源端降速
PFC：缓冲接近危险水位时按优先级暂停上游
```

## 6. DCBX

DCBX 通过 LLDP 交换 PFC、ETS 和 Application Priority 等信息。

必须决定：

- 主机还是交换机作为配置权威；
- Willing/Non-Willing 行为；
- 不一致时是否自动接受；
- DCBX 未建立时默认值；
- 固件升级后策略是否变化。

自动协商能减少手工错误，也可能把错误配置传播到端点。生产要监控实际 Oper 状态，而不只看 Admin 配置。

## 7. CNP 分类

RoCEv2 拥塞通知包也需要正确分类和队列：

- CNP 被丢或排队过久，会延迟发送端降速；
- CNP 与 RoCE Data 使用完全相同拥塞队列，可能在拥塞时回不去；
- CNP 标记和调度必须与 NIC/交换机设计一致。

不要凭某厂商默认值假设所有环境都使用同一 DSCP/PCP。

## 8. 端到端验证

### 8.1 主机 {/* #主机 */}

```bash
ip -d link show <netdev>
ethtool --show-priv-flags <netdev>
mlnx_qos -i <netdev>
lldptool -t -i <netdev>
```

工具取决于驱动和发行版。记录 Admin 与 Oper：

- Trust State；
- DSCP/PCP 映射；
- PFC Enabled Priority；
- ETS/TC；
- Application TLV；
- ECN/DCQCN。

### 8.2 交换机 {/* #交换机 */}

检查每个 Hop：

```text
Ingress Classification
Priority→TC
TC→Queue
PFC Priority
ECN Profile
Queue Scheduler
Buffer Pool
```

### 8.3 数据面 {/* #数据面 */}

抓包/计数器证明：

- 数据包 DSCP/PCP；
- ECN Mark 是否出现；
- 进入哪个 Queue；
- PFC Pause 只作用于设计 Priority；
- 普通业务没有误入 Lossless Queue。

## 9. 配置漂移矩阵

| 错误 | 结果 |
|---|---|
| NIC 发 DSCP，交换机 Trust PCP | 流量进默认队列 |
| 两端 PFC Priority 不一致 | Pause 无法端到端生效 |
| Data 与 CNP 同一低权重队列 | 拥塞反馈延迟 |
| 普通存储流被标成 RoCE | Pause Storm 影响扩大 |
| 中间一跳重写 DSCP | 后续 ECN/PFC Profile 失效 |
| DCBX 覆盖静态配置 | 重启后 Oper 状态改变 |

## 10. 实验

1. 画出两端 NIC 和所有交换 Hop 的映射。
2. 用 RoCE 流量验证目标 Queue 字节增长。
3. 用普通 TCP 流量验证 Best Effort Queue。
4. 制造 NIC DSCP 与交换 Trust 不匹配。
5. 观察 RDMA 性能、Queue、PFC、ECN 变化。
6. 修复后再次抓包和比较计数。
7. 重启端口/节点，确认 Oper 状态保持。

## 11. 掌握标准

看到一个 RoCE 数据包，能够沿每一跳说出 DSCP/PCP、内部 Priority、TC、Queue、Buffer、
PFC 和 ECN Profile；能用计数器证明流量实际进入目标队列。

## 12. 参考资料 {/* #参考资料 */}

- [NVIDIA RoCE Commands and Counters](https://docs.nvidia.com/networking/display/nvidiaonyxusermanualv3104006/roce%2Bcommands)
- [IEEE 802.1 Data Center Bridging](https://1.ieee802.org/dcb/)
