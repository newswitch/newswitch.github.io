---
title: "IPsec VPN 学习路线"
sidebar_label: "00. IPsec VPN 学习路线"
sidebar_position: 0
description: "从保护一个 IP 包开始，学习 ESP、IKEv2、安全关联、策略选流、NAT 穿越与路径 MTU。"
tags: [IPsec, ESP, IKEv2, VPN]
---

# IPsec VPN 学习路线

IPsec 不只是“在两个公网 IP 之间拉一条隧道”。它需要确定对端身份、哪些包应被保护、用什么状态和密钥处理，以及解密后的包该如何继续访问内部网络。

## 1. 阅读顺序

1. [ESP、安全关联与封装模式](./01-IPsec-ESP安全关联与封装模式.md)：理解内外层地址、传输／隧道模式、SPI、SPD、SAD 和防重放。
2. [IKEv2 协商、认证与密钥生命周期](./02-IKEv2协商认证与密钥生命周期.md)：理解建立、更新、重认证和活性检测的区别。
3. [选路、NAT 穿越与路径 MTU](./03-IPsec选路NAT穿越与路径MTU.md)：解释 SA 已建立而业务不通的机制原因。

## 2. 用三条路径理解 VPN

| 路径 | 要回答的问题 |
| --- | --- |
| 控制路径 | 双方能否协商并认证 |
| 外层数据路径 | ESP 或 UDP 封装能否经过承载网络 |
| 内层业务路径 | 明文流量是否匹配策略，解密后是否有路由和权限 |

公网端点可达、IKE 已建立、内网业务成功，是三个不同结论。阅读前可复习 [NAT 与连接跟踪](../firewall-acl-nat/01-NAT-ACL与连接跟踪.md)。
