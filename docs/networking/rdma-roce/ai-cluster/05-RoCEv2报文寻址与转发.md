---
title: "RoCEv2 报文、寻址与转发"
sidebar_label: "05. RoCEv2 报文、寻址与转发"
sidebar_position: 5
description: "从 GID、IP、UDP 4791、BTH 和 QP 一路理解 RoCEv2 报文如何跨三层以太网转发。"
tags: [RoCEv2, UDP 4791, GID, RDMA CM, ECMP, MTU]
---

# RoCEv2 报文、寻址与转发

RoCEv2 把 RDMA Transport 封装在 UDP/IP 中，因此可以跨三层路由。它不使用 TCP；
可靠连接的顺序、确认和重试由 RDMA RC Transport 处理。

## 1. 报文分层

```text
Ethernet
└── VLAN（可选）
    └── IPv4 / IPv6
        └── UDP
            └── InfiniBand Transport Headers
                ├── BTH
                ├── 扩展头（按操作）
                └── Payload / ICRC
```

RoCEv2 常用 UDP 目的端口 4791。仅根据端口识别业务仍不足以判断 QP、操作类型和拥塞反馈。

## 2. BTH 中关心什么

Base Transport Header 包含操作码、目标 QP、Packet Sequence Number 等信息。

这些字段支持：

- 区分 Send、Write、Read Response、ACK、CNP 等报文；
- 把报文交给目标 QP；
- RC 可靠传输中的顺序与重试；
- 报文完整性校验。

普通网络抓包可能只能看到 UDP；要解析 RDMA Header 需要支持 RoCE 的 Wireshark/设备镜像能力。

## 3. GID 与 IP

RoCE 使用 GID 表达 RDMA 地址。RoCEv2 GID 与 IP/Netdev 关联，主机可能同时存在：

- 多个物理端口；
- VLAN 子接口；
- IPv4 与 IPv6；
- PF 与 VF；
- 多个 Network Namespace；
- RoCEv1 和 RoCEv2 类型条目。

检查：

```bash
show_gids
ibv_devinfo -v
rdma link show
ip -br addr
```

必须把：

```text
RDMA Device / Port
↔ GID Index
↔ GID Type
↔ Netdev
↔ VLAN / IP
↔ PCIe BDF
```

对应起来。较新 NCCL 版本通常能够动态选择 GID；不要无依据固定旧环境的
`NCCL_IB_GID_INDEX`，应以当前 NCCL 文档和日志为准。

## 4. 建连与地址解析

RDMA CM 可以使用 IP 风格地址完成：

```text
地址解析
→ 路由解析
→ 建立 CM 连接
→ 交换 QP 参数
→ QP 进入 RTR/RTS
→ Verbs 数据传输
```

ARP/ND、VLAN、路由或策略错误都可能让 RDMA CM 在数据传输前失败。

常用测试：

```bash
rdma link show
rping -s -a <server-ip>
rping -c -a <server-ip>
```

`rping` 成功只证明小规模连接和操作，不代表大消息、高并发和 GPU Memory 性能达标。

## 5. 路由与 ECMP

外层 IP 允许 RoCEv2 经过 Leaf-Spine L3 Fabric。交换机通常根据五元组或更深字段哈希。

风险：

- 单个大流（Elephant Flow）可能只落一条路径；
- 多 QP 的源端口/哈希熵决定 ECMP 分布；
- 极化让多条逻辑流落在同一上联；
- 某些负载均衡策略可能造成同一 QP 乱序；
- 不对称路径会让观测和故障定位更复杂。

RDMA RC 对丢包和乱序敏感。交换策略必须与 NIC、Transport 和厂商支持矩阵一致。

## 6. MTU

链路层 MTU、IP MTU 和 RDMA Active MTU 是相关但不同的概念。

RoCEv2 需要容纳：

```text
RDMA Payload
+ IB Transport Headers
+ UDP
+ IP
+ VLAN（可选）
+ Ethernet
```

端到端任一链路 MTU 较小都可能引起丢包、分片或连接异常。生产通常避免依赖 IP 分片。

检查：

```bash
ip link show <netdev>
ip route get <peer-ip>
ping -M do -s <size> <peer-ip>
ibv_devinfo | grep -E 'active_mtu|link_layer'
```

测试的 `ping` 大小与线上 RoCE 报文并非一一相等，目的是发现路径 MTU 不一致。

## 7. QoS 字段

RoCE 数据包可能经过以下映射：

```text
应用/NIC Traffic Class
→ IP DSCP / ECN
→ 入口 Trust
→ Switch Priority
→ 802.1p PCP（带 VLAN 时）
→ Traffic Class / Queue
→ PFC Priority 与 ECN Profile
```

只有端点设置 DSCP 而交换机不信任，或者交换机信任 PCP 但报文没有正确 PCP，都会进入错误队列。
完整映射在第二阶段展开。

## 8. RoCEv1 与 RoCEv2

| 特征 | RoCEv1 | RoCEv2 |
|---|---|---|
| 网络层 | 二层 Ethertype | UDP/IP |
| 路由 | 限于二层域 | 可三层路由 |
| ECMP | 受二层设计限制 | 可用 IP Fabric |
| 地址 | GID | GID 与 IP 关联 |

实际设备可能同时暴露多种 GID Type，测试两端必须选择兼容条目。

## 9. 抓包验证

镜像实验端口，筛选：

```text
udp.port == 4791
```

记录：

- 外层源/目的 MAC；
- VLAN/PCP；
- 源/目的 IP；
- DSCP/ECN；
- UDP 源/目的端口；
- QP 和 PSN（解析器支持时）；
- CNP/ACK/重试相关报文。

生产全速端口镜像可能丢包，不能把“抓包没看到”作为唯一证据。结合端口和 NIC 计数器。

## 10. 常见故障

| 现象 | 优先检查 |
|---|---|
| IP ping 通，`rping` 失败 | GID Type、RDMA CM、QP、策略 |
| 同 VLAN 通，跨网段失败 | 路由、MTU、DSCP Trust、ACL |
| 一张 NIC 正常另一张失败 | GID/Netdev/固件/端口映射 |
| 小消息通，大消息失败 | MTU、丢包、缓冲、重试 |
| 能跑但性能像 TCP | NCCL Transport、GDR、HCA 选择 |
| 部分 QP 抖动 | ECMP 极化、热点、错误链路 |

## 11. 实验

1. 导出两端 GID 表，标注 RoCEv2 条目。
2. 用 IP 路由证明到对端 GID/地址的路径。
3. 运行 `rping` 和 CPU Memory `ib_write_bw -R`。
4. 抓取 UDP 4791，解读 IP、DSCP、ECN 和 BTH。
5. 改变消息大小和 QP 数，观察 ECMP。
6. 在隔离环境制造路径 MTU 不一致并定位。
7. 使用错误 Netdev/GID，记录失败层。

## 12. 掌握标准

能够从一个 GID 找到 Netdev、IP、VLAN、PCIe 设备和物理端口；能把一条 RoCEv2 Packet
从 BTH/QP 一直追到三层 ECMP 路径，并解释为何“ping 通”不能证明 RDMA 正常。

## 13. 参考资料 {/* #参考资料 */}

- [NVIDIA RDMA Aware Networks Programming User Manual](https://docs.nvidia.com/networking/display/rdmaawareprogrammingv17)
- [NCCL Networking Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html)
