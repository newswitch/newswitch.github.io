---
title: "VXLAN 数据面：VTEP、VNI、封装、MTU 与 Linux 实验"
sidebar_label: "03. VXLAN 数据面：VTEP、VNI、封装、MTU 与 Linux 实验"
sidebar_position: 3
description: "从内外层报文理解 VXLAN 数据面，并用 Linux VXLAN 设备完成跨三层二层互通实验。"
tags: [VXLAN, VTEP, VNI, Overlay, Linux, MTU]
---

# VXLAN 数据面：VTEP、VNI、封装、MTU 与 Linux 实验

## 1. VXLAN 解决什么问题

传统 VLAN 使用 12 位 VLAN ID，可用规模约 4094；大二层跨数据中心 Fabric 还会受
STP、广播域和物理拓扑限制。

VXLAN 将二层帧封装在 UDP/IP 中：

- 使用 24 位 VNI 标识逻辑网络。
- Overlay 与 Underlay 解耦。
- 只要 VTEP IP 可达，就能跨三层 Fabric 延伸逻辑二层。
- 外层 IP 可利用 ECMP。

VXLAN 本身主要定义数据面封装，不负责大规模地址发布和策略；这些通常由 EVPN 控制面提供。

## 2. 核心对象

| 对象 | 含义 |
| --- | --- |
| VTEP | VXLAN Tunnel Endpoint，封装/解封装端点 |
| VNI | VXLAN Network Identifier，24 位逻辑网络标识 |
| NVE | Network Virtualization Edge，承担 Overlay 边缘功能 |
| Underlay | VTEP 之间的 IP 传输网络 |
| Overlay | 租户可见的逻辑二层/三层网络 |

同一 VLAN 在不同 Leaf 可映射到同一 L2 VNI；不同租户即使 VLAN 号相同，也可映射到
不同 VNI。

## 3. 报文封装

```text
Outer Ethernet
  Outer IP: local VTEP → remote VTEP
    UDP: destination 4789
      VXLAN: VNI
        Inner Ethernet
          Inner IP
            TCP/UDP/Application
```

转发时：

1. 接入端 VTEP 收到内层以太网帧。
2. 根据 VLAN/Bridge Domain 找到 VNI。
3. 根据目的 MAC 找到远端 VTEP。
4. 封装外层 IP/UDP/VXLAN。
5. Underlay 按外层目的 VTEP 路由并 ECMP。
6. 远端 VTEP 解封装，按内层二层表转发。

Underlay 设备不需要理解租户内层 MAC/IP。

## 4. UDP Source Port 与 ECMP

VXLAN 目的端口通常为 4789。源端口常由 VTEP 根据内层五元组哈希生成，使不同内层流
得到不同外层 UDP Source Port，从而为 Underlay ECMP 提供熵。

如果实现始终使用固定源端口，大量 Overlay 流可能被 Underlay 哈希到同一条链路。

## 5. BUM 流量

当目的 MAC 未知或帧属于广播/多播时，VTEP 需要把它送往参与该 VNI 的其他 VTEP：

- Head-End Replication：入口 VTEP 为每个远端复制一份。
- Underlay Multicast：利用多播树复制。

静态 Flood-and-Learn 可以用于小实验，但规模化生产通常使用 EVPN 发布参与者和
MAC/IP 信息，减少不必要泛洪。

## 6. MTU

IPv4 VXLAN 常增加约 50 字节外层开销：

```text
Outer Ethernet 14
Outer IPv4 20
UDP 8
VXLAN 8
= 50 bytes
```

如果内层仍发送 1500 字节 IP Packet，外层帧会超过传统 1500 MTU。

选择：

- Underlay 全链路配置足够 Jumbo MTU。
- 将主机/Overlay MTU 降低。
- 通过 MSS Clamping 缓解部分 TCP 场景，但不能替代完整 MTU 设计。

验证必须使用 DF 大包和真实协议流。

## 7. Linux 静态 VXLAN 实验

拓扑：

```text
h1 -- leaf1(VTEP 192.0.2.1) ===== IP Underlay ===== leaf2(VTEP 192.0.2.2) -- h2
                  VNI 10010 / Overlay 10.10.10.0/24
```

以下实验在专用 Linux 主机执行。

### 7.1 创建 Leaf Namespace 和 Underlay

