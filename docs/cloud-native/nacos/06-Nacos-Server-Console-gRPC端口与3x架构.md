---
title: "Server、Console、gRPC、端口与 3.x 架构"
sidebar_label: "06. Server、Console、gRPC、端口与 3.x 架构"
sidebar_position: 6
description: "理解 Nacos 3.x 运行面、管理面、客户端/服务端协议和端口边界。"
tags: [Nacos, Server, Console, gRPC, Architecture]
---

# Server、Console、gRPC、端口与 3.x 架构

> 版本基线：Nacos 3.2；最后核验：2026-08-18。端口偏移和模块拆分必须以目标版本配置及实际监听 Socket 为准。

Nacos 3.x 支持 Server 与 Console 分离：

```text
runtime SDK/OpenAPI → Nacos Server
admin browser/API   → independent Console → Server admin APIs
Server members      ↔ server gRPC + JRaft
```

## 1. 默认端口关系 {/* #默认端口关系 */}

以主端口 8848 为例，客户端 gRPC 常为 +1000（9848）、Server gRPC +1001（9849）、JRaft -1000（7848）；独立 Console 常有 8080。目标版本/配置可改变，按实际 socket 校验。

## 2. Server {/* #server */}

加载 Naming、Config、AI Registry 等模块（可用 function mode 控制），维护 SDK 长连接、OpenAPI、数据复制和存储。Server 只对内网客户端/LB 开放必要端口。

## 3. Console {/* #console */}

管理面可独立资源、SSO/WAF、审计和访问网。关闭 Console 不应影响已有 SDK 数据面；Console 不可与主端口一起公开公网。

## 4. gRPC {/* #grpc */}

SDK 2.x/3.x 与 Server 通过 gRPC 长连接做请求/推送。防火墙只开 8848 会出现 HTTP 能访问、SDK 连接/推送失败。NAT/LB idle timeout 和连接数也需规划。

## 5. 请求路径与端口验收 {/* #请求路径与端口验收 */}

不要仅根据默认偏移开放防火墙，部署后从进程和客户端两侧证明真实监听与连通：

```bash
ss -lntp | grep -E '(:7848|:8848|:9848|:9849|:8080)'
curl -fsS http://127.0.0.1:8848/nacos/v1/console/health/liveness
```

具体健康 API、认证和端口以 3.2.x 当前配置为准。使用真实 2.x/3.x SDK 注册实例、订阅服务、监听配置，保持连接超过 LB idle timeout，并在控制台关闭、单 Server 下线和 leader 变化时观察推送、重连与数据面影响。

网络策略应分层：应用只访问客户端入口/gRPC；Server 成员开放 Server gRPC/JRaft；Console 仅管理网访问并通过受控管理 API 连接 Server。所有入口启用认证/TLS 和最小权限。出现“8848 正常但配置不推送”时，依次检查 SDK/server 版本、9848 连通、LB HTTP/2/长连接、NAT idle timeout 和服务端连接指标。

## 6. 验收题 {/* #验收题 */}

- Console 分离带来什么安全/稳定收益？
- 只开放 8848 为什么 SDK 可能异常？
- function mode 与 deployment mode 有何区别？
- Server 管理面和运行面如何隔离？

## 7. 参考资料 {/* #参考资料 */}

- [Nacos deployment overview](https://nacos.io/en/docs/latest/manual/admin/deployment/deployment-overview/)
- [Deployment best practices](https://nacos.io/en/docs/latest/manual/admin/deployment/deployment-best-practices/)
