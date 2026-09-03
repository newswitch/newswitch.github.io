---
title: "BGP 原理、策略与双出口实验"
sidebar_label: "07. BGP 原理、策略与双出口实验"
sidebar_position: 7
description: "从 AS、会话、地址族和 RIB 数据流理解 BGP，深入下一跳递归、选路属性、RR、策略刷新、路由安全和双出口。"
tags: [BGP, eBGP, iBGP, Route Policy, 双出口, FRRouting]
date: 2026-02-19 12:00:00
categories: 网络
---

# BGP 原理、策略与双出口实验

本文在完成 IP 路由和 OSPF 基础之后学习。目标不是死记某个厂商的选路表，而是理解：

- BGP 为什么用 TCP 建立会话，却仍需要底层路由可达。
- Adj-RIB-In、Loc-RIB、Adj-RIB-Out、主 RIB 和 FIB 如何衔接。
- Local Preference、AS_PATH、MED、Community 等属性分别影响哪个范围。
- 如何用策略实现双出口，而不是只修改一个“优先级数字”。

## 1. BGP 核心原理

> 本文原有实验使用华为风格 CLI，保留它用于理解策略语义。命令、默认属性和
> 最佳路径细节会因实现与版本而异；在生产环境必须以目标设备文档和实际
> `show/display` 输出为准。

### 1.1 BGP 的概念 {/* #一bgp-的概念 */}

BGP（边界网关协议）是路径矢量协议：通告的不只是“某前缀可达”，还有 AS 路径、下一跳和策略属性。它被用于互联网、数据中心与 VPN 等网络，并不要求经过公网。

#### 1.1.1 自治系统（AS）与 AS 号 {/* #01-自治系统as与-as-号 */}

自治系统（AS）是按统一对外路由策略组织的网络。ASN 是其路由身份，不等于企业名称、区域号或路由器数量；现代 BGP 支持四字节 ASN，不能把两字节写成不变的默认限制。

| 范围或值 | 含义 |
| --- | --- |
| 64512～65534 | 两字节范围内的私有 ASN |
| 4200000000～4294967294 | 四字节私有 ASN 范围 |
| 64496～64511、65536～65551 | 文档与示例范围 |
| 0、65535、4294967295 等 | 特殊保留，不能按普通私有 ASN 使用 |
| 23456 | AS_TRANS，参与旧能力互操作，不是普通私有编号 |

