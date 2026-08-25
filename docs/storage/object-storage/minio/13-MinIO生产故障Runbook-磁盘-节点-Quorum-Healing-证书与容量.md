---
title: "MinIO 生产故障 Runbook：磁盘、节点、Quorum、Healing、证书和容量"
sidebar_label: "13. MinIO 生产故障 Runbook"
sidebar_position: 13
description: "以保护 Erasure Set 和对象完整性为前提，处理磁盘、节点、Quorum、Healing、TLS、KMS 与容量故障。"
tags: [MinIO, Runbook, Quorum, Healing, 故障排查]
---

# MinIO 生产故障 Runbook：磁盘、节点、Quorum、Healing、证书和容量

MinIO 故障处理先保护仍健康的 Erasure Set 和 Drive。没有画清 Set、Node、Drive 映射前，不要同时重启多个节点、重新格式化磁盘或执行批量 Healing/迁移。

## 1. 前五分钟

1. 确认受影响 Operation、Bucket/Prefix、Tenant 和时间；
2. 区分 S3 4xx、5xx、超时、慢请求和数据校验失败；
3. 检查 LB/DNS/TLS、节点、Drive、Pool、Quorum、Healing、容量；
4. 冻结升级、Decommission、Lifecycle 大变更和并发维护；
5. 必要时限制非关键 PUT/大查询，保护剩余容量和带宽；
6. 保存 Request ID、客户端错误、服务日志、内核 I/O 和硬件信息。

## 2. 决策树

```text
S3失败/变慢
├─ 4xx → 签名、时间、Policy、Key、Object Lock
├─ TLS/连接 → DNS、LB、证书、NetworkPolicy
├─ 5xx/Quorum → Set成员、Drive/Node、挂载
├─ GET校验失败 → Bit Rot、Shard、Healing
├─ P99高 → 磁盘、网卡、Healing、KMS、并发
└─ 只有历史对象失败 → 对象存储元数据、版本、KMS、Lifecycle
```

## 3. 高风险场景

### 3.1 Drive 离线

确认是硬盘、控制器、文件系统、挂载还是权限。用序列号和 Endpoint 定位，避免替错盘。保持其他成员稳定，更换后观察 Healing 到完成。

### 3.2 失去 Quorum

优先恢复原节点、网络和挂载，不要创建空目录冒充原 Drive。若多个盘永久损坏，先冻结写并联系具备数据恢复经验的人员，保存所有原始介质和日志。

### 3.3 容量耗尽

限制写入，识别当前版本、历史版本、未完成 Multipart、Delete Marker/Object Lock 和复制开销。扩容或按已验证 Lifecycle 回收，禁止无清单批量删除。

### 3.4 证书/KMS

证书问题沿 Client → LB → MinIO → 节点间链路定位；KMS 故障可能只影响加密对象。不要通过关闭校验或改成明文长期绕过。

## 4. 恢复验收

- 所有 Pool/Set 达到预期 Quorum；
- 离线 Drive 和 Healing 失败归零或有明确计划；
- PUT/GET/List/Delete、Multipart、Range 正常；
- 随机对象和模型 Manifest Checksum 正确；
- P99、吞吐和复制积压恢复；
- TLS、OIDC/KMS、审计正常；
- 临时限流和安全例外已回收。

## 5. 演练矩阵

演练单 Drive、单 Node、LB 后端、证书过期、KMS 不可用、复制断链、容量水位和对象存储查询风暴。每次记录真实 RPO/RTO、Healing 时间和对模型冷启动的影响。

参考：[MinIO Data Recovery](https://min.io/docs/minio/linux/operations/data-recovery.html)、[Troubleshooting](https://min.io/docs/minio/linux/operations/troubleshooting.html)。
