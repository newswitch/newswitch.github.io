---
title: "APISIX 部署、Admin API、插件、认证、可观测性与 Kubernetes"
sidebar_label: "02. 生产部署、插件与安全"
sidebar_position: 2
description: "掌握 APISIX 单机、集群和 Kubernetes 部署，以及控制面安全、插件治理和可观测性。"
tags: [APISIX, Deployment, Kubernetes, Plugins]
---

# APISIX 部署、Admin API、插件、认证、可观测性与 Kubernetes

## 1. 部署形态

学习环境可用 Docker Compose 同时启动 APISIX 与 etcd；虚机生产用多 APISIX 节点加独立 etcd 集群；Kubernetes 可使用 Helm，并通过 APISIX Ingress Controller/Gateway API 把声明式资源翻译为网关配置。

APISIX 数据面节点尽量无状态并跨故障域；etcd 使用奇数成员、稳定磁盘、备份与 TLS。Admin API 不应暴露公网。

## 2. 发布与控制面安全

- Admin API 使用强 Key/mTLS/网络访问控制；
- 自动化账号按环境隔离，配置变更进入 Git、审计和审批；
- etcd 启用双向 TLS、认证和最小网络范围；
- Secret 不明文进入 Route JSON，优先使用 Secret Manager 集成；
- 配置先校验、灰度到少量网关，再扩大发布。

声明式控制器与人工 Admin API 同时修改同一对象会产生所有权冲突，必须确定唯一配置来源。

## 3. 插件治理

插件分认证授权、流量、安全、可观测性、转换和 Serverless。上线新插件需检查执行阶段、优先级、失败模式、外部依赖、同步阻塞、内存分配和配置 Schema。自定义 Lua 插件属于生产代码，要有单元测试、压测、版本和回滚。

认证常见 Key Auth、JWT、OIDC、HMAC、LDAP；认证只证明调用方是谁，Authorization 还要判断它能访问哪个 Route/资源。不要用隐藏 URL 代替授权。

## 4. 可观测性

Prometheus 记录请求率、状态码、延迟和带宽；Access Log 应包含 Request ID、Route、Consumer、Upstream、重试与分段耗时；Trace 传播 W3C Context。控制标签基数，不能把完整 URI 参数或用户 ID 直接作为指标标签。

## 5. Kubernetes 验收

验证 CRD/Gateway API 状态、Controller 日志、Admin API 对象、数据面生效四层；删除 Controller 时已有配置和新配置有不同边界；滚动 APISIX Pod 时保持连接和容量；etcd 故障时验证已加载路由、冷启动和配置写入。

参考：[APISIX Deployment Modes](https://apisix.apache.org/docs/apisix/deployment-modes/)、[APISIX Ingress Controller](https://apisix.apache.org/docs/ingress-controller/getting-started/)。
