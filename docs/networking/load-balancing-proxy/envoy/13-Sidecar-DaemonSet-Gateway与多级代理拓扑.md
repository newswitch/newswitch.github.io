---
title: "Envoy Sidecar、DaemonSet、Gateway、Service Mesh 与多级代理拓扑"
sidebar_position: 13
tags: [Envoy, Sidecar, DaemonSet, Gateway, Service Mesh]
description: "比较 Envoy 部署拓扑、故障域、资源成本、身份边界，并追踪多级代理中的请求与超时。"
---

# Envoy Sidecar、DaemonSet、Gateway、Service Mesh 与多级代理拓扑

同一个 Envoy 二进制可以成为边缘网关、共享节点代理或 Sidecar，但配置所有权、故障域、身份和容量完全不同。拓扑选择先看隔离和运维边界，不只看代理数量。

## 1. 形态对比

| 形态 | 优点 | 主要代价 |
| --- | --- | --- |
| Sidecar | 每工作负载隔离、身份/策略细、Localhost 路径 | Pod 资源、连接/配置规模、升级数量大 |
| DaemonSet/Node Proxy | 每节点共享、实例少 | 租户隔离和路径重定向复杂，节点级故障域 |
| Central Gateway | 集中入口/出口、证书和策略统一 | 容量热点、额外网络跳数、共享故障域 |
| Service Mesh | 控制面统一流量/身份/可观测 | 控制面和代理生命周期复杂 |

Ambient/无 Sidecar 等具体产品形态可能使用节点隧道和 L7 waypoint，需按所用 Mesh 架构单独分析，不能简单等同于 DaemonSet Envoy。

## 2. 多级请求

```text
client → cloud LB → edge Envoy
       → source sidecar/node proxy
       → destination sidecar/waypoint
       → application
```

每级都可能 TLS 终止/重建、重试、超时、限流、写访问日志。必须规定每项策略由哪一级负责，避免三层重试造成尝试数相乘、多个代理都缓冲大 Body，或每层都生成不关联的 Request ID。

## 3. 超时与重试预算

外层总超时大于内层，并为网络/返回留余量。只有最了解幂等和可恢复错误的一层执行重试，其他层尽量透传失败。Trace Context 和内部请求 ID 跨层传播，各层记录自己的 Route/Cluster/Host。

## 4. 容量与高可用

Sidecar 容量随应用副本扩展但会争用 Pod CPU/内存；共享 Gateway 必须按总入口流量和单实例故障扩容。DaemonSet 受节点流量偏斜影响。任何形态都要验证跨节点/可用区分散、控制面断线、证书更新和滚动排空。

多级代理增加连接与带宽：每跳存在 downstream/upstream 连接池、TLS、Buffer 和遥测开销。容量规划以真实拓扑压测，不把单 Envoy 基准直接乘副本。

## 5. 透明流量边界

iptables/eBPF/透明代理会改变 Original Source/Destination、DNS 和回环路径。排障先确认数据包实际经过哪些代理，避免流量重复捕获、健康检查被劫持或代理自身访问形成环路。应用绕过代理时，策略和 mTLS 也可能被绕过。

## 6. 选型问题

- 需要工作负载级强隔离还是可接受节点/网关共享？
- 配置、证书和升级由哪个团队/控制面负责？
- 是否有长连接、东西向高带宽或低延迟敏感流量？
- 代理故障影响单 Pod、单节点、单服务还是全入口？
- 应用能否感知/配合重试、身份和优雅关闭？
- 资源成本、连接规模和可观测基数是否可控？

## 7. 掌握标准

你应能画出生产请求经过的每个代理和 TLS/身份边界，指定超时、重试与日志所有者，并根据故障域和容量选择 Sidecar、节点代理或集中 Gateway。

## 参考资料

- [Envoy Deployment Types](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/intro/deployment_types)
- [Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/)
