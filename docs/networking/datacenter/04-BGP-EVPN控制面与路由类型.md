---
title: "BGP EVPN 控制面与常用五类路由"
sidebar_label: "04. BGP EVPN 控制面与常用五类路由"
sidebar_position: 4
description: "从 EVI、MAC-VRF 与 IP-VRF 进入 EVPN，理解路由编码、导入、递归解析、ARP/ND 代理和 MAC 移动。"
tags: [BGP, EVPN, VXLAN, Route Type, ARP Suppression]
---

# BGP EVPN 控制面与常用五类路由

VXLAN 封装本身不提供远端主机位置数据库。早期常见方案依赖 Flood-and-Learn：泛洪未知单播和 ARP，再从数据面学习 MAC。规模增大后，广播、收敛和排障都会变得困难。

BGP EVPN 的核心价值是：**用 MP-BGP 在控制面发布二层、三层可达性和多归属状态。**本文采用 VXLAN 数据面，但 EVPN 也可以与 MPLS 等承载组合；它不是 VXLAN 的另一个名字。

## 1. 先建立完整心智模型

```mermaid
flowchart LR
    H1["主机 10.10.10.11 / MAC-A"] --> L1["Leaf1 / VTEP1"]
    L1 -->|"学习本地 MAC/IP"| R1["生成 EVPN 路由"]
    R1 -->|"MP-BGP UPDATE"| RR["Route Reflector"]
    RR --> L2["Leaf2 / VTEP2"]
    L2 -->|"导入到对应 VRF/VNI"| FDB["FDB、ARP/ND、IP 路由表"]
    FDB --> H2["远端主机"]
```

需要同时分清四种标识：

| 标识 | 解决的问题 | 典型写法 |
|---|---|---|
| VNI | 数据面属于哪个 VXLAN 广播域或租户 | L2VNI 10100、L3VNI 50001 |
| RD | 让不同设备发布的相同前缀在 BGP 中保持唯一 | `10.0.0.1:10100` |
| RT | 决定路由可以被哪些 VRF/VNI 导入、导出 | `target:65000:10100` |
| ESI | 标识一组连接到同一以太网段的多归属 PE/VTEP | 10 字节 Ethernet Segment Identifier |

容易混淆的地方：

- RD 解决“唯一性”，RT 解决“策略归属”，二者不是同一个东西。
- VNI 出现在 VXLAN 数据面，RT 出现在 BGP 控制面；工程上常让数值相似，但协议没有要求必须相同。
- EVPN Address Family 使用 MP-BGP 传递 NLRI；BGP 邻居建立并不代表 EVPN 路由已被正确导入。

### 1.1 先把服务对象放到正确层级

| 对象 | 含义 | 不应直接等同于 |
| --- | --- | --- |
| EVI，EVPN Instance | 一份 EVPN 服务实例 | 所有产品中的单一 VLAN |
| MAC-VRF | 维护相应二层服务的 MAC 可达性 | 租户的全部 IP 路由表 |
| Bridge Domain/Bridge Table | 广播与桥接查找范围 | Underlay 的广播域 |
| IP-VRF | 维护租户三层路由 | 每个主机的 ARP 缓存 |
| Ethernet Tag ID | EVPN 路由中的服务区分字段 | 总是原始接入口 VLAN ID |