不能将上述特殊值之外的所有号码直接概括为“都已分配的公网 ASN”。分配与保留状态以 [IANA ASN 注册表](https://www.iana.org/assignments/as-numbers)和[特殊用途表](https://www.iana.org/assignments/iana-as-numbers-special-registry)为准。私有 ASN 可在受控网络内复用，但跨公共路由边界应避免泄漏和身份冲突。

#### 1.1.2 动态路由分类 {/* #02-动态路由分类 */}

动态路由协议有很多分类方法，按自治系统分类、按协议类型分类是最常用的两种。

**按自治系统分类：**

- **IGP**（内部网关路由协议）：如 RIP、OSPF、IS-IS，常用于组织内部可达与拓扑计算。
- **EGP**（外部网关路由协议）：通常指 BGP，运行在 AS 之间，用于控制路由传播与最优路由选择。

常见骨干用 IGP 保证路由器与 BGP 下一跳可达，用 BGP 承载业务或外部前缀。这不要求把所有 IGP 路由都重分发给 BGP，更不要求把完整互联网表注入 IGP。两者可以服务于不同的规模和策略目标。

#### 1.1.3 BGP 的特征 {/* #03-bgp-的特征 */}

- 通过 eBGP 在 AS 之间交换信息，也通过 iBGP 在 AS 内传播相应路由
- **路径矢量**（Path-Vector）协议，通过 AS_PATH 防环，区别于距离矢量/链路状态
- 常规对等连接基于 TCP，监听端口为 179；TCP 有序传输不等于整网同时完成收敛
- 属性与输入／输出策略共同决定路径，具体完整比较顺序依实现而定
- AS_PATH 与 iBGP/RR 等传播规则分别约束不同范围的环路；不保证每个瞬时数据路径或每种错误策略都无环
- 为路由附带多种属性；支持 **CIDR**
- 通常增量通告变化，不周期洪泛整张路由表；会话初始化、路由刷新和扩展也可能重新发送路由。Keepalive 与 Hold Timer 维护 BGP 活性，具体间隔不是协议固定的 60 秒

距离矢量常交换到目的的距离信息，链路状态描述拓扑，BGP 则在可达信息中携带路径及策略属性。AS_PATH 长度并不代表链路带宽、地理距离或 RTT。[RFC 4271](https://www.rfc-editor.org/rfc/rfc4271.html) 定义了 BGP 的基础模型。

### 1.2 BGP 的工作原理 {/* #二bgp-的工作原理 */}

BGP 按对等体交换路由。正常会话是持续更新的前提，但会话 Established 后仍需地址族、输入策略、有效下一跳和转发安装配合。

#### 1.2.1 BGP 邻居关系 {/* #01-bgp-邻居关系 */}

运行 BGP 的实体称为 Speaker，互相交换信息的端点称为 Peer（对等体）。学习时应将会话状态机、报文与路由处理分开，不把某份资料列出的“几个表”当成所有软件固定的内部实现。

**（1）BGP 报文类型**

- **Open**：与对等体建立邻接，建连后首包，携带版本、AS、Holdtime 等
- **KeepAlive**：维护 BGP 活性，不是 TCP Keepalive；周期和 Hold Timer 有关
- **Update**：传递路由信息，用于通告或撤销路由
- **Notification**：报告相应错误并终止会话；后续扩展对部分 UPDATE 错误有更细粒度处理
- **Route-Refresh**：请求对端重新通告指定地址族的路由，不是宣告自己支持刷新；支持能力在 OPEN 中协商，见 [RFC 2918](https://www.rfc-editor.org/rfc/rfc2918.html)

协商后的 Hold Time 通常取双方提议中的较小值，合法取值与禁用语义受协议约束；收到相应有效 UPDATE 或 KEEPALIVE 会维持接收侧计时。Hold Time 为 0 时不使用相应 Hold/Keepalive 计时，不能套用“所有 BGP 必须每分钟有心跳”。

**（2）BGP 状态机**

- **Idle**：初始状态，等待启动事件；收到后发起 TCP，进入 Connect
- **Connect**：发起 TCP；成功→OpenSent，失败→Active
- **Active**：持续尝试 TCP；成功→OpenSent，超时回 Connect
- **OpenSent**：已发 Open，等待对端 Open 并校验；无误发 KeepAlive→OpenConfirm，有误发 Notification→Idle
- **OpenConfirm**：等待 KeepAlive；收到→**Established**
- **Established**：邻居建立，交换 Update，复位 Hold 计时器

这是主干过程，不是全部事件转换。重试、连接冲突和特定错误有不同处理；Active 在这里表示尝试建立传输，不是“已经活动可用”。

**（3）BGP 路由信息处理（RIB）**

概念上，**Adj-RIB-In** 表示从各对等体获得的输入信息；经过输入策略和决策后，选中的 BGP 路径进入 **Loc-RIB**；针对每个对等体应用传播规则与输出策略，形成 **Adj-RIB-Out**。

BGP 还要把候选提交给系统主 RIB，后者处理不同来源与安装条件，再下发 FIB。实现不一定按这三个概念保存三份完整物理副本，命令里的 received/accepted/advertised 也可能对应不同阶段。

**（4）BGP 邻居关系类型**

- **IBGP**：同一 AS 内 BGP 对等体之间的邻居关系。
- **EBGP**：不同 AS 之间 BGP 对等体的邻居关系。

**建邻要点**：基础 BGP 不像 OSPF 那样用 Hello 发现邻居，常规会话需要明确的对等关系与可达端点。产品可提供动态邻居、接口邻居等扩展，不能一概说每个地址都必须逐条手填。

**常见建邻失败原因**：到 Peer 的路径、源地址、TTL/GTSM、TCP 认证、对端 AS 与过滤策略不符。Idle 并不唯一证明缺路由。还要区分“用于建立 TCP 的路由”和“用于解析业务 NEXT_HOP 的路由”；默认路由是否可参与特定递归由实现和配置决定，不应推广为所有设备的统一限制。

#### 1.2.2 通告 BGP 路由的方法 {/* #02-通告-bgp-路由的方法 */}

BGP 可以从对等体学习路由，也可以本地始发、重分发或聚合路由。下面两种是常见本地注入方式，不是全部路由来源。

（1）network方式：

许多实现中的 BGP `network` 按明确前缀始发路由，通常还检查系统 RIB 中是否存在精确匹配，具体开关依产品而定。它与 OSPF `network` 选择哪些接口参与区域的语义不同，也不会自动扫描前缀里有哪些服务器真实在线。

（2）Import方式：

重分发把指定来源的候选按策略转入 BGP，例如直连、静态或某个 IGP 的路由。需要明确前缀白名单、属性和回灌防护；把同一路由在多个协议边界来回引入，可能造成反馈、错误优先级和路由泄漏。

#### 1.2.3 BGP 路由通告原则 {/* #03-bgp-路由通告原则 */}

- 基础模型通常选择最佳路径供通告；Multipath、Add-Path 等分别扩展本地多路径安装与多路径通告，不能据此断言永远只有一条路径
- **从 eBGP 学到的路由**：可按资格与策略传播给其他合适对等体，不是向所有邻居无条件发送；向 eBGP 通告通常改 NEXT_HOP，第三方下一跳等情况另有规则，向 iBGP 转发通常保留原值
- **从 iBGP 学到的路由**：普通 iBGP Speaker 不再转给另一普通 iBGP Peer；向 eBGP 输出仍要满足策略和其他资格，RR／联盟提供特定扩展
- 让所有 IBGP 都能收到某条路由的三种方式：**全互联**、**RR（路由反射器）**、**联盟**

历史 BGP/IGP Synchronization 规则针对部分内部转发设备不运行 BGP 的旧架构。现代设计通常通过完整承载路径、BGP 或隧道解决交付，不应为了“同步”把全量外部路由复制进 IGP；旧功能支持与默认值应按版本核对。

#### 1.2.4 更新源建立邻居关系 {/* #04-更新源建立邻居关系 */}

使用 Loopback 作为会话端点，可以把对等身份与某一条物理接口解耦。只要替代路径及时恢复可达且连接未超时，单链路故障未必导致 BGP 会话重建；这不是“设备运行时 Loopback 就永远可达”的保证。更新源指定本地连接源地址，还要保证对端的 Peer 配置、路由和传输保护匹配。

![BGP](/images/传统组网（一）/BGP-1.png)

如在上图中，三个路由器同在AS 100区域中，若R1和R3要使用更新源建立邻居关系，那么配置如下：

R1路由器：

```text
[R1]bgp 100
[R1-bgp]router-id 1.1.1.1
[R1-bgp]peer 3.3.3.3 as-number 100
[R1-bgp]peer 3.3.3.3 connect-interface LoopBack0
```

R3路由器（相关命令解释参考R1路由器的配置）：

```text
[R3]bgp 100
[R3-bgp]router-id 3.3.3.3
[R3-bgp]peer 1.1.1.1 as-number 100
[R3-bgp]peer 1.1.1.1 connect-interface LoopBack0
```

注意：双方 Loopback 需要有相应路由和传输可达性。Ping 只是 ICMP 样本，既不是 BGP 成功的充分条件，也不是必须放行 ICMP 才能建立 TCP 的要求。

#### 1.2.5 保证 IBGP 下一跳可达 {/* #05-保证-ibgp-下一跳可达 */}

边界设备把外部路由传播给内部设备时，通常保留外部 NEXT_HOP。内部设备可能能到达边界设备的 BGP 会话地址，却不知道怎么到达这个外部下一跳；这就是会话正常、业务路径无效的一类原因。

![BGP](/images/传统组网（一）/BGP-2.png)

图中 A～J 代表接口地址。若内部路由器缺少到外部连接网段的可达信息，保留下来的 NEXT_HOP 并不一定是协议写错，而是本地无法解析。可以按架构传播必要的承载可达性，或让合适的边界设备向内部通告自己为下一跳。后一种方式要求边界设备确实能够继续交付业务；不能让不参与转发的 RR 随意把自己变成下一跳。请求与回复方向需要分别建立这条依赖。

配置如下（就拿一个路由器来举例，前三条配置命令的解释可以参考上面的注释，主要是最后一条命令，来改变路由的下一跳）：

```text
[R3]bgp 200
[R3-bgp]router-id 3.3.3.3
[R3-bgp]peer 34.1.1.4 as-number 200
[R3-bgp]peer 34.1.1.4 next-hop-local
```

#### 1.2.6 EBGP 多跳 {/* #06-ebgp-多跳 */}

常见直接 eBGP 模式使用较小 TTL 并可能带直连检查；非直连对等体需要匹配的多跳或其他平台机制。提高 TTL 只改变允许跨越的三层路径范围，不创建路由，也不完成身份认证。TTL Security/GTSM 则按另一种发送与接收校验模型保护邻接，不能将它与简单放大 TTL 混用。

![BGP](/images/传统组网（一）/BGP-3.png)

配置上图中的R3路由器多跳（R1路由器也需要进行类似的配置，进而改变TTL值，这里只拿R3为例）：

R3 配置如下：

```text
[R3]bgp 200
[R3-bgp]router-id 3.3.3.3
[R3-bgp]peer 12.0.0.1 as-number 100
[R3-bgp]peer 12.0.0.1 ebgp-max-hop 2   # 跳数为 2，即 TTL=2
```

#### 1.2.7 控制 BGP 选路 {/* #07-控制-bgp-选路 */}

BGP 协议包含很多路由属性，这些属性可以非常灵活的控制BGP的选路。

**属性四类**：公认必遵（Origin、AS_Path、Next_Hop）→ 公认任意（Local_Pref、Atomic-Aggregate 等）→ 可选过渡（Community、Aggregator 等）→ 可选非过渡（MED、Originator-ID、Cluster-List）。不识别时：过渡属性可转给邻居；非过渡属性丢弃不转发。

**常用属性简述**：

- **ORIGIN**：IGP、EGP、INCOMPLETE 三种编码，在该比较步骤中通常按此顺序偏好；IGP 编码不证明前缀实际来自 OSPF，EGP 编码也不是“由 eBGP 学到”的意思。
- **AS_PATH**：路径向量及 AS 级防环依据，普通接收规则拒绝包含自身 ASN 的路径，特定受控功能存在例外。AS_SET 与 AS_CONFED_SET 已被弃用，不能再将生成无序集合写成通用汇总建议，见 [RFC 9774](https://www.rfc-editor.org/rfc/rfc9774.html)。
- **NEXT_HOP**：业务转发需要解析到的下一跳，不必等于发送 UPDATE 的对等体地址；默认改写及扩展行为需按传播场景区分。
- **LOCAL_PREF**：在本 AS 内表达路径偏好，通常高者更优，常见默认值为 100；普通 eBGP 不向外部邻居传播它。
- **MED**：向相邻 AS 提供进入本 AS 的出口偏好线索，通常低者更优，常见规则只在同一相邻 AS 来源间比较。它可在接收 AS 内传播，但不能无条件转送给另一个外部 AS。缺失 MED 的处理及比较范围依实现和配置而定。
- **Community**：策略标签。标准、扩展和 Large Community 是不同编码体系；NO_EXPORT、NO_ADVERTISE 等具有约定语义，普通自定义标签只有被策略解释后才产生效果。

![BGP](/images/传统组网（一）/BGP-4.png) ![BGP](/images/传统组网（一）/BGP-5.png) ![BGP](/images/传统组网（一）/BGP-6.png) ![BGP](/images/传统组网（一）/BGP-7.png)

#### 1.2.8 选路不是全行业固定的十二步 {/* #08-bgp-选路规则12-条顺序 */}

先排除不合格路径，再按本实现的政策和比较顺序，为同一 NLRI 选择路径。常见比较因素包括本地偏好、LOCAL_PREF、是否本地始发、AS_PATH、ORIGIN、适用范围内的 MED、eBGP/iBGP、下一跳 IGP 代价与末尾仲裁。

Weight、PrefVal 等是本地扩展，不是所有设备都会收到的标准 BGP 属性；MED 比较、路由年龄、RR 属性和多路径条件也会影响具体顺序。因此应说明当前两个候选最先在哪个有效比较条件上分出高下，而不是背诵一份跨产品不成立的十二步列表。一个具体实现可对照 [FRR 路径选择说明](https://docs.frrouting.org/en/latest/bgp.html#route-selection)。

例如同一前缀有两条可用路径：A 的 LOCAL_PREF 为 200、AS_PATH 长度为 4，B 的 LOCAL_PREF 为 100、长度为 1。若此前没有其他条件分出胜负，通常 A 因本 AS 策略偏好获选，不会继续让 B 的短 AS_PATH 推翻它。

若另一条路由是更具体前缀，它属于另一个选路对象；FIB 里的最长前缀匹配不是 BGP 对同一 NLRI 的属性比较步骤。

#### 1.2.9 汇总、过滤与进阶（提要） {/* #09-汇总过滤与进阶提要 */}

**路由汇总**：用较短前缀表达多个可达范围，以减少通告；始发条件、明细抑制、属性继承和本地丢弃路由由具体策略决定。汇总依旧存在时，某条明细的消失可能被隐藏，流量到达汇总节点后仍然无处交付。ATOMIC_AGGREGATE 表示相应聚合信息边界，不是“所有抑制明细操作必然生成相同属性”的保证。

**路由过滤**：`peer x ip-prefix xx import`、`peer x filter-policy xx import`、`peer x as-path-filter xx import`（as-path-filter 用正则匹配 AS_PATH）。

**路由反射器（RR）**：在资格和策略允许时，把来自 Client 的路由反射给其他 Client 与 Non-Client，把来自 Non-Client 的路由反射给 Client；不会借此无条件向其他 Non-Client 再反射。对 eBGP 的通告仍按相应规则处理。ORIGINATOR_ID 与 CLUSTER_LIST 用于反射防环，RR 之间的连接关系需要按层次和冗余设计，不能一律要求或认定任意两台 RR 必须全互联。

**联盟**：将一个对外 AS 组织成多个成员 AS，成员之间采用具有特殊传播规则的会话，对外隐藏内部成员路径。NEXT_HOP、LOCAL_PREF、MED 等处理与普通跨企业 eBGP 不同；显示括号只是工具表示法，不是线上的报文格式。

**默认路由**：对 peer 通告默认、network/import 默认路由、`default-route imported`。

**四字节 ASN 互操作**：能力协商和 AS4_PATH／AS4_AGGREGATOR 等机制用于兼容旧 Speaker，AS_TRANS 是相应过渡表示。现代全能力网络中，不应只看 OPEN 的旧字段或一段工具输出就把四字节 ASN 错判成非法值。

#### 1.2.10 AFI/SAFI 与下一跳递归 {/* #地址族与下一跳递归 */}

AFI（Address Family Identifier，地址族标识符）标识地址族，SAFI（Subsequent Address Family Identifier，后续地址族标识符）进一步区分路由语义，例如单播、VPN 或 EVPN 等。两者组合决定当前交换哪类路由信息。

NLRI（Network Layer Reachability Information，网络层可达性信息）描述所通告的前缀或对象。MP-BGP 用相应扩展承载不同 NLRI 和下一跳；会话 Established，不意味着两端已经为所有地址族达成能力并交换前缀。

```text
对等体 TCP 地址：UPDATE 从谁那里来
NLRI：这份通告描述哪个前缀／对象
NEXT_HOP：业务需要向哪里继续交付
递归结果：最终使用哪个出接口和承载下一跳
```

例如 RR 的 Loopback 可达，表示控制消息能到 RR；RR 通告的业务下一跳可能是某台 PE。还必须有到该 PE 的有效承载路径，才能把业务送到正确出口。VPN 场景还要解析对应传输标签或隧道，不只是查一条普通默认路由。

#### 1.2.11 RR 为什么可能隐藏候选路径 {/* #路由反射与路径隐藏 */}

普通 iBGP 全互联的会话数随设备数呈平方增长，RR 通过特定传播规则减轻会话压力，但 RR 看到的最佳出口不一定是每个客户端从自己位置看见的最佳出口。

如果 RR 只通告它选中的一条路径，客户端即使有更靠近另一出口的承载拓扑，也可能看不到另一候选，这就是 Path Hiding 的一类表现。RR 改变的是路由信息可见性，不一定处于业务转发路径。反射机制见 [RFC 4456](https://www.rfc-editor.org/rfc/rfc4456.html)。

要区分三种能力：

| 能力 | 改变的对象 |
| --- | --- |
| BGP Multipath | 本机是否向转发表安装多条符合条件的路径 |
| Add-Path | 是否能向对等体通告同一前缀的多条路径，需协商并选择发送策略 |
| 面向客户端优化的反射 | RR 是否按客户端视角等机制改善出口选择 |

开启 Add-Path 不等于对端一定安装 ECMP，更不保证所有路径都被无条件通告。它也增加状态与更新规模，见 [RFC 7911](https://www.rfc-editor.org/rfc/rfc7911.html)。

#### 1.2.12 策略刷新与会话重建 {/* #策略刷新与会话重建 */}

输入策略改变后，需要对已经收到的候选重新计算。实现可以使用保留的输入信息重评估，或在能力支持时请求对端 Route Refresh。出方向策略改变则需要重新形成对该邻居的通告。

这与直接关闭 TCP、清理路由再重建会话不同。保存完整输入副本消耗内存，刷新重放会增加更新工作量；增强刷新还可标记重放的开始与结束，见 [RFC 7313](https://www.rfc-editor.org/rfc/rfc7313.html)。不能将所有策略变更都解释为必须硬重置全部邻居。

#### 1.2.13 Graceful Restart 与过期路由 {/* #gr与过期路由 */}

GR（Graceful Restart）允许对等体在符合能力与条件时，暂时保留重启节点的部分路由，等待控制面恢复，以减少转发表确实仍可工作的重启中断。

它依赖“相关转发能力在重启中继续成立”的条件，不是通用的故障免疫。若节点已经断电或数据面失效，保留旧路由反而可能延长黑洞。GR、BFD、路由撤销和 End-of-RIB 等事件需要按实现及协商关系理解，见 [RFC 4724](https://www.rfc-editor.org/rfc/rfc4724.html)。

#### 1.2.14 通告合法性、路由泄漏与 RPKI {/* #路由安全与rpki */}

输入／输出策略决定哪些前缀可以通过特定关系传播。最大前缀数约束的是规模，不知道每一条前缀是否越权；只设置告警也不会自动阻断更新。明确进出口策略的基础原则见 [RFC 8212](https://www.rfc-editor.org/rfc/rfc8212.html)。

RPKI Origin Validation 使用经过验证的授权数据，检查路由的起源 ASN 和前缀长度是否满足相应授权：

- **Valid**：有覆盖该前缀且允许相应长度及起源 ASN 的授权。
- **Invalid**：存在覆盖授权，但没有一条满足此次起源和长度条件。
- **NotFound**：没有相应覆盖授权，不能直接等同于 Invalid。

ROA 的 `maxLength` 约束允许始发的更具体长度。比如授权 AS 64496 始发某 `/24` 且最大长度为 `/24`，该 AS 再通告其中 `/25`，也不会因为起源 ASN 相同就变成 Valid。

起源验证不校验完整 AS_PATH，不证明商业传播关系正确，也不检测全部路由泄漏。有效性状态是否影响接收需要本地策略；见 [RFC 6811](https://www.rfc-editor.org/rfc/rfc6811.html)。

### 1.3 BGP 的配置实例 {/* #三bgp-的配置实例 */}

下面保留原有隔离实验，便于对照属性与设备输出。示例中的地址和 ASN 只属于该实验拓扑，不代表可在公网使用；策略结果也受初始配置和设备版本影响。

其中硬重置全部 BGP、无过滤重分发和人为追加任意 ASN 的写法不能作为生产模板。需要变更时应按支持能力选择有边界的策略重评估，实际 AS_PATH 处理应遵循合法的自治系统身份。

![BGP](/images/传统组网（一）/BGP-8.png)

#### 1.3.1 需求如下 {/* #01-需求如下 */}

1. AS 200 内部使用 OSPF 协议使 AS 200 内部互通，并在AS 200内部各个路由器上都运行BGP协议（R1和R2、R3建立邻居关系，R4和R2、R3及R5建立邻居关系，），各个AS之间运行BGP协议。

2. 分别在 R1 和 R5 使用 BGP 协议宣告 21.0.0.0/24 和 20.0.0.0/24，使所有路由器学到这两条路由信息
3. 通过 BGP 的属性控制选路，实现 PC1→R1→R2→R4→R5→PC2→R5→R4→R3→R2→R1→PC1 的路由通信，并测试多种控制选路方法
4. 在 R2、R3 和 R4 上分别向 BGP 注入本地 OSPF 路由，使全网互通（满足第 3 点选路要求并不代表 PC1 能 ping 通所有设备，如 R2）
5. 为演示 EBGP 多跳，尝试让 R1 与 R4 直接建立对等体关系

#### 1.3.2 开始配置 {/* #02-开始配置 */}

1. 自行配置各 PC、路由器物理接口及 loopback 的 IP（此处仅给出路由器 IP 配置参考）：

```text
<R1>sys

[R1]in g0/0/0

[R1-GigabitEthernet0/0/0]ip add 12.1.1.1 24

[R1-GigabitEthernet0/0/0]int loop 0

[R1-LoopBack0]ip add 1.1.1.1 32
```

2. 配置 AS 200 内部的 OSPF 路由协议。

**R2 配置示例：**

```text
[R2]ospf 1
[R2-ospf-1]area 0
[R2-ospf-1-area-0.0.0.0]net 2.2.2.2 0.0.0.0
[R2-ospf-1-area-0.0.0.0]net 12.1.1.0 0.0.0.255
[R2-ospf-1-area-0.0.0.0]net 24.1.1.0 0.0.0.255
```

**R3、R4** 类似，仅将 `net` 改为各自 loopback 与直连网段即可。

3. 配置 BGP，建立邻居关系。

**R1 配置：**

```text
[R1]bgp 100

[R1-bgp]router-id 1.1.1.1

[R1-bgp]peer 12.1.1.2 as 200

[R1-bgp]peer 13.1.1.3 as 200

[R1-bgp]network 21.0.0.0 24
```

**R2 配置：**

```text
[R2]bgp 200

[R2-bgp]router-id 2.2.2.2

[R2-bgp]peer 12.1.1.1 as 100

[R2-bgp]peer 4.4.4.4 as 200

[R2-bgp]peer 4.4.4.4 connect-interface LoopBack 0

[R2-bgp]peer 4.4.4.4 next-hop-local
```

**R3 配置：**

```text
[R3]bgp 200

[R3-bgp]router-id 3.3.3.3

[R3-bgp]peer 13.1.1.1 as 100

[R3-bgp]peer 4.4.4.4 as 200

[R3-bgp]peer 4.4.4.4 connect-interface LoopBack 0

[R3-bgp]peer 4.4.4.4 next-hop-local
```

**R4 配置：**

```text
[R4]bgp 200

[R4-bgp]router-id 4.4.4.4

[R4-bgp]peer 2.2.2.2 as 200

[R4-bgp]peer 3.3.3.3 as 200

[R4-bgp]peer 2.2.2.2 next-hop-local

[R4-bgp]peer 3.3.3.3 next-hop-local

[R4-bgp]peer 2.2.2.2 connect-interface LoopBack 0

[R4-bgp]peer 3.3.3.3 connect-interface LoopBack 0

[R4-bgp]peer 45.1.1.5 as 300
```

**R5 配置：**

```text
[R5]bgp 300

[R5-bgp]router-id 5.5.5.5

[R5-bgp]peer 45.1.1.4 as 200

[R5-bgp]network 20.0.0.0 24
```

BGP 邻居建立后可用以下命令查看：

```text
[R1]dis bgp peer

 BGP local router ID : 1.1.1.1
 Local AS number : 100
 Total number of peers : 2        Peers in established state : 2

  Peer            V          AS  MsgRcvd  MsgSent  OutQ  Up/Down       State Pre
fRcv

  12.1.1.2        4         200        5        8     0 00:02:11 Established
   1
  13.1.1.3        4         200        7       10     0 00:04:34 Established    1
```

该实验的两端业务前缀完成双向通告和安装后，PC1 与 PC2 才具备相应可达路径。这不自动使所有路由器接口或管理地址可达；例如 R2 的某个接口前缀可能尚未向远端发布。

4. 第三个需求：通过 BGP 属性控制选路，实现 PC1→R1→R2→R4→R5→PC2→R5→R4→R3→R2→R1→PC1 的路径。先用 `tracert` 查看实际经过的路由器。

**PC1→PC2 路径示例：**

```text
PC>tracert 20.0.0.1
traceroute to 20.0.0.1, 8 hops max (ICMP), press Ctrl+C to stop
 1  21.0.0.254   <1 ms  16 ms  15 ms
 2  12.1.1.2   16 ms  15 ms  16 ms
 3  24.1.1.4   31 ms  32 ms  31 ms
 4  45.1.1.5   31 ms  47 ms  31 ms
 5  20.0.0.1   31 ms  32 ms
```

**PC2→PC1 路径示例：**

```text
PC>tracert 21.0.0.1

traceroute to 21.0.0.1, 8 hops max (ICMP), press Ctrl+C to stop
 1  20.0.0.254   15 ms  <1 ms  16 ms
 2  45.1.1.4   16 ms  31 ms  16 ms
 3  24.1.1.2   31 ms  31 ms  31 ms
 4  12.1.1.1   47 ms  16 ms  47 ms
 5  21.0.0.1   31 ms  31 ms  31 ms
```

下面通过三种方式配置选路：

**方法 1：修改 Local-Preference，使 R3 优先**

在 R3 上执行：

```text
[R3]route-policy lop permit node 10

Info: New Sequence of this List.

[R3-route-policy]apply local-preference 222

[R3-route-policy]quit

[R3]bgp 200

[R3-bgp]peer 4.4.4.4 route-policy lop export

[R3-bgp]quit

[R3]quit
<R3>reset bgp all
```

此时从 PC2 再 tracert PC1，路径会经 R3 而非 R2：

```text
PC>tracert 21.0.0.1
traceroute to 21.0.0.1, 8 hops max

(ICMP), press Ctrl+C to stop

 1  20.0.0.254   <1 ms  16 ms  16 ms
 2  45.1.1.4   15 ms  16 ms  31 ms
 3  34.1.1.3   31 ms  32 ms  31 ms
 4  13.1.1.1   47 ms  31 ms  47 ms
 5  21.0.0.1   47 ms  31 ms
```

**方法 2：使用 AS-PATH 控制选路**

为还原走 R2 的路径，先在 R3 上取消 Local-Preference 策略：

```text
[R3]bgp 200
[R3-bgp]undo peer 4.4.4.4 route-policy lop export
```

删除后稍等，可再 tracert 确认 PC2→PC1 是否恢复走 R2。

在 R2 上通过 AS-PATH 拉长路径（向 R4 通告 21.0.0.0 时附加虚造 AS，使 R4 认为经 R2 的路径更长，从而选 R3）：

**R2 配置：**

```text
[R2]route-policy as permit node 10

Info: New Sequence of this List.

[R2-route-policy]apply as-path 123 123 123 add

[R2-route-policy]quit

[R2]bgp 200

[R2-bgp]peer 4.4.4.4 route-policy as export
[R2-bgp]quit
[R2]quit
<R2>reset bgp all
```

在 PC2 再次 tracert 会改走 R3：

```text
PC>tracert 21.0.0.1

traceroute to 21.0.0.1, 8 hops max

(ICMP), press Ctrl+C to stop

 1  20.0.0.254   16 ms  <1 ms  15 ms
 2  45.1.1.4   32 ms  15 ms  31 ms
 3  34.1.1.3   16 ms  31 ms  32 ms
 4  13.1.1.1   31 ms  31 ms  31 ms
 5  21.0.0.1   47 ms  31 ms
```

**方法 3：使用 MED 控制选路**

初始时 PC1→PC5 经 R2；在 R2 上配置 MED 并向 R1 通告，使 R1 侧选 R3。R2 配置：

```text
[R2]route-policy med permit node 10

Info: New Sequence of this List.

[R2-route-policy]apply cost + 500

[R2-route-policy]quit

[R2]bgp 200

[R2-bgp]peer 12.1.1.1 route-policy med export
[R2-bgp]quit
[R2]quit
<R2>reset bgp all
```

在 PC1 上 tracert 20.0.0.1：

```text
PC>tracert 20.0.0.1

traceroute to 20.0.0.1, 8 hops max

(ICMP), press Ctrl+C to stop

 1  21.0.0.254   16 ms  <1 ms  16 ms
 2  13.1.1.3   15 ms  16 ms  15 ms
 3  34.1.1.4   47 ms  16 ms  16 ms
 4  45.1.1.5   31 ms  31 ms  31 ms
 5  20.0.0.1   32 ms  31 ms
```

路径已改为经 R3，说明配置生效。BGP 选路主要通过各类 BGP 属性调节完成，属性丰富，控制力强于 IGP。

5. **第四个需求**：在 R2、R3、R4 上向 BGP 注入本地 OSPF 路由，使全网互通。

```text
[R2]bgp 200
[R2-bgp]import-route ospf 1
```

R3、R4 同样执行 `import-route ospf 1`。可用文末查看命令验证路由表。

6. **第五个需求**：R1 与 R4 直接建立对等体（EBGP 多跳）。

**R1：**

```text
[R1]bgp 100
[R1-bgp]peer 34.1.1.4 as 200
[R1-bgp]peer 34.1.1.4 ebgp-max-hop 2
```

**R4：**

```text
[R4]bgp 200
[R4-bgp]peer 13.1.1.1 as 100
[R4-bgp]peer 13.1.1.1 ebgp-max-hop 2
```

验证（邻居建立可能需要约 1～2 分钟）：

```text
[R1]dis bgp peer

 BGP local router ID : 1.1.1.1
 Local AS number : 100
 Total number of peers : 3        Peers in established state : 3

  Peer            V          AS  MsgRcvd  MsgSent  OutQ  Up/Down       State Pre
fRcv

  12.1.1.2        4         200       27       38     0 00:17:49 Established
   8
  13.1.1.3        4         200       55       70     0 00:45:35 Established
   8
  34.1.1.4        4         200       12       13     0 00:00:02 Established    8
```

**常用查看命令：** `dis ip routing-table`、`dis ospf routing`、`dis bgp peer`。

### 1.4 配置总结 {/* #四配置总结 */}

在配置过程中需注意：

1. 建立邻居前，确认目标端点路由、源地址和 TCP 可达；Ping 是辅助证据，不是协议的必选前提。
2. AS 内建立 BGP 邻居时，建议用对端 Loopback，并配置更新源：`peer x.x.x.x connect-interface LoopBack 0`。
3. AS 内多台设备跑 BGP（IBGP）时，注意「保证 IBGP 下一跳可达」：`peer x.x.x.x next-hop-local`。
4. 非直连 eBGP 对等体需匹配设备的多跳、源地址或 TTL Security 机制；文中 TTL 数值属于该实验。增大 TTL 不替代路由、访问控制和会话认证。

## 2. 用 FRRouting 验证同一套原理

以双出口为例：

```text
                 ISP-A AS65001
                /
Enterprise AS65000
                \
                 ISP-B AS65002
```

企业边界 FRR 基础配置：

```text
router bgp 65000
 bgp router-id 10.255.0.1
 neighbor 192.0.2.1 remote-as 65001
 neighbor 198.51.100.1 remote-as 65002
 !
 address-family ipv4 unicast
  network 203.0.113.0/24
  neighbor 192.0.2.1 route-map ISP_A_IN in
  neighbor 198.51.100.1 route-map ISP_B_IN in
 exit-address-family
!
route-map ISP_A_IN permit 10
 set local-preference 200
!
route-map ISP_B_IN permit 10
 set local-preference 100
```

验证不能只看 Ping：

```text
show bgp summary
show bgp neighbors 192.0.2.1
show bgp ipv4 unicast
show bgp ipv4 unicast 0.0.0.0/0
show ip route 0.0.0.0/0
show ip route
```

检查策略时回答：

1. 前缀是否从对端进入 Adj-RIB-In？
2. 输入策略是否允许，修改了哪些属性？
3. 为什么某一条成为 Best？
4. Best 是否进入主 RIB，下一跳是否可达？
5. 出方向通告给了谁，是否泄漏了不应发布的前缀？

## 3. 双出口策略设计

### 3.1 出站流量 {/* #出站流量 */}

本 AS 选择出口时常用：

- Local Preference：在本 AS 内传播，值大优先。
- Weight：部分厂商本地私有属性，只影响单台设备。
- IGP Cost to Next Hop：前面条件相同后可能影响热土豆出口。

### 3.2 入站流量 {/* #入站流量 */}

远端 AS 决定如何进入本 AS，常见影响手段：

- 更具体前缀：影响强，但会增加路由规模和故障风险。
- AS_PATH Prepend：提示远端选择更短路径，不是强制。
- MED：通常只在特定邻接 AS 场景比较，行为需核对实现。
- Provider Community：请求运营商设置 Local Preference、地域通告或黑洞。

入站与出站是两次独立决策。只修改本地 Local Preference 无法控制互联网如何进入。

## 4. 必须具备的策略护栏

生产 eBGP 邻居至少考虑：

- 精确的入站和出站 Prefix List。
- 最大前缀数限制，防止错误全表或泄漏。
- 只通告本 AS 明确拥有且已验证的数据前缀。
- Bogon、私有 ASN/前缀和默认路由处理策略。
- RPKI Origin Validation 或上游等效保护。
- BGP 会话认证、控制面 ACL、TTL Security（平台支持时）。
- 策略命名、变更审批、回滚和邻居软刷新边界。

示意：

```text
ip prefix-list OUR_PREFIX seq 10 permit 203.0.113.0/24
!
route-map ISP_A_OUT permit 10
 match ip address prefix-list OUR_PREFIX
!
router bgp 65000
 address-family ipv4 unicast
  neighbor 192.0.2.1 route-map ISP_A_OUT out
  neighbor 192.0.2.1 maximum-prefix 100000 warning-only
```

阈值必须根据邻居类型和业务规模设计，不能照抄示例。

这里的 `warning-only` 仅告警，不会因达到该阈值自动阻断；它不能单独承担防止错误全表或泄漏的保护职责。示例只展示一个方向的配置结构，其他对等体及地址族仍需完整策略。

## 5. BGP 分层排障

| 层级 | 关键问题 | 证据 |
| --- | --- | --- |
| TCP | 179 端口能否双向建立 | 路由、ACL、抓包、Socket |
| 会话 | Open 参数与能力是否兼容 | Neighbor 日志、ASN、AFI/SAFI |
| 接收 | 对端是否真正发送前缀 | Received Routes、更新计数 |
| 策略 | 前缀是否被过滤或改写 | Prefix List、Route Map 命中 |
| 决策 | 为什么不是最佳路径 | BGP 路由明细与属性 |
| 安装 | 是否进入 RIB/FIB | `show ip route`、下一跳递归 |
| 通告 | 是否发给目标邻居 | Advertised Routes |
| 数据面 | 实际流量走哪条路径 | FIB、接口计数、Flow/抓包 |

### 5.1 常见状态 {/* #常见状态 */}

- `Idle/Active`：底层路由、TCP 179、源地址、TTL、ACL、认证。
- `OpenSent/OpenConfirm`：ASN、Router ID、能力协商、地址族。
- `Established` 但无路由：地址族未激活、策略过滤、对端未通告。
- 有 BGP 路由但无系统路由：非 Best、下一跳不可达，或系统路由选择了其他来源。
- 系统路由存在但转发异常：FIB/硬件安装、下一跳组、邻居解析及实际接口交付。
- 路由正常但业务不通：返回路径、NAT、防火墙、MTU、数据面。

## 6. 故障演练

1. 配错 Remote AS，记录会话状态和 Notification。
2. 删除到 Loopback Neighbor 的 IGP 路由，验证 BGP 对底层可达性的依赖。
3. 用 Prefix List 拒绝默认路由，观察 Adj-RIB-In、Loc-RIB 和主 RIB 差异。
4. 修改 Local Preference，证明只影响本 AS 的出站决策。
5. 错误放宽出站策略，在实验中复现路由泄漏，再用最大前缀和精确策略阻断。
6. 关闭主 ISP，分解 BFD/Keepalive、BGP 撤销、RIB/FIB 和业务恢复时间。

## 7. 验收标准

- 能解释 eBGP、iBGP、Route Reflector 与全互联的取舍。
- 能从 RIB 流程解释输入策略、最佳路径和输出策略。
- 能分别设计出站和入站流量策略。
- 能证明前缀没有越权通告，并能在错误发生时自动阻断。
- 能用表项和时间线排查，而不是反复重启 BGP 进程。

## 8. 思考与解答

**收到前缀、BGP Best、进入系统路由和实际转发，是否是一回事？**

不是。分别对应接收、协议决策、主 RIB 选择和 FIB/邻居交付，可能在中间被策略、其他路由来源或无效下一跳阻断。

**AS_PATH 最短，为什么仍输给另一条路径？**

它可能在更早的有效条件上失去资格，例如 LOCAL_PREF 较低。BGP 按策略顺序选择，不把所有指标加权为一个通用最短值。

**RR 的地址能通，为什么客户前缀仍不通？**

RR 负责路由传播，业务下一跳可能是另一台 PE。需要验证业务 NEXT_HOP 的递归、隧道或标签，以及对应 VRF 和回复路径。

**Route Refresh 会改变对方的输出策略吗？**

不会替对方制定策略。它请求对方按相应地址族重新通告当前可输出信息，本端再按自己的输入规则处理。

**RPKI Valid 是否保证不存在路由泄漏？**

不保证。它检查起源与授权前缀长度，无法仅凭这些信息证明完整 AS 路径和商业传播关系都符合预期。

**更具体路由的 LOCAL_PREF 较低，会输给较短前缀吗？**

若两者均已有效安装，它们不是同一 NLRI 的候选比较；数据面优先匹配更具体前缀。不要把最长前缀匹配与 BGP 同前缀选路混在一起。

## 9. 参考资料

- [RFC 4271: Border Gateway Protocol 4](https://www.rfc-editor.org/rfc/rfc4271)
- [RFC 7454: BGP Operations and Security](https://www.rfc-editor.org/rfc/rfc7454)
- [FRRouting BGP Documentation](https://docs.frrouting.org/en/latest/bgp.html)

[下一篇：NAT、ACL 与连接跟踪 →](../security/firewall-acl-nat/01-NAT-ACL与连接跟踪.md)
