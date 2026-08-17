---
title: "Server、Console、gRPC、端口与 3.x 架构"
sidebar_position: 6
tags: [Nacos, Server, Console, gRPC, Architecture]
description: "理解 Nacos 3.x 运行面、管理面、客户端/服务端协议和端口边界。"
---

# Server、Console、gRPC、端口与 3.x 架构

Nacos 3.x 支持 Server 与 Console 分离：

```text
runtime SDK/OpenAPI → Nacos Server
admin browser/API   → independent Console → Server admin APIs
Server members      ↔ server gRPC + JRaft
```

## 默认端口关系

以主端口 8848 为例，客户端 gRPC 常为 +1000（9848）、Server gRPC +1001（9849）、JRaft -1000（7848）；独立 Console 常有 8080。目标版本/配置可改变，按实际 socket 校验。

## Server

加载 Naming、Config、AI Registry 等模块（可用 function mode 控制），维护 SDK 长连接、OpenAPI、数据复制和存储。Server 只对内网客户端/LB 开放必要端口。

## Console

管理面可独立资源、SSO/WAF、审计和访问网。关闭 Console 不应影响已有 SDK 数据面；Console 不可与主端口一起公开公网。

## gRPC

SDK 2.x/3.x 与 Server 通过 gRPC 长连接做请求/推送。防火墙只开 8848 会出现 HTTP 能访问、SDK 连接/推送失败。NAT/LB idle timeout 和连接数也需规划。

## 验收题

- Console 分离带来什么安全/稳定收益？
- 只开放 8848 为什么 SDK 可能异常？
- function mode 与 deployment mode 有何区别？
- Server 管理面和运行面如何隔离？

## 参考资料

- [Nacos deployment overview](https://www.nacos.io/en/docs/next/manual/admin/deployment/deployment-overview/)
