---
title: "Bucket Replication、Site Replication、跨集群灾备与一致性边界"
sidebar_label: "09. 复制、灾备与一致性边界"
sidebar_position: 9
description: "比较 Bucket 与 Site Replication，设计跨集群 RPO/RTO、故障切换、冲突和回切流程。"
tags: [MinIO, Bucket Replication, Site Replication, 灾备, RPO]
---

# Bucket Replication、Site Replication、跨集群灾备与一致性边界

跨站复制通常是异步的。源站 PUT 成功不等于目标站同一时刻已经可读，复制延迟和失败队列直接决定灾备 RPO。

## 1. 两种复制目标

| 能力 | 关注范围 |
| --- | --- |
| Bucket Replication | 指定 Bucket/Prefix 的对象版本、删除等规则 |
| Site Replication | 多站点之间更完整地同步对象及支持的站点配置/身份状态 |

实际复制内容、双向行为和版本要求随 MinIO 版本变化，设计前使用目标版本文档列出对象、Delete Marker、Retention、Policy、用户和 KMS 哪些会同步。

## 2. 异步数据路径

```text
Client PUT Site A
→ A达到本地Write Quorum并返回
→ Replication Queue
→ 通过TLS写Site B
→ B持久化并返回
→ A更新复制状态
```

网络中断、目标限流、权限错误、证书或对象锁冲突会让队列积压。恢复后回放会与正常流量争夺网络和磁盘。

## 3. RPO/RTO

- RPO：允许目标站落后多少对象/时间；
- RTO：故障后多久切换 Endpoint、身份和应用；
- 复制积压年龄必须小于 RPO；
- DNS/LB TTL、客户端连接池和缓存影响实际切换时间；
- KMS、OIDC、审计、网络和模型 Manifest 也必须在灾备站可用。

## 4. 冲突与双写

主动—被动最容易定义。若允许两站同时写同一 Key，必须理解版本、时间、删除和冲突解决行为；业务层最好使用不可变 Key，并让发布指针有单一写入权。

切换前冻结或隔离旧站写入，防止网络分区后双主。旧站恢复后先比较版本和复制状态，再决定回切，不能立即让两个站点同时接收写。

## 5. 灾备演练

1. 持续写入带序号和 Checksum 的对象；
2. 阻断站点间网络，记录复制积压；
3. 在允许 RPO 时切到目标站；
4. 验证对象、Version、Delete Marker、Policy、KMS 和应用；
5. 恢复网络并限速追平；
6. 执行受控回切；
7. 计算真实 RPO/RTO。

复制能传播误删除和坏数据，因此仍需要 Versioning、Object Lock 或独立备份。

参考：[MinIO Bucket Replication](https://min.io/docs/minio/linux/administration/bucket-replication.html)、[Site Replication](https://min.io/docs/minio/linux/operations/install-deploy-manage/multi-site-replication.html)。
