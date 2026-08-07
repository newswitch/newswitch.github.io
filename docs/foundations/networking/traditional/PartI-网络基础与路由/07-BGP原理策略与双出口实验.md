---
title: BGP 原理、策略与双出口实验
sidebar_position: 7
date: 2026-02-19 12:00:00
categories: 网络
tags: [BGP, eBGP, iBGP, Route Policy, 双出口, FRRouting]
description: 从 BGP 会话、RIB 与属性开始，学习最佳路径、策略控制、双出口设计和分层故障排查。
---

# BGP 原理、策略与双出口实验

本文在完成 IP 路由和 OSPF 基础之后学习。目标不是死记某个厂商的选路表，而是理解：

- BGP 为什么用 TCP 建立会话，却仍需要底层路由可达。
- Adj-RIB-In、Loc-RIB、Adj-RIB-Out、主 RIB 和 FIB 如何衔接。
- Local Preference、AS_PATH、MED、Community 等属性分别影响哪个范围。
- 如何用策略实现双出口，而不是只修改一个“优先级数字”。

---

## 1. BGP 核心原理

> 本文原有实验使用华为风格 CLI，保留它用于理解策略语义。命令、默认属性和
> 最佳路径细节会因实现与版本而异；在生产环境必须以目标设备文档和实际
> `show/display` 输出为准。

### 一、BGP 的概念




BGP（边界网关协议）是基于 AS 的**路径矢量**协议，解决 AS 间选路问题，适合互联网。重点掌握：报文与建邻、路由属性、12 条选路原则及汇总/过滤/RR/联盟等。



#### 01 自治系统（AS）与 AS 号

自治系统（AS）是同一管理机构下、使用统一选路策略的一组路由器。**AS 号**默认 2 字节，可扩展 4 字节，需申请。

- **1～64511**：公有 AS 号，全球唯一
- **64512～65535**：私有 AS 号，可重用，不出域



#### 02 动态路由分类

动态路由协议有很多分类方法，按自治系统分类、按协议类型分类是最常用的两种。



**按自治系统分类：**

- **IGP**（内部网关路由协议）：如 RIP、OSPF、ISIS、EIGRP（思科私有）。运行在 AS 内部，用于发现与计算路由。
- **EGP**（外部网关路由协议）：通常指 BGP，运行在 AS 之间，用于控制路由传播与最优路由选择。



一般会先使用IGP协议在自治系统内部计算和发现路由条目，再通过BGP协议将IGP协议产生的路由传递至其他的AS（自治系统）。



#### 03 BGP 的特征

- 外部路由协议，在 AS 之间传递路由信息
- **路径矢量**（Path-Vector）协议，通过 AS_PATH 防环，区别于距离矢量/链路状态
- 可靠更新：基于 **TCP，目的端口 179**，源端口随机
- 丰富度量与策略：**12 条选路原则**、route-policy 等
- 设计上避免环路
- 为路由附带多种属性；支持 **CIDR**
- **无周期更新**，仅触发更新且只更新变化部分；周期（约 60s）发送 **KeepAlive** 检测 TCP 连通性

