---
title: "静态路由、OSPF、ECMP 与 BFD"
sidebar_label: "06. 静态路由、OSPF、ECMP 与 BFD"
sidebar_position: 6
description: "从 RIB/FIB 进入动态路由，理解 OSPF 邻居、LSDB、SPF、ECMP 哈希和 BFD 快速故障检测。"
tags: [Static Route, OSPF, ECMP, BFD, FRRouting]
---

# 静态路由、OSPF、ECMP 与 BFD

## 1. 静态路由的价值与边界

静态路由结构简单、行为可预测，适合：

- 小规模 Stub 网络。
- 明确的默认出口。
- 管理或应急路径。
- 与动态协议配合的汇总、黑洞和浮动备份。

它的边界是：拓扑变化不会自动传播。接口仍为 Up 但远端链路断开时，静态下一跳
可能继续存在，形成黑洞。

## 2. 动态路由做了什么

动态路由协议不是直接转发业务包，而是：

1. 发现邻居或建立会话。
2. 交换可达性和拓扑信息。
3. 根据协议算法选出最佳路径。
4. 将结果提交到 RIB。
5. 由系统将最佳路由编程到 FIB。

因此，邻居 Established/Full 只是控制面的一环。

## 3. OSPF 心智模型

OSPF 是链路状态 IGP。每台路由器通过 LSA 描述自己的链路状态，在区域内泛洪，
最终形成一致的 Link-State Database，再独立运行 SPF 算法。

```mermaid
flowchart LR
    A["Hello 发现邻居"] --> B["建立邻接关系"]
    B --> C["同步 LSDB"]
    C --> D["LSA 泛洪"]
    D --> E["SPF 计算"]
    E --> F["安装 OSPF 路由"]
    F --> G["编程 FIB"]
```

### 3.1 邻居状态 {/* #邻居状态 */}

常见状态：

```text
Down → Init → 2-Way → ExStart → Exchange → Loading → Full
```

- 停在 Init：通常只收到对端 Hello，对端没有看到本端。
- 停在 ExStart/Exchange：常见 MTU、主从协商或链路质量问题。
- Full 后反复重建：检查丢包、CPU、定时器、BFD 和接口抖动。

### 3.2 DR/BDR {/* #drbdr */}

广播多访问网络上，若所有路由器两两建立完整邻接，规模会快速增长。DR/BDR 用于
减少邻接和 LSA 交换复杂度。点到点链路不需要 DR 选举。

### 3.3 Area {/* #area */}

Area 0 是骨干区域。多区域用于限制 LSDB 和 SPF 影响范围，但也引入 ABR、汇总、
Stub/NSSA 和故障排查复杂度。规模不大时不要为了“架构高级”过早分区。

### 3.4 常见 LSA {/* #常见-lsa */}

| 类型 | 作用 |
| --- | --- |
| Type 1 | Router LSA，描述区域内路由器链路 |
| Type 2 | Network LSA，由 DR 描述多访问网段 |
| Type 3 | Summary LSA，ABR 在区域间通告前缀 |
| Type 5 | External LSA，ASBR 注入外部路由 |
| Type 7 | NSSA 内的外部路由，边界处转换 |

## 4. OSPF 邻居建立条件

两端至少检查：

- 接口是否 Up、IP/掩码是否符合设计。
- Area ID 是否一致。
- Hello/Dead Timer 是否一致。
- 网络类型是否兼容。
- 认证是否一致。
- Router ID 是否唯一。
- MTU 是否导致数据库交换失败。
- ACL/防火墙是否允许 OSPF IP Protocol 89。

不要通过“把所有参数都改成一样”替代理解状态机停在哪一步。

## 5. FRRouting 配置示例

三台路由器：

```text
r1 -- 10.0.12.0/30 -- r2 -- 10.0.23.0/30 -- r3
```

r1：

```text
router ospf
 ospf router-id 1.1.1.1
 network 10.0.12.0/30 area 0
 network 1.1.1.1/32 area 0
```

r2：

