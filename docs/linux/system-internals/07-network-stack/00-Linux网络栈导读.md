---
title: "Linux 网络栈导读：从 Socket 到网卡与对端应用"
sidebar_label: "00. Linux 网络栈导读"
sidebar_position: 0
description: "沿发送与接收路径建立 Socket、TCP/IP、路由、Netfilter、qdisc、NAPI、驱动和网卡的整体模型。"
tags: [Linux, 网络栈, Socket, TCP, NAPI]
---

# Linux 网络栈导读：从 Socket 到网卡与对端应用

应用 `send()` 成功只表示本机内核在相应语义下接受了数据，不表示网卡已发送、对端 TCP 已确认或对端应用已处理。网络排障必须给每个“成功”找到准确边界。

## 1. 发送与接收全景

```mermaid
flowchart LR
    APP["应用"] --> SOCK["Socket"]
    SOCK --> TCP["TCP/UDP"]
    TCP --> IP["IP 路由/Netfilter"]
    IP --> Q["qdisc"]
    Q --> DRV["驱动 TX Ring"]
    DRV --> NIC["NIC"]
    NIC --> WIRE["网络"]
    WIRE --> RNIC["对端 NIC"]
    RNIC --> NAPI["IRQ/NAPI/GRO"]
    NAPI --> RIP["L2/IP/Netfilter"]
    RIP --> RTCP["TCP/UDP Socket Queue"]
    RTCP --> RAPP["对端应用"]
```

中间可以插入 Namespace、veth、Bridge、VXLAN、iptables/nftables、conntrack、代理、Service 转发和多块网卡，实际路径需要按目标 Namespace 与设备拓扑展开。

## 2. 网络问题的五类资源

| 资源 | 典型限制 |
|---|---|
| 连接/状态 | fd、端口、SYN backlog、accept queue、conntrack |
| 缓冲/队列 | Socket buffer、qdisc、NIC Ring、NAPI backlog |
| CPU | softirq、协议栈、加密、单队列热点 |
| 带宽/包率 | 链路 bps、pps、设备/虚拟化能力 |
| 路径与策略 | 路由、邻居、MTU、Netfilter、策略路由 |

CPU 总利用率低时仍可能一个 RX queue/softirq CPU 饱和；带宽低时仍可能小包 PPS 达到极限。

## 3. 本模块文章

1. [Socket 对象与缓冲区](./01-Socket对象与缓冲区.md)
2. [发送路径：从 send 到 NIC TX](./02-发送路径-send到NIC-TX.md)
3. [接收路径：DMA、IRQ、NAPI 与协议栈](./03-接收路径-DMA-IRQ-NAPI.md)
4. [sk_buff 生命周期](./04-sk_buff生命周期.md)
5. [路由、策略路由与邻居子系统](./05-路由策略路由与邻居子系统.md)
6. [TCP 连接生命周期](./06-TCP连接生命周期.md)
7. [TCP 可靠性、流控与拥塞控制](./07-TCP可靠性流控与拥塞控制.md)
8. [UDP、分片与 ICMP 错误](./08-UDP分片与ICMP错误.md)
9. [Netfilter、Conntrack 与 NAT](./09-Netfilter-Conntrack与NAT.md)
10. [网络队列与 Backlog](./10-网络队列与Backlog.md)
11. [qdisc 与流量控制](./11-qdisc与流量控制.md)
12. [多队列、RSS、RPS、XPS 与卸载](./12-多队列RSS-RPS-XPS与卸载.md)
13. [Network Namespace、veth、Bridge 与 VXLAN](./13-Network-Namespace-veth-Bridge与VXLAN.md)
14. [丢包、重传与延迟分层排查](./14-丢包重传与延迟分层排查.md)

## 4. 观察点必须标明 Namespace

```bash
ss -s
ip route get 1.1.1.1
ip neigh
ip -s link
cat /proc/net/softnet_stat
```

容器内与宿主机看到的 Socket、接口、路由、Netfilter 和 `/proc/net` 可能属于不同 Network Namespace。进入正确 Namespace 是所有证据的前提。

## 5. 掌握标准

能画出包在主机内的发送/接收路径；能区分 Socket 队列、qdisc、NIC Ring 和 conntrack；能说明 TCP ACK、应用 read 和业务成功的边界；能用计数器、抓包和内核路径定位丢包究竟发生在哪一层。

下一篇：[Socket 对象与缓冲区](./01-Socket对象与缓冲区.md)
