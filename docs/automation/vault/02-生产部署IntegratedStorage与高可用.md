---
title: "Vault 生产部署、Integrated Storage 与高可用"
sidebar_label: "02. 生产部署与高可用"
sidebar_position: 2
description: "设计 Vault Integrated Storage 的节点、Quorum、TLS、自动解封、负载均衡、Autopilot 和 Kubernetes 部署。"
tags: [Vault, Integrated Storage, Raft, 高可用, TLS]
---

# Vault 生产部署、Integrated Storage 与高可用

生产 Vault 不是“起三个 Pod”。它同时依赖 Raft 多数派、低延迟磁盘、TLS、Seal、审计、负载均衡和下游系统。任意一层设计错误，都可能表现为 Secret 请求超时。

## 1. 先决定故障模型

Integrated Storage 使用 Raft 复制 Vault 数据。常见规模是 3 或 5 个 Voter：

| Voter 数 | Quorum | 可容忍同时失效 |
| ---: | ---: | ---: |
| 1 | 1 | 0 |
| 3 | 2 | 1 |
| 5 | 3 | 2 |

Quorum 公式是 `floor(N/2)+1`。节点数不是越多越好：一次写入必须由 Leader 复制到多数派，增加跨故障域延迟会直接增加提交延迟。不要为了“跨地域容灾”把一个 Raft 集群拉过高延迟 WAN；跨区域灾备应使用独立恢复方案，企业版可进一步评估 Replication。

## 2. 推荐生产拓扑

```text
应用 / Vault Agent / Operator
  → 内部负载均衡或服务发现
  → 3/5 个 Vault Server
      ├── 一个 Active，其余 Standby
      ├── 每节点独立低延迟持久盘
      ├── Raft 节点间 mTLS 通道
      ├── KMS/HSM Auto Unseal
      └── 至少两个独立审计目标
```

不同可用区能降低单机房故障风险，但前提是区间网络延迟、抖动和丢包满足写入 SLO。先测真实链路，不要只看云厂商标称网络。

## 3. 磁盘为什么决定写入性能

一次稳定写入大致经历：

```text
客户端 → Active
→ Raft Leader 写本地日志
→ 复制到其他 Voter
→ 多数派持久化确认
→ 状态机提交
→ 返回客户端
```

因此写延迟往往由“Leader 到多数派的网络往返 + 最慢必要磁盘同步”决定。需要持续观察：

- 写延迟的 P95/P99，而不只是 IOPS；
- 磁盘队列、fsync、吞吐和剩余空间；
- 网络盘或虚拟化宿主机的突发额度；
- 快照与备份是否和业务写入争用 I/O；
- 节点间 RTT、重传和抖动。

每个 Raft 节点必须使用自己的持久卷，不能让多个节点共享同一数据目录。

## 4. 关键地址与最小配置

```hcl
ui           = true
api_addr     = "https://vault-0.vault-internal.example:8200"
cluster_addr = "https://vault-0.vault-internal.example:8201"

listener "tcp" {
  address            = "0.0.0.0:8200"
  cluster_address    = "0.0.0.0:8201"
  tls_cert_file      = "/vault/tls/tls.crt"
  tls_key_file       = "/vault/tls/tls.key"
  tls_client_ca_file = "/vault/tls/ca.crt"
}

storage "raft" {
  path    = "/vault/data"
  node_id = "vault-0"
}
```

证书 SAN 必须覆盖客户端、LB、Pod DNS 或节点域名的实际访问方式。`cluster_addr` 对 Integrated Storage 和节点间转发至关重要，不能写成其他节点无法解析或回连的地址。

## 5. 建立 Raft 集群

首节点初始化并解封后，其余节点加入。所有节点必须使用兼容的 Vault 版本、相同的 Seal 配置和可互信的集群 TLS。

```bash
vault operator raft list-peers
vault status
```

示例输出：

```text
Node       Address         State       Voter
----       -------         -----       -----
vault-0    vault-0:8201    leader      true
vault-1    vault-1:8201    follower    true
vault-2    vault-2:8201    follower    true
```

加入失败时按链路检查：DNS → 8200/8201 网络 → TLS SAN/CA → Seal 配置 → 已有集群状态 → Raft 日志。不要反复删除数据目录碰运气。

## 6. Auto Unseal 是另一套可用性系统

使用 KMS/HSM 后，恢复链变成：

```text
节点启动
→ 获取工作负载/主机身份
→ 访问 KMS Endpoint
→ 获得 Seal Key 解密能力
→ 打开 Barrier
→ 加入 Raft 并提供服务
```

