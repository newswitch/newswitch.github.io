---
title: BGP EVPN 控制面与五类路由
sidebar_label: "04. BGP EVPN 控制面与五类路由"
sidebar_position: 4
tags: [BGP, EVPN, VXLAN, Route Type, ARP Suppression]
description: 从 RD、RT、VNI 到 EVPN 五类路由，理解控制面如何分发 MAC、IP、前缀和多归属信息。
---

# BGP EVPN 控制面与五类路由

VXLAN 只定义了如何封装数据包，并没有规定 VTEP 如何获知远端主机。早期方案依赖 Flood-and-Learn：广播未知单播和 ARP，再从数据面学习 MAC。规模增大后，广播、收敛和排障都会变得困难。

BGP EVPN 的核心价值是：**用 MP-BGP 在控制面发布二层和三层可达性，再由 VXLAN 承载数据面流量。**

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

## 2. 五类常用 EVPN 路由

| 路由类型 | 名称 | 主要用途 | 重点字段 |
|---|---|---|---|
| Type 1 | Ethernet Auto-Discovery | 多归属别名、快速撤销、每 ES/每 EVI 通告 | RD、ESI、Ethernet Tag |
| Type 2 | MAC/IP Advertisement | 发布主机 MAC，可选绑定主机 IP | MAC、IP、ESI、标签/VNI |
| Type 3 | Inclusive Multicast Ethernet Tag | 宣告 VTEP 参与某 VNI 的 BUM 复制树 | Originating Router IP、VNI |
| Type 4 | Ethernet Segment | 多归属 VTEP 之间发现同一 ES，支持 DF 选举 | ESI、Originating Router IP |
| Type 5 | IP Prefix | 发布租户三层前缀、外部路由或汇总路由 | IP Prefix、Gateway IP、L3VNI |

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

这使 Leaf2 可以在本地回答部分 ARP/ND 请求，即 **ARP/ND Suppression**。它减少广播，但也引入一个要求：MAC-IP 绑定必须真实、及时，并且能在主机迁移时正确更新。

### 2.2 Type 3：建立 BUM 复制关系

当 VTEP 加入 L2VNI 时，它发布 Type 3 IMET 路由。其他 VTEP 据此知道 BUM 流量应复制给谁。

Ingress Replication 场景中，一个广播包可能被入口 VTEP复制 N 份。它不需要 Underlay 组播，但 VTEP 数量增大时带宽和复制开销也会增加。

### 2.3 Type 5：租户前缀而非单个主机

Type 2 更适合 MAC/IP 主机路由；Type 5 更适合：

- 数据中心外部网络；
- 防火墙后的业务网段；
- 云或园区汇总前缀；
- 不需要扩展二层的纯三层服务。

如果跨 VTEP 路由需要知道单个主机的 MAC/IP，可依赖 Type 2；如果只需要知道“某前缀经哪个 VTEP/边界节点可达”，Type 5 更清晰。

## 3. 一条 Type 2 路由的生命周期

1. 接入端口 Up，主机发送 ARP、ND 或普通报文。
2. Leaf 在本地 VLAN/FDB 学习源 MAC，并关联 IP。
3. EVPN 进程生成带 RD 的 Type 2 NLRI。
4. BGP 根据导出 RT 发布给 RR。
5. RR 反射给其他 Leaf，不负责租户转发。
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

## 4. MAC 移动如何被控制面处理

主机从 Leaf1 迁移到 Leaf2 后，Leaf2 会用更高的 MAC Mobility Sequence 发布同一 MAC。其他 VTEP选择更新版本，把远端下一跳改为 Leaf2。

排障时要问：

1. 是正常虚机迁移，还是二层环路导致 MAC 在两个端口反复震荡？
2. 新 Type 2 的 Mobility Sequence 是否增加？
3. 旧 VTEP 是否撤销路由？
4. 是否存在静态 MAC、粘滞 MAC 或安全策略阻止移动？

如果 MAC 在短时间内高频迁移，应告警并限制影响，不能只靠“最后一次更新获胜”掩盖环路。

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

### 练习一：RT 导入错误

故意让 Leaf2 的 import RT 与 Leaf1 的 export RT 不同。

要求：

- 证明 BGP 邻居正常；
- 证明 RR 上能看到 Type 2；
- 证明 Leaf2 的目标 VNI 没有导入；
- 修复后验证 FDB、ARP 和业务恢复。

### 练习二：观察 ARP Suppression

在远端已经存在 MAC-IP Type 2 后清空主机 ARP 缓存，再发起访问并抓包。判断 ARP 请求是被本地 VTEP 代理，还是被泛洪到全部 VTEP。

### 掌握标准

你应能在白板上从一个本地 MAC 开始，完整画出 Type 2 的生成、发布、导入和数据面转发过程；看到 Type 1～5 时，能够说清每一种在解决什么问题，而不是背编号。

## 参考资料

- [RFC 7432：BGP MPLS-Based Ethernet VPN](https://www.rfc-editor.org/rfc/rfc7432)
- [RFC 8365：Network Virtualization Overlay Solution Using EVPN](https://www.rfc-editor.org/rfc/rfc8365)
- [FRRouting EVPN 文档](https://docs.frrouting.org/en/latest/evpn.html)
