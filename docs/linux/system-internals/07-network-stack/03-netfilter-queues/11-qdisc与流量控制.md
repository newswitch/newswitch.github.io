---
title: "qdisc 与流量控制：排队、整形、调度和丢包发生在哪里"
sidebar_label: "11. qdisc 与流量控制"
sidebar_position: 11
description: "解释 Linux qdisc、class/classifier/action、shaping/policing、fq_codel、HTB、多队列与队列时延。"
tags: [Linux, qdisc, tc, Traffic Control, fq_codel]
---

# qdisc 与流量控制：排队、整形、调度和丢包发生在哪里

qdisc 位于内核网络发送路径的重要排队点，可决定包何时、按什么顺序进入设备队列。入口方向的 ingress/clsact 也可分类、丢弃、重定向或执行 BPF，但普通 qdisc 的主要排队语义集中在 egress。

## 1. 四个概念

| 概念 | 作用 |
|---|---|
| qdisc | 排队和调度包 |
| class | 在 classful qdisc 中划分层级带宽 |
| classifier/filter | 根据五元组、mark、cgroup、BPF 等分类 |
| action | drop、mark、redirect、police 等动作 |

`tc` 是配置这些对象的用户态工具，不是数据包转发本身。

## 2. Shaping 与 Policing

- Shaping：通常在出口缓存并延后发送，把速率整形成目标值。
- Policing：超过速率时常直接丢弃/重新标记，通常不提供同样的平滑队列。

整形需要队列，因此速率限制、burst 和最大排队时延必须共同设计。

## 3. 常见 qdisc

- `fq`：按流公平排队，支持节奏控制等能力。
- `fq_codel`：结合按流排队与 CoDel 主动队列管理，控制 bufferbloat。
- `htb`：层级令牌桶，按 class 分配/借用带宽。
- `tbf`：单速率令牌桶整形。
- `mq`：把流量分配到多硬件发送队列的根结构之一。
- `noqueue`：某些虚拟/特殊设备不使用普通排队。

可用和默认 qdisc 随发行版、设备类型和配置变化。

## 4. qdisc backlog

```bash
tc -s qdisc show dev <interface>
```

关注 sent、dropped、overlimits、requeues、backlog 等，但字段含义由具体 qdisc 决定。`dropped=0` 不能排除 NIC、交换机、接收端和更早/更晚 hook 丢包。

## 5. TCP pacing 与 qdisc

TCP 可以计算发送节奏，`fq` 等 qdisc 根据时间安排包，减少突发。应用一次写入大块数据不应立即形成线速突发；协议栈、拥塞控制、GSO 和 qdisc 共同决定实际节奏。

## 6. 容器与虚拟设备

包可能先经过容器 veth qdisc，再经过宿主机物理网卡 qdisc。CNI、eBPF、IFB 和隧道还会增加设备/hook。只查 Pod 内 eth0 会漏掉宿主机出口。

## 7. 修改风险

替换根 qdisc 会立即改变流量行为，错误规则可能中断远程连接。生产修改前应保留带外访问、导出当前 `tc -s` 配置、限定测试接口并准备回滚。

## 8. 练习与答案

**问题：qdisc 没有 drop 能否证明主机没丢包？**

答案：不能。包可能在 XDP/Netfilter、softnet、NIC Ring、驱动、交换机或对端 Socket 等其他层丢弃。

**问题：整形到 1Gbps 为什么延迟可能升高？**

答案：如果输入长期超过 1Gbps，超额数据会在 qdisc 排队；队列上限和 AQM 决定等待与丢弃。

下一篇：[多队列、RSS、RPS、XPS 与卸载](./12-多队列RSS-RPS-XPS与卸载.md)
