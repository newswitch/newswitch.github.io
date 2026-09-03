---
title: "数据中心 Underlay：eBGP、OSPF、ECMP 与收敛设计"
sidebar_label: "02. 数据中心 Underlay：eBGP、OSPF、ECMP 与收敛设计"
sidebar_position: 2
description: "设计 VTEP IP 可达的稳定 Underlay，比较 eBGP 与 IGP，并建立收敛和故障验证方法。"
tags: [Underlay, eBGP, OSPF, ECMP, BFD, FRRouting]
---

# 数据中心 Underlay：eBGP、OSPF、ECMP 与收敛设计

## 1. Underlay 的唯一核心承诺

在 EVPN/VXLAN Fabric 中，Underlay 最重要的职责是：

> 所有 VTEP Loopback 之间具有稳定、可收敛、支持 ECMP 的 IP 可达性。

逻辑上的 Underlay 转发主要依据外层 IP，不依赖租户 MAC 或 VNI 才能选路。设备可以同时承担租户与承载角色，也可能解析内层字段辅助散列；这不改变两个路由上下文应明确分离的原则。

## 2. 地址对象

典型地址：

| 对象 | 用途 | 建议 |
| --- | --- | --- |
| Router ID Loopback | 协议标识和管理 | 全局唯一、稳定 |
| VTEP Loopback | VXLAN 外层源地址 | 可与 Router ID 相同或独立 |
| Leaf-Spine 链路 | Underlay 邻接 | `/31`、IPv6 Link-Local 或 Unnumbered |
| 管理地址 | 带外管理 | 与 Fabric 数据面隔离 |

地址规划应支持角色和机架识别，但不要让过度编码阻碍扩容。

## 3. eBGP Underlay

常见 ASN 模型：

### 3.1 每台 Leaf 独立 ASN {/* #每台-leaf-独立-asn */}

```text
Spine AS 65000
Leaf-1 AS 65101
Leaf-2 AS 65102
...
```

优点：

- 故障和策略边界清晰。
- AS_PATH 天然防环。
- 适合自动生成。

需要处理：

- Spine 之间是否使用同一 ASN。
- Leaf 从不同 Spine 收到路径时的 AS_PATH。
- `allowas-in`、`as-override` 等特殊需求应谨慎。

### 3.2 每层共享 ASN {/* #每层共享-asn */}

所有 Leaf 共用一个 ASN、所有 Spine 共用另一个 ASN。配置更统一，但同 ASN 路径接收
和防环策略需要结合实现设计。

## 4. OSPF/IS-IS Underlay

IGP 适合团队已有成熟经验的场景：

- 邻接简单。
- Link-State 能看到相应区域/Level/拓扑实例内的链路状态，而非无条件拥有全网明细。
- ECMP 与快速收敛成熟。

需要控制：

- Area/Level 设计。
- LSA/LSP 泛洪范围。
- SPF 频率和大规模故障时的 CPU。
- Overlay BGP 与 Underlay IGP 两套协议的运维模型。

选择 eBGP 还是 IGP 不是“新旧技术之争”。应比较规模、团队能力、平台实现、
故障模型和自动化成熟度。

协议机制分别见 [OSPF、ECMP 与 BFD](../routing-switching/06-OSPF-ECMP与BFD.md) 和 [IS-IS 层次邻接、泛洪与 SPF](../routing-switching/12-IS-IS层次邻接泛洪与SPF.md)。如果承载还需要受约束路径与本地快速保护，继续理解 [SR-MPLS/SRv6](../routing-switching/13-Segment-Routing-SR-MPLS与SRv6.md)，但不要把 SR 当成“不再需要 Underlay 可达性”。

## 5. eBGP 配置示例

Leaf-1：

```text
interface swp1
 ip address 10.0.0.0/31
!
interface swp2
 ip address 10.0.0.2/31
!
interface lo
 ip address 10.255.1.1/32
!
router bgp 65101
 bgp router-id 10.255.1.1
 neighbor 10.0.0.1 remote-as 65000
 neighbor 10.0.0.3 remote-as 65000
 !
 address-family ipv4 unicast
  network 10.255.1.1/32
  maximum-paths 64
 exit-address-family
```

