---
title: "Nacos 从零到精通学习路线"
sidebar_label: "00. Nacos 从零到精通学习路线"
sidebar_position: 0
tags: [Nacos, 服务发现, 配置中心, Raft, 学习路线]
description: "以 Nacos 3.x 为主线，从 Naming 与 Config 深入 gRPC 推送、Distro/Raft、集群部署、安全、容量、升级和故障排查。"
---

# Nacos 从零到精通学习路线

Nacos 同时承担服务发现和配置中心。学习时必须把临时/持久实例、健康检查、客户端缓存、配置监听、推送、Distro、Raft、外部数据库和控制台安全分开；“服务列表里看得到”不等于客户端一定拿到相同配置或能访问实例。

本路线以 **Nacos 3.x** 为主线，重点覆盖 3.0 以后 Server 与 Console 分离、端口边界和 gRPC 接入，同时标注 2.x 客户端兼容。Nacos 官方明确定位为内网组件，不应直接暴露到公网。

## 1. 两条控制路径

```text
Service Discovery
Provider register / heartbeat
  → Nacos Server
  → Naming metadata / health state
  → push to subscribed Consumer
  → local cache / client-side load balancing

Configuration
Publisher → Config API → persistence / consistency
  → listener notification
  → client long connection / local snapshot
  → application refresh
```

## 2. 13 篇文章规划

| 编号 | 文章 | 优先级 | 核心问题 | 状态 |
| --- | --- | --- | --- | --- |
| N00 | Nacos 从零到精通学习路线 | P0 | 建立 Naming、Config 和一致性地图 | 已完成 |
| N01 | [Nacos 解决什么问题与一次注册/配置发布路径](./01-Nacos解决什么问题与一次注册配置发布路径.md) | P0 | 注册中心、配置中心和 DNS/etcd 的边界 | 已完成 |
| N02 | [Namespace、Group、Service、Cluster、Instance 与 DataId](./02-Nacos资源模型与隔离.md) | P0 | 资源模型和隔离 | 已完成 |
| N03 | [服务注册、订阅、健康检查、客户端缓存与负载均衡](./03-服务注册订阅健康检查客户端缓存与负载均衡.md) | P0 | 临时/持久实例和推送 | 已完成 |
| N04 | [配置发布、监听、灰度、加密、回滚与动态刷新](./04-配置发布监听灰度加密回滚与动态刷新.md) | P0 | 配置一致性和应用风险 | 已完成 |
| N05 | [Distro、Raft/JRaft、AP/CP 与数据一致性](./05-Distro-Raft-JRaft与数据一致性.md) | P0 | 不同数据为何使用不同协议 | 已完成 |
| N06 | [Server、Console、gRPC、端口与 3.x 架构](./06-Nacos-Server-Console-gRPC端口与3x架构.md) | P0 | 数据面、管理面和安全边界 | 已完成 |
| N07 | [Standalone、三节点、外部数据库、Docker 与 K8s 部署](./07-Nacos-Standalone三节点外部数据库Docker与Kubernetes部署.md) | P0 | 多种部署方式及存储依赖 | 已完成 |
| N08 | [Java/Spring Cloud/Dubbo 客户端、版本兼容与推送故障](./08-Nacos-Java-Spring-Cloud-Dubbo客户端与推送故障.md) | P1 | 客户端才是控制面落地终点 | 已完成 |
| N09 | [Authentication、Token、TLS、RBAC、Namespace 与内网隔离](./09-Nacos认证Token-TLS-RBAC与内网隔离.md) | P1 | 防止未授权配置和注册 | 已完成 |
| N10 | [服务数、实例数、配置数、推送连接与容量压测](./10-服务实例配置推送与容量压测.md) | P1 | Server/JVM/DB/网络怎样估算 | 已完成 |
| N11 | [监控、日志、备份、升级、迁移与多集群](./11-Nacos监控日志备份升级迁移与多集群.md) | P1 | 生命周期和灾备 | 已完成 |
| N12 | [源码、注册丢失、配置不生效、选主/数据库异常 Runbook](./12-Nacos源码与生产故障Runbook.md) | P2 | 从客户端到协议和存储排障 | 已完成 |

当前完成 **13/13**，剩余 **0 篇**。

## 3. 版本与端口基线

Nacos 3.x 常见端口职责：

| 端口 | 典型职责 | 暴露原则 |
| --- | --- | --- |
| 8848 | Server HTTP/Open API | 仅必要内网调用 |
| 9848 | 客户端 gRPC | 客户端/VIP TCP 转发 |
| 9849 | Server 间 gRPC | 仅集群成员 |
| 7848 | JRaft | 仅集群成员 |
| 8080 | 独立 Console | 受控管理网 |

端口可调整，实际以主端口偏移和配置为准。通过 VIP/Nginx 转发客户端 gRPC 时应使用 TCP，而不是把它误作普通 HTTP 转发。

## 4. P0 验收题

- 临时实例与持久实例的健康和一致性机制有什么差异？
- Provider 注册成功后，Consumer 为什么仍可能拿到旧列表？
- 客户端本地缓存是可用性保护还是一致性风险？
- Distro 与 Raft 分别服务哪些类型的数据，为什么？
- Nacos Server 正常但外部数据库慢，会影响注册、配置还是两者？
- 配置中心发布成功，应用为什么可能没有刷新？
- Nacos 3.x 只转发 8848 为什么客户端仍可能失败？
- 三个 Nacos Pod 在同一节点是否算高可用？

## 5. 实验拓扑

```text
Standalone：Naming、Config、客户端缓存和灰度
3 Server + external DB：选主、一致性、节点故障
独立 Console：管理面隔离、认证和审计
Kubernetes：Service、DNS、反亲和、持久化和滚动升级
Spring/Dubbo 应用：注册、订阅、动态配置和客户端故障
```

## 6. 与其他模块连接

- etcd：通用强一致 KV/DCS 与 Nacos 微服务控制面的区别；
- PostgreSQL/MySQL：Nacos 外部持久化数据库的可用性；
- Higress：从 Nacos 发现服务并生成网关路由；
- Kubernetes：Nacos 服务发现与 Service/DNS/EndpointSlice 的边界。

## 7. 官方资料

- [Nacos Documentation](https://nacos.io/en/docs/latest/)
- [Nacos Deployment Overview](https://www.nacos.io/en/docs/next/manual/admin/deployment/deployment-overview/)
- [Nacos Source](https://github.com/alibaba/nacos)

本系列会把控制台操作还原为客户端、Server、协议和存储状态变化，不用“页面显示正常”代替端到端验证。
