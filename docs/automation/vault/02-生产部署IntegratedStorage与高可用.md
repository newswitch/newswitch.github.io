---
title: "Vault 生产部署、Integrated Storage 与高可用"
sidebar_label: "02. 生产部署与高可用"
sidebar_position: 2
description: "设计 Vault 节点、Raft Integrated Storage、TLS、自动解封、负载均衡和故障域。"
tags: [Vault, Integrated Storage, Raft, 高可用, TLS]
---

# Vault 生产部署、Integrated Storage 与高可用

## 1. 生产拓扑

常见方案使用奇数个 Vault 节点和 Integrated Storage：

```text
Client / Agent
  → 内部 LB 或服务发现
  → Vault 3/5 节点（一个 Active，其余 Standby）
      ├── 本地低延迟持久盘上的 Raft 数据
      ├── KMS/HSM 自动解封
      └── 外部审计日志目标
```

节点数由故障容忍和写入延迟决定。Raft 多数派不可达时不能安全提交写入；把节点跨越高延迟、不稳定链路可能降低可用性。

## 2. 节点与存储

- 每个节点使用独立持久盘，不共享同一个文件目录。
- 保证磁盘延迟、IOPS、容量和文件系统稳定。
- `node_id`、API 地址、Cluster 地址和证书 SAN 唯一且正确。
- 时钟同步影响 Token、证书和审计关联。
- 防止操作系统 Swap、Core Dump 和日志暴露敏感数据。

## 3. TLS 与网络

客户端到 Vault、Vault 节点间通信都要建立可信 TLS。限制 Listener 暴露范围；防火墙只允许客户端/API、集群通信和必要下游。不要用明文或永久跳过证书验证解决上线问题。

## 4. 自动解封设计

Auto Unseal 身份只获得必要 KMS Key 操作。验证 KMS 区域故障、权限撤销、密钥禁用、网络中断和跨账号恢复。KMS 密钥删除通常具有灾难性，必须启用保护和变更审批。

## 5. Kubernetes 部署边界

使用 Helm 并不自动解决状态：Pod 反亲和、PDB、优雅终止、持久卷拓扑、调度故障域、升级次序和 Seal 状态都需要验证。一次不要同时重启丢失多数派所需的节点。

## 6. 上线验收

- 单节点故障后服务和 Raft Quorum 正常；
- Active 切换期间客户端有限重试，不形成风暴；
- 证书、Auto Unseal、审计设备和快照告警可用；
- 备份能在隔离集群恢复；
- Root/恢复材料、Break-glass 权限和应急 Runbook 已演练。