Spine 侧为相邻接口配置对应邻居。实际生产应使用 Peer Group、接口邻居、BFD、
Prefix List 和最大前缀保护，示例只展示路径。

验证：

```text
show bgp summary
show bgp ipv4 unicast 10.255.1.1/32
show ip route 10.255.2.1/32
show ip route 10.255.2.1/32 json
```

## 6. 路由策略应尽量简单

Underlay 通常只需要发布：

- 本机 Loopback/VTEP。
- 必要的链路或汇总前缀。

不应把租户路由、默认路由或管理网无边界地注入 Fabric。

护栏：

```text
入方向：只接受对端角色允许的前缀长度和数量
出方向：Leaf 发布本机 Loopback/明确汇总；Spine 按拓扑转发允许的其他 Leaf 前缀
最大前缀：异常时告警或关闭邻居
下一跳：验证递归和接口状态
```

越简单的 Underlay 越容易证明正确。

## 7. ECMP 与 Hash

Leaf 到另一个 Leaf 的 VTEP 通常有多个 Spine 下一跳。检查：

```text
RIB 有多少等价路径
FIB 实际编程多少下一跳
ASIC ECMP Group 是否完整
不同五元组是否分布
成员故障后是否及时删除
```

Overlay 外层哈希字段影响 Fabric 分布。对于 VXLAN，设备可能基于外层五元组和
UDP Source Port；VTEP 应根据内层流生成足够熵，避免所有 Overlay 流压在同一路径。

## 8. MTU

Underlay 接口必须容纳 Overlay 封装：

```text
Outer Ethernet
+ Outer IP
+ UDP
+ VXLAN
+ Inner Ethernet/IP/TCP
```

