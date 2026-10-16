---
title: "SPIFFE 身份、证书签发、mTLS、PeerAuthentication 与 DestinationRule"
sidebar_label: "08. 身份、证书与 mTLS"
sidebar_position: 8
description: "从 Service Account 到工作负载证书、SDS、握手和策略，分析 Istio mTLS 的完整路径。"
tags: [Istio, SPIFFE, mTLS, PeerAuthentication, Certificate]
---

# SPIFFE 身份、证书签发、mTLS、PeerAuthentication 与 DestinationRule

Istio 以工作负载身份而不是 Pod IP 做服务认证。典型身份由 Trust Domain、Namespace 和 Service Account 组成，证书是短生命周期凭据。

## 1. 身份与证书路径

```text
Pod ServiceAccount Token
→ Istio Agent/ztunnel向Istiod CA证明身份
→ 签发X.509 SVID
→ 通过SDS交给Envoy/数据平面
→ 建立mTLS并验证对端Trust Domain与身份
→ 到期前自动轮换
```

Root/Intermediate CA、Trust Domain 和 Service Account 是安全根，必须有备份、轮换和审计。

## 2. 两个策略方向

| 配置 | 作用 |
| --- | --- |
| PeerAuthentication | 目标工作负载入站接受/要求何种 mTLS 模式 |
| DestinationRule TLS | 客户端到目标的出站 TLS 行为 |

`STRICT` 要求 mTLS，`PERMISSIVE` 同时接受明文和 mTLS，常用于迁移。永久保持 PERMISSIVE 会让未入网格客户端绕过身份认证。

## 3. 自动 mTLS

Istio 可根据服务发现和策略自动选择 mTLS，但显式错误 DestinationRule 可能覆盖正确行为。排障必须查看实际 Cluster Transport Socket，而不是只看 PeerAuthentication。

## 4. 证书诊断

```bash
istioctl proxy-config secret POD -n NS
istioctl authn tls-check POD SERVICE.NS.svc.cluster.local
```

核对证书有效期、SAN、Issuer、Trust Domain、根证书和系统时间。握手失败常见于过期、Root 不一致、错误 SNI、跨集群信任和明文端口。

## 5. 安全迁移

```text
盘点明文客户端
→ PERMISSIVE并观察连接
→ 让所有客户端加入身份体系
→ 小范围STRICT
→ 验证异常与回滚
→ 全量STRICT
```

mTLS 只认证和加密连接，不决定“这个身份是否允许调用接口”；AuthorizationPolicy 负责授权。

## 6. CA 轮换

先让数据平面信任新旧 Root，再签发新链，等待工作负载证书轮换，最后移除旧 Root。直接替换 Root 会让存量 Proxy 相互不信任。轮换要覆盖 Sidecar、Gateway、ztunnel、Waypoint 和多集群。

## 7. 验收

用不同 Service Account 调用同一服务，抓取身份和证书；从 PERMISSIVE 切到 STRICT，证明网格内成功、明文失败；模拟错误 Root 与时钟偏移，完成诊断。

参考：[Istio Security](https://istio.io/latest/docs/concepts/security/)、[Authentication Policy](https://istio.io/latest/docs/tasks/security/authentication/)。