```text
router ospf
 ospf router-id 2.2.2.2
 network 10.0.12.0/30 area 0
 network 10.0.23.0/30 area 0
 network 2.2.2.2/32 area 0
```

r3：

```text
router ospf
 ospf router-id 3.3.3.3
 network 10.0.23.0/30 area 0
 network 3.3.3.3/32 area 0
```

验证：

```text
show ip ospf neighbor
show ip ospf database
show ip ospf route
show ip route ospf
show ip route 3.3.3.3/32
```

验证顺序是邻居、LSDB、协议路由、系统路由，而不是只执行 `ping`。

## 6. ECMP

当多条路径前缀长度、协议优先级和代价满足等价条件时，系统可安装多个下一跳。

```text
10.20.0.0/16
  nexthop via 192.0.2.1 dev eth1
  nexthop via 192.0.2.5 dev eth2
```

数据面通常对流哈希：

```text
hash(源/目的 IP、协议、源/目的端口) → 某个下一跳
```

要点：

- 单流通常只走一条路径。
- 多流分布可能不完全均匀。
- 哈希字段和 Seed 因设备而异。
- 成员变化会重新映射一部分流。
- 非对称路径可能影响状态防火墙、NAT 和故障定位。

测试 ECMP 不能只运行一个 `iperf3` 流。

## 7. BFD

路由协议 Hello 定时器通常以秒计。BFD 提供轻量、快速、协议无关的双向可达性检测，
并把会话 Down 通知给 OSPF、BGP 或静态路由。

```text
物理链路仍 Up
→ BFD 连续丢失控制包
→ BFD 会话 Down
→ 路由协议撤销邻接/路径
→ RIB/FIB 收敛
```

BFD 只加快故障检测，不自动保证业务恢复。总恢复时间还包括控制面传播、FIB 编程、
ARP/邻居更新和应用重试。

过激定时器会让 CPU 抖动或瞬时拥塞变成大规模邻居重建。定时器应基于平台能力、
链路质量和故障预算验证。

FRR 示例：

```text
bfd
 peer 10.0.12.2
  no shutdown
 !
!
interface eth1
 ip ospf bfd
```

验证：

```text
show bfd peers
show ip ospf neighbor
show ip route
```

## 8. 收敛时间分解

一次故障的端到端恢复时间：

```text
T_total =
  T_detect
  + T_protocol
  + T_rib_fib
  + T_neighbor
  + T_application
```

测量时应记录每个时间点，而不是只写“切换约 3 秒”。

## 9. 故障实验

至少完成以下实验：

1. OSPF 两端 Area 不一致，观察邻居状态和日志。
2. 两端 MTU 不一致，观察是否停在 ExStart/Exchange。
3. 构建两条等价路径，用多个五元组观察 ECMP 分布。
4. 关闭一条链路，分别比较 OSPF 原生检测与 BFD 的恢复时间。
5. 在链路上注入丢包，验证过激 BFD 定时器是否产生误切换。

每次实验保存：

```text
故障前邻居与路由快照
故障注入时间
协议状态变化
FIB 变化
业务丢包窗口
恢复后状态
```

## 10. 常见误区

- OSPF Full 就说明所有网段都可达：还要检查 LSA、路由选择和 FIB。
- BFD 越快越好：错误定时器会放大瞬时抖动。
- ECMP 等于链路带宽线性叠加：单流和哈希倾斜会限制利用率。
- 所有 OSPF External 都应进入骨干：错误重分发会形成环路和路由风暴。
- 多区域必然更稳定：额外边界也会增加汇总和故障复杂度。

## 11. 参考资料

- [RFC 2328: OSPF Version 2](https://www.rfc-editor.org/rfc/rfc2328)
- [RFC 5880: Bidirectional Forwarding Detection](https://www.rfc-editor.org/rfc/rfc5880)
- [FRRouting OSPF Documentation](https://docs.frrouting.org/en/latest/ospfd.html)
- [FRRouting BFD Documentation](https://docs.frrouting.org/en/latest/bfd.html)

[下一篇：BGP 原理、策略与双出口 →](./07-BGP原理策略与双出口实验.md)
