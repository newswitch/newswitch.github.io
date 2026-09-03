---
title: "MPLS、VRF、RD/RT 与 L3VPN"
sidebar_label: "09. MPLS、VRF、RD/RT 与 L3VPN"
sidebar_position: 9
description: "从 FEC、标签栈和 VRF 理解 MPLS，追踪 LDP/MP-BGP 如何协作，以及一份 L3VPN 报文逐跳如何转发。"
tags: [MPLS, VRF, LDP, MP-BGP, L3VPN, RD, RT]
---

# MPLS、VRF、RD/RT 与 L3VPN

同一个 `10.0.0.0/24` 可以同时属于两个客户，但运营商不能把它们的流量混在一起。理解 L3VPN，需要回答：设备先在哪张表里查，核心依据什么送到远端，远端又凭什么恢复客户上下文。

## 1. 先区分 VRF、MPLS 与 VPN

- **VRF**：在一台设备上维护相互隔离的路由和转发表。
- **MPLS**：在转发路径中使用短标签栈，而不是每跳只查 IP 前缀。
- **L3VPN**：利用 VRF、MP-BGP 和 MPLS 等机制，为多个租户提供隔离的三层网络。

MPLS VPN 默认不提供加密。“VPN”在这里主要表示逻辑隔离，不等于 IPsec。

VRF 可以在没有 MPLS 的设备上存在，MPLS 也可以承载非 L3VPN 业务。它们是可组合的机制，不是三个不同名字的同一项功能。需要机密性时，应另行评估 [IPsec](../security/ipsec/00-IPsec学习路线.md)等保护，而不能根据产品中有 VPN 字样推断已经加密。

## 2. 角色

```text
CE ── PE ── P ── P ── PE ── CE
```

- CE：Customer Edge，租户侧设备。
- PE：Provider Edge，连接租户并维护 VRF。
- P：Provider/Core，只负责骨干标签转发，不需要租户路由。

核心扩展性来自：P 设备不保存所有租户 VRF 路由。

## 3. MPLS 标签转发

MPLS 标签头包含 Label、Traffic Class、Bottom of Stack 和 TTL 等字段。设备依据
LFIB 执行动作：

- Push：压入标签。
- Swap：交换外层标签。
- Pop：弹出标签。
- PHP：倒数第二跳弹出传输标签，减少出口 PE 工作。

数据路径示例：

```text
入口 PE：
  查租户 VRF
  Push VPN Label
  Push Transport Label

P 节点：
  Swap Transport Label

出口附近：
  Pop Transport Label

出口 PE：
  用 VPN Label 定位 VRF/下一跳
  转发给 CE
```

标签栈中外层通常解决“如何到出口 PE”，内层解决“出口 PE 上属于哪个 VPN/下一跳”。

### 3.1 FEC 与标签的本地含义

FEC（Forwarding Equivalence Class，转发等价类）把需要同类转发处理的报文归为一组。目的前缀可以是一种 FEC，但 FEC 不等于一定只按目的地址定义。

标签把报文与某个本地转发动作关联。对同一 FEC，不同节点分配的标签可以不同；设备收到标签后按本地标签空间和适用的接口等上下文查 LFIB，而不是把标签当成全球统一的 VPN 编号。

