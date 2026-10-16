---
title: "Netfilter、Conntrack 与 NAT：包在主机内何时被过滤和改写"
sidebar_label: "09. Netfilter、Conntrack 与 NAT"
sidebar_position: 9
description: "解释 Netfilter Hook、iptables/nftables、连接跟踪状态、NAT 映射、表满丢包和 Kubernetes Service 关联。"
tags: [Linux, Netfilter, Conntrack, NAT, iptables]
---

# Netfilter、Conntrack 与 NAT：包在主机内何时被过滤和改写

Netfilter 在 IPv4/IPv6 包路径设置 Hook，iptables/nftables 等规则系统在这些位置过滤、标记、跟踪或改写包。规则顺序必须结合包是本地输入、本地产生还是转发来解释。

## 1. 五个经典 Hook

```text
入站设备
  → PREROUTING
  → 路由判断
     ├→ 本机：INPUT → 本地 Socket
     └→ 转发：FORWARD → POSTROUTING → 出站设备

本地产生：OUTPUT → 路由/处理 → POSTROUTING → 出站设备
```

Bridge、路由、隧道、Network Namespace 和 eBPF 可使路径更复杂，不能机械认为每个包一定经过所有 Hook。

## 2. Conntrack 记录什么

连接跟踪为双向流维护 tuple、状态、超时和 NAT 关联：

- TCP 根据握手/关闭等状态推进。
- UDP 没有握手，按观察到的双向流和超时维护伪连接状态。
- RELATED 可表示与已有连接相关的新流或 ICMP 错误。

`ESTABLISHED` conntrack 状态与 TCP Socket 的 `ESTABLISHED` 不是完全相同层次。

## 3. NAT

DNAT 改目的地址/端口，SNAT/MASQUERADE 改源地址/端口。通常在流的首包建立映射，后续包按 conntrack 状态快速应用双向转换。

NAT 改写后需要增量更新或重新计算校验和，并受端口资源、哈希表和状态超时影响。

## 4. 表满为什么静默超时

```bash
sysctl net.netfilter.nf_conntrack_count net.netfilter.nf_conntrack_max
journalctl -k | grep -i conntrack
conntrack -S 2>/dev/null
```

表满或插入失败时，新流包可能被丢弃，表现为偶发连接超时、重试成功，已有连接可能仍工作。只调大 max 会增加内存并延迟再次耗尽，还要找短连接、扫描、超时和流量模型根因。

## 5. 规则性能和可观测性

iptables 规则、nftables 集合、conntrack 和 eBPF Service 数据面具有不同匹配结构和可观测接口。规则数量大不自动等于性能差，需测新建连接路径、每包成本和 CPU Cache 行为。

```bash
nft list ruleset
iptables-save
conntrack -L 2>/dev/null | head
```

规则与状态可能包含敏感地址/端口，采集时遵守安全边界。

## 6. Kubernetes Service

iptables/ipvs/eBPF 模式会把 ClusterIP/NodePort 流量映射到后端 Pod，并可能使用 conntrack/NAT。Pod IP 直连正常、ClusterIP 超时，说明应重点检查 Service 数据面、conntrack、后端选择、SNAT 和返回路径，但不能预先断定唯一根因。

## 7. 练习与答案

**问题：把 INPUT 链放行是否能解决所有转发流量？**

答案：不能。本机终止流量走 INPUT，路由转发主要经过 FORWARD，本地产生走 OUTPUT；还要考虑其他 Hook、table 和 Namespace。

**问题：conntrack count 接近 max，为什么调大上限不是完整修复？**

答案：根因可能是连接速率、异常扫描、过长超时或应用短连接；增大上限提高内存消耗，只改变耗尽时间。

下一篇：[网络队列与 Backlog](./10-网络队列与Backlog.md)