在无额外 VLAN、IPv4 无选项的普通 VXLAN 模型中，1500 字节客户 IP 包需要容纳 1550 字节外层 IP 包的承载空间。这里必须计入内层以太网头，不能把 IP MTU 与整个外层帧尺寸混为一谈；逐层计算见 [VXLAN MTU](./03-VXLAN数据面与隧道实验.md#6-mtu)。IPv6 和额外封装还会改变所需空间。

策略：

- Fabric 使用一致 Jumbo MTU。
- 或降低主机/Overlay MTU。
- 验证 PMTUD 和 ICMP，不只验证小 Ping。

```bash
ping -M do -s <payload> <remote-vtep>
```

## 9. BFD 与收敛

故障恢复链：

```text
Link/BFD 检测
→ BGP/IGP 撤销
→ RIB 重算
→ FIB/ASIC ECMP 更新
→ Overlay 流重新哈希
→ 应用恢复
```

BFD 定时器应与设备 CPU、链路规模和微突发风险匹配。所有 Leaf 同时错误抖动会在
Spine 形成控制面风暴。

## 10. Graceful Restart 的风险

Graceful Restart 在控制面重启时暂时保留转发表，可降低无谓中断；但如果设备数据面
也已失效，保留陈旧路由会延长黑洞。

应明确：

- 哪些重启场景支持数据面继续转发。
- Stale Timer 多长。
- BFD 与 GR 的交互。
- 设备真正断电时的行为。

不要把所有邻居都无条件启用 GR。

## 11. 故障验证

### 11.1 单链路故障 {/* #单链路故障 */}

预期：只从 ECMP Group 删除一个成员。

保存：

```text
故障前后 RIB/FIB 下一跳数
BFD/邻居时间线
流量丢包与重哈希
剩余链路队列和利用率
```

### 11.2 单 Spine 故障 {/* #单-spine-故障 */}

预期：所有 Leaf 同时减少部分 ECMP 容量，但仍可达。

重点观察控制面并发更新和剩余容量。

### 11.3 MTU 不一致 {/* #mtu-不一致 */}

VTEP 小 Ping 可能成功，Overlay 大包失败。用 DF 大包、接口 Drop 和双侧抓包证明。

### 11.4 错误路由泄漏 {/* #错误路由泄漏 */}

向 Underlay 注入大量租户前缀，验证 Prefix List/Maximum Prefix 是否阻断。

### 11.5 一条 VTEP 路由怎样逐层形成

设 Leaf1 的 VTEP 为 `10.255.1.1/32`，Leaf2 为 `10.255.2.1/32`，两者通过两个 Spine：

1. Leaf2 将自己的 VTEP 前缀发布给两个 Spine。
2. Spine 经入口过滤接受，选择候选，并向 Leaf1 通告；不能把“仅发布本机 Loopback”的 Leaf 策略照搬到 Spine，否则失去中转传播。
3. Leaf1 为远端 VTEP 建立一个含可用 Spine 下一跳的 ECMP 组。
4. 发送 VXLAN 包时，外层目的为远端 VTEP；实际链路交付解析的是本地 Spine 邻居。
5. 远端 Leaf 解封装后，才在租户上下文继续查 MAC 或 IP。

因此远端 VTEP 地址、BGP 通告下一跳和当前以太网邻居是不同对象。到远端 Loopback 的小包成功，只验证了承载的一部分，不验证 VNI/租户导入，也不验证封装后的尺寸。

### 11.6 Unnumbered 没有消除地址与邻居

接口式 eBGP 邻接可使用 IPv6 链路本地地址，减少逐条分配 IPv4 `/31` 的工作。但对端仍由地址与接口上下文标识，并非完全“不用 IP”。

若要经 IPv6 下一跳承载 IPv4 路由，还涉及扩展下一跳能力、邻居发现与平台转发支持。BGP 会话 Established 不等于所需 IPv4 地址族及这种下一跳编码已协商。有关能力见 [RFC 5549](https://www.rfc-editor.org/rfc/rfc5549.html)、[RFC 8950](https://www.rfc-editor.org/rfc/rfc8950.html) 和 [FRR BGP](https://docs.frrouting.org/en/latest/bgp.html)。

Loopback 上建立多跳 BGP 又要求先有抵达对端 Loopback 的承载路径，不能用尚未建立的会话来提供它自身唯一的启动路径。直连邻接与 Loopback 多跳邻接的依赖不同。

### 11.7 检测到了，不代表全部硬件同时更新

链路 Down/BFD、路由撤销、RIB 最佳候选和 ASIC 下一跳更新是不同事件。即使控制面很快报告撤销，部分包仍可能在旧成员上损失；重哈希还可能让流转向拥塞的幸存路径。

一般路由拓扑中，各节点 FIB 更新顺序不同可形成瞬态微环路；简单 Clos 的常见单链路故障可能主要体现为旧成员黑洞与容量下降，不应声称每次 ECMP 更新都必然微环路。

GR 保留陈旧状态的前提是数据面仍可用。BFD 已发现不可转发时，GR 是否仍保留路由取决于双方能力和实现策略，不能只看“GR 已开启”。此处应联合检查会话、stale 标记、真实 FIB 和数据面，机制见 [BGP Graceful Restart](https://www.rfc-editor.org/rfc/rfc4724.html)。

### 11.8 思考与解答

**Spine 也只发布自己的 Loopback，Leaf 之间还能互通吗？**

若没有其他有效传播路径就不能。Spine 必须按拓扑传播允许的远端 Leaf 前缀，出口过滤应按角色定义。

**Unnumbered BGP Established，就能确认 IPv4 VTEP 可达吗？**

不能。还要看地址族、扩展下一跳能力、路由安装和数据面支持。

**BFD Down 后业务仍丢包，是 BFD 没作用吗？**

未必。BFD 只完成检测，后面还有撤销、FIB 更新、重哈希和幸存链路容量等阶段。

**开启 GR 为什么可能延长中断？**

数据面也失效时，保留的 stale 路由仍可能吸引流量进入黑洞；它只适合符合其前提的重启情境。

## 12. 参考资料

- [RFC 7938: Use of BGP for Routing in Large-Scale Data Centers](https://www.rfc-editor.org/rfc/rfc7938)
- [FRRouting BGP Documentation](https://docs.frrouting.org/en/latest/bgp.html)
- [FRRouting OSPF Documentation](https://docs.frrouting.org/en/latest/ospfd.html)

[下一篇：VXLAN 数据面与隧道实验 →](./03-VXLAN数据面与隧道实验.md)
