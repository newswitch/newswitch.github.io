---
title: MPLS、VRF、RD/RT 与 L3VPN
sidebar_position: 9
tags: [MPLS, VRF, LDP, MP-BGP, L3VPN, RD, RT]
description: 从标签转发和 VRF 隔离开始，理解 MPLS L3VPN 控制面、数据面、RD/RT 与分层排障。
---

# MPLS、VRF、RD/RT 与 L3VPN

## 1. 先区分 VRF、MPLS 与 VPN

- **VRF**：在一台设备上维护相互隔离的路由和转发表。
- **MPLS**：在转发路径中使用短标签栈，而不是每跳只查 IP 前缀。
- **L3VPN**：利用 VRF、MP-BGP 和 MPLS 等机制，为多个租户提供隔离的三层网络。

MPLS VPN 默认不提供加密。“VPN”在这里主要表示逻辑隔离，不等于 IPsec。

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

## 6. RD 解决地址唯一性

不同租户可以使用相同 IPv4 前缀。MP-BGP 将 RD 与 IPv4 前缀组合成 VPNv4 唯一地址：

```text
65000:100:10.0.0.0/24
65000:200:10.0.0.0/24
```

RD 主要用于让重叠前缀在 BGP 中唯一；它不直接决定谁导入这条路由。

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

RT 是安全和隔离边界，必须纳入自动校验。

## 8. MP-BGP VPNv4 控制面

入口 PE 从 CE 学到 IPv4 路由后：

1. 放入对应 VRF。
2. 加上 RD 转成 VPNv4 NLRI。
3. 附加 Export RT。
4. 附加出口使用的 VPN Label。
5. 通过 MP-BGP 发布给远端 PE 或 Route Reflector。

远端 PE：

1. 接收 VPNv4 路由。
2. 根据 Import RT 选择目标 VRF。
3. 安装租户路由和标签转发信息。

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

## 13. 参考资料

- [RFC 3031: Multiprotocol Label Switching Architecture](https://www.rfc-editor.org/rfc/rfc3031)
- [RFC 4364: BGP/MPLS IP Virtual Private Networks](https://www.rfc-editor.org/rfc/rfc4364)
- [FRRouting LDP Documentation](https://docs.frrouting.org/en/latest/ldpd.html)

[下一篇：网络故障排查方法与工具 →](./10-网络故障排查方法与工具.md)
