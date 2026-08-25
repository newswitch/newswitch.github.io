---
title: "多集群、多网络、East-West Gateway、服务发现与故障域"
sidebar_label: "12. 多集群与多网络"
sidebar_position: 12
description: "比较 Istio 多集群控制面拓扑、服务发现、信任、East-West Gateway 和跨集群故障边界。"
tags: [Istio, Multicluster, Multi-network, East-West Gateway, Failover]
---

# 多集群、多网络、East-West Gateway、服务发现与故障域

多集群不是简单把两个 Kubeconfig 交给 Istio。必须设计控制平面归属、服务发现、网络可达、信任域、故障转移和跨集群流量成本。

## 1. 关键维度

| 维度 | 选择 |
| --- | --- |
| 控制面 | 单主、主—远端、多主 |
| 网络 | 扁平可直达、不同网络经 Gateway |
| 信任 | 共享 Root、Trust Domain Alias 或隔离 |
| 服务 | 同名合并、Cluster-local、显式 Export |
| 流量 | 本地优先、区域/集群 Failover、全局负载 |

## 2. 跨网络路径

```text
Source Workload
→ Source Proxy/ztunnel
→ East-West Gateway
→ 跨集群网络
→ Target East-West Gateway/ztunnel
→ Target Workload
```

Gateway 地址、SNI、证书和 Network Label 必须正确。LB Ready 不代表远端 Endpoint 可用。

## 3. 服务发现

控制面要获得远端 Service/Endpoint 信息并为数据平面生成网络可达地址。Remote Secret 权限是高敏感控制面凭据；限制读取范围并轮换审计。

同名服务合并会把流量扩到多个集群，发布前确认 Cluster-local 和 Failover Priority，避免无意跨区产生延迟和费用。

## 4. 故障边界

- 远端 Kubernetes API 不可用；
- 单集群 Istiod 不可用；
- East-West Gateway/LB 故障；
- 集群间网络分区；
- Root/Trust Domain 不一致；
- DNS/服务发现陈旧；
- 跨集群 Endpoint 健康但依赖不完整。

Failover 前确认目标集群有足够容量和依赖数据。网格只能转移网络请求，不能同步数据库或 Session。

## 5. 验收

用两个集群部署同名服务，验证本地优先和故障转移；分别隔离 API、Istiod、Gateway 和网络，记录现有/新连接、配置更新和恢复。通过证书 Principal 证明跨集群身份正确。

参考：[Istio Multicluster](https://istio.io/latest/docs/setup/install/multicluster/)。
