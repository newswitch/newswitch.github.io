---
title: "Kubernetes、Nacos、DNS、Dubbo 服务发现"
sidebar_label: "05. Kubernetes、Nacos、DNS、Dubbo 服务发现"
sidebar_position: 5
description: "理解 Higress 不同 Endpoint 来源、协议元数据、同步、缓存和故障。"
tags: [Higress, Service Discovery, Nacos, Dubbo]
---

# Kubernetes、Nacos、DNS、Dubbo 服务发现

## 1. 来源 {/* #来源 */}

| 来源 | 权威对象 | 变化机制 |
| --- | --- | --- |
| Kubernetes | Service/EndpointSlice | Watch |
| Nacos | Service/Cluster/Instance | Subscribe/push |
| DNS | A/AAAA/SRV | TTL refresh |
| Dubbo | 注册中心服务/元数据 | 协议适配 |

Controller 将来源转换为 Envoy Cluster/Endpoint。必须为每个 Backend 指定单一权威来源，避免两个系统互相覆盖。

## 2. 元数据映射 {/* #元数据映射 */}

协议、端口、weight、zone、TLS、健康和服务版本需要正确映射。Nacos 显示实例并不证明 Higress 订阅了相同 Namespace/Group/Cluster；K8s Pod Ready 不等于自定义业务健康完全符合。

## 3. 缓存和故障 {/* #缓存和故障 */}

控制面失联后 Gateway 使用最后 endpoints，提高可用性却可能调用下线实例。配置主动/被动健康、连接排空和 stale 上限。DNS TTL、negative cache 和 resolver 失败也需监控。

## 4. 验收 {/* #验收 */}

新增/下线/改权重一个 Endpoint，记录来源事件、Controller 版本、Envoy endpoint 和真实请求比例/错误；阻断发现源，验证旧缓存与恢复收敛。

## 5. 服务发现故障分层 {/* #服务发现故障分层 */}

```text
资源/注册中心 -> Higress controller/provider -> 下发 cluster/endpoints
             -> Gateway 健康检查/连接池 -> 真实上游
```

对 Kubernetes、Nacos、DNS 和 Dubbo 各准备一个最小后端，记录注册实例、健康状态、网关已知 endpoint 和请求命中实例。然后删除实例、让 Nacos 不可达、制造 DNS 失败，测量摘除/缓存/恢复时间。

```bash
kubectl get endpointslice -A
kubectl logs -n higress-system deploy/higress-gateway-controller --since=10m
```

注册中心显示 healthy 不等于从网关网络可达；要检查地址类型、端口、协议、TLS、NetworkPolicy 和连接池。控制面缓存可在依赖短时故障时维持旧 endpoint，但也可能把流量送到已失效地址，因此必须明确 TTL、健康检查和 stale 数据边界。

## 6. 验收题 {/* #验收题 */}

- 服务发现权威来源为何必须唯一？
- Endpoint metadata 哪些会影响路由？
- 控制面缓存如何交换可用性与新鲜度？
- Nacos Namespace 错误怎样定位？

## 7. 参考资料 {/* #参考资料 */}

- [Higress service sources](https://higress.cn/en/docs/latest/user/service-source/)
