---
title: "Network Namespace、veth、Bridge 与 VXLAN：容器网络怎样组成"
sidebar_label: "13. Network Namespace、veth、Bridge 与 VXLAN"
sidebar_position: 13
description: "解释网络命名空间隔离、veth 成对设备、Linux Bridge、路由、VXLAN 封装和 Kubernetes Pod 路径。"
tags: [Linux, Network Namespace, veth, Bridge, VXLAN]
---

# Network Namespace、veth、Bridge 与 VXLAN：容器网络怎样组成

Network Namespace 隔离网络设备、地址、路由、端口、Netfilter 等视图；veth 像一根跨 Namespace 的虚拟网线；Bridge 在二层转发；VXLAN 把二层帧封装进 UDP/IP 穿越三层网络。

## 1. Network Namespace 中有什么

每个 netns 拥有自己的：

- 网络接口和 loopback。
- IPv4/IPv6 地址与路由表。
- ARP/ND 邻居表。
- Socket 端口空间。
- Netfilter/conntrack 相关实例或视图。
- 多数网络 sysctl。

```bash
lsns -t net
readlink /proc/<PID>/ns/net
nsenter -t <PID> -n ip addr
```

## 2. veth pair

从一端发送的帧会在另一端接收：

```text
Pod eth0 (veth A)
      ║
Host veth B
```

两端可以放在不同 Namespace。veth 有自己的 qdisc、统计和 MTU，宿主机端名称通常由 CNI 管理。

## 3. Linux Bridge

Bridge 学习源 MAC 与端口映射，根据 FDB 转发二层帧；未知单播/广播可泛洪。Bridge 端口可以是 veth、物理口、tap 或 VXLAN 设备。

```bash
bridge link
bridge fdb show
ip -d link show type bridge
```

Bridge 不自动等于 IP 路由器。主机可同时在 Bridge 上配置三层地址，使其既参与二层转发又在本机终止/路由流量。

## 4. VXLAN

VXLAN 把内层 Ethernet Frame 封装为外层 UDP/IP：

```text
Inner Ethernet/IP/Transport
→ VXLAN header（VNI）
→ Outer UDP
→ Outer IP
→ Outer Ethernet
```

VNI 标识逻辑二层网络；VTEP 负责封装/解封装。额外头部降低可用 MTU，底层 MTU 若未预留会产生分片或 PMTU 黑洞。

## 5. Kubernetes Pod 跨节点示例

```text
Pod A eth0
→ veth host side
→ Bridge/路由/eBPF 数据面
→ 可选 VXLAN 封装
→ 物理 NIC
→ Underlay 网络
→ 目标节点解封装
→ 目标 veth
→ Pod B eth0
```

Calico、Cilium、Flannel 等模式可能使用纯路由、VXLAN、IP-in-IP、eBPF 或云路由，不能用一张路径套全部集群。

## 6. 抓包分层

同一个请求可在 Pod eth0、宿主机 veth、VXLAN、物理 NIC 多点抓包。外层抓包看到节点 IP 和 UDP 端口，内层看到 Pod IP；只在一个点抓包可能误判 NAT、MTU 或丢包位置。

## 7. 练习与答案

**问题：两个 Pod 都有 eth0，是否是同一设备？**

答案：不是。它们位于各自 Network Namespace，名称可相同；通常分别连接不同 veth 对端。

**问题：VXLAN 下 Pod MTU 为什么通常小于物理网卡 MTU？**

答案：外层 Ethernet/IP/UDP/VXLAN 头部占用额外字节，需要给封装预留空间，避免外层超过 Underlay MTU。

下一篇：[丢包、重传与延迟分层排查](./14-丢包重传与延迟分层排查.md)