**路由算法分类**（便于对比理解）：[距离矢量](https://en.wikipedia.org/wiki/Distance-vector_routing_protocol)（如 RIP，按跳数、Bellman-Ford）、[链路状态](https://en.wikipedia.org/wiki/Link-state_routing_protocol)（如 OSPF/IS-IS，每节点维护拓扑图）、[路径矢量](https://en.wikipedia.org/wiki/Path-vector_routing_protocol)（BGP，维护路径信息、易检测环路）。




### 二、BGP 的工作原理




BGP是跨公网、跨AS（自治系统）的路由协议，可以在AS之间学习路由。BGP的动态学习路由也是基于邻居，只有邻居关系正常，BGP才可以正常工作。



#### 01 BGP 邻居关系

运行 BGP 的路由器通常被称为 BGP Speaker（发言者），相互之间传递报文的speaker之间互称为对等体（peer）。BGP邻居关系的建立、更新和删除是通过对等体之间的5种报文、6种状态机和5个表等信息来完成，最终形成BGP邻居。



**（1）BGP 报文类型**

- **Open**：与对等体建立邻接，建连后首包，携带版本、AS、Holdtime 等
- **KeepAlive**：周期（约 60s）发送，维护 TCP 连接
- **Update**：传递路由信息，用于通告或撤销路由
- **Notification**：检测到错误时发送，随后断连
- **Route-Refresh**：通知对端本端支持路由刷新能力


**（2）BGP 状态机**

- **Idle**：初始状态，等待启动事件；收到后发起 TCP，进入 Connect
- **Connect**：发起 TCP；成功→OpenSent，失败→Active
- **Active**：持续尝试 TCP；成功→OpenSent，超时回 Connect
- **OpenSent**：已发 Open，等待对端 Open 并校验；无误发 KeepAlive→OpenConfirm，有误发 Notification→Idle
- **OpenConfirm**：等待 KeepAlive；收到→**Established**
- **Established**：邻居建立，交换 Update，复位 Hold 计时器

除 Idle 外任一步出错都会回退到 Idle。常见可见状态：Idle、Active、Established。



**（3）BGP 路由信息处理（RIB）**

对等体发来的 Update 先入 **Adj-RIB-In**，经**输入策略**过滤后参与**路径选择**；最优路径写入 **Loc-RIB** 并提交 **IP RIB**。Loc-RIB 再经**输出策略**，通过者写入 **Adj-RIB-Out** 发给对应对等体。另有邻居表记录 peer 信息。



**（4）BGP 邻居关系类型**

- **IBGP**：同一 AS 内 BGP 对等体之间的邻居关系。
- **EBGP**：不同 AS 之间 BGP 对等体的邻居关系。



**建邻要点**：邻居基于 **TCP 单播**，无自动发现，需在 BGP 进程下手动配置对端地址。通过 IGP 或静态路由保证到对端的 TCP 可达性。

**常见建邻失败原因**：一直 Idle（无到 Peer 路由）、EBGP 多跳未配、源地址错误（对端看到的 IP 非本端配置的 peer 地址）、TCP 认证失败、路由错误或被过滤。华为：若经默认路由到达邻居，该邻居通告的所有路由视为无效。



#### 02 通告 BGP 路由的方法

BGP 路由是通过 BGP 命令通告而成的，而通告BGP路由的方法有两种：network和Import。



（1）network方式：

使用network命令可以将当前设备路由表中的路由（非BGP）发布到BGP路由表中并通告给邻居，和OSPF中使用network命令的方式大同小异，只不过在BGP宣告时，只需要宣告网段+掩码数即可，如：network 12.12.0.0 16。



（2）Import方式：

使用Import命令可以将该路由器学到的路由信息重分发到BGP路由表中，是BGP宣告路由的一种方式，可以引入BGP的路由包括：直连路由、静态路由及动态路由协议学到的路由。其命令格式与在RIP中重分发OSPF差不多。



#### 03 BGP 路由通告原则

- 只把**最优路由**加入路由表并只向对等体通告最优路由；多条路径时只选一条最优
- **从 EBGP 学到的路由**：向所有 EBGP、IBGP 对等体通告；**通告给 EBGP 时下一跳改为自己**（若通告方与接收方 EBGP 在同一网段可不改）；通告给 IBGP 时**不改下一跳**，避免次优
- **从 IBGP 学到的路由**：**不**再通告给其他 IBGP（**IBGP 水平分割**）；仅通告给 EBGP
- 让所有 IBGP 都能收到某条路由的三种方式：**全互联**、**RR（路由反射器）**、**联盟**

**BGP 与 IGP 同步**：同步关（默认）：从 IBGP 学到的路由可传给 eBGP。同步开：只有 IGP 里也有的路由才传给 eBGP，防 AS 内路由黑洞。华为默认关且不支持开启；思科可开。



#### 04 更新源建立邻居关系

这个概念说白了就是在指定对等体时，使用对方的loopback口，因为该接口比任何物理接口都要稳定，只要设备在运行，loopback口就不会关闭，只要有一条链路可以和对方的loopback地址通信，就不会造成BGP状态的改变，若使用物理接口，一旦这个物理接口down掉，那么BGP也就完了，所以这种使用loopback口建立BGP邻居的方法称为更新源建立邻居，通常会在同一个AS内使用冗余链路来确保BGP的稳定性。（若在不同AS内使用对端路由器的loopback地址来建立邻居关系，需要改变两个路由器上的TTL值，具体解释请参考博文末尾的配置总结）

![BGP](/images/传统组网（一）/BGP-1.png)


如在上图中，三个路由器同在AS 100区域中，若R1和R3要使用更新源建立邻居关系，那么配置如下：

R1路由器：

[R1]bgp 100              

[R1-bgp]router-id 1.1.1.1

[R1-bgp]peer 3.3.3.3 as-number 100    

[R1-bgp]peer 3.3.3.3 connect-interface LoopBack0  



R3路由器（相关命令解释参考R1路由器的配置）：

[R3]bgp 100                    

[R3-bgp]router-id 3.3.3.3              

[R3-bgp]peer 1.1.1.1 as-number 100              

[R3-bgp]peer 1.1.1.1 connect-interface LoopBack0          



注意：本地loopback接口先要让对等体可达（就是可以ping通对方的loopback地址），需要手动添加对等体环回接口的路由条目或者使用OSPF、RIP等自动学习对方环回接口的路由。



#### 05 保证 IBGP 下一跳可达

在 AS 边缘的 BGP 设备，会接收到它的EBGP对等体邻居传递过来的BGP路由信息。上面说过：所有EBGP对等体在传递过程中下一跳改变， 所有IBGP对等体在传递过程中下一跳不变。上个图来直观的说一下：

![BGP](/images/传统组网（一）/BGP-2.png)



图中，用A——J分别来代替路由器的接口IP地址，结合所有EBGP对等体在传递过程中下一跳改变， 所有IBGP对等体在传递过程中下一跳不变这个结论，可以看到图中存在什么问题（自己看图理解吧，是在是懒癌晚期，不想解释了），就是图中R3路由器以后的路由器收到的路由条目中的下一跳是错误的，解决办法就是在R3和R5路由器上对R4和R6宣称下一跳为它自己，然后就会发现，R4学到的下一跳地址是E。R6学到的下一跳就是I。这只是解决了R1宣告路由时出现的问题，那么如果现在R6又宣告了一条路由，就还需要在R4和R2路由器上对R3和R1宣称下一跳为它自己。这样才算保证了IBGP的下一跳可达。



配置如下（就拿一个路由器来举例，前三条配置命令的解释可以参考上面的注释，主要是最后一条命令，来改变路由的下一跳）：

[R3]bgp 200

[R3-bgp]router-id 3.3.3.3

[R3-bgp]peer 34.1.1.4 as-number 200  

[R3-bgp]peer 34.1.1.4 next-hop-local              



#### 06 EBGP 多跳

这个好理解，由于默认 BGP 中 EBGP 邻居之间的 TTL 值为 1，（TTL，数据包的生命周期值，每经过一个路由器该值会-1，当该值为0后，数据包将会被丢弃）。若EBGP对等体非直连（通信时需要经过一个以上的路由器，TTL值就不够用了），TTL值限制会使非直连的对等体无法正常建立邻居关系，所以需要用EBGP多跳的命令来解决非直连的邻居关系。如下图，若不配置EBGP多跳，那么R1和R3将无法正常建立邻居关系：

![BGP](/images/传统组网（一）/BGP-3.png)



配置上图中的R3路由器多跳（R1路由器也需要进行类似的配置，进而改变TTL值，这里只拿R3为例）：

R3 配置如下：

[R3]bgp 200

[R3-bgp]router-id 3.3.3.3

[R3-bgp]peer 12.0.0.1 as-number 100

[R3-bgp]peer 12.0.0.1 ebgp-max-hop 2   # 跳数为 2，即 TTL=2



#### 07 控制 BGP 选路

BGP 协议包含很多路由属性，这些属性可以非常灵活的控制BGP的选路。



**属性四类**：公认必遵（Origin、AS_Path、Next_Hop）→ 公认任意（Local_Pref、Atomic-Aggregate 等）→ 可选过渡（Community、Aggregator 等）→ 可选非过渡（MED、Originator-ID、Cluster-List）。不识别时：过渡属性可转给邻居；非过渡属性丢弃不转发。

**常用属性简述**：

- **Origin**：路由来源。IGP（network 注入）> EGP > Incomplete（import 引入）
- **AS_Path**：矢量顺序记录经过的 AS，含本 AS 则拒收（防环）。类型：AS-Sequence（有序）、AS-Set（无序）、AS-confed-sequence/Set（联盟内）
- **Next_Hop**：本端始发发给 IBGP 时设为建邻接口地址；发给 EBGP 时设为建邻接口地址；向 IBGP 转发从 EBGP 学来的路由时通常不改（需 next-hop-local 场景见前文）
- **Local_Pref**：仅 IBGP 间传递，判断**离开 AS** 的最佳路由，值高优先，默认 100
- **MED**：仅相邻 AS 间传递，判断**进入 AS** 的最佳路由，值小优先，默认 0
- **Community**：aa:nn 或团体号；公认：Internet、No_Advertise、No_Export、No_Export_Subconfed

![BGP](/images/传统组网（一）/BGP-4.png) ![BGP](/images/传统组网（一）/BGP-5.png) ![BGP](/images/传统组网（一）/BGP-6.png) ![BGP](/images/传统组网（一）/BGP-7.png)



#### 08 BGP 选路规则（12 条顺序）

1. 下一跳不可达则忽略
2. PrefVal 大优先
3. Local_Pref 大优先
4. 本地生成优先（聚合 > 非聚合；手聚 > 自聚；network > import）
5. AS_Path 短优先
6. Origin：IGP > EGP > Incomplete
7. MED 小优先
8. EBGP 优于 IBGP
9. 到 BGP 下一跳的 IGP metric 小优先
10. Cluster_List 短优先
11. Originator_ID（无则 Router ID）小优先
12. 对等体 IP 小优先

#### 09 汇总、过滤与进阶（提要）

**路由汇总**：自动汇总仅对重分发进 BGP 的外部路由生效且为主类；手动汇总优先。常用：`detail-suppressed` 抑制明细、`suppress-policy` 指定抑制项、`as-set` 防环、`attribute-policy` 设属性。带 `detail-suppressed` 时汇总路由会带 Atomic-Aggregate，不继承明细的 community。

**路由过滤**：`peer x ip-prefix xx import`、`peer x filter-policy xx import`、`peer x as-path-filter xx import`（as-path-filter 用正则匹配 AS_PATH）。

**路由反射器（RR）**：反射原则——从 EBGP 收到的可反射给 Client、Non-Client、EBGP；从 Non-Client 收到的可反射给 Client 和 EBGP，不反射给 Non-Client；从 Client 收到的可反射给 Client、Non-Client、EBGP。Client 只与 RR 建 IBGP；RR 之间、Non-Client 之间需全互联。经 RR 反射的路由带 Cluster_List、Originator_ID 防环。

**联盟**：联盟内 EBGP 传路由时不改下一跳；用 loopback 建联盟 eBGP 时也需配 ebgp-max-hop。AS 号表示：`()` 联盟内有序、`[]` 联盟内无序（华为）、`{}` 联盟外无序。

**默认路由**：对 peer 通告默认、network/import 默认路由、`default-route imported`。

**常用命令**：`active-route-advertise` 只通告活动路由；`bgp-rib-only` 在 IP RIB 侧过滤 BGP（与上一条互斥）；`as-path limit 1` 限制 AS_Path 长度（默认 255）。4 字节 AS 号：能力协商、AS4_Path/AS4_Aggregator 属性、AS_Trans 23456 衔接 2/4 字节。

### 三、BGP 的配置实例




上面是 BGP 理论概要，实际配置相对简单。下面按实验拓扑进行配置，网络拓扑如下：

![BGP](/images/传统组网（一）/BGP-8.png)

#### 01 需求如下

1. AS 200 内部使用 OSPF 协议使 AS 200 内部互通，并在AS 200内部各个路由器上都运行BGP协议（R1和R2、R3建立邻居关系，R4和R2、R3及R5建立邻居关系，），各个AS之间运行BGP协议。



2. 分别在 R1 和 R5 使用 BGP 协议宣告 21.0.0.0/24 和 20.0.0.0/24，使所有路由器学到这两条路由信息
3. 通过 BGP 的属性控制选路，实现 PC1→R1→R2→R4→R5→PC2→R5→R4→R3→R2→R1→PC1 的路由通信，并测试多种控制选路方法
4. 在 R2、R3 和 R4 上分别向 BGP 注入本地 OSPF 路由，使全网互通（满足第 3 点选路要求并不代表 PC1 能 ping 通所有设备，如 R2）
5. 为演示 EBGP 多跳，尝试让 R1 与 R4 直接建立对等体关系



#### 02 开始配置

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

至此 PC1 已可与 PC2 通信，当然是BGP协议做的咯，但是现在除了非直连网段及AS 200内部路由器以外，也只有PC1和PC2可以通信，如PC1并不能ping通R2路由器。



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

[R3]quit<R3>reset bgp all        



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




### 四、配置总结




在配置过程中需注意：

1. 建立邻居前，务必保证能 ping 通对端（指定对端地址前先确认路由可达）。
2. AS 内建立 BGP 邻居时，建议用对端 Loopback，并配置更新源：`peer x.x.x.x connect-interface LoopBack 0`。
3. AS 内多台设备跑 BGP（IBGP）时，注意「保证 IBGP 下一跳可达」：`peer x.x.x.x next-hop-local`。
4. 跨 AS 建立邻居时，若用对端 Loopback（非直连网段），需配置 EBGP 多跳，否则 TTL=1 会导致建邻失败。IBGP 默认 TTL=255，无需改。命令示例：`peer x.x.x.x ebgp-max-hop 2`，数值不小于实际跳数即可。

---

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

### 出站流量

本 AS 选择出口时常用：

- Local Preference：在本 AS 内传播，值大优先。
- Weight：部分厂商本地私有属性，只影响单台设备。
- IGP Cost to Next Hop：前面条件相同后可能影响热土豆出口。

### 入站流量

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

### 常见状态

- `Idle/Active`：底层路由、TCP 179、源地址、TTL、ACL、认证。
- `OpenSent/OpenConfirm`：ASN、Router ID、能力协商、地址族。
- `Established` 但无路由：地址族未激活、策略过滤、对端未通告。
- 有 BGP 路由但无系统路由：非 Best、下一跳不可达、管理距离或 FIB 编程失败。
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

## 8. 参考资料

- [RFC 4271: Border Gateway Protocol 4](https://www.rfc-editor.org/rfc/rfc4271)
- [RFC 7454: BGP Operations and Security](https://www.rfc-editor.org/rfc/rfc7454)
- [FRRouting BGP Documentation](https://docs.frrouting.org/en/latest/bgp.html)

[下一篇：NAT、ACL 与连接跟踪 →](./08-NAT-ACL与连接跟踪.md)
