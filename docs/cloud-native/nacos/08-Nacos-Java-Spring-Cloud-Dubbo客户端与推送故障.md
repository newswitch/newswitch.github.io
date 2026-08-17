---
title: "Java/Spring Cloud/Dubbo 客户端、版本兼容与推送故障"
sidebar_label: "08. Java/Spring Cloud/Dubbo 客户端、版本兼容与推送故障"
sidebar_position: 8
tags: [Nacos, Java, Spring Cloud, Dubbo, SDK]
description: "理解 Nacos SDK 地址发现、长连接、缓存、线程和框架适配兼容。"
---

# Java/Spring Cloud/Dubbo 客户端、版本兼容与推送故障

控制面最终由客户端执行。Server 正常不代表 Spring Cloud/Dubbo/Nacos SDK 已正确订阅、刷新和调用。

## 启动路径

```text
load server address/namespace/credentials
→ HTTP/gRPC connect
→ register/listen/subscribe
→ persist local failover cache
→ framework ServiceInstance/config bean
→ load balancer/runtime refresh
```

## 版本矩阵

记录 JDK、Nacos Server/Client、Spring Cloud Alibaba/Spring Boot 或 Dubbo 版本。BOM 管依赖，检查传递依赖是否覆盖 Nacos Client；升级先跑注册、配置监听、鉴权和故障恢复。

## 地址和缓存

Server 地址可来自配置、环境、Endpoint/VIP。Namespace ID 与显示名不同。客户端本地 cache/failover 文件路径、权限和刷新行为需确认；容器重建会丢临时缓存。

## 推送故障

比较 Server 配置/实例视图、SDK 日志/连接、Listener 回调、框架实际 Bean/Endpoint 和业务请求。线程池阻塞、回调异常、旧 SDK、LB 9848、鉴权都可导致部分实例不更新。

## 验收题

- 为什么 BOM 版本不等于运行时 Nacos Client？
- Namespace 名称/ID 错误怎样表现？
- SDK 收到变更但应用未生效应查哪层？
- 本地 cache 的可用性与陈旧代价是什么？

## 参考资料

- [Nacos SDK overview](https://nacos.io/en/docs/latest/manual/user/sdk/overview/)
- [Spring Cloud Alibaba Nacos](https://sca.aliyun.com/en/docs/2023/user-guide/nacos/quick-start/)
