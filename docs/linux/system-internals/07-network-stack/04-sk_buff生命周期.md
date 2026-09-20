---
title: "skbuff 生命周期：Linux 网络包的元数据与缓冲布局"
sidebar_label: "04. skbuff 生命周期"
sidebar_position: 4
description: "解释 skb 头部与数据区、headroom/tailroom、clone、non-linear fragments、GSO/GRO 和释放记账。"
tags: [Linux, sk_buff, skb, GSO, GRO]
---

# skbuff 生命周期：Linux 网络包的元数据与缓冲布局

`sk_buff`（skb）是 Linux 网络栈最核心的数据结构之一，但它不是“固定包含一个线上包的连续数组”。它同时保存协议元数据、指针、设备/路由信息以及线性或分片数据。

## 1. 缓冲布局

```text
head                                              end
 │                                                  │
 ├─ headroom ─┬─ 当前线性数据 ───────┬─ tailroom ──┤
              data                  tail

skb 元数据还可引用 page fragments / frag_list
```

发送时可向 headroom 前推加入 TCP/IP/Ethernet 头；接收解析时 data 指针逐层推进。这样减少为每层重新分配和复制整个包。

## 2. skb 保存什么

典型元数据包括：

- 长度、协议和 checksum 状态。
- MAC/Network/Transport header 偏移。
- 输入/输出 net_device。
- 路由目的缓存。
- Socket 所有权和内存记账。
- 时间戳、mark、priority、VLAN 信息。
- GSO 类型和分段大小。

字段依内核配置和版本变化，源码阅读应固定版本。

## 3. Clone 与 Copy

多个处理路径可 clone skb 共享底层数据区，只复制元数据并增加引用；需要修改共享数据时可能触发 copy/expand。抓包、Bridge、Netfilter 和重传都会涉及生命周期管理。

“clone 是零拷贝”只表示某一步共享数据，不代表整条路径没有任何复制或引用维护。

## 4. Non-linear skb

大数据可由线性头部加多个 page fragment 组成。网卡 scatter-gather 能直接 DMA 多段；某些协议/程序需要连续数据时，内核可能 linearize，产生额外 CPU 和复制成本。

## 5. GSO/GRO 与“一包”的含义

- GSO/TSO 允许一个大 skb 表示未来多个线上分段。
- GRO 把多个接收包聚合成一个较大 skb 供上层处理。

因此不同 hook、tracepoint 和抓包点统计的 packets/bytes 含义可能不同。性能分析必须说明观察位置是在分段前还是聚合后。

## 6. skb 内存压力

高包率、队列积压、重传和应用读取慢会增加 skb/slab 占用。单个小包的元数据比例可能很高，PPS 限制常先于带宽限制。

```bash
cat /proc/net/sockstat
slabtop -o | grep -i -E 'skbuff|sock|TCP'
ss -m
```

## 7. 释放时机

发送 skb 可能在 NIC 完成后释放，也可能因 TCP 重传/确认状态保留相关数据；接收 skb 在协议栈消费、排队或丢弃后释放。异步设备访问完成前不能提前复用 DMA 缓冲。

## 8. 练习与答案

**问题：一个 skb 是否永远等于一个 Ethernet Frame？**

答案：不是。GSO/TSO 下一个大 skb 可对应多个未来帧，GRO 下一个 skb 可聚合多个接收包；隧道还可能同时保存内外层头信息。

**问题：skb clone 后两份能否任意修改同一数据区？**

答案：不能。共享数据需要遵守引用和可写性规则，修改路径可能先复制或扩展。

下一篇：[路由、策略路由与邻居子系统](./05-路由策略路由与邻居子系统.md)
