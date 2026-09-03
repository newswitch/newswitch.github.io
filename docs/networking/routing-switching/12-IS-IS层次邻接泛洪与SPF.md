---
title: "IS-IS：NET、层次邻接、泛洪与 SPF"
sidebar_label: "12. IS-IS：NET、层次邻接、泛洪与 SPF"
sidebar_position: 12
description: "从 IS-IS 的链路层承载进入 NET、L1/L2、DIS、LSP/CSNP/PSNP、SPF、路由泄漏及 IPv6 多拓扑。"
tags: [IS-IS, IGP, NET, DIS, SPF, IPv6]
---

# IS-IS：NET、层次邻接、泛洪与 SPF

一台路由器能够发现隔壁设备，还不等于知道远端前缀；知道远端前缀，也不等于已经安装好转发表。IS-IS 将邻接、拓扑同步、路径计算与 IP 转发衔接起来，但这些步骤分别有自己的对象与状态。

阅读前应理解 [路由、RIB/FIB 与 OSPF](./06-OSPF-ECMP与BFD.md)。本篇聚焦协议机制，不把某个厂商的命令和默认值作为协议本身。

## 1. IS-IS 在网络中负责什么

IS-IS 是 Intermediate System to Intermediate System 的缩写。这里的 Intermediate System 指参与路由的中间系统，可以先理解为路由器。

它属于链路状态 IGP：设备描述自己的连接与可达信息，在相应范围内同步数据库，各设备独立运行 SPF，再把结果交给系统路由选择与转发安装。

### 1.1 控制报文不是通过 TCP/UDP 端口传输

常见以太网场景中，IS-IS 控制 PDU 直接使用链路层承载，不像 OSPF 使用 IP 协议号 89，也不像 BGP 使用 TCP 179。这里的 PDU 是 Protocol Data Unit（协议数据单元）。

因此寻找“IS-IS 的 UDP 端口”会找错层级；IP Ping 成功也不证明相应链路层控制报文能通过。接入口是否启用协议、二层过滤、认证和邻接资格仍要分别考虑。

### 1.2 协议不依靠 IP 承载，不代表不能计算 IP 路由

