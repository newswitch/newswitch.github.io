---
title: "DNS 学习路线"
sidebar_label: "00. DNS 学习路线"
sidebar_position: 0
description: "沿名称解析链路学习递归与权威、委派与资源记录、缓存与切换，以及 DNSSEC 和加密 DNS。"
tags: [DNS, 递归解析, DNSSEC, TTL]
---

# DNS 学习路线

DNS 是分布式名称数据库和查询协议，不只是一张“域名对应 IP”的表。要理解一次访问，既要知道谁负责回答，也要知道答案缓存在哪里、为什么可信，以及应用何时真正使用新答案。

## 1. 阅读顺序

| 文章 | 重点 |
| --- | --- |
| [递归、权威、委派与资源记录](./01-DNS递归权威委派与资源记录.md) | 从应用查询追踪到答案生成的位置 |
| [TTL、负缓存与服务切换](./02-DNS-TTL负缓存与服务切换.md) | 理解记录更新、缓存失效和长连接各自的时间线 |
| [DNSSEC、DoT、DoH 与分域解析](./03-DNSSEC-DoT-DoH与分域解析.md) | 分开理解答案真实性、传输隐私与解析策略 |

## 2. 相关内容

- 传输协议基础：[ICMP、UDP、TCP、DNS 与连接诊断](../../fundamentals/04-ICMP-UDP-TCP与DNS.md)。
- 地址族选择：[IPv4 与 IPv6 双栈通信机制](../../fundamentals/ipv6/06-IPv4与IPv6双栈通信机制.md)。
- 命令使用：[网络命令参考库](../../commands/00-网络命令参考库学习路线.md)中的 DNS 查询工具。

本系列讨论通用 DNS 机制。CoreDNS、BIND、云解析和浏览器解析器的具体行为，需要在这些机制之上结合实现理解。
