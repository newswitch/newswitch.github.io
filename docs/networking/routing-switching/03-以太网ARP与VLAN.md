---
title: 以太网、MAC、ARP、VLAN 与 Linux Bridge
sidebar_position: 3
tags: [Ethernet, MAC, ARP, VLAN, Trunk, Linux Bridge]
description: 从以太网帧、MAC 学习和 ARP 开始，理解 VLAN 隔离、Access/Trunk 与 Linux Bridge 实验。
---

# 以太网、MAC、ARP、VLAN 与 Linux Bridge

## 1. 交换机如何转发帧

二层交换机主要维护 Forwarding Database（FDB）：

```text
VLAN + 目的 MAC → 出端口
```

交换机收到帧后：

1. 用源 MAC 学习“这个地址来自哪个端口”。
2. 查找目的 MAC。
3. 已知单播：只转发到对应端口。
4. 未知单播：在同一 VLAN 内泛洪。
5. 广播：在同一 VLAN 内泛洪。
6. 目的 MAC 位于入端口：过滤，不再原路发回。

因此，MAC 表是通过数据面流量学习的，会老化；它不是路由协议发布的全局目录。

## 2. 以太网帧

常见 Ethernet II 帧：

```text
Destination MAC | Source MAC | EtherType | Payload | FCS
```

- EtherType `0x0800`：IPv4。
- EtherType `0x0806`：ARP。
- EtherType `0x86DD`：IPv6。
- 带 802.1Q 标签时会增加 VLAN Tag。

抓包：

```bash
tcpdump -eni eth0
```

`-e` 会显示链路层头部。若网卡执行 VLAN 或校验和卸载，主机抓包看到的内容可能与
线上线速报文略有差异，应结合 `ethtool -k` 判断。

## 3. ARP 解决什么问题

IPv4 主机知道下一跳 IP 后，需要 ARP 将它解析为 MAC。

```text
ARP Request：谁拥有 10.0.0.1？请告诉 10.0.0.10
ARP Reply：10.0.0.1 的 MAC 是 02:00:00:00:00:01
```

查看邻居表：

```bash
ip neigh show
```

常见状态：

- `REACHABLE`：近期确认可达。
- `STALE`：表项仍可用，但需要后续确认。
- `DELAY`/`PROBE`：正在进行可达性确认。
- `INCOMPLETE`：解析尚未完成。
- `FAILED`：多次探测无响应。

连续 `FAILED` 优先检查 VLAN、端口状态、掩码、对端地址是否存在，而不是手工永久
写静态邻居表掩盖问题。

## 4. VLAN 是广播域隔离

VLAN 将一套物理交换网络拆成多个逻辑广播域。同一个 MAC 可以在不同 VLAN 中出现，
所以真实 FDB 的键通常是 `VLAN + MAC`。

### Access 端口

- 接收终端发来的无标签帧。
- 在内部将帧归入端口的 PVID/VLAN。
- 发往终端时通常移除 VLAN 标签。

### Trunk 端口

- 在同一物理链路承载多个 VLAN。
- 依赖 802.1Q 标签区分广播域。
- Native/PVID 处理因厂商而异，错配会导致泄漏或单向通信。

VLAN 只提供二层隔离。不同 VLAN 互通仍需要三层网关和路由策略。

## 5. Linux Bridge 心智模型

Linux bridge 是内核中的二层交换机。物理接口、veth、虚拟机 Tap 接口都可以成为
Bridge Port。

关键查看命令：

```bash
bridge link
bridge fdb show
bridge vlan show
ip -d link show type bridge
```

## 6. VLAN-aware Bridge 实验

拓扑：

```text
h10 ── p10 [VLAN 10] ┐
                      br0
h20 ── p20 [VLAN 20] ┘
```

创建 bridge、namespace 和端口：

```bash
sudo ip link add br0 type bridge vlan_filtering 1
sudo ip link set br0 up

sudo ip netns add h10
sudo ip netns add h20
sudo ip link add p10 type veth peer name e10
sudo ip link add p20 type veth peer name e20
sudo ip link set e10 netns h10
sudo ip link set e20 netns h20
sudo ip link set p10 master br0
sudo ip link set p20 master br0
sudo ip link set p10 up
sudo ip link set p20 up

sudo ip -n h10 addr add 10.0.0.10/24 dev e10
sudo ip -n h20 addr add 10.0.0.20/24 dev e20
sudo ip -n h10 link set lo up
sudo ip -n h20 link set lo up
sudo ip -n h10 link set e10 up
sudo ip -n h20 link set e20 up
```

配置 Access VLAN：

```bash
sudo bridge vlan del dev p10 vid 1
sudo bridge vlan del dev p20 vid 1
sudo bridge vlan add dev p10 vid 10 pvid untagged
sudo bridge vlan add dev p20 vid 20 pvid untagged
sudo bridge vlan show
```

虽然两台主机 IP 在同一 `/24`，但处于不同 VLAN，ARP 广播无法到达对方：

```bash
sudo ip netns exec h10 ping -c 2 10.0.0.20
sudo ip -n h10 neigh
```

将 p20 改到 VLAN 10：

```bash
sudo bridge vlan del dev p20 vid 20
sudo bridge vlan add dev p20 vid 10 pvid untagged
sudo ip netns exec h10 ping -c 2 10.0.0.20
sudo bridge fdb show br br0
```

这次应该可以通信，并在 FDB 中看到两个 MAC。

清理：

```bash
sudo ip netns del h10
sudo ip netns del h20
sudo ip link del br0
```

## 7. Trunk 验证方法

排查 Trunk 不要只看“端口是 up”：

1. 两端允许 VLAN 列表是否一致。
2. Native/PVID 是否一致。
3. 目标 VLAN 是否在中间所有链路存在。
4. MAC 是否在期望 VLAN 和端口学习。
5. 抓包中是否存在预期 802.1Q Tag。
6. 是否有 STP 阻塞或端口安全策略。

```bash
tcpdump -eni eth0 vlan
bridge vlan show
bridge fdb show
```

## 8. 广播、未知单播与多播

BUM 代表 Broadcast、Unknown Unicast、Multicast。规模扩大后，BUM 泛洪会消耗链路
和主机处理能力。传统 VLAN 依赖树状二层域限制环路；VXLAN/EVPN 则需要额外处理
远端 VTEP 之间的 BUM 复制和地址学习。

这也是后续学习 EVPN Type 3、ARP 抑制和 Head-End Replication 的基础。

## 9. 常见故障

| 现象 | 关键证据 |
| --- | --- |
| ARP 一直 INCOMPLETE | ARP Request 是否离开、VLAN 是否一致、Reply 是否返回 |
| 同 VLAN 部分主机不通 | MAC 漂移、端口安全、链路聚合哈希、错误 Trunk |
| 单向通信 | Native VLAN 错配、ACL、非对称链路、MAC 学习错误 |
| 改线后短暂黑洞 | 旧 FDB、ARP 缓存、环路保护或收敛延迟 |
| 广播异常升高 | 二层环路、未知单播、故障网卡或地址扫描 |

## 10. 参考资料

- [RFC 826: Address Resolution Protocol](https://www.rfc-editor.org/rfc/rfc826)
- [Linux Kernel Ethernet Bridging](https://docs.kernel.org/networking/bridge.html)
- [bridge(8) manual](https://man7.org/linux/man-pages/man8/bridge.8.html)

[下一篇：STP 与链路聚合 →](./04-STP与链路聚合.md)
