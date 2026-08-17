---
title: "Envoy xDS、Bootstrap、ADS、SotW/Delta 与 ACK/NACK"
sidebar_label: "05. Envoy xDS、Bootstrap、ADS、SotW/Delta 与 ACK/NACK"
sidebar_position: 5
tags: [Envoy, xDS, ADS, ACK, NACK, Control Plane]
description: "理解 Envoy 动态配置协议、资源依赖、版本确认、配置预热和控制面正确性。"
---

# Envoy xDS、Bootstrap、ADS、SotW/Delta 与 ACK/NACK

Bootstrap 告诉 Envoy 自己是谁、怎样联系管理服务器，以及哪些资源静态或动态获得。xDS 则持续交付 Listener、Route、Cluster、Endpoint、Secret 和扩展配置。

## 1. 配置链

```text
bootstrap node.id / node.cluster
→ management cluster
→ gRPC ADS stream
→ LDS/CDS/RDS/EDS/SDS/ECDS resources
→ validation and dependency warming
→ ACK/NACK
→ active runtime objects
```

ADS 将多种 xDS 复用到一条流上，便于控制依赖顺序；它不自动保证业务层事务。控制面必须维持资源引用完整，例如先让 Cluster/Endpoint 可用，再激活引用它的 Route/Listener。

## 2. SotW 与 Delta

- **State of the World**：一次响应表达该订阅范围的完整资源集合，删除通常通过下一版不再包含该资源表示；
- **Delta xDS**：按资源增量增加、更新和删除，并维护资源级版本/订阅状态。

Delta 可减少大规模配置更新量，但控制面状态机更复杂。不要因为叫“Delta”就假定它天然更一致或不会全量同步。

## 3. ACK/NACK 的准确含义

Envoy 对 DiscoveryResponse 回 DiscoveryRequest。`response_nonce` 关联被确认的响应；有 `error_detail` 表示 NACK，`version_info` 表示客户端最近使用/确认的版本语义，具体字段随 SotW/Delta 不同。

- ACK 表示资源通过接收侧校验并有应用意图；不等于真实请求一定命中或业务健康；
- NACK 表示响应中至少有资源无效，控制面应记录 error detail、类型、节点、nonce 和版本；
- 某一资源 NACK 时，Envoy 通常继续使用最后有效配置，不能假定已经“回滚为数据库旧值”；
- 不要对相同未变化资源循环推送，否则会制造控制面和数据面负载。

## 4. Warming 与依赖

Listener/Cluster 可等待 RDS/EDS/SDS 等依赖准备后再 active。资源卡在 warming 时，检查引用名称、订阅范围、Secret、Endpoint 和控制面推送顺序。只看 ACK 计数不足以判断 active 状态。

控制面断线时 Envoy 通常保留最后有效资源继续代理，但新路由、Endpoint 和证书无法更新。需要告警 xDS 连接、版本陈旧、NACK、warming 时长与 SDS 到期时间。

## 5. 控制面实现原则

1. 为节点建立稳定身份和授权，防止取到其他租户配置；
2. 使用单调、可追踪的版本，不把时间戳当唯一审计信息；
3. 构建不可变 Snapshot 并做引用完整性校验；
4. 合并高频变更，设置推送背压，避免 Endpoint 抖动风暴；
5. 记录配置来源→生成资源→目标节点→ACK/NACK 的链路；
6. 保留最后已知良好版本并支持小批 Canary；
7. 用兼容测试覆盖不同 Envoy minor/API deprecation。

## 6. 实验

- 推送不存在 Cluster 的 Route，观察 NACK/依赖行为；
- 推送错误 Secret，观察 Listener warming 和旧证书；
- 断开管理服务器，验证数据面继续使用最后配置；
- 让一个节点错配 `node.id`，确认隔离和审计；
- 比较 SotW/Delta 删除资源及重连后的同步；
- 大批更新 Endpoint，测控制面队列、推送时间和 Envoy CPU。

## 7. 掌握标准

你应能解释配置“保存成功、ACK、active、请求命中”是四个不同阶段，并可凭 node、type URL、nonce、version 和 error detail 定位 NACK。

## 参考资料

- [xDS Protocol](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol.html)
- [Dynamic Configuration](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/dynamic_configuration)