```bash
sudo ip netns add leaf1
sudo ip netns add leaf2
sudo ip link add l1-u type veth peer name l2-u
sudo ip link set l1-u netns leaf1
sudo ip link set l2-u netns leaf2
sudo ip -n leaf1 addr add 192.0.2.1/30 dev l1-u
sudo ip -n leaf2 addr add 192.0.2.2/30 dev l2-u
sudo ip -n leaf1 link set lo up
sudo ip -n leaf2 link set lo up
sudo ip -n leaf1 link set l1-u up
sudo ip -n leaf2 link set l2-u up
```

### 7.2 创建主机 Namespace 和接入链路

```bash
sudo ip netns add h1
sudo ip netns add h2
sudo ip link add l1-h type veth peer name h1-e
sudo ip link add l2-h type veth peer name h2-e
sudo ip link set l1-h netns leaf1
sudo ip link set h1-e netns h1
sudo ip link set l2-h netns leaf2
sudo ip link set h2-e netns h2

sudo ip -n h1 addr add 10.10.10.1/24 dev h1-e
sudo ip -n h2 addr add 10.10.10.2/24 dev h2-e
sudo ip -n h1 link set lo up
sudo ip -n h2 link set lo up
sudo ip -n h1 link set h1-e up
sudo ip -n h2 link set h2-e up
```

### 7.3 创建 Bridge 和 VXLAN

Leaf-1：

```bash
sudo ip -n leaf1 link add br10 type bridge
sudo ip -n leaf1 link add vx10 type vxlan id 10010 \
  local 192.0.2.1 remote 192.0.2.2 dstport 4789 dev l1-u
sudo ip -n leaf1 link set l1-h master br10
sudo ip -n leaf1 link set vx10 master br10
sudo ip -n leaf1 link set l1-h up
sudo ip -n leaf1 link set vx10 up
sudo ip -n leaf1 link set br10 up
```

Leaf-2：

```bash
sudo ip -n leaf2 link add br10 type bridge
sudo ip -n leaf2 link add vx10 type vxlan id 10010 \
  local 192.0.2.2 remote 192.0.2.1 dstport 4789 dev l2-u
sudo ip -n leaf2 link set l2-h master br10
sudo ip -n leaf2 link set vx10 master br10
sudo ip -n leaf2 link set l2-h up
sudo ip -n leaf2 link set vx10 up
sudo ip -n leaf2 link set br10 up
```

### 7.4 验证

```bash
sudo ip netns exec h1 ping -c 3 10.10.10.2
sudo ip -n leaf1 -d link show vx10
sudo ip netns exec leaf1 bridge fdb show
sudo ip netns exec leaf2 bridge fdb show
```

Underlay 抓包：

```bash
sudo ip netns exec leaf1 tcpdump -eni l1-u 'udp port 4789'
```

应看到外层源/目的 `192.0.2.1/192.0.2.2`，解码后内层是 h1/h2 的 MAC 和 IP。

### 7.5 故障实验

1. 将 leaf2 VNI 改为 10020：Underlay 通、Overlay 不通。
2. 将一端 UDP 端口改错：远端无法正确解封装。
3. 把 Underlay MTU 降低，用大包复现封装后丢弃。
4. 删除 Remote/Flood 条目：未知 MAC 的首包失败。

清理：

```bash
sudo ip netns del h1
sudo ip netns del h2
sudo ip netns del leaf1
sudo ip netns del leaf2
```

## 8. 需要查看的表

```text
Underlay RIB/FIB：远端 VTEP 是否可达
VNI/VXLAN 接口：VNI、Local VTEP、UDP 端口
FDB：内层 MAC 对应本地端口还是远端 VTEP
邻居表：本地接入主机 ARP/ND
接口计数：封装、解封装、Drop、MTU
```

## 9. 常见误区

- VXLAN 自动学习全网 MAC：纯数据面只能 Flood-and-Learn，规模化需要控制面。
- VNI 等于 VLAN：VLAN 是本地接入标识，VNI 是 Overlay 标识，映射可按设计变化。
- Underlay Ping 通就证明 VXLAN 通：VNI、FDB、UDP 和 MTU 都可能错误。
- Overlay MTU 1500 就要求 Underlay 1500：外层封装需要额外空间。
- 抓到 UDP 4789 就说明远端已正确解封装：还要看远端 VNI/FDB 和内层转发。

## 10. 参考资料 {/* #参考资料 */}

- [RFC 7348: Virtual eXtensible Local Area Network](https://www.rfc-editor.org/rfc/rfc7348)
- [Linux Kernel VXLAN Documentation](https://docs.kernel.org/networking/vxlan.html)

[下一篇：BGP EVPN 控制面 →](./04-BGP-EVPN控制面与路由类型.md)
