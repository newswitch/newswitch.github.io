---
title: "Ingress、Gateway API、Domain、Route 与 Backend"
sidebar_position: 4
tags: [Higress, Ingress, Gateway API, Route]
description: "理解 Kubernetes Ingress/Gateway API 所有权、Host/Path 匹配、Backend 和状态。"
---

# Ingress、Gateway API、Domain、Route 与 Backend

Ingress 用单资源表达 Host/Path→Service；Gateway API 拆分 GatewayClass、Gateway、HTTPRoute 等，让基础设施与应用团队分权。

```text
GatewayClass（实现/控制器）
→ Gateway（Listener/地址/TLS）
→ HTTPRoute（Host/Rule/Filter/BackendRef）
→ Service/Endpoint or external backend
```

## 绑定

Route 通过 parentRefs 绑定 Gateway，Listener 用 allowedRoutes 限制 Namespace；BackendRef 跨 Namespace 需 ReferenceGrant。检查 `Accepted`、`Programmed`、`ResolvedRefs` 条件和 observedGeneration。

## 匹配

Host、Path exact/prefix、Header/Query 的优先级和冲突按 API/实现规则，不靠 YAML 顺序。Rewrite/Redirect、timeout/retry 等由标准或 Higress Policy 扩展，版本支持需核对。

## TLS

Gateway Listener 引用 Secret；证书 SAN 覆盖域名，SNI 选择与 Host 路由分开测试。Secret 跨 Namespace/轮换受 RBAC和控制器监听范围影响。

## 发布

GitOps apply → status gate → 合成请求测试 → Canary Domain/Header → 指标 → 放量。删除 Gateway/Route 先确认共享引用和回滚。

## 验收题

- GatewayClass/Gateway/HTTPRoute 分别由谁拥有？
- ReferenceGrant 解决什么安全问题？
- Ready Pod 为何不证明 Route 已 Programmed？
- TLS SNI 与 HTTP Host 如何分别验证？

## 参考资料

- [Gateway API](https://gateway-api.sigs.k8s.io/)
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
