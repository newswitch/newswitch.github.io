---
title: "单机实验、Docker、分布式 Server Pool、systemd 与负载均衡部署"
sidebar_label: "06. 多种部署方式与 Server Pool"
sidebar_position: 6
description: "从单机学习环境到多节点多盘 Server Pool，讲清节点身份、Drive、DNS、TLS 和负载均衡。"
tags: [MinIO, Docker, systemd, Server Pool, Load Balancer]
---

# 单机实验、Docker、分布式 Server Pool、systemd 与负载均衡部署

单机单盘适合学习 S3 API，不具备生产冗余。生产分布式部署要求稳定的节点 Endpoint、独占 Drive、低延迟网络、时间同步和一致配置。

## 1. 形态边界

| 形态 | 用途 | 不能证明 |
| --- | --- | --- |
| 单机二进制 | API/权限实验 | Drive/Node 容错 |
| 单容器 | 客户端集成 | 持久化和调度可靠性 |
| Compose 多节点 | 本地拓扑实验 | 真实故障域和磁盘性能 |
| systemd 多节点多盘 | 固定生产环境 | 仍需 LB、监控、灾备 |

## 2. Server Pool

Server Pool 是一组协同提供容量和纠删码保护的 Server/Drive Endpoint。扩容通常添加新的 Pool，而不是随意给现有节点插入单盘并期待数据自动均衡。具体扩容规则以部署版本为准。

```text
Load Balancer
├─ minio1:9000 → drives 1..N
├─ minio2:9000 → drives 1..N
├─ minio3:9000 → drives 1..N
└─ minio4:9000 → drives 1..N
```

## 3. Drive 基线

- 每个 Endpoint 对应独立、稳定、专用文件系统；
- 使用 UUID/受控挂载，禁止设备名漂移；
- MinIO 启动前 Mount 已就绪，否则可能在根盘创建目录；
- 所有 Drive 容量和性能尽量一致；
- 不叠加未经验证的硬件 RAID/共享盘抽象；
- 监控 SMART、内核 I/O、文件系统和 inode。

## 4. systemd 与配置

环境文件保存 Server URL、Console 地址和根凭据引用，权限严格限制。Service 设置 Mount 依赖、文件描述符、重启策略和优雅终止。凭据不出现在进程参数和仓库。

## 5. 负载均衡

LB 暴露统一 S3 Endpoint 和 TLS 证书，健康检查应确认节点可服务而非只开端口。支持大对象流式传输，关闭不必要缓存，设置足够连接/Idle Timeout，并保留客户端源和 Request ID 便于追踪。

Console 与 S3 API 可使用不同域名和访问策略。分布式节点间流量不应绕公网 LB。

## 6. 验收

上传大/小对象和 Multipart，记录基线；停止一个 Drive、一个节点和一个 LB 后端，验证客户端重试、Quorum、Healing 与 TLS；重启全部节点时确认 Drive 挂载顺序和数据一致。

参考：[MinIO Deployments](https://min.io/docs/minio/linux/operations/install-deploy-manage/deploy-minio-multi-node-multi-drive.html)。
