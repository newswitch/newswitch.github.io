---
title: "Nacos Standalone、三节点、外部数据库、Docker 与 Kubernetes 部署"
sidebar_position: 7
tags: [Nacos, 部署, 集群, Docker, Kubernetes, MySQL]
description: "面向 Nacos 3.x，讲清单机、三节点、独立 Console、外部数据库、端口、Docker/Kubernetes 部署和验收。"
---

# Nacos Standalone、三节点、外部数据库、Docker 与 Kubernetes 部署

Nacos 3.x 与很多旧教程的最大差异是 Console 可以与 Server 分离，客户端/服务端 gRPC、Raft 和 Console 管理面有不同端口与安全边界。Nacos 被定位为内网控制面组件，不应直接暴露公网。

## 1. 部署形态

| 形态 | 适合 | 存储 | 高可用 |
| --- | --- | --- | --- |
| Standalone + embedded DB | 本地学习 | 内置 | 无 |
| Standalone + external DB | 集成测试/低要求 | 外部数据库 | Server 仍单点 |
| 3+ Server cluster | 生产 | 外部或版本支持的嵌入模式 | 多节点 |
| 独立 Console | 生产管理面隔离 | 访问 Server | Console 可独立扩展 |
| Kubernetes/Helm/Operator | K8s | PVC/外部数据库 | 取决于拓扑 |

“用了外部 MySQL”只解决部分持久化，并不会消除单 Nacos Server 的可用性风险。

## 2. Nacos 3.x 网络地图

默认主端口为 8848 时，常见派生端口包括：

```text
8848  HTTP Client/Admin/Open API
9848  client → server gRPC
9849  server ↔ server gRPC
7848  server ↔ server JRaft
8080  independent Console default (verify target version)
```

端口可能通过参数改变，不能只照抄清单；应从启动参数、配置、监听 socket 和官方目标版本文档生成最终网络策略。

内网负载均衡通常面向客户端开放主端口及对应客户端 gRPC 端口，节点间 gRPC/Raft 仅在 Server 子网互通，Console 和 Admin API 只向运维网开放。

## 3. Standalone 二进制实验

下载固定 Nacos release 并校验摘要。使用受支持 JDK，设置独立日志与数据目录，然后：

```bash
sh bin/startup.sh -m standalone
tail -f logs/start.out
```

若目标版本支持 function mode，纯微服务场景可只加载 Config/Naming；实际参数以 `startup.sh -h` 和官方文档为准。

验收不能只登录 Console：使用 SDK 注册临时实例、订阅服务、发布配置、监听变更，重启 Server 后确认持久数据和客户端缓存行为。

## 4. 三节点 Release Package

推荐三个或更多 Server 节点跨宿主机/故障域。每台 `cluster.conf` 或等价成员配置使用可达的私网地址：

```text
nacos-1.internal:8848
nacos-2.internal:8848
nacos-3.internal:8848
```

多网卡环境显式指定对外 IP/网卡，避免节点注册容器桥接或管理网地址。三个节点使用同一 Nacos 版本、功能模式、鉴权配置和数据源 Schema。

启动顺序应先准备数据库与初始化 Schema，再逐节点启动并检查成员状态、Raft/Distro、gRPC 连接和错误日志，最后接入内部 VIP/DNS。

## 5. 外部数据库

外部数据库本身要高可用，并满足目标 Nacos 版本支持矩阵。配置包括 JDBC URL、用户、密码、连接池和正确的初始化 Schema。

生产原则：

- Nacos 使用独立数据库和最小权限账户；
- 凭据进入 Secret 管理，不提交 Git；
- TLS、连接超时和连接池上限经过验证；
- 数据库容量、慢 SQL、连接数、备份/PITR 有告警；
- Nacos 升级前执行 Schema 兼容和回滚演练；
- 不允许多个不兼容 Nacos 版本随意共用同一 Schema。

