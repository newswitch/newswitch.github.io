---
title: "Kubernetes、Nacos、DNS、Dubbo 服务发现"
sidebar_position: 5
tags: [Higress, Service Discovery, Nacos, Dubbo]
description: "理解 Higress 不同 Endpoint 来源、协议元数据、同步、缓存和故障。"
---

# Kubernetes、Nacos、DNS、Dubbo 服务发现

## 来源

| 来源 | 权威对象 | 变化机制 |
| --- | --- | --- |
| Kubernetes | Service/EndpointSlice | Watch |
| Nacos | Service/Cluster/Instance | Subscribe/push |
| DNS | A/AAAA/SRV | TTL refresh |
| Dubbo | 注册中心服务/元数据 | 协议适配 |

Controller 将来源转换为 Envoy Cluster/Endpoint。必须为每个 Backend 指定单一权威来源，避免两个系统互相覆盖。

## 元数据映射

协议、端口、weight、zone、TLS、健康和服务版本需要正确映射。Nacos 显示实例并不证明 Higress 订阅了相同 Namespace/Group/Cluster；K8s Pod Ready 不等于自定义业务健康完全符合。

## 缓存和故障

控制面失联后 Gateway 使用最后 endpoints，提高可用性却可能调用下线实例。配置主动/被动健康、连接排空和 stale 上限。DNS TTL、negative cache 和 resolver 失败也需监控。

## 验收

新增/下线/改权重一个 Endpoint，记录来源事件、Controller 版本、Envoy endpoint 和真实请求比例/错误；阻断发现源，验证旧缓存与恢复收敛。

## 验收题

- 服务发现权威来源为何必须唯一？
- Endpoint metadata 哪些会影响路由？
- 控制面缓存如何交换可用性与新鲜度？
- Nacos Namespace 错误怎样定位？

## 参考资料

- [Higress service sources](https://higress.cn/en/docs/latest/user/service-source/)
