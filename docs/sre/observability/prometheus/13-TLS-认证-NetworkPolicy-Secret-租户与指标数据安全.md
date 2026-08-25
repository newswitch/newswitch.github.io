---
title: "TLS、认证、NetworkPolicy、Secret、租户和指标数据安全"
sidebar_label: "13. 监控体系安全"
sidebar_position: 13
description: "保护抓取、查询、远程写、告警通知和多租户边界，防止指标与凭据泄露。"
tags: [Prometheus, TLS, NetworkPolicy, Secret, 多租户, 安全]
---

# TLS、认证、NetworkPolicy、Secret、租户和指标数据安全

指标可能泄露主机名、租户、内部路由、版本、错误类型和业务规模。Prometheus、Alertmanager 与 Grafana 的管理接口还具有重载、Silence 或查询能力，不能默认暴露在公网。

## 1. 信任边界

```text
Prometheus → Target /metrics
Prometheus → Remote Write Backend
Prometheus → Alertmanager
User/Grafana → Query API
Alertmanager → Webhook/邮件/OnCall
```

每条链路分别配置身份认证、TLS、授权、网络允许和审计。TLS 只提供传输保护，不替代最小权限。

## 2. 抓取认证

在 Scrape Config/ServiceMonitor 中通过 Secret 引用 Bearer Token、Basic Auth、OAuth2 或 TLS 文件。ServiceAccount 只获得发现所需的 Kubernetes RBAC；业务 Endpoint 使用独立只读监控身份。

禁止 `insecure_skip_verify` 作为长期方案，CA 和证书轮换要有重叠窗口。

## 3. 查询与管理接口

Prometheus 自身通常不承担复杂多租户授权，应置于认证代理或受控网关后。限制 Admin API、Reload、Snapshot 和远程写接收入口。Grafana 用组织/文件夹/Data Source 权限隔离团队，但真正的数据 Tenant 边界应在后端强制执行。

## 4. Label 与样本安全

- 不把用户名、邮箱、Token、原始 SQL、完整 URL 放入 Label；
- 日志型错误详情不应作为指标值；
- External Label 不携带 Secret；
- 对 Exporter 输出做数据审查；
- 多租户远程写验证 Tenant Header 不能由不可信客户端伪造；
- 设置 Series、Label 和请求限制防止资源攻击。

## 5. 网络策略

只允许 Prometheus 到指定指标端口，允许 Grafana/规则组件访问查询入口，允许 Alertmanager 到必要通知目标。Alertmanager Gossip 端口仅在集群成员间开放。出口代理和 Webhook 应防止 SSRF 与任意内网访问。

## 6. 验收

使用无权限身份尝试抓取、查询、重载和创建 Silence；抓包确认 TLS；轮换 CA/Token；尝试写入高基数和敏感 Label，验证限制、审计与脱敏流程。安全验证必须覆盖失败路径。

参考：[Prometheus TLS and Authentication](https://prometheus.io/docs/prometheus/latest/configuration/https/)、[Security Model](https://prometheus.io/docs/operating/security/)。