因此“整条路径每跳标签不一样”是正常现象。Swap 表示使用下游理解的标签继续交付，不是在改写业务的目的 IP。体系定义见 [RFC 3031](https://www.rfc-editor.org/rfc/rfc3031)。

### 3.2 一个标签项为什么占四字节

基本标签栈项包含：

| 字段 | 位数 | 含义 |
| --- | --- | --- |
| Label | 20 | 用于相应标签查找的值 |
| TC | 3 | 流量类别相关标记，具体排队/丢弃映射由策略决定 |
| S | 1 | Bottom of Stack；为 1 表示当前是栈底项 |
| TTL | 8 | 标签转发的跳数限制，和 IP TTL 的映射需结合模型 |

四个字段合计 32 位，所以每个基本标签项增加 4 字节；两层标签增加 8 字节，但这不是整个链路所有封装的总开销。格式见 [RFC 3032](https://www.rfc-editor.org/rfc/rfc3032.html)。

通常处理栈顶以决定下一步动作；栈底的 S 位不能拿来表示“这个包属于哪个租户”。标签数量也不固定为两层：流量工程、业务封装等可以增加栈深。

### 3.3 PHP、Implicit Null 与 Explicit Null

PHP（Penultimate Hop Popping）是在倒数第二跳提前弹出相应传输标签。下游通过 Implicit Null 表达这种要求；值 3 是控制语义，不作为普通隐式空标签压进线上的栈。

Explicit Null 则会保留一个可见的特殊标签到出口，例如 IPv4 的值 0 和 IPv6 的值 2。它允许出口按相应模型处理仍保留的标签信息，不能与 Implicit Null 混为一谈。

是否使用 PHP、保留显式空标签，以及如何处理 TTL/TC，取决于标签分配和服务模型。PHP 是一种处理选择，不是所有 MPLS LSP 无条件具备的固定最后一步。

## 4. LDP 与传输 LSP

传统 MPLS 骨干可通过 IGP 获得 Loopback 可达性，再由 LDP 为 FEC 分发标签。

```text
IGP 路由不通
→ LDP 邻居或 FEC 标签不完整
→ 传输 LSP 不成立
→ VPN 路由即使存在也无法转发
```

因此排障顺序必须先 Underlay/IGP，再 LDP/Transport Label。

现代网络也可能使用 Segment Routing MPLS 替代 LDP，但“先建立到出口 PE 的传输路径”
这一逻辑仍然适用。

标签分发与路径指令的区别，继续见 [Segment Routing：SR-MPLS 与 SRv6](./13-Segment-Routing-SR-MPLS与SRv6.md)。SR 传输段仍需与业务标签、VRF 和出口交付配合。

### 4.1 LDP 建邻与标签绑定不是同一张表

LDP 的常见链路发现使用 Hello，随后建立用于交换标签映射等信息的会话。基础发现与会话分别涉及 UDP 和 TCP 646；Targeted Discovery 等有不同范围和条件，不能只看一个 Hello 就确认全部 LDP 状态建立。

标签映射表达的是“下游为某 FEC 分配了哪个标签”。常规逐跳 LDP 场景中，本机还要结合 IGP 选出的下一跳，使用对应下游提供的绑定形成转发项。

```text
IGP：到出口 PE 应该经邻居 P2
LDP：P2 说到这个 FEC 请使用标签 90
LFIB：收到本地标签 160 时，换成 90 并交给 P2
```

收到了很多标签绑定，不等于每个都被选入活动 LFIB。分发、保持与控制模式也会影响保存哪些绑定；LDP 定义见 [RFC 5036](https://www.rfc-editor.org/rfc/rfc5036.html)。

### 4.2 为什么 IGP 恢复后仍可能黑洞

一条链路恢复时，IGP 可能已经把它纳入最短路径，但相关 LDP 绑定和标签数据面尚未准备好。IP 控制可达与 MPLS 可转发之间出现短暂缺口。

LDP/IGP 同步机制使相应路由可用性与标签准备状态协调，减少这种窗口；它不代替硬件安装检查，也不保证所有故障零丢包，见 [RFC 5443](https://www.rfc-editor.org/rfc/rfc5443.html)。

LDP 通常跟随 IGP 的逐跳路径，并不因此获得显式带宽预留或任意流量工程能力。RSVP-TE、SR-MPLS 等是另外的路径建立机制，不能把标签转发的存在理解为已经完成流量工程。

## 5. VRF

同一个前缀可存在于不同 VRF：

```text
VRF-A: 10.0.0.0/24 → CE-A
VRF-B: 10.0.0.0/24 → CE-B
```

查看路由时必须带 VRF 上下文：

```text
show ip route vrf TENANT_A
show bgp vrf TENANT_A ipv4 unicast
```

在默认路由表里查不到租户路由可能是正常设计。

入接口、子接口或其他接入映射决定数据首先属于哪个 VRF。报文源地址不能自行证明租户身份，否则地址重叠就无法隔离。

VRF 的路由表隔离也不等于完整的资源或应用隔离：接口绑定、路由泄漏、ACL、控制服务监听范围和共享设备资源，都影响最终边界。

## 6. RD 解决地址唯一性

不同租户可以使用相同 IPv4 前缀。MP-BGP 将 RD 与 IPv4 前缀组合成 VPNv4 唯一地址：

```text
65000:100:10.0.0.0/24
65000:200:10.0.0.0/24
```

RD 主要用于让重叠前缀在 BGP 中唯一；它不直接决定谁导入这条路由。

上面的写法是便于阅读的组合示意，不是要求在设备里把三个冒号片段原样输入。VPNv4 的地址部分由 8 字节 RD 与 IPv4 前缀组成，标签等还按相应 NLRI 编码承载。

同一租户经不同 PE 发布相同 IPv4 前缀时，选择不同 RD 可以把它们表示为不同 VPN 路由对象；相同 RD/前缀则属于同一 NLRI 的路径竞争。这与 RR 的候选可见性有关，但不能仅用不同 RD 自动保证最终 VRF 安装等价多路径。

## 7. RT 决定导入导出策略

Route Target 是 BGP Extended Community：

- Export RT：VRF 导出 VPN 路由时附加。
- Import RT：VRF 接受哪些带相应 RT 的路由。

```text
VRF-A export 65000:100
VRF-B import 65000:100
```

这会允许 B 导入 A 的路由。错误 RT 会造成：

- 应有路由缺失。
- 不同租户意外互通。
- Shared Services 路由只通单向。

RT 是路由导入策略边界的一部分，但不是密码学授权，也不是逐包防火墙。接口和对等体信任、导入过滤以及业务访问规则仍需要配合。

### 7.1 相同 RT 可以连接不同 RD

RD 负责区分对象，RT 负责选择哪些对象进入哪些 VRF。因此两个 VRF 可以使用不同 RD，却通过匹配 RT 互相导入；也可以共享一个导出目标而具有不同导入目标，形成 Hub-and-Spoke 或共享服务关系。

若 B 导入 A 的前缀，但 A 没有到 B 的回复路径，仍是单向可达关系。路由导入不是自动双向建立的 TCP 会话。

### 7.2 地址重叠遇到共享服务

两个客户各自的 `10.0.0.0/24` 可以在不同 VRF 中共存，但把它们都导入同一普通服务 VRF 后，数据包只带同一个目的地址时仍会产生归属歧义。

RD 保留在 VPN 控制面对象中，不会让一个普通 IPv4 服务凭空知道应回复哪个客户。共享服务可能需要独立接入上下文、地址转换或其他明确方案，不能用“RT 都导入了”代替地址与返回路径设计。

## 8. MP-BGP VPNv4 控制面

发布路由的 PE 从 CE 学到 IPv4 路由后：

1. 放入对应 VRF。
2. 加上 RD 转成 VPNv4 NLRI。
3. 附加 Export RT。
4. 附加出口使用的 VPN Label。
5. 通过 MP-BGP 发布给远端 PE 或 Route Reflector。

远端 PE：

1. 接收 VPNv4 路由。
2. 根据 Import RT 选择目标 VRF。
3. 安装租户路由和标签转发信息。

这里从“前缀发布者”描述控制面。**对于去往这个前缀的业务，发布它的 PE 恰好是数据路径的出口 PE**。不要把“先讲到的那台 PE”永远理解成数据入口。

### 8.1 跟踪一个实际包的四跳变化

设 PE2 学到客户前缀 `10.20.0.0/24`，为对应交付动作分配 VPN 标签 240，通过 MP-BGP 发布 NEXT_HOP=PE2、RD 和 RT。PE1 的客户 VRF 按导入策略接受它，并解析出到 PE2 的传输路径。

以下数字仅是说明本地标签意义的算例：

| 位置 | 收到的对象 | 处理后交付 |
| --- | --- | --- |
| PE1 | 客户 IP 包，目的 10.20.0.8 | 按入口 VRF 查路由，压入 `[传输160, VPN240]`，发给 P1 |
| P1 | `[160, 240] + 原 IP 包` | 查本地 LFIB，Swap 成 `[90, 240]`，发给 P2 |
| P2 | `[90, 240] + 原 IP 包` | 若下游要求 PHP，弹出 90，发给 PE2 |
| PE2 | `[240] + 原 IP 包` | 按自己的标签 240 定位相应 VRF／转发动作，交给客户侧 |

P1/P2 不需要知道每个客户的 `10.20.0.0/24`。传输标签把包送到有能力解释 VPN 标签的 PE2，VPN 标签再恢复正确的业务交付上下文。

出口可以按 VRF、前缀或其他粒度分配 VPN 标签，因此“一个 VPN 标签永远等于一张 VRF 表”也过于绝对。出口动作是否继续查 IP，需要结合分配模式。控制面与数据面的配合见 [RFC 4364](https://www.rfc-editor.org/rfc/rfc4364.html)。

### 8.2 RD 和 RT 为什么不出现在普通逐跳转发图里

RD/RT 用于构造和选择 VPN 路由；业务包进入骨干后，主要通过标签栈和原始 IP 内容转发，不为每个普通客户包附上一份 BGP 路由及 RT 列表。

所以数据面不能仅靠抓到一个标签值就推断它对应哪个 RT。需要把本地标签绑定、VPN 路由和目标 VRF 关联起来。

### 8.3 MTU、TTL 与 QoS 的跨层关系

标签栈消耗帧承载空间，物理接口允许的尺寸、MPLS MTU 和客户 IP MTU 不是可以随意互换的三个数字。小包可达并不能证明深标签栈下的大包可达。

IP TTL 和 MPLS TTL 可以按 Uniform、Pipe 等模型组合；是否把骨干跳数暴露到客户侧、出口如何继续处理寿命，要看模型，而不是固定断言 MPLS 会隐藏所有 P 节点。相关定义见 [RFC 3443](https://www.rfc-editor.org/rfc/rfc3443.html)。

TC 与内层 DSCP 的映射也受策略影响。标记高优先级不等于沿途自动获得带宽预留；实际队列、调度与拥塞处理仍在每个节点执行，参见 [RFC 3270](https://www.rfc-editor.org/rfc/rfc3270.html)。

## 9. PE-CE 路由

可使用：

- Static：简单但扩展和故障传播有限。
- OSPF：需处理 Domain ID、路由类型和环路防护。
- eBGP：策略清晰、扩展性好，常用于大规模场景。

PE-CE 协议选择不会改变骨干 VPNv4 的基本模型，但会影响租户侧收敛和策略。

## 10. 分层排障

按顺序验证：

### 10.1 Underlay

```text
PE Loopback 是否 IGP 可达
P/PE 链路与 IGP 邻居是否正常
```

### 10.2 Transport Label

```text
LDP/SR 状态
到远端 PE 的标签绑定和 LFIB
```

### 10.3 VPN 控制面

```text
PE-CE 是否学到前缀
VPNv4 路由是否携带正确 RD、RT、Next Hop、VPN Label
远端 PE 是否接收
```

### 10.4 VRF 导入

```text
Import RT 是否匹配
路由是否进入正确 VRF
下一跳是否有效
```

### 10.5 数据面

```text
入口标签栈
每跳 Swap/Pop
出口 VRF 与 CE 邻居
返回方向
```

## 11. 典型故障

| 现象 | 可能层级 |
| --- | --- |
| 所有租户跨 PE 都不通 | Underlay、LDP/SR、MP-BGP 会话 |
| 只有一个租户不通 | VRF、RT、PE-CE、VPN Label |
| 单方向不通 | RT 不对称、返回路由、PE-CE 策略 |
| 路由存在但标签转发失败 | LFIB、传输 LSP、MTU |
| 两租户意外互通 | 错误 Import RT 或接口绑定错误 |

## 12. 实验要求

搭建至少 2 PE + 2 P + 2 CE：

1. 两个租户使用重叠地址。
2. 验证租户完全隔离。
3. 建立 Shared Services VRF，只开放指定前缀。
4. 故意删除一个 Import RT，观察远端 VRF 路由变化。
5. 故意破坏一段 LDP/IGP，区分控制面路由存在与数据面 LSP 失败。
6. 输出每一跳标签栈和 VRF 路由证据。

## 13. 思考与解答

**标签值 240 在两台设备上相同，就表示同一租户吗？**

不能。标签首先在各设备相应标签空间内解释；同一数值可以对应不同动作，必须结合绑定与上下文。

**P 节点没有客户路由，如何把客户包送到正确的远端？**

它按传输标签到达出口 PE，出口再解释 VPN 标签并交付客户。核心无需为此保存所有租户前缀。

**RD 不同，两个 VRF 就必然不能通信吗？**

不是。RD 区分 VPN 路由对象，导入关系由 RT 与相应策略等决定，最终还需要有效转发和双向路由。

**VPNv4 路由和 RT 都正确，为什么所有跨 PE 大包失败？**

它们只证明部分控制状态。标签数据面、栈深与 MTU、出口交付和返回路径仍可能异常。

**PHP 弹掉传输标签，是否已经丢失租户身份？**

在这里的双标签模型中没有，VPN 标签仍留给出口 PE 解释。它只提前完成指定外层标签的处理。

## 14. 参考资料

- [RFC 3031: Multiprotocol Label Switching Architecture](https://www.rfc-editor.org/rfc/rfc3031)
- [RFC 4364: BGP/MPLS IP Virtual Private Networks](https://www.rfc-editor.org/rfc/rfc4364)
- [FRRouting LDP Documentation](https://docs.frrouting.org/en/latest/ldpd.html)

[下一篇：网络故障排查方法与工具 →](../troubleshooting/10-网络故障排查方法与工具.md)
