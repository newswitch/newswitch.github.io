---
title: "VXLAN 数据面：VTEP、VNI、封装、MTU 与 Linux 实验"
sidebar_label: "03. VXLAN 数据面：VTEP、VNI、封装、MTU 与 Linux 实验"
sidebar_position: 3
description: "从两套地址与查表关系理解 VXLAN，推导首包学习、已知单播、BUM、UDP 熵、MTU 与封装边界。"
tags: [VXLAN, VTEP, VNI, Overlay, Linux, MTU]
---

# VXLAN 数据面：VTEP、VNI、封装、MTU 与 Linux 实验

## 1. VXLAN 解决什么问题

传统 VLAN 使用 12 位 VLAN ID，可用规模约 4094；大二层跨数据中心 Fabric 还会受
STP、广播域和物理拓扑限制。

VXLAN 将二层帧封装在 UDP/IP 中：

- 使用 24 位 VNI 标识逻辑网络。
- Overlay 与 Underlay 解耦。
- 借助 VTEP 间的 IP 承载延伸逻辑二层，同时要求封装、映射、策略和 MTU 等条件成立。
- 外层 IP 可利用 ECMP。

VXLAN 本身主要定义数据面封装，不负责大规模地址发布和策略；这些通常由 EVPN 控制面提供。

### 1.1 二层服务为什么可以跨三层网络

主机认为目的设备在同一子网，因此按普通以太网方式寻找目的 MAC。VTEP 则把整份客户帧放进另一个 IP 包，让中间路由器只负责把这个外层包送到远端 VTEP。

这不是让中间每台路由器都加入客户 VLAN，而是在边缘恢复二层服务。广播域仍然存在，只是承载它的物理网络可以采用三层路由；广播范围、地址冲突和接入环路不会因为换了封装自动消失。

### 1.2 隧道不是另一条 TCP 连接

基础 VXLAN 没有为每个远端执行 TCP 式握手、确认和重传。设备上显示 VXLAN 接口 Up，可能仅表示本地对象已启用，不证明远端已经接收并接受某个 VNI。

