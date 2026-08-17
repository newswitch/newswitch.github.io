---
title: "Envoy Drain、Hot Restart、Runtime、灰度与无损升级"
sidebar_label: "11. Envoy Drain、Hot Restart、Runtime、灰度与无损升级"
sidebar_position: 11
tags: [Envoy, Drain, Hot Restart, Runtime, Upgrade]
description: "理解配置更新、连接排空、进程热重启、Kubernetes 滚动和版本兼容，建立可回退升级流程。"
---

# Envoy Drain、Hot Restart、Runtime、灰度与无损升级

“无损”不是进程没退出，而是新请求被正确接管、旧连接在预算内完成、长连接有明确策略、配置和协议保持兼容。

## 1. 四类变化

| 变化 | 主要机制 | 风险 |
| --- | --- | --- |
| xDS 资源更新 | 新资源 validate/warm/activate | NACK、依赖缺失、语义变化 |
| Runtime 值 | 分层运行时/动态键 | 未审计漂移、键弃用 |
| Envoy 进程替换 | Hot Restart 或多实例切换 | FD/状态继承、版本兼容 |
| Kubernetes Pod 滚动 | readiness、LB 摘除、drain、grace | 竞态、强杀长连接 |

Runtime 适合少量受支持的运行参数和灰度开关，不是绕过配置发布审计的任意 KV 系统。

## 2. Drain 的含义

Drain 通常停止或逐步停止接受新工作，并允许已有连接/Stream 在截止时间前完成。HTTP/2、gRPC Streaming、WebSocket 和 SSE 可能长于终止宽限期；需要决定等待、发送 GOAWAY/关闭、客户端重连还是业务迁移。

先从外部 LB/Service Endpoint 摘除，等待传播，再启动 Envoy drain。Readiness 失败、preStop、drain time 和 `terminationGracePeriodSeconds` 必须按顺序和最长请求设计。

## 3. Hot Restart 与多副本滚动

Envoy Hot Restart 可由新老进程代际协同接管 Listener/统计等，但需要正确的 base ID、共享状态和版本兼容。容器/Kubernetes 通常更适合多副本滚动，让新 Pod 独立 warm 并接流，再排空旧 Pod。

无论哪种方式，都必须验证下游 Listener、xDS、SDS、Endpoint、Filter/Wasm 和 upstream 协议就绪，不能只以进程启动为 readiness。

## 4. 升级流程

1. 阅读固定旧/新 minor 的 release notes、API deprecation 和安全公告；
2. 校验控制面能生成新旧 Envoy 都接受的资源；
3. 离线 validate/bootstrap，预发布重放真实 xDS Snapshot；
4. Canary 一个数据面实例/小流量，比较 NACK、503、P99、内存和协议；
5. 逐批扩容新实例，确认健康容量后排空旧实例；
6. 保留旧镜像、旧 Bootstrap 与兼容 xDS 版本；
7. 直到观察窗口结束再删除旧 API/Filter/Secret。

## 5. 回滚边界

镜像回滚不代表配置可回滚：控制面可能已发送旧版本不认识的字段，CRD/证书/插件也可能已经迁移。回滚计划要覆盖数据面版本、控制面生成逻辑、xDS Snapshot、SDS Secret、Wasm digest 和外部 LB。

## 6. 验收实验

- 持续发送短 HTTP、gRPC Unary、gRPC Stream、WebSocket/SSE；
- 在升级中观察新请求是否仍进入旧 Pod；
- 记录 drain 开始、Endpoint 摘除、最后连接结束和进程退出；
- 故意推送新版本不接受的配置，验证 NACK 和自动停止发布；
- 中途回滚，确认旧版本仍可获得兼容资源。

## 7. 掌握标准

你应能解释配置更新、Runtime、Drain、Hot Restart 和 Pod Rolling Update 的边界，并用连接级证据证明升级对短请求和长流的影响符合约定。

## 参考资料

- [Envoy Hot Restart](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart)
- [Draining](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/draining)
