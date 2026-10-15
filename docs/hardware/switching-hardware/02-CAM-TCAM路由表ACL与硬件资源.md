---
title: "CAM、TCAM、路由表、ACL 与硬件资源"
sidebar_label: "02. CAM、TCAM 与表项资源"
sidebar_position: 2
description: "理解 SRAM、CAM、TCAM、LPM、Exact Match、ACL Key 宽度和硬件 Profile，定位表项耗尽与配置下发失败。"
tags: [CAM, TCAM, ACL, LPM, FIB]
---

# CAM、TCAM、路由表、ACL 与硬件资源

交换机的数据面内存不是一块可任意分配的普通 RAM。不同查找类型依赖不同硬件结构，表项数量还受 Key 宽度、Action、Profile 和芯片切片影响。

## 1. SRAM、CAM 与 TCAM

| 结构 | 查找特点 | 常见用途 |
| --- | --- | --- |
| SRAM/Hash | 地址或 Exact Match | MAC、邻居、会话、Counter |
| CAM | 按内容精确匹配 | Exact Match 表 |
| TCAM | 0/1/通配并行匹配 | ACL、Prefix、策略匹配 |
| Algorithmic LPM | 算法与 SRAM 组合 | 大规模路由前缀 |

具体 ASIC 的实现可能不同，不能用通用定义推断某型号的固定容量。

## 2. 为什么 TCAM 昂贵

TCAM 可以在一个查找周期内并行比较大量带通配符 Key，但代价是面积、功耗和容量。ACL 中每增加字段可能扩大 Key Width，使一条逻辑规则占用多个物理 Slice。

```text
规则 A：Src IP + Dst IP
规则 B：IPv6 Src/Dst + L4 Port + VLAN + Metadata

逻辑上都是 1 条规则，物理占用可能完全不同。
```

因此不能只用“ACL 条数”估算 TCAM。

## 3. Exact Match、LPM 与 Priority

- Exact Match：整个 Key 相等，例如某些 MAC/邻居项；
- LPM：选择最长匹配前缀，用于 IP Route；
- Ternary/Priority：通配匹配并按优先级选规则，常用于 ACL；
- Range Match：端口范围等可能展开或占用专用 Comparator。

同一条策略在不同 ASIC 上可能采用不同资源组合。

## 4. 从 RIB 到硬件

```text
Routing Protocol
→ RIB 选择最佳路由
→ FIB / Next Hop
→ SDK / Driver 下发
→ ASIC Table
```

控制面存在不代表硬件下发成功。失败可能来自：

- Route/Host/Next-Hop 表满；
- ECMP Group/Member 耗尽；
- ACL/TCAM Bank 耗尽；
- 邻居未解析；
- SDK 同步异常；
- 芯片某 Slice 或 Pipe 局部资源耗尽。

## 5. Hardware Profile

许多平台允许在重启前选择资源模板，例如在 IPv4 Route、IPv6 Route、ACL、Tunnel 和 Host 表之间分配更多 Bank。代价是增加一类容量会减少另一类。

变更 Profile 通常会影响整个转发芯片并需要重启，必须先：

1. 导出当前资源占用和峰值；
2. 估算未来路由、邻居、ACL 和 Overlay 增长；
3. 核对 Feature 与 Profile 兼容性；
4. 在同型号实验设备验证；
5. 准备配置与回滚。

## 6. IPv6、Overlay 与资源放大

IPv6 地址更宽，VXLAN/EVPN 又增加 VNI、Tunnel、Remote VTEP 和 Inner/Outer 表项。资源增长可能不是租户数的一次函数：

```text
租户
× VRF/VNI
× 路由/邻居
× VTEP
× 策略维度
```

规划时应根据实际对象展开后的硬件资源，而不是只数配置行。

## 7. ACL 顺序与展开

ACL 可能因以下原因产生隐式展开：

- Port Range 拆成多个可匹配前缀；
- 同一策略应用到多个 Port/VLAN/VRF；
- IPv4 与 IPv6 使用不同 Key；
- 双向策略生成两个方向规则；
- Logging/Counter/Mirror 绑定额外资源。

优化规则时要保留语义和优先级，不能仅为省表项随意合并。

## 8. 资源水位与告警

建议监控：

- Route/Host/Neighbor/Next-Hop；
- ECMP Group 与 Member；
- MAC/FDB；
- ACL/TCAM 各 Bank；
- Tunnel/VNI/VTEP；
- Mirror、Counter、Policer；
- 每个 ASIC/Pipe/Slice 的局部水位。

全局 60% 不代表安全，某个 Pipe 的关键 Bank 可能已接近 100%。

## 9. 排障流程

1. 区分配置接受、控制面生成和硬件下发；
2. 查找同一时间的 SDK/Resource 错误；
3. 查看具体资源池而非系统总内存；
4. 比较故障对象和成功对象的 Key/Scope；
5. 核对 Profile、Feature 依赖和 ASIC 局部性；
6. 清理必须确认引用关系，避免误删共享 Next Hop；
7. 扩容、分片或更换 Profile 后做容量回归。

## 10. 练习与答案

**问题：删除 1000 条 IPv4 路由后，为什么 ACL 仍无法下发？**

答案：IPv4 Route 和 ACL 可能使用不同 Bank/表结构。释放路由资源不会自动释放 TCAM ACL 资源。

**问题：同样 100 条 ACL，IPv6 规则为什么可能占用更多硬件？**

答案：IPv6 Key 更宽，叠加端口、VLAN 和元数据后可能跨多个 Slice，单条逻辑规则的物理占用更高。