Integrated IS-IS 通过扩展携带 IP 可达信息，同时保留自己的邻接与泛洪机制。实际业务 IP 包仍按普通 IP 转发，不会因为路由由 IS-IS 学到，就在每个包外再包一份 IS-IS PDU。基础关系见 [RFC 1195](https://www.rfc-editor.org/rfc/rfc1195.html)。

还有一个容易混淆的缩写：本篇的 LSP 是 **Link State PDU（链路状态报文）**；在 MPLS 中 LSP 是 **Label Switched Path（标签交换路径）**。一个是控制信息对象，一个是转发路径。

## 2. NET 与 System ID：路由器怎样标识自己

NET（Network Entity Title，网络实体标识）采用 NSAP（Network Service Access Point，网络服务访问点）风格地址。一个常见示例是：

```text
49.0001.0000.0000.0001.00
```

| 部分 | 本例取值 | 本例长度 |
| --- | --- | --- |
| 区域地址 | `49.0001` | 3 字节 |
| System ID，系统标识 | `0000.0000.0001` | 6 字节 |
| NSEL，网络选择符 | `00` | 1 字节 |

点号只是便于阅读的分隔；这些部分不是 IPv4 点分十进制地址。

区域地址帮助判断相应 L1 区域关系，System ID 标识系统，NET 中 NSEL 为 00。真实 NET 有不同允许长度与格式，本例不是唯一合法形式。NET 与 NSAP 的关系见 [Juniper IS-IS 概览](https://www.juniper.net/documentation/us/en/software/junos/is-is/topics/concept/is-is-routing-overview.html)。

### 2.1 为什么不能把 NET 当作接口 IP

接口 IP 用于相应 IP 链路与转发，NET 用于协议实体与区域身份。改变接口地址不应被理解为必须同步改变整个系统的协议身份。

为排障方便，可以采用某种可读编码把 Loopback 信息映射进 System ID，但那只是规划方法，不是协议要求。多个设备复制同一 System ID 会让数据库中的始发身份冲突，必须在相应路由域内保持明确唯一性。

一个设备在一个实例中的多个区域地址还涉及特定过渡和多区域地址支持，不能据此把它想象为任意多个互相独立的 L1 路由器。

## 3. L1、L2 与 L1/L2 分别看到什么

可以把基本层次理解为区域内与区域间：

```text
区域 49.0001                         区域 49.0002
A（L1）── R1（L1/L2） ══ L2 ══ R2（L1/L2）── B（L1）
     L1 邻接                               L1 邻接
```

| 角色 | 主要维护的状态 | 不能由名字推断的事情 |
| --- | --- | --- |
| L1 | 相应区域内的邻接、LSDB 与路径 | 不自动保存整个域的全部明细拓扑 |
| L2 | L2 骨干拓扑与相应可达性 | 不表示设备一定只有骨干物理接口 |
| L1/L2 | 分别参加两个层级的计算与传播 | 不是把两份数据库直接拼成一份 |

L1 邻接需要符合区域匹配条件；L2 邻接不要求区域地址相同，但仍要满足其他资格。上图 R1 与 R2 区域不同，并不阻止它们在相应链路建立 L2 邻接。

### 3.1 L2 不是 OSPF 的“Area 0 改名”

两者都进行层次化路由，但区域边界和数据库组织不同。OSPF 常按接口分属区域，ABR 连接多个区域；基本 IS-IS 模型按路由器的区域身份组织 L1，L1/L2 设备再连接 L2 骨干。

应保持所需 L2 拓扑的连通性。不能让一个普通 L1 区域自动充当两段断开的 L2 骨干之间的透明桥梁。

## 4. 从 Hello 到邻接 Up

IIH（IS-IS Hello）用于发现与维持邻接。LAN 上有相应的 L1/L2 Hello；点到点链路有自己的 Hello 与能力表达方式，不能逐条照抄 OSPF 的邻居状态机。

双方至少需要具备：

- 可以互相交付相应控制 PDU 的链路；
- 兼容的电路类型与 Level；
- 需要时匹配的区域地址；
- 无冲突的系统身份；
- 相应的认证、支持协议与接口条件。

### 4.1 点到点三次握手确认的是双向可见性

三次握手扩展在 Hello 中携带邻接状态、系统和电路身份等，使双方能够确认对方所看到的连接与自己一致。Down、Initializing、Up 是这个机制中的状态，而不是 OSPF 的 ExStart、Exchange、Full。

它解决的是邻接建立中的确认问题，不保证 LSDB 已经同步、所有前缀可达或数据面已安装。机制见 [RFC 5303](https://www.rfc-editor.org/rfc/rfc5303.html)。

### 4.2 Hold Time 与 MTU 为什么也影响结果

接收端根据收到的 Holding Time 维护邻居超时。不同发送间隔和保持时间可以形成不同方向的检测预算，不应把“Hello/Dead 两端必须完全一致”的 OSPF 记忆直接套进全部 IS-IS 场景。

Hello Padding 会影响控制报文尺寸，LSP 也可能比小 Hello 大。链路只允许小 PDU 通过时，可能出现邻接不稳定，或邻接可见但较大状态无法可靠同步。

关闭 Padding 即使改变了现象，也不等于修复了承载尺寸；应继续确认 LSP MTU 和端到端控制交付条件。相关实现选项见 [FRR IS-IS 文档](https://docs.frrouting.org/en/latest/isisd.html)。

## 5. DIS 与伪节点为什么存在

多访问网段上有 N 台路由器时，在拓扑图中表达所有两两连接会很繁琐。IS-IS 用 Pseudonode（伪节点）代表这份共享网段，并由 DIS（Designated Intermediate System，指定中间系统）发布相应伪节点 LSP。

```text
实际共享以太网：A、B、C、D 接在同一 LAN
拓扑表达：     A、B、C、D 分别连接一个代表该 LAN 的伪节点
```

伪节点是拓扑建模对象，不是多加了一台需要转发全部业务的虚拟路由器。

### 5.1 DIS 与 OSPF DR 的关键不同

基本 LAN 模型按相应 Level 选举 DIS，先比较接口优先级，再用 SNPA 等仲裁；以太网上 SNPA 对应相应 MAC 身份。选举具有抢占性，没有 OSPF BDR 那样的固定备份角色。

LAN 上其他合格 IS-IS 邻居仍可形成相应邻接，不应套用“两个 DROther 保持 OSPF 2-Way”的规则。DIS 还帮助维护数据库一致性，但业务不因此都必须先经过 DIS。伪节点和选举机制见 [Cisco IS-IS Pseudonode 说明](https://www.cisco.com/c/en/us/support/docs/ip/integrated-intermediate-system-to-intermediate-system-is-is/49627-DIS-LSP-1.html)。

点到点电路不需要用伪节点表达一个共享 LAN，也不选举这个 LAN DIS。

## 6. LSP、CSNP、PSNP 如何让数据库收敛

| PDU | 可以先怎样理解 | 不是什么 |
| --- | --- | --- |
| IIH | 邻居发现与存活信息 | 整份路由表 |
| LSP | 本系统或伪节点的状态内容 | MPLS 标签路径 |
| CSNP | 某个标识范围内的完整状态摘要清单 | 所有完整 LSP 内容的简单拼包 |
| PSNP | 部分状态条目的请求/确认信息 | 一份 SPF 计算结果 |

CSNP 中的标识、序号、校验和等使设备发现缺失或陈旧内容，再通过请求与 LSP 交付补齐。不同电路类型的确认和发送周期不同：点到点链路的确认、LAN DIS 的周期摘要不能当成所有接口完全相同的定时循环。

### 6.1 一个 LSP 的身份与新旧

常见输出可用下列示意阅读：

```text
0000.0000.0001.00-00
```

其中 `0000.0000.0001` 为 System ID，随后的 `.00` 是 Pseudonode ID（伪节点标识），最后的 `-00` 是 Fragment ID（分片标识）。

相应 Level 数据库中，LSP ID 定位对象，序列号、校验和与 Remaining Lifetime 等帮助判断版本和有效性。非零伪节点部分表示相应伪节点身份，不能把末尾所有数字都读成“第几条 IP 路由”。

内容太多时可以使用多个 LSP Fragment。这里的 Fragment 是状态内容的拆分身份，不是把一个客户 IPv4 包做 IP 分片；日志中的 LSP ID、序号和 Fragment 示例见 [Juniper IS-IS 详细跟踪说明](https://www.juniper.net/documentation/us/en/software/junos/is-is/bgp/topics/task/isis-tracing-displaying.html)。

### 6.2 从一次链路变化推导后续事件

1. A 发现到 B 的连接状态发生变化。
2. A 更新自己负责的相关 LSP，并使用新的版本信息。
3. 其他设备按相应 Level 接收、比较、保存与继续泛洪。
4. 需要的设备触发 SPF 或相应增量处理。
5. 协议结果提交系统 RIB，再更新 FIB 和下一跳。

发送一次更新不保证所有设备同时完成第 5 步。邻接、数据库、路径与硬件安装之间可能存在不同的时间窗口。

没有拓扑变化也仍需刷新和老化维护；过期状态需要退出数据库。不能把“只在拓扑变化时发送任何东西”当作链路状态协议的完整行为。

## 7. TLV、SPF 与度量

TLV 是 Type-Length-Value（类型、长度、值）的编码方式。IS-IS 可以在相应 PDU 中携带链路、IP 前缀、认证与能力等不同信息，而不把所有新功能都硬塞进一组不可变的固定字段。

支持 TLV 扩展不代表设备自动支持全部新功能：它可能保存、忽略或无法用于计算某类信息，具体由该扩展和实现决定。

### 7.1 SPF 算的是拓扑代价，不是实时延迟

假设从 A 到 D 有两条候选，相关方向 Cost 为：

```text
A→B→D：10 + 10 = 20
A→C→D： 5 + 30 = 35
```

在候选资格相同且未引入其他约束的情况下，A 倾向 B 路径；每台路由器分别从自己的位置计算。Cost 是协议度量，不证明 B 路径的 RTT 更低或当下更空闲。

IS-IS 的接口度量不能按“所有平台自动由带宽计算”来理解。应检查实际配置与默认规则；更改物理速率不一定同步改变路径偏好。

### 7.2 Wide Metric 为什么重要

早期窄度量的表达空间有限。扩展 IS 可达性和扩展 IP 可达性引入更大度量范围与子 TLV，支持更丰富的拓扑及流量工程信息；其中链路度量与前缀度量字段也不是同一位数。

迁移时要考虑双方发布和接受哪些格式，而不是一侧切到 Wide 后就认为全网具备相同计算输入。度量与扩展结构见 [RFC 5305](https://www.rfc-editor.org/rfc/rfc5305.html)。

## 8. 跨层路由、ATT 与 Up/Down

在基本分层模型中，L1/L2 设备可以将相应 L1 可达信息向 L2 表达。L1 设备则可利用带 Attached 信息的合适 L1/L2 设备作为区域外出口，而不是默认接收全部 L2 明细。

### 8.1 最近出口不一定是整个端到端最短路径

假设 A 到两个出口 R1、R2 的区域内代价分别为 10、30，出口到目标的外部部分分别为 100、20。只根据最近出口，A 会偏向 R1；若具有完整适用信息，两段代价对照却是 110 与 50。

这个算例说明层次隐藏信息会改变选择范围，不是说基础协议算错了。需要更明确的目的可达信息时，可以按策略把合适的 L2 路由下泄到 L1，同时控制状态规模。

### 8.2 Up/Down 防止下泄路由被反向回灌

从更高层泄漏下来的前缀需要带上相应标志，避免另一边界设备再把它误当作新 L1 来源传回 L2，造成回路或错误路径。路由泄漏是一项有约束的传播机制，不是把两个数据库全部互相复制。解释见 [Cisco IS-IS Route Leaking](https://www.cisco.com/c/en/us/support/docs/ip/integrated-intermediate-system-to-intermediate-system-is-is/13796-route-leak.html)。

ATT 的设置条件、缺省路由生成与重分发策略应结合实际实现理解。手工强制“我有区域外出口”，若没有真实承载能力，仍可能产生黑洞。

## 9. Overload Bit 为什么不等于设备完全不可达

Overload Bit 用于表达相应拓扑计算中的过载/避免中转状态。其他路由器通常应避免把该节点作为中转，但仍可能访问它直接附着的前缀；不是简单删除这台路由器的一切身份与邻接。

设备刚启动、控制面还在收敛时，也可以利用相应机制避免过早吸引中转流量。具体是否继续传播跨层或外部前缀、如何结束启动保护，需要单独检查。边界见 [Cisco Overload Bit 说明](https://www.cisco.com/c/en/us/support/docs/ip/integrated-intermediate-system-to-intermediate-system-is-is/24509-set-overload-bit.html)。

它也不负责像 QoS 一样测量并解决每条链路的瞬时排队。名称里有 Overload，不代表默认跟着接口利用率自动调度业务。

## 10. IPv6 与 Multi-Topology

IPv6 可达性通过相应扩展 TLV 表达，不需要把 IS-IS 邻接转换成依赖 IPv6 地址传输的 TCP 会话。相关前缀和接口地址机制见 [RFC 5308](https://www.rfc-editor.org/rfc/rfc5308.html)。

若 IPv4 与 IPv6 并不使用完全相同的链路集合，只用一个公共拓扑计算可能让某地址族获得无法真正交付的路径。Multi-Topology 让相应拓扑具有独立的链路/前缀参与关系与计算上下文，见 [RFC 5120](https://www.rfc-editor.org/rfc/rfc5120.html)。

Multi-Topology 不等于 VRF。前者主要区分拓扑计算视图，后者区分转发表及业务上下文；也不应与后续 Segment Routing 的 SID 或 Flex-Algo 直接画等号。

## 11. 从现象定位到协议对象

| 现象 | 优先解释哪一层 |
| --- | --- |
| 没有邻接 | 链路层交付、Level/区域条件、系统身份、认证 |
| 邻接可见但 LSDB 不收敛 | LSP 版本、尺寸、泛洪、摘要和请求/确认 |
| LSDB 有对象但无协议路由 | 拓扑可达、前缀与地址族、度量、OL/跨层资格 |
| 协议有路由但系统 RIB 不选它 | 其他路由来源与本地选择规则 |
| RIB 正常但业务不通 | FIB 安装、邻居解析、MTU、策略与返回方向 |

认证也要分 Hello 与相应层级的数据库 PDU 等作用范围。保护邻接不等于为业务数据加密；密钥和算法协商不匹配会影响协议交付。认证扩展可参见 [RFC 5310](https://www.rfc-editor.org/rfc/rfc5310.html)。

## 12. 思考与解答

**IS-IS 不使用 IP 承载，为什么可以发布 IPv4/IPv6 路由？**

控制 PDU 的承载方式与其中描述的可达信息是两回事。TLV 可以携带 IP 信息，计算结果仍进入普通 IP 路由与转发系统。

**两台路由器区域地址不同，是否一定不能建立 IS-IS 邻接？**

不是。L1 需要相应区域匹配，L2 不要求区域相同；但 Level、链路、身份和认证等其他条件仍需成立。

**DIS 故障后一定由预先选好的 Backup DIS 接管吗？**

不是。基本 IS-IS LAN 机制没有 OSPF BDR 式固定备份角色，DIS 按对应选举机制更新。

**LSP Fragment 就是 IP 分片吗？**

不是。它用于拆分与标识链路状态内容，不是客户 IP 报文在网络层分片。

**邻接 Up 就等价于 OSPF Full 并保证全部路由安装吗？**

不能这样对应。要继续确认数据库同步、路径计算与系统安装，不能只按一个状态名称跳过后续阶段。

**设置 Overload Bit 后，为什么这台路由器的 Loopback 还可能可达？**

避免中转不等于禁止到达该节点或其相应附着前缀。具体跨层和外部通告还要看策略。

**L1 默认选择最近出口，为什么不保证到每个外部前缀都最短？**

它可能没有外部每段路径的明细。按区域内出口代价做出的选择，不等于掌握端到端全部代价后的选择。

## 13. 继续阅读

IS-IS 可以为 [数据中心 Underlay](../datacenter/02-Underlay路由设计与收敛.md) 提供承载可达性，也可以传播 Segment Routing 所需的拓扑与 SID 信息。下一篇进入 [SR-MPLS 与 SRv6](./13-Segment-Routing-SR-MPLS与SRv6.md)，区分“学到网络状态”和“让一个包按指定指令序列转发”。
