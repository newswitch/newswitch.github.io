---
title: "Consul Agent、Server、Gossip、Raft、DNS 与一次服务发现路径"
sidebar_label: "01. 架构与服务发现路径"
sidebar_position: 1
description: "跟踪服务从注册、健康检查、Catalog 提交到 DNS/HTTP 返回实例的完整路径。"
tags: [Consul, Agent, Gossip, Raft, DNS]
---

# Consul Agent、Server、Gossip、Raft、DNS 与一次服务发现路径

每个节点运行 Agent；Client Agent 接受本机注册、执行健康检查并转发请求；少数 Server Agent 保存权威 Catalog，并通过 Raft 复制强一致状态。

## 1. 两套协议不要混淆

| 机制 | 管什么 | 故障表现 |
| --- | --- | --- |
| LAN Gossip | 数据中心内成员与故障检测 | 节点被怀疑/标记失败 |
| WAN Gossip | 多数据中心 Server 发现 | 跨 DC 查询/联邦异常 |
| Raft | Catalog、ACL、KV 等一致状态 | 无 Quorum 时不能提交写入 |

Gossip 可发现 Server 还活着，不代表 Raft 仍有多数派；Raft 有 Leader，也不代表某个服务健康检查一定通过。

## 2. 注册到查询

```text
应用/配置向本机Agent注册Service
→ Client Agent执行HTTP/TCP/gRPC/TTL Check
→ 注册和健康状态写入Server Catalog
→ Leader经Raft复制到多数Server后提交
→ 客户端查询 service.consul
→ DNS请求到本机Agent并转发/读取Catalog
→ 仅返回满足健康与过滤条件的实例
→ 客户端连接实例
```

DNS 常用于无 SDK 的应用；HTTP API 能表达更多过滤、标签和一致性选项。DNS TTL 与客户端缓存决定故障实例从应用视角消失的时间。

## 3. 一致性与可用性

Catalog 查询可选择不同一致性级别。强一致读通常经过 Leader，正确性高但延迟和可用性受 Leader 影响；允许陈旧读可提高读取可用性。服务发现的业务容忍度决定选择，不能全局套用。

## 4. 健康检查设计

HTTP Check 能验证应用端点，TCP 只证明端口建立，TTL 依赖应用主动续约。检查间隔、超时和 Deregister 时间共同决定摘除速度。过于激进会在瞬时抖动时造成服务雪崩；过于宽松会把坏实例长期返回。

## 5. 观测

同时观察 Raft Leader/Peer、Autopilot、Gossip Member、Catalog Service、Health Check 和 DNS 查询延迟。一次“发现失败”要沿查询端 Agent、Server、Catalog、健康状态和应用缓存逐层确认。

参考：[Consul Consensus](https://developer.hashicorp.com/consul/docs/architecture/consensus)、[DNS Interface](https://developer.hashicorp.com/consul/docs/discover/service/static/dns)。
