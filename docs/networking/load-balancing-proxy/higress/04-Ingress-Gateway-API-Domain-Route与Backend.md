---
title: "Ingress、Gateway API、Domain、Route 与 Backend"
sidebar_label: "04. Ingress、Gateway API、Domain、Route 与 Backend"
sidebar_position: 4
description: "理解 Kubernetes Ingress/Gateway API 所有权、Host/Path 匹配、Backend 和状态。"
tags: [Higress, Ingress, Gateway API, Route]
---

# Ingress、Gateway API、Domain、Route 与 Backend

Ingress 用单资源表达 Host/Path→Service；Gateway API 拆分 GatewayClass、Gateway、HTTPRoute 等，让基础设施与应用团队分权。

```text
GatewayClass（实现/控制器）
→ Gateway（Listener/地址/TLS）
→ HTTPRoute（Host/Rule/Filter/BackendRef）
→ Service/Endpoint or external backend
```

## 1. 绑定 {/* #绑定 */}

Route 通过 parentRefs 绑定 Gateway，Listener 用 allowedRoutes 限制 Namespace；BackendRef 跨 Namespace 需 ReferenceGrant。检查 `Accepted`、`Programmed`、`ResolvedRefs` 条件和 observedGeneration。

## 2. 匹配 {/* #匹配 */}

Host、Path exact/prefix、Header/Query 的优先级和冲突按 API/实现规则，不靠 YAML 顺序。Rewrite/Redirect、timeout/retry 等由标准或 Higress Policy 扩展，版本支持需核对。

## 3. TLS {/* #tls */}

Gateway Listener 引用 Secret；证书 SAN 覆盖域名，SNI 选择与 Host 路由分开测试。Secret 跨 Namespace/轮换受 RBAC和控制器监听范围影响。

## 4. 发布 {/* #发布 */}

GitOps apply → status gate → 合成请求测试 → Canary Domain/Header → 指标 → 放量。删除 Gateway/Route 先确认共享引用和回滚。

## 5. Route 验收矩阵 {/* #route-验收矩阵 */}

为 host、path、method、header、优先级和不存在后端建立正反例，查看资源 `status.conditions`，再从网关入口访问。只看到 YAML Accepted 不代表所有 Reference、证书和 Endpoint 已就绪。

```bash
kubectl describe gateway -n gateway-system
kubectl describe httproute -n app
kubectl get endpointslice -n app -l kubernetes.io/service-name=orders
curl --resolve api.example.com:443:<gateway-ip> https://api.example.com/orders
```

Ingress 与 Gateway API 并存时要定义唯一权威来源、GatewayClass 和冲突优先级，避免两个 controller 接管同一对象。跨命名空间 Backend/Secret 使用 `ReferenceGrant` 等授权边界。变更先 dry-run/预发、再小流量，保存旧 Route 快速回滚。

## 6. 验收题 {/* #验收题 */}

- GatewayClass/Gateway/HTTPRoute 分别由谁拥有？
- ReferenceGrant 解决什么安全问题？
- Ready Pod 为何不证明 Route 已 Programmed？
- TLS SNI 与 HTTP Host 如何分别验证？

## 7. 参考资料 {/* #参考资料 */}

- [Gateway API](https://gateway-api.sigs.k8s.io/)
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
