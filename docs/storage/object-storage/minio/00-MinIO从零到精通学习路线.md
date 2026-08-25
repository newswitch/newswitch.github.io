---
title: "MinIO 从零到精通学习路线"
sidebar_label: "00. MinIO 从零到精通学习路线"
sidebar_position: 0
description: "从 S3、Bucket、Object 和 Erasure Coding 入门，进阶到分布式部署、安全、复制、容量、性能、升级和故障恢复。"
tags: [MinIO, S3, 对象存储, Erasure Coding, 模型仓库]
---

# MinIO 从零到精通学习路线

MinIO 提供兼容 S3 API 的对象存储能力，适合模型制品、数据集、Checkpoint、备份和日志/Trace 后端。它不是共享 POSIX 文件系统，Bucket/Object、HTTP API、版本和 Erasure Coding 才是核心模型。

```text
S3 Client
→ DNS/TLS/Load Balancer
→ MinIO API
→ Authentication/Policy
→ Bucket/Object/Version
→ Erasure Set
→ Data + Parity Shards
→ Drives
```

## 1. P0：对象路径与数据安全

1. [MinIO 解决什么问题与一个对象的完整读写路径](./01-MinIO解决什么问题与一个对象的完整读写路径.md)
2. [Bucket、Object、Erasure Set、Quorum 与 Healing](./02-Bucket-Object-Erasure-Set-Quorum与Healing.md)
3. [S3 Put/Get/List/Delete、Multipart、Range、ETag 与 Checksum](./03-S3-Put-Get-List-Delete-Multipart-Range-ETag与Checksum.md)
4. [Versioning、Delete Marker、Lifecycle、Retention 与 Object Lock](./04-Versioning-Delete-Marker-Lifecycle-Retention与Object-Lock.md)
5. [Erasure Coding、Bit Rot、Drive/Node 故障和后台 Healing](./05-Erasure-Coding-Bit-Rot-Drive-Node故障与后台Healing.md)

## 2. P1：部署、安全与生产运维

6. [单机实验、Docker、分布式 Server Pool、systemd 与负载均衡部署](./06-单机实验-Docker-分布式Server-Pool-systemd与负载均衡部署.md)
7. [Kubernetes Operator/Tenant、PVC、拓扑、调度与故障域](./07-Kubernetes-Operator-Tenant-PVC-拓扑-调度与故障域.md)
8. [Access Key、Policy、STS、OIDC、TLS、KMS、SSE 与审计](./08-Access-Key-Policy-STS-OIDC-TLS-KMS-SSE与审计.md)
9. [Bucket Replication、Site Replication、跨集群灾备与一致性边界](./09-Bucket-Replication-Site-Replication-跨集群灾备与一致性边界.md)
10. [`mc`、Admin API、Prometheus、日志、告警与日常运维](./10-mc-Admin-API-Prometheus-日志-告警与日常运维.md)
11. [容量、Small Object、Multipart、并发、网卡、磁盘与性能测试](./11-容量-Small-Object-Multipart-并发-网卡-磁盘与性能测试.md)
12. [扩容、Decommission、升级、迁移、兼容性与回滚](./12-扩容-Decommission-升级-迁移-兼容性与回滚.md)

## 3. P2：故障处理

13. [MinIO 生产故障 Runbook：磁盘、节点、Quorum、Healing、证书和容量](./13-MinIO生产故障Runbook-磁盘-节点-Quorum-Healing-证书与容量.md)

## 4. 与相邻存储的边界

| 系统 | 接口 | 典型场景 |
| --- | --- | --- |
| MinIO/S3 | HTTP Object API | 模型、数据集、备份、日志块、跨集群复制 |
| NFS | POSIX 共享文件 | 共享目录、传统应用、RWX |
| CephFS | 分布式 POSIX 文件 | 大规模共享文件 |
| Ceph RGW | S3/Swift Object API | 已有 Ceph 集群的对象服务 |
| 本地 NVMe | 块/文件 | 节点缓存、临时高速数据 |

应用要求 `open/read/mmap` 时不能直接把 S3 Endpoint 当文件系统；通常需要下载到本地缓存或使用明确支持对象 API 的数据层。

## 5. 必做实验

- 使用 S3/`mc` 创建 Bucket 并上传、Range 下载大对象；
- Multipart 中断和恢复；
- 启用 Versioning，制造覆盖和 Delete Marker 后恢复；
- 计算 Erasure Coding 可用容量和容错边界；
- 在受控环境停止单个 Drive/Node，观察 Quorum 和 Healing；
- 部署 TLS 和最小权限 Policy；
- 为模型对象保存版本、Checksum 和不可变发布指针；
- 测试多节点并发拉取模型时的吞吐、首字节和磁盘/网络瓶颈；
- 演练磁盘水位、证书过期、负载均衡错误和对象存储不可用；
- 完成升级、回滚和跨集群恢复。

## 6. 学习完成标准

- 能解释 Bucket、Object Key、Version 和 Prefix，不把 Prefix 当真实目录；
- 能画出 PUT/GET 到 Erasure Shard 和 Drive 的路径；
- 能解释 Data/Parity、Read/Write Quorum 和 Healing；
- 能规划磁盘、节点、Server Pool 和故障域；
- 能部署分布式 MinIO 和 Kubernetes Tenant；
- 能设计 TLS、Policy、STS/OIDC、KMS 和审计；
- 能处理 Versioning、Object Lock、Replication 和灾备；
- 能定位 Slow PUT/GET、Small Object、Quorum 和 Healing 问题；
- 能建设适合 AI 模型制品的版本、完整性和缓存链路。
