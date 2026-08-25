---
title: "Consul 部署、ACL、TLS、健康检查、选型与故障 Runbook"
sidebar_label: "02. 生产部署与故障 Runbook"
sidebar_position: 2
description: "完成 Consul 生产拓扑、安全、备份、升级、容量和服务发现故障排查。"
tags: [Consul, Deployment, ACL, Troubleshooting]
---

# Consul 部署、ACL、TLS、健康检查、选型与故障 Runbook

## 1. 生产拓扑

每个 Datacenter 通常部署 3 或 5 个 Server，跨故障域分布；普通工作节点运行 Client Agent。Server 节点使用稳定磁盘、地址和低时延网络，不在高抖动链路上拉大一个 Raft 集群。跨地域通过 WAN Federation 或 Mesh Gateway 连接，而不是把同一 Raft Quorum 横跨远距离区域。

上线前固定 Consul 版本、Datacenter/Node 名称、Retry Join、数据目录和端口；配置 Autopilot；完成 Snapshot 备份与恢复演练。

## 2. 安全基线

- Gossip Encryption 保护成员通信；
- Agent RPC/HTTP/gRPC 使用 TLS 并校验证书；
- 启用 ACL Default Deny，Bootstrap Token 只用于初始化；
- 为 Agent、DNS、服务注册和自动化分别发最小权限 Token；
- 限制 HTTP API 网络入口，审计 Token 使用和轮换。

TLS、Gossip Key 和 ACL Token 是三层不同安全机制，缺一不可。

## 3. 容量与升级

容量受注册服务/检查数、Catalog 写入率、DNS QPS、Watch/Blocking Query 和 Raft 磁盘延迟影响。压测注册风暴、节点重连和健康状态翻转。升级一次只处理一个 Server，保持 Quorum；再滚动 Client。任何阶段都检查 Leader、Peer、Autopilot 和查询。

## 4. Runbook

```text
DNS无结果
→ 本机Agent可达？
→ Service是否注册？
→ Health是否passing？
→ Catalog查询是否有实例？
→ ACL是否允许？
→ DNS缓存/TTL是否仍持有旧结果？
```

Raft 无 Leader：检查 Server Members、网络、时钟、磁盘和多数派，禁止同时重启所有 Server。节点误判失败：检查 Gossip RTT、丢包和资源暂停。Catalog 有实例但连接失败：问题已离开 Consul 查询层，继续检查路由、防火墙和应用端口。

## 5. 选型结论

当环境跨 VM、裸机、Kubernetes 和多个数据中心，需要统一服务目录、安全连接时，Consul 价值明显；纯 Kubernetes 单集群只做服务发现时，先使用 Service/CoreDNS，避免多一个关键控制面。

参考：[Consul Deployment Guide](https://developer.hashicorp.com/consul/docs/deploy/server)、[Disaster Recovery](https://developer.hashicorp.com/consul/tutorials/datacenter-operations/backup-and-restore-state)。