Nacos 节点健康但数据库不可用时，已有客户端缓存可能继续一段时间，新配置发布/管理操作则会失败或降级，需要分别演练。

## 6. 独立 Console

Nacos 3.x 可让 Server 使用 `-d server`、Console 使用 `-d console` 等目标版本支持的方式分离。价值是：

```text
runtime client plane → Nacos Server
admin browser/API    → Nacos Console → Nacos Server
```

Console 身份、入口、WAF/SSO、审计和资源与 Server 分开，避免管理面扫描或大查询干扰注册发现。Console 不能替代 Server 的 Admin API 权限控制。

## 7. Docker/Compose

官方镜像环境变量映射会随版本调整，生产更稳妥的做法是挂载完整 `application.properties` 并固定镜像 digest。每个节点需要：

- 唯一 hostname/宣告地址；
- 完整 `NACOS_SERVERS` 或成员配置；
- 主端口及派生 gRPC/Raft 端口互通；
- 日志、插件、必要数据的持久化；
- 数据库、鉴权 Token/Identity、Console Secret；
- JVM Heap 与容器 limits；
- readiness 区分端口存活和服务可用。

不要用 `MODE=standalone` 的单容器示例声称完成了生产高可用。

## 8. Kubernetes 部署

使用目标版本官方 Helm/Operator 前先渲染并审查：

```text
Server StatefulSet: stable identity + 3 replicas
Console Deployment: independent management plane
Headless Service: member addressing
Internal Service/LB: client access
ConfigMap/Secret: config and credentials
PVC or external DB: persistent state
```

配置反亲和、TopologySpread、PDB、PriorityClass、资源限制、NetworkPolicy 和优雅终止。Service 端口要覆盖 SDK 实际使用的 HTTP/gRPC，而不是只暴露 8848。

Pod IP 变化后，成员和客户端必须依赖稳定 DNS/Service；若用固定 IP 写 `cluster.conf`，滚动会产生陈旧成员。

## 9. 安全基线

```text
internal-only network
admin/console/client auth enabled
non-default strong identity/token
TLS or trusted internal encrypted path
least-privilege DB account
namespace + RBAC + network isolation
config encryption / external Secret for credentials
audit admin changes
rate limit and protect admin APIs
```

不要依赖“默认密码之后再改”。首次启动前就应生成独立凭据，密钥轮换要验证旧客户端重连。

## 10. 统一验收与故障演练

1. 从每类客户端网络验证 8848/9848 等实际路径；
2. 三节点成员和一致性状态正确；
3. 注册、订阅、健康摘除、配置发布/监听都成功；
4. 记录 Server 状态与各客户端有效缓存版本；
5. 停一个 Server，证明已有/新客户端行为；
6. 停一个数据库节点或阻断连接，验证控制面降级；
7. 停 Console，证明运行时发现不被管理面单点影响；
8. 恢复后核对实例列表、配置版本和客户端收敛；
9. 从数据库备份和 Nacos 配置导出完成隔离恢复。

## 11. 升级与回滚

检查 Nacos、SDK、插件、数据库 Schema、Helm/Operator 与 JDK 兼容。先在影子环境回放注册/配置流量，生产逐节点滚动并观察 Raft/Distro、连接、推送和应用有效版本。

若升级涉及 Schema，回滚不能只换旧 JAR。应预备升级前数据库备份、旧配置、旧镜像和独立恢复环境，并明确哪些数据可通过应用重新注册、哪些配置必须恢复。

## 12. 参考资料

- [Nacos 部署概览](https://www.nacos.io/en/docs/next/manual/admin/deployment/deployment-overview/)
- [Nacos 集群部署](https://www.nacos.io/en/docs/next/manual/admin/deployment/deployment-cluster/)
- [Nacos 系统参数](https://nacos.io/en/docs/latest/manual/admin/system-configurations/)
- [Nacos 部署最佳实践](https://nacos.io/en/docs/latest/manual/admin/deployment/deployment-best-practices/)