需要独立监控 KMS 请求错误、权限、Key 状态、DNS、网络和限流。KMS Key 被禁用或永久删除不是普通节点故障；扩容 Vault 节点也无法修复它。

## 7. Autopilot 管什么、不管什么

Integrated Storage 的 Autopilot 用于评估服务器健康和安全推进集群成员变更。需要关注：

- 新节点经过稳定期后才被认为健康；
- 节点最后联系时间和日志落后程度；
- Dead Server Cleanup 默认不会随意自动清理坏节点；
- `dead_server_last_contact_threshold` 不应短于大型快照载入、慢盘追赶等正常耗时，否则正在恢复的节点可能被误移除。

Autopilot 不能替代磁盘、网络、Quorum 和备份监控。

## 8. 负载均衡与健康检查

常见策略有两种：

1. 只向 Active 发送流量，LB 根据健康接口识别 Active；
2. 向已解封的 Active/Standby 发送流量，由 Standby 转发。

第二种配置简单，但会增加一次内部转发；第一种切主依赖健康检查收敛。无论选择哪种，都要避免：

- 把 Sealed 节点加入池；
- 将 Standby 的状态码误判为整个服务失败；
- 切主期间客户端无限重试形成放大；
- LB 的 TLS/SNI 与后端证书不匹配。

## 9. Kubernetes 部署不是无状态 Deployment

Vault Server 通常需要 StatefulSet 语义：

- 稳定 Pod 身份与独立 PVC；
- Pod Anti-Affinity 或 Topology Spread 分散故障域；
- PDB 防止自愿中断同时破坏 Quorum；
- PVC 拓扑与调度区域一致；
- 明确 Init、Seal、Join 和滚动升级顺序；
- 禁止普通 HPA 随意缩容 Raft Voter。

PDB 只能约束部分自愿中断，不能阻止节点宕机、断电、存储故障或管理员误删。升级时一次只处理一个节点，并在每步确认 Peer、Autopilot 和应用请求恢复。

## 10. 容量与 SLO

Vault 负载不能只用“每秒 Secret 请求”描述，至少拆分：

- 登录和 Token 创建速率；
- KV 读写；
- Database/PKI 等下游创建速率；
- Lease Renew/Revoke；
- Transit 加解密及 Payload 大小；
- Audit 每请求写放大；
- Raft 快照和存储增长。

分别制定读取、写入、登录、发证书和动态凭据的延迟与错误率 SLO。下游数据库慢不能简单归因成 Vault Core 性能不足。

## 11. 故障演练顺序

1. 停止一个 Follower，确认 Quorum 和请求正常；
2. 对 Active 执行 Step-down，观察切主时间和客户端重试；
3. 模拟 KMS 短时不可用，验证已解封节点与新启动节点的差异；
4. 模拟一个 Audit Device 故障，确认备用审计目标可用；
5. 恢复隔离快照并验证登录、策略、KV、动态凭据和 PKI；
6. 验证失去多数派时系统安全停止写入，而不是产生分叉。

演练使用受控测试环境，不应在生产中直接断多数派或破坏 KMS Key。

## 12. 上线验收清单

- 3/5 个 Voter 的故障域和 Quorum 经过验证；
- 磁盘延迟、容量和文件系统有告警；
- TLS 证书覆盖全部访问名称并能轮换；
- Auto Unseal 身份最小化，KMS Key 有删除保护；
- LB 正确识别 Active、Standby、Sealed 状态；
- Raft Peer 和 Autopilot 状态受监控；
- 审计目标不会因单盘写满阻断全部请求；
- 快照已在隔离环境完成恢复验证；
- Break-glass、Root 生成、升级与灾备 Runbook 已演练。

## 13. 练习与答案

**问题：把 3 个节点分别放到相距很远的三个地域，是否一定更可用？**

答案：不一定。Raft 写入需要多数派确认，高延迟和不稳定 WAN 会使日常请求变慢，并增加失去多数派的概率。地域级灾备与同一低延迟集群的 HA 是两个问题。

**问题：5 节点集群失去 2 个节点后仍能写，为什么不能直接继续维护第三个节点？**

答案：此时只剩最小多数派 3。再失去一个节点就无法提交写入，应先恢复冗余，再做计划变更。

参考资料：

- [Integrated Storage](https://developer.hashicorp.com/vault/docs/configuration/storage/raft)
- [Integrated Storage concepts](https://developer.hashicorp.com/vault/docs/concepts/integrated-storage)
- [Autopilot](https://developer.hashicorp.com/vault/docs/concepts/integrated-storage/autopilot)
- [Production hardening](https://developer.hashicorp.com/vault/docs/concepts/production-hardening)
