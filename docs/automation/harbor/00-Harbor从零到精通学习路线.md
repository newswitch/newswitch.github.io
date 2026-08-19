---
title: "Harbor 从零到精通学习路线"
sidebar_label: "00. Harbor 学习路线"
sidebar_position: 0
description: "从 OCI 制品与 Registry 协议开始，系统掌握 Harbor 架构、部署、权限、安全、复制、存储治理和生产排障。"
tags: [Harbor, OCI, Registry, 镜像仓库, DevSecOps, 学习路线]
---

# Harbor 从零到精通学习路线

Harbor 不是一个“保存 Docker 镜像的目录”，而是位于构建系统与运行平台之间的制品控制面。它负责身份、项目隔离、元数据、扫描、复制和保留策略；真正的大对象数据通常位于 Registry 后端存储。

## 1. 学习顺序

| 阶段 | 文章 | 完成后能做什么 |
| --- | --- | --- |
| 1 | [OCI、Registry 协议与 Harbor 架构](./01-OCI-Registry协议与Harbor架构.md) | 解释一次 Push/Pull 的请求和数据路径 |
| 2 | [生产部署、高可用、TLS 与存储](./02-生产部署高可用TLS与存储.md) | 设计单机实验和生产 HA 拓扑 |
| 3 | [项目、RBAC、机器人账户与审计](./03-项目RBAC机器人账户与审计.md) | 建立最小权限和租户边界 |
| 4 | [镜像推拉、认证、Digest 与运行时](./04-镜像推拉认证Digest与运行时.md) | 定位认证、分层上传和拉取故障 |
| 5 | [扫描、SBOM、签名与不可变制品](./05-扫描SBOM签名与不可变制品.md) | 建立制品供应链门禁 |
| 6 | [复制、Proxy Cache 与多站点](./06-复制ProxyCache与多站点.md) | 设计跨地域分发和上游缓存 |
| 7 | [保留策略、垃圾回收与容量](./07-保留策略垃圾回收与容量.md) | 控制增长并安全回收 Blob |
| 8 | [备份、恢复、升级与故障排查](./08-备份恢复升级与故障排查.md) | 处理数据保护和生产故障 |
| 9 | [Kubernetes 制品交付综合项目](./09-Kubernetes制品交付综合项目.md) | 串联 CI、Harbor、签名和集群发布 |

## 2. 必须建立的边界

- Tag 是可变名称，Digest 才是内容身份；生产部署应记录 Digest。
- Harbor 数据库保存元数据，不等于全部制品数据；恢复必须覆盖数据库、存储和配置。
- 漏洞扫描结果受漏洞库时间影响，不代表镜像已被证明安全。
- 保留策略删除 Artifact 引用，垃圾回收才可能释放底层 Blob 空间。
- Harbor 高可用不等于对象存储、数据库和 Redis 自动高可用。

## 3. 掌握标准

- [ ] 能画出客户端、负载均衡、Core、Registry、数据库、Redis 和存储的关系。
- [ ] 能用项目、机器人账户和短期凭据隔离构建与运行身份。
- [ ] 能解释 Manifest、Config、Layer、Tag 和 Digest。
- [ ] 能设计扫描、签名、不可变、复制和保留策略。
- [ ] 能从状态码、服务日志、数据库、Redis 和存储逐层排障。
- [ ] 能完成可演练的备份恢复与滚动升级方案。

## 4. 官方资料

- [Harbor Documentation](https://goharbor.io/docs/)
- [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec)
