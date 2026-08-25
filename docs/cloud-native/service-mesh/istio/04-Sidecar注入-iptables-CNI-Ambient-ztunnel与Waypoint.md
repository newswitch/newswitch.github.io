---
title: "Sidecar 注入、iptables/CNI、Ambient、ztunnel 与 Waypoint"
sidebar_label: "04. Sidecar 与 Ambient 数据平面"
sidebar_position: 4
description: "比较 Sidecar 和 Ambient 的流量捕获、身份、L4/L7 能力、资源成本与迁移边界。"
tags: [Istio, Sidecar, Ambient, ztunnel, Waypoint]
---

# Sidecar 注入、iptables/CNI、Ambient、ztunnel 与 Waypoint

Sidecar 与 Ambient 都由 Istiod 控制，但数据包路径不同。选择时要根据 L7 能力、隔离、资源、升级和当前版本限制，而不是只比较“少一个容器”。

## 1. Sidecar 模式

Mutating Webhook 在 Pod 创建时注入 Envoy 与 Agent。流量通过 initContainer iptables 或 Istio CNI 重定向：

```text
Application socket → iptables/TProxy → Envoy Outbound
Network → Envoy Inbound → Application socket
```

每个 Pod 都有完整 L4/L7 Proxy，隔离清晰，但 Sidecar 占用 CPU/内存、需要随应用重启升级，并改变 Pod 启动与终止顺序。

## 2. Ambient 模式

```text
Pod → 节点ztunnel（L4、身份、mTLS）
    → 可选Waypoint（L7路由、L7授权、Telemetry）
    → 目标ztunnel → Pod
```

Namespace 加入 Ambient 通常不要求重启工作负载。ztunnel 是节点级关键组件；Waypoint 按 Service Account/Namespace 等范围部署并可独立扩缩。

## 3. 能力边界

| 能力 | Sidecar | Ambient 基础层 | Ambient + Waypoint |
| --- | --- | --- | --- |
| mTLS/身份 | 支持 | 支持 | 支持 |
| L4 授权/Telemetry | 支持 | 支持 | 支持 |
| HTTP 路由/重试 | 支持 | 不提供 | 支持 |
| L7 授权/Trace | 支持 | 不提供 | 支持 |
| EnvoyFilter | 可用但高风险 | 不适用于 ztunnel | 能力按版本确认 |

## 4. 注入与捕获故障

Sidecar 未注入先查 Namespace Label、Webhook Selector、证书、Pod 创建时间；已有 Pod 不会因后来加 Label 自动注入。流量绕过查排除端口、Host Network、UID、iptables/CNI 和协议。

Ambient 查 `istio.io/dataplane-mode=ambient`、CNI、ztunnel Workload 视图、HBONE、Waypoint Enrollment 和 Gateway API Status。

## 5. 终止与连接

Sidecar 必须允许应用完成请求、Envoy 排空连接再退出；错误的 PreStop/Grace Period 会在发布时制造 503。Ambient 迁移不重启 Pod，但连接、Telemetry Label 和 Trace Span 数量可能变化，应重新验证 SLO。

## 6. 迁移步骤

```text
安装Ambient组件但不迁移流量
→ 校验ztunnel/CNI
→ 选择低风险Namespace加入L4层
→ 验证mTLS、授权和Telemetry
→ 按需部署Waypoint
→ 迁移L7策略
→ 更新告警和容量
→ 扩大范围并保留回滚
```

## 7. 实验

同一应用运行 Sidecar、Ambient L4、Ambient+Waypoint 三组，比较 Pod 资源、请求路径、证书身份、指标、Trace、P99 和滚动发布时间，再做选型。

参考：[Sidecar or Ambient](https://istio.io/latest/docs/overview/dataplane-modes/)、[Ambient Architecture](https://istio.io/latest/docs/ambient/architecture/)。
