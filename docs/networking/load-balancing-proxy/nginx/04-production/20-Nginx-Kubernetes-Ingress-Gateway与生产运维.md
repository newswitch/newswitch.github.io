---
title: "Nginx、Kubernetes Ingress、Gateway API 与生产运维"
sidebar_label: "20. Kubernetes 入口与生产运维"
sidebar_position: 20
description: "区分普通 Nginx、Ingress Controller 与 Gateway 数据面，理解配置生成、Service 路径、证书、Reload、扩缩容和排障。"
tags: [Nginx, Kubernetes, Ingress, Gateway API, Ingress Controller]
---

# Nginx、Kubernetes Ingress、Gateway API 与生产运维

“集群里用了 Nginx”可能指三种完全不同的东西：业务自己运行的 Nginx Deployment、根据 Ingress 生成配置的 Controller，或实现 Gateway API 的数据面。先识别控制面和配置所有者，再修改参数。

## 1. 三种形态

```text
普通 Nginx Pod
  用户直接维护 nginx.conf

Ingress Controller
  Watch Ingress/Service/EndpointSlice/Secret
  → 生成并下发 Nginx 配置

Gateway Controller/Data Plane
  Watch GatewayClass/Gateway/Route/Policy
  → 生成 Listener、Route、Backend 配置
```

产品名称包含 Nginx 不代表支持相同注解、CRD、模板或指标。开源 Nginx、F5 NGINX Ingress Controller、社区 ingress-nginx 及其他实现需要分别看版本文档和生命周期公告。

## 2. 北向请求路径

```text
Client
→ DNS
→ Cloud/Hardware LoadBalancer 或 NodePort
→ Nginx Data Plane Pod
→ Service ClusterIP 或 Endpoint
→ Application Pod
```

每跳都可能执行 SNAT、健康检查、TLS 终止、连接复用和超时。排障时记录实际 Remote IP、Forwarded Header 和 Endpoint。

## 3. Ingress 对象

Ingress 描述 Host/Path 到 Service 的 HTTP 路由，不直接运行代理。Controller 通过 `ingressClassName` 选择对象：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /v1
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 8080
```

同一对象的注解在不同 Controller 上可能完全不同。必须确认 `IngressClass.spec.controller` 和运行中的 Controller 参数。

## 4. Gateway API

Gateway API 将职责拆开：

- GatewayClass：实现与基础设施类型；
- Gateway：Listener 和入口实例；
- HTTPRoute/GRPCRoute/TLSRoute/TCPRoute/UDPRoute：路由；
- ReferenceGrant：跨命名空间引用授权；
- Policy：实现支持的后端/TLS/流量策略。

对象 `Accepted=True` 不等于数据面已生效，还要检查 `Programmed`、`ResolvedRefs`、Route Parent Status 和真实请求。

## 5. 配置生成与 Reload

典型 Controller 流程：

```text
Watch API 对象
→ 建立内部模型
→ 校验冲突和引用
→ 生成配置/调用动态 API
→ Reload 或增量更新数据面
→ 写 Status/Event/Metrics
```

高频 Endpoint/Secret 变化可能引发配置抖动。观察配置生成次数、Reload 成功率、旧 Worker 排空和控制器队列，不只看 Pod Running。

## 6. Service 与 Endpoint 模式

Controller 可能把流量发给：

- Service ClusterIP：再由 Kubernetes 数据面选 Endpoint；
- Pod Endpoint：Nginx 直接负载均衡到 Pod IP；
- NodePort/ExternalName 等其他后端。

两种常见路径的健康、源地址、连接复用和 Endpoint 更新不同。通过生成配置和 `$upstream_addr` 确认实际模式。

## 7. TLS Secret

```yaml
spec:
  tls:
    - hosts: [api.example.com]
      secretName: api-tls
```

检查：

- Secret 命名空间与引用规则；
- `tls.crt` 是否包含叶子和中间链；
- `tls.key` 是否匹配；
- Controller RBAC 能否读取；
- 数据面是否已加载新序列号；
- 更前面的 Cloud LB/CDN 是否才是真正终止点。

## 8. 真实客户端地址

路径可能为：

```text
Client → Cloud LB → Node → Nginx Pod
```

`externalTrafficPolicy`、SNAT、PROXY Protocol、Forwarded Header 和 Controller Trust CIDR 共同决定 `$remote_addr`。错误信任会导致所有用户显示 LB 地址或允许伪造 IP，影响日志、限流和授权。

## 9. Pod 生命周期与排空

Readiness 失败到所有入口停止发新连接存在传播时间。建议：

```text
标记不就绪/从数据面摘流
→ 等待配置传播
→ 向 Nginx 发送 QUIT
→ 等待存量连接
→ 到达 terminationGracePeriod 后终止
```

PreStop、Controller 行为和 LB 健康检查需联合验证。SSE/WebSocket/gRPC 长流要设置最大寿命和重连机制。

## 10. 资源与调度

- Request/Limit 决定调度和 CPU Throttling；
- 多副本跨节点/故障域分散；
- PodDisruptionBudget 只限制自愿中断，不保证容量；
- HPA 指标要结合连接、RPS、CPU 和延迟；
- Cache/Temp/Log 的 `emptyDir` 计入节点临时存储；
- HostNetwork/HostPort/NodePort 改变网络和端口冲突边界。

## 11. 变更与升级

升级前固定：

- Controller 与 Nginx 数据面版本；
- Helm Chart/Manifest；
- CRD 和 Admission Webhook；
- 注解/参数弃用清单；
- 默认 TLS、Header、Path Matching 和 Snippet 策略变化；
- 回滚是否兼容新 CRD/配置。

Canary Controller 应使用独立 Class/入口，避免两个控制器同时认领同一对象。

## 12. 故障排查

```bash
kubectl get ingress,ingressclass -A
kubectl get gateway,httproute,grpcroute -A
kubectl describe ingress -n <ns> <name>
kubectl get endpointslice -n <ns> -l kubernetes.io/service-name=<svc>
kubectl logs -n <controller-ns> deploy/<controller>
kubectl exec -n <controller-ns> <pod> -- nginx -T
```

排查顺序：对象是否被正确 Controller 接受 → 引用和 Endpoint 是否有效 → 生成配置是否正确 → Data Plane 是否 Reload → Service/Pod 网络是否可达 → 应用是否健康。

## 13. 练习与答案

**问题：** Ingress 已创建但没有 Address，优先检查什么？

检查 `ingressClassName`、IngressClass Controller、Controller Watch 范围/RBAC、事件和入口基础设施，而不是先改 Service。

**问题：** Secret 更新后为何部分请求仍看到旧证书？

可能部分数据面未加载、流量经过另一入口/CDN、IPv4/IPv6 指向不同实例，或旧连接没有重新握手。

**问题：** Pod Running 是否表示入口已可用？

不表示。还需 Readiness、Controller 配置完成、LB 健康和真实请求验证。

## 14. 参考资料

- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/)
- [Kubernetes EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