这里的“无连接封装”也不是完全没有状态：VNI 映射、MAC/FDB、远端列表和 Underlay 路由仍是必要状态。内层若是 TCP，可靠性仍由内层端点处理；外层 UDP 不会替它重传。基础封装与学习模型见 [RFC 7348](https://www.rfc-editor.org/rfc/rfc7348)。

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

### 2.1 本地 VLAN、广播域和 VNI 不是同一个编号空间

假设 Leaf1 的接入 VLAN 100 与 Leaf2 的接入 VLAN 200 都映射到 L2VNI 10100，在相应 VLAN 转换与业务模型支持下，它们可以属于同一逻辑二层服务。主机并不需要知道远端接入口使用哪个本地 VLAN 编号。

反过来，两台设备都配置 VLAN 100，若映射的逻辑网络不同，也不能据此认为它们互通。VNI 的 24 位编码空间更大，不表示交换芯片能同时容纳同样数量的广播域、MAC 表和复制成员；协议可编码范围与产品资源容量是两回事。

本文使用全局一致 VNI 的常见模型。EVPN 还存在不同的标识作用域与服务映射，不能把“某个编号必须全网一样”推广为所有 Overlay 的规则。

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

### 3.1 一次已知单播实际上查了哪些表

设主机 A、B 同属 L2VNI 10100，分别连接 Leaf1 和 Leaf2。A 已知道 B 的 MAC，Leaf1 也已经获得远端映射：

| 阶段 | 查找对象 | 得到的结果 |
| --- | --- | --- |
| 接入分类 | 入端口和 VLAN 等上下文 | A 属于哪个 Bridge Domain/L2VNI |
| 客户二层查找 | 该广播域中的 B-MAC | 应通过 VXLAN 发往 Leaf2 的 VTEP |
| 外层路由查找 | Leaf2 的 VTEP IP | 下一跳是某台 Spine、使用某出接口 |
| 承载邻居解析 | 直连 Spine 的 IP | 外层以太网目的 MAC |
| Leaf2 解封装 | VNI 与本地映射 | 在相应客户广播域中继续处理 |
| 出口二层查找 | B-MAC | B 的本地接入口 |

**Leaf1 不会为了跨三层传输，直接 ARP 查询远端 Leaf2 的以太网 MAC。**它解析的是当前直连承载下一跳。外层 IP 指向远端 VTEP，外层 MAC 指向眼前这一跳。

### 3.2 哪些字段变化，哪些字段保持

在纯二层桥接的 VXLAN 路径中：

- 内层源/目的 MAC 仍表示 A、B，内层 IP 仍表示客户通信端点。
- 外层源/目的 IP 表示 VTEP；沿普通 Underlay 路由前进时外层 MAC 逐跳变化。
- Underlay 路由递减外层 IP 的 TTL/Hop Limit，不因这次承载转发而递减客户内层 IP TTL。
- 远端移除封装后，恢复客户帧并交付。

若边缘执行跨子网路由，内层 MAC 和 TTL 会按三层转发改变，那属于后文的 [IRB](./05-EVPN网关BUM与多归属.md)，不要与本节的同子网桥接混在一起。

## 4. UDP Source Port 与 ECMP

VXLAN 目的端口通常为 4789。源端口常由 VTEP 根据内层五元组哈希生成，使不同内层流
得到不同外层 UDP Source Port，从而为 Underlay ECMP 提供熵。

如果实现始终使用固定源端口，大量 Overlay 流可能被 Underlay 哈希到同一条链路。

### 4.1 熵不是逐包随机数

同一个内层流通常应保持稳定的外层哈希结果，避免仅因封装就频繁乱序；不同内层流再尽量分散到不同结果。增加可见字段能改善分布，但不保证每条链路精确均分：少数大流、哈希碰撞和硬件识别能力仍会产生热点。

外层端口也不是对租户端口做 NAT。内层 TCP 端口仍在封装内部，外层 UDP 源端口用于承载与分流，两者无需数值相同。

## 5. BUM 流量

当目的 MAC 未知或帧属于广播/多播时，VTEP 需要把它送往参与该 VNI 的其他 VTEP：

- Head-End Replication：入口 VTEP 为每个远端复制一份。
- Underlay Multicast：利用多播树复制。

静态 Flood-and-Learn 可以用于小实验，但规模化生产通常使用 EVPN 发布参与者和
MAC/IP 信息，减少不必要泛洪。

### 5.1 首包面对的是两种不同的未知

主机 A 不知道 B 的 IP 对应哪个 MAC，会先发 ARP；VTEP 不知道某个目的 MAC 在哪个远端，则是 FDB 查找未命中。这两种未知分别发生在主机邻居解析和交换转发中。

在简单 Flood-and-Learn 模型里，可以沿下列过程理解：

1. A 发 ARP 广播，Leaf1 按该 VNI 的复制关系送到远端。
2. Leaf2 解封装，按允许的本地接入范围交给 B；启用数据面学习时，还可记录 A-MAC 与源 VTEP 的对应关系。
3. B 回复，反向报文使 Leaf1 获得 B 的位置；A 同时建立 B-IP→B-MAC 的邻居项。
4. 后续已知单播不再需要向全部远端复制。

EVPN 或其他控制系统可以提前提供这些映射；配置静态项也是一种来源。不能把所有 VXLAN 都限定为只能从收到的数据包学习。Linux VXLAN 支持学习与静态转发表等方式，见 [内核 VXLAN 文档](https://docs.kernel.org/networking/vxlan.html)。

### 5.2 丢弃未知单播不是无代价的广播优化

限制未知单播可以减少泛洪，但若远端 MAC 尚未学习、刚迁移或表项失效，业务就可能被直接丢弃。优化前必须明确如何补齐缺失映射，以及等待期间允许怎样的行为。

普通隧道转发还需要避免把从 Overlay 收到的 BUM 再无边界地送回 Overlay。接入侧环路、多归属重复交付和隧道复制各有控制机制，不能只靠外层 TTL 限制它们的影响。

## 6. MTU

“VXLAN 多 50 字节”需要先固定比较口径。假设内外层都没有 VLAN 标签，IPv4 无选项，不计 FCS、前导码和帧间隙：

```text
客户 IP 包                         1500 字节
客户以太网帧（14 + 1500）           1514 字节
外层 IPv4 包（20 + 8 + 8 + 1514）  1550 字节
外层以太网帧（14 + 1550）           1564 字节
```

前后以太网帧比较，增加 `1564 - 1514 = 50` 字节；从客户 IP MTU 到承载所需 IP MTU 比较，增加的也是 50，但后一种算法包含的是**内层以太网头**，不是外层以太网头。两者数字恰好相同，不能据此混淆计量层级。

因此客户 IP MTU 为 1500 时，本例要求承载路径至少容纳 1550 字节的外层 IPv4 包；若外层改为无扩展头的 IPv6，基础 IP 头多 20 字节，对应为 1570。额外 VLAN、加密或其他隧道还要继续计算。

选择：

- Underlay 全链路配置足够 Jumbo MTU。
- 将主机/Overlay MTU 降低。
- 通过 MSS Clamping 缓解部分 TCP 场景，但不能替代完整 MTU 设计。

验证必须使用 DF 大包和真实协议流。

### 6.1 为什么小包通，大包不通

小包可能同时满足客户 MTU 和承载 MTU，大包则在封装后超限。不能依赖“路由器帮忙分片”作为通用保证：VXLAN 对分片处理有约束，远端可能不接受相应片段；IPv6 中间路由器也不会代替源端分片。

路径 MTU 探测还依赖相应 ICMP 错误能够正确到达并被处理。MSS Clamping 只影响匹配场景的 TCP 协商，不解决 UDP 大报文、所有封装层和所有已建立连接。

抓包也有观察位置限制：主机的分段/校验和卸载可能让软件抓到尚未切成线速帧的大包，或显示尚未完成的校验和。应区分软件对象与线上帧，不能仅凭一次本机抓包断言交换机真的转发了超 MTU 巨帧。相关设备卸载背景见 [内核分段卸载说明](https://docs.kernel.org/networking/segmentation-offloads.html)。

### 6.2 VNI 隔离不等于身份认证或加密

基础 VXLAN 不提供租户数据加密，也不单凭一个 VNI 就证明报文来自可信 VTEP。允许哪些端点进入封装网络、接口属于哪个客户、解封装后怎样应用访问策略，都属于独立边界。

客户地址重叠依靠正确的业务上下文隔离；若接入映射或解封装策略错误，使用更大的 VNI 编号空间也不能补救。

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

- VXLAN 自动学习全网 MAC：映射需要学习、静态配置或控制面等来源，创建隧道本身不生成远端主机清单。
- VNI 等于 VLAN：VLAN 是本地接入标识，VNI 是 Overlay 标识，映射可按设计变化。
- Underlay Ping 通就证明 VXLAN 通：VNI、FDB、UDP 和 MTU 都可能错误。
- Overlay MTU 1500 就要求 Underlay 1500：外层封装需要额外空间。
- 抓到 UDP 4789 就说明远端已正确解封装：还要看远端 VNI/FDB 和内层转发。

## 10. 思考与解答

**为什么远端 VTEP IP 不在本地子网，仍能传输以太网帧？**

客户帧作为外层 IP 包的负载，经过路由网络到远端再还原。无需让所有中间接口属于客户 VLAN。

**客户邻居表有 B-IP→B-MAC，是否就证明 Leaf1 能发送 VXLAN？**

不证明。Leaf1 还需要对应广播域中的 MAC 位置、远端 VTEP 路由及承载下一跳邻居信息。

**同子网客户包穿过三台 Spine，内层 TTL 一定减三吗？**

不会仅因 Underlay 转发而减三。纯桥接模型中递减的是外层 TTL；跨子网 IRB 是另一种内层路由行为。

**客户 MTU 1500、无额外标签、外层 IPv4，承载 IP MTU 1540 够吗？**

不够，本例需要 1550。不能只加 IPv4、UDP、VXLAN 的 36 字节而漏掉被封装的内层以太网头。

**把外层 UDP 源端口每包随机变化，是否一定更快？**

不是。同一流可能跨不同时延路径而乱序，稳定的流映射与足够的跨流熵要同时考虑。

**两个 VTEP 的接口都 Up，是否证明客户数据安全互通？**

不是。还要验证映射、远端接受、路径与业务策略；基础 VXLAN 也不等于加密或认证。

## 11. 参考资料 {/* #参考资料 */}

- [RFC 7348: Virtual eXtensible Local Area Network](https://www.rfc-editor.org/rfc/rfc7348)
- [Linux Kernel VXLAN Documentation](https://docs.kernel.org/networking/vxlan.html)

[下一篇：BGP EVPN 控制面 →](./04-BGP-EVPN控制面与路由类型.md)
