---
title: "发送路径：从 send 到 NIC TX，数据经过哪些内核组件"
sidebar_label: "02. 发送路径：send 到 NIC TX"
sidebar_position: 2
description: "沿 sendmsg、TCP/UDP、路由、Netfilter、邻居、qdisc、驱动、TX Ring 和 DMA 追踪发送路径。"
tags: [Linux, TX Path, sendmsg, qdisc, NIC Ring]
---

# 发送路径：从 send 到 NIC TX，数据经过哪些内核组件

发送路径同时包含协议控制、路由决策、包构造、排队和设备交接。不同 Socket 类型、Namespace、Netfilter 和卸载配置会改变细节。

## 1. TCP 发送概念路径

```text
应用 send/write
→ Socket 层检查状态和缓冲空间
→ copy/引用用户数据进入发送队列
→ TCP 建立序列空间、分段计划、重传状态
→ IP 路由与源地址选择
→ Netfilter OUTPUT/POSTROUTING 等
→ 邻居解析下一跳二层地址
→ qdisc 排队/整形
→ 驱动映射 DMA、填写 TX descriptors
→ NIC 从主机内存取数据并发出
→ TX completion 回收 descriptors/skb
```

本地进程间通信、loopback、veth、Bridge 和隧道会插入或省略不同步骤。

## 2. send 返回边界

阻塞 TCP send 返回 N，通常表示 N 字节已被本机内核接受；它们可能仍在：

- Socket 发送队列等待窗口。
- qdisc 等待带宽。
- 驱动 TX Ring 等待设备。
- 网络中传输/丢失。
- 对端协议栈接收但应用尚未读取。

需要应用级确认时，必须由协议返回响应，不能用本机 send 成功或 TCP ACK 代替业务提交。

## 3. 路由与邻居

路由决定出口接口、下一跳和源地址；以太网发送还需要下一跳 MAC。直连目标解析目标 MAC，经网关时解析网关 MAC。

```bash
ip route get <destination>
ip neigh show dev <interface>
```

邻居解析未完成时，数据可能暂存在邻居队列；解析失败最终报错或丢弃。

## 4. qdisc 和驱动队列

qdisc 可以执行排队、分类、整形和丢包策略。多队列网卡常有根 qdisc 把流映射到具体 TX queue。驱动把 skb 映射为 DMA 段并写入 descriptor ring；Ring 满会产生 stop/wake queue 和背压。

```bash
tc -s qdisc show dev <interface>
ip -s link show dev <interface>
ethtool -S <interface>
```

不同驱动统计字段名称不同，drop/error 必须结合驱动文档解释。

## 5. 分段卸载改变抓包

TCP 可把大 skb 交给 GSO/TSO，在软件后段或 NIC 处分割为 MTU 大小的线上帧。发送主机较早抓包点可能看到超 MTU 大包和未完成校验和，这不等于线路发送了同样的大帧或错误校验和。

验证线上形态应结合对端抓包、卸载配置和抓包点。

## 6. Zero-copy 边界

`sendfile`、splice、MSG_ZEROCOPY 等可减少某些用户—内核数据复制，但仍有页引用、skb 元数据、DMA 映射、完成通知和错误处理。零拷贝是减少特定复制，不是数据不经过内存和内核。

## 7. 发送慢的分层证据

| 现象 | 可能层次 |
|---|---|
| send 阻塞/EAGAIN | Socket send buffer、对端窗口、拥塞/重传 |
| qdisc backlog/drop 增长 | 出口整形、链路或下层队列 |
| TX Ring busy/stop | 驱动/NIC 消费不及 |
| TCP retrans 增长 | 网络丢包、乱序、对端 ACK 路径 |
| 邻居 INCOMPLETE/FAILED | ARP/ND、二层连通或策略 |

## 8. 练习与答案

**问题：NIC TX completion 是否证明对端 TCP 收到数据？**

答案：不是。它通常表示 NIC/驱动可回收本机描述符和缓冲资源；网络中仍可能丢包，需 TCP ACK 或应用响应提供更高层确认。

**问题：发送主机抓到 64KiB TCP 包是否说明 MTU 是 64KiB？**

答案：不一定，可能是在 TSO/GSO 分段前抓到的大 skb 表示。

下一篇：[接收路径：DMA、IRQ、NAPI 与协议栈](./03-接收路径-DMA-IRQ-NAPI.md)