服务模型决定一个 EVI/MAC-VRF 与一个或多个广播域怎样对应。常见 VLAN-based 模型与 VLAN-aware Bundle 模型不能机械共用同一字段解释；Ethernet Tag 为 0 也可能是合法模型，而非“设备忘记配置 VLAN”。对象关系可对照 [FRR EVPN 文档](https://docs.frrouting.org/en/latest/evpn.html)。

### 1.2 UPDATE 中的路由对象与属性要分开

EVPN 使用 AFI 25、SAFI 70。一次 BGP UPDATE 包含用于表示可达对象的 NLRI，以及 NEXT_HOP、RT、封装能力等相应属性。不同路由类型的 NLRI 字段并不相同。

工程输出常把这些信息并排显示，因此容易误以为 RT、VNI、下一跳全部都是每一种 NLRI 内的相同字段。实际上 Type 3 的复制方式还与 PMSI Tunnel Attribute（提供商组播服务接口的隧道属性）相关；VXLAN 场景对原有标签字段的解释也不同于 MPLS 标签转发。编码模型见 [RFC 8365](https://datatracker.ietf.org/doc/html/rfc8365)。

另外，资料中的“RT-2”通常指 Route Type 2，而“import RT”中的 RT 是 Route Target。前者是路由类型，后者是导入策略标签。

## 2. 五类常用 EVPN 路由

| 路由类型 | 名称 | 主要用途 | 重点字段 |
|---|---|---|---|
| Type 1 | Ethernet Auto-Discovery | 多归属别名、快速撤销、每 ES/每 EVI 通告 | RD、ESI、Ethernet Tag |
| Type 2 | MAC/IP Advertisement | 发布主机 MAC，可选绑定主机 IP | MAC、IP、ESI、标签/VNI |
| Type 3 | Inclusive Multicast Ethernet Tag | 发现相应服务的 BUM 复制成员 | Originating Router IP、Ethernet Tag，以及 PMSI 属性中的隧道信息 |
| Type 4 | Ethernet Segment | 多归属 VTEP 之间发现同一 ES，支持 DF 选举 | ESI、Originating Router IP |
| Type 5 | IP Prefix | 发布租户三层前缀、外部路由或汇总路由 | IP Prefix、ESI/Gateway IP、标签字段，以及下一跳等属性 |

这里介绍的是入门最常见的五类，不表示 EVPN 扩展永远只有五种路由。

### 2.1 Type 2：主机可达性的核心

Leaf1 从接入口学习到：

```text
VLAN 100 / L2VNI 10100
MAC aa:aa:aa:aa:aa:11
IP  10.10.10.11
下一跳 VTEP 10.0.0.1
```

Leaf1 生成 Type 2 路由。Leaf2 根据 RT 把它导入对应租户，形成类似状态：

```text
FDB: aa:aa:aa:aa:aa:11 -> vxlan10100 -> remote VTEP 10.0.0.1
ARP: 10.10.10.11 -> aa:aa:aa:aa:aa:11
```

如果通告确实包含有效 IP 绑定，而且 Leaf2 已导入、安装并启用相应代理功能，就有机会在本地回答部分 ARP/ND 请求，即 **ARP/ND Suppression**。它减少广播，但要求绑定真实、及时，并能在主机迁移时正确更新。

Type 2 也可以只携带 MAC。Leaf 从普通以太网帧学到源 MAC，不代表已经知道该主机全部 IP；IP 绑定可能来自 ARP/ND 观察或其他可信来源。**有 Type 2、具有 MAC-IP 绑定、能够代理答复，是三个不同判断。**

一个主机可能具有多个 IP，同一个 MAC 也可能对应多份带 IP 的通告。不能把“路由条数”直接当作物理服务器数量。

### 2.2 Type 3：建立 BUM 复制关系

当 VTEP 加入 L2VNI 时，它发布 Type 3 IMET 路由。其他 VTEP 据此知道 BUM 流量应复制给谁。

Ingress Replication 场景中，一个广播包可能被入口 VTEP复制 N 份。它不需要 Underlay 组播，但 VTEP 数量增大时带宽和复制开销也会增加。

Type 3 不告诉设备“主机 B 在哪台 Leaf”，它回答的是“哪些端点参与这份服务的多目的交付”。因此已知单播与 BUM 可以出现不同故障：Type 2 已安装而 Type 3 复制关系缺失时，已有会话可能正常，新主机的地址解析却失败。

参与关系也不意味着任何组播都必须发给全部参与者。组播优化、Snooping、未知单播策略和多归属过滤还会进一步影响复制范围。

### 2.3 Type 5：租户前缀而非单个主机

Type 2 更适合 MAC/IP 主机路由；Type 5 更适合：

- 数据中心外部网络；
- 防火墙后的业务网段；
- 云或园区汇总前缀；
- 不需要扩展二层的纯三层服务。

如果跨 VTEP 路由需要知道单个主机的 MAC/IP，可依赖 Type 2；如果只需要知道“某前缀经哪个 VTEP/边界节点可达”，Type 5 更清晰。

#### 2.3.1 Type 5 不等于完全不再需要 Type 2

先分清两个递归层次：

```text
业务前缀的 Overlay 下一跳 → 哪个业务交付对象/出口 PE
出口 PE 的承载地址       → 哪条 Underlay 路由和实际出接口
```

部分 Type 5 模型可直接使用相应下一跳和封装信息；另一些模型带有 Overlay Index。例如 Gateway IP 指向租户空间中的下一跳时，接收端需要相应的 Type 2 IP 绑定来解析；以 ESI 为索引时则涉及相应 Type 1 信息。

所以“Type 5 已收到，但 IP-VRF 没有可用路径”可能是依赖尚未满足，而不只是 RT 配错。通告的发布者也未必就是递归解析后的实际业务出口，见 [RFC 9136](https://www.rfc-editor.org/rfc/rfc9136.html)。

### 2.4 Type 1 与 Type 4 为什么还需要独立存在

Type 4 帮助同一 Ethernet Segment 的 PE 发现彼此并形成 DF 选举视图；它不是一份主机 MAC 清单。

Type 1 的 Per-ES 与 Per-EVI 语义不同：一个偏向成组收敛依赖，一个参与服务级可达关系、Aliasing 等处理。不能看到“Type 1 有一条”就断言全部多归属状态齐备。它们怎样配合主机路由及数据面，继续见 [EVPN 多归属](./05-EVPN网关BUM与多归属.md)。

## 3. 一条 Type 2 路由的生命周期

1. 接入端口 Up，主机发送 ARP、ND 或普通报文。
2. Leaf 在本地 VLAN/FDB 学习源 MAC；有相应可信信息时再关联 IP。
3. EVPN 进程生成带 RD 的 Type 2 NLRI。
4. 按输出策略附加相应 RT 等属性，并向有资格的对等体发布。
5. 若使用 RR，RR 按传播规则反射；纯控制面 RR 不需要转发租户数据。
6. 远端 Leaf 根据导入 RT 接收路由。
7. 控制面把路由下发为远端 FDB、邻居表或主机路由。
8. 数据包按 VNI 封装，外层目的地址为远端 VTEP。

任何一步失败都会出现不同症状：

| 断点 | 典型症状 |
|---|---|
| 本地未学习 MAC | 本地 EVPN RIB 中没有 Type 2 |
| BGP 地址族未激活 | 邻居 Established，但收不到 EVPN 路由 |
| RT 不匹配 | 全局 EVPN 表有路由，租户 VRF/FDB 没有 |
| VNI 映射错误 | 路由导入了错误广播域 |
| VTEP 下一跳不可达 | 控制面正常，数据流量黑洞 |
| MTU 不足 | 小包通，大包丢或 TCP 卡顿 |

### 3.1 控制面看见路由，不等于所有表一起完成

把一份候选放进全局 EVPN RIB，只证明接收和保留到达了某个阶段。业务服务还要检查导入资格、路径选择、下一跳解析与数据面安装。不同阶段可能异步执行，期间表项数量暂时不同不一定是计数器错误。

例如收到 B-MAC 的 Type 2，却没有对应 L2VNI 的远端 FDB，可以按顺序判断：这是不是目标服务的候选、是否获选、对应 VNI 是否存在、下一跳是否有效、内核/ASIC 安装是否成功。无需一开始就把故障归因于 BGP TCP 会话。

RR 的地址与实际 VTEP 也必须分开。把一台不承担租户转发的 RR 任意改成业务 NEXT_HOP，可能让“路由传播成功”与“流量交付失败”同时出现。

### 3.2 ARP/ND 代理为何不能等同于缓存永不失效

代理表是有来源、生命期和更新条件的状态。主机关机、迁移、地址冲突、静默老化或远端撤销后，旧绑定都可能失效。代理快速回答一个错误 MAC，有时比继续泛洪更难察觉。

对 IPv6，还要区分普通地址解析、DAD（重复地址检测）和 NUD（邻居不可达检测）；不能按“所有 NS 都照样回复”实现代理。未知绑定如何泛洪、已知绑定何时代理、冲突如何处理，应遵循相应规则，见 [RFC 9161](https://www.rfc-editor.org/rfc/rfc9161.html)。

## 4. MAC 移动如何被控制面处理

对于被判定为动态 MAC 移动的场景，新位置会按 MAC Mobility 规则使用相应序列信息，接收端再决定采用哪个位置。这个序号表示移动关系，不是主机发包计数，也不是 BGP UPDATE 总次数。

排障时要问：

1. 是正常虚机迁移，还是二层环路导致 MAC 在两个端口反复震荡？
2. 新 Type 2 的 Mobility Sequence 是否增加？
3. 旧 VTEP 是否撤销路由？
4. 是否存在静态 MAC、粘滞 MAC 或安全策略阻止移动？

如果 MAC 在短时间内高频迁移，应告警并限制影响，不能只靠“最后一次更新获胜”掩盖环路。

### 4.1 多归属不是主机在两台 Leaf 之间反复迁移

同一 MAC 从相同非零 ESI 的多个成员处可达，可能正是合法 All-Active 多归属。来自不同接入段的相互竞争位置，才需要按移动、静态/粘滞状态及重复检测等规则区分。

这也说明只按“同一 MAC 有两个下一跳”报警会误判；必须带上 ESI、服务上下文与通告属性。基础移动机制见 [RFC 7432](https://datatracker.ietf.org/doc/html/rfc7432)。

### 4.2 MAC 改位置与 IP 改归属是两件事

主机迁移后 IP 不变、MAC 不变，主要更新接入位置；若相同 IP 被另一个 MAC 使用，还涉及绑定冲突或正常地址接管的判断。不能只增加 MAC Mobility 序号就解决所有重复 IP 问题。

原位置撤销、远端 FDB 更新、代理邻居项更新和实际端口交付也不一定同时完成。收敛必须观察整条状态依赖，而不是只看新 Type 2 到达时间。

## 5. FRR 实验骨架

以下仅展示结构，接口名和 AS 号应按实验拓扑调整：

```text
router bgp 65001
 bgp router-id 10.0.0.1
 neighbor 10.0.0.254 remote-as 65000
 !
 address-family l2vpn evpn
  neighbor 10.0.0.254 activate
  advertise-all-vni
 exit-address-family
```

在 Linux/FRR VTEP 上至少检查：

```bash
vtysh -c 'show bgp l2vpn evpn summary'
vtysh -c 'show bgp l2vpn evpn route'
vtysh -c 'show bgp l2vpn evpn route type macip'
vtysh -c 'show evpn vni'
bridge fdb show
ip neigh show
ip -d link show type vxlan
```

不要只看 `BGP Established`。完整验收要形成证据链：

```text
本地主机状态
→ 本地 Type 2
→ RR 收到并反射
→ 远端 Type 2 被正确 RT 导入
→ 远端 FDB/ARP 表下发
→ Underlay 可达远端 VTEP
→ VXLAN 数据包成功往返
```

## 6. 练习与验收

### 6.1 练习一：RT 导入错误 {/* #练习一rt-导入错误 */}

故意让 Leaf2 的 import RT 与 Leaf1 的 export RT 不同。

要求：

- 证明 BGP 邻居正常；
- 证明 RR 上能看到 Type 2；
- 证明 Leaf2 的目标 VNI 没有导入；
- 修复后验证 FDB、ARP 和业务恢复。

### 6.2 练习二：观察 ARP Suppression {/* #练习二观察-arp-suppression */}

在远端已经存在 MAC-IP Type 2 后清空主机 ARP 缓存，再发起访问并抓包。判断 ARP 请求是被本地 VTEP 代理，还是被泛洪到全部 VTEP。

### 6.3 掌握标准 {/* #掌握标准 */}

你应能在白板上从一个本地 MAC 开始，完整画出 Type 2 的生成、发布、导入和数据面转发过程；看到 Type 1～5 时，能够说清每一种在解决什么问题，而不是背编号。

### 6.4 参考答案与验收标准

**练习一**：Leaf1 与 RR 的 BGP 会话应为 Established，RR 的 EVPN RIB 中能看到携带 Leaf1 export RT 的 MAC/IP Type 2；Leaf2 因 import RT 不匹配，不会把该路由安装到目标 MAC-VRF/VNI，因此对应远端 MAC、ARP/ND 或转发表项缺失。把 Leaf2 import RT 改为与 Leaf1 export RT 相交后，确认路由进入本地 EVPN RIB、VXLAN FDB/邻居表出现远端项，最后以双向业务和抓包验证恢复。

**练习二**：如果本地 VTEP 已导入远端 MAC-IP Type 2 且开启 ARP Suppression，本地 VTEP应直接代理回复，Underlay中不应看到该ARP请求被BUM复制到所有远端VTEP；若仍泛洪，应检查Type 2是否携带IP、VNI/VRF映射、代理功能和邻居表安装状态。

**掌握标准答案**：本地学习MAC/IP后，VTEP生成Type 2并附加RD、RT、VNI及下一跳，经RR反射；远端VTEP按RT导入并安装到MAC-VRF，再通过VXLAN封装把已知单播送往发布该路由的VTEP。Type 1用于以太网自动发现和多归属，Type 2发布MAC/IP，Type 3建立BUM成员关系，Type 4完成以太网段多归属与DF相关控制，Type 5发布IP前缀。

## 7. 思考与解答

**Type 2 出现了，为什么还不能代理 ARP？**

它可能只含 MAC，或绑定未被目标服务导入、未安装、已失效，或者本地未启用相应代理。路由类型本身不是全部前提。

**Type 3 和 Type 2 是否会互相替代？**

不会。前者建立多目的交付的参与关系，后者发布特定 MAC/可选 IP 可达性，数据面查找对象不同。

**Type 5 有合法 RT，是否一定进入 IP-VRF？**

不一定。还需要路径有效；使用 Overlay Index 时，相应 Type 1/2 依赖及承载下一跳也要可解析。

**相同 MAC 从两个 VTEP 发布，就一定是环路吗？**

不是。相同 ES 的合法多归属可有多个成员。要结合 ESI、移动序列、接入状态及是否持续异常变化判断。

**全局 EVPN RIB 与 ASIC 中的条目数不同，是否一定有丢路由？**

不是。候选、服务导入、最佳路径、聚合及安装对象的统计口径不同；应针对一个明确对象逐阶段验证。

**EVPN 一定使用 VXLAN，并且只有五类路由吗？**

都不是。EVPN 是控制面技术，可以对应不同承载；本文的五类是常用基础类型，扩展能力需要分别学习。

## 8. 参考资料 {/* #参考资料 */}

- [RFC 7432：BGP MPLS-Based Ethernet VPN](https://www.rfc-editor.org/rfc/rfc7432)
- [RFC 8365：Network Virtualization Overlay Solution Using EVPN](https://www.rfc-editor.org/rfc/rfc8365)
- [FRRouting EVPN 文档](https://docs.frrouting.org/en/latest/evpn.html)
