---
title: "istioctl、Envoy Admin、xDS 与生产故障 Runbook"
sidebar_label: "14. Istio 生产故障 Runbook"
sidebar_position: 14
description: "沿请求、配置、身份和资源四条证据链定位 Istio 503、路由错误、mTLS、授权和控制面故障。"
tags: [Istio, istioctl, Envoy Admin, xDS, Runbook]
---

# istioctl、Envoy Admin、xDS 与生产故障 Runbook

Istio 故障最容易被“重启 Sidecar 后恢复”掩盖。先保存出错 Proxy 的配置、Stats、日志和连接，再做变更。

## 1. 前五分钟

1. 确认影响 Host、Path、来源/目标身份、Namespace 和时间；
2. 比较无网格/网格内、单 Pod/全服务、入口/服务间；
3. 冻结路由、策略、升级和批量重启；
4. 保存 `proxy-status`、`analyze`、目标 Proxy Config Dump 和指标；
5. 根据响应 Flags、HTTP/Envoy 状态和 Upstream 日志定位层级。

## 2. 决策树

```text
请求失败
├─ DNS/Service/Endpoint错误
├─ 流量未进入Proxy → 注入/CNI/iptables/Ambient enrollment
├─ xDS不同步 → Istiod连接、Revision、NACK、作用域
├─ NR/404 → Listener/Route/Host/Gateway
├─ UH/503 → Cluster无健康Endpoint
├─ UF/握手 → 网络、mTLS、证书、SNI
├─ 401/403 → JWT/AuthorizationPolicy
└─ Timeout/Reset → Upstream、连接池、重试、排空
```

## 3. 证据命令

```bash
istioctl analyze -A
istioctl proxy-status
istioctl proxy-config all POD -n NS -o json > proxy.json
istioctl proxy-config secret POD -n NS
kubectl logs POD -c istio-proxy -n NS --since=30m
```

Envoy Admin 仅通过本地受控端口访问，保存 `/config_dump`、`/clusters`、`/stats`。不要把 Admin Port 暴露到集群外。

## 4. Ambient 专项

检查 ztunnel Pod/日志、Workload/Service 配置视图、Waypoint Status 与绑定、HBONE 网络和 CNI。L4 正常但 L7 规则无效时优先查是否真正经过 Waypoint。

## 5. 控制面故障

Istiod 不可用时已有 Proxy 可能继续使用旧配置。确认 xDS 连接分布、API Server/Webhook、证书签发和新 Pod 注入。先恢复一个可用 Revision，不要同时删除旧控制面。

## 6. 恢复验收

- 允许/拒绝请求符合策略矩阵；
- Proxy `SYNCED`，无持续 NACK；
- Listener/Route/Cluster/Endpoint 正确；
- mTLS 身份和证书有效；
- 503/Reset/Retry/P99 恢复；
- 临时放宽授权、PERMISSIVE、重试和 Silence 已回收。

## 7. 演练

演练错误 Host、空 Subset、Endpoint 退出、证书不信任、DENY 策略、Istiod 退出、Gateway 排空、ztunnel/Waypoint 故障和升级回滚。复盘必须指出失败发生在控制面还是数据面。

参考：[Istio Diagnostic Tools](https://istio.io/latest/docs/ops/diagnostic-tools/)、[Common Problems](https://istio.io/latest/docs/ops/common-problems/)。
