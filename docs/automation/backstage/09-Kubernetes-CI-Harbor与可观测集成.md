---
title: "Backstage Kubernetes、CI、Harbor 与可观测集成"
sidebar_label: "09. 平台系统集成"
sidebar_position: 9
description: "通过 Catalog 标识聚合 Kubernetes、CI/CD、Harbor、Prometheus 和告警数据，并保持真相来源和权限边界。"
tags: [Backstage, Kubernetes, CI/CD, Harbor, Observability]
---

# Backstage Kubernetes、CI、Harbor 与可观测集成

## 1. 统一标识

为 Component 定义稳定 ID，并在仓库、OCI Label、Kubernetes Label、监控和告警中传播：

```text
component-id + environment + version/digest + owner
```

插件通过这些标识查询，不按模糊名称猜测资源。

## 2. 数据来源

| 页面信息 | 真相来源 |
| --- | --- |
| Owner/关系/生命周期 | Software Catalog |
| 构建与发布 | Jenkins/GitLab CI/GitHub Actions |
| 镜像、扫描、Digest | Harbor |
| 工作负载与 Event | Kubernetes API |
| SLI/SLO、告警 | Prometheus/可观测平台 |
| Runbook/架构 | TechDocs |

Backstage 展示来源、最后更新时间和跳转链接，不复制为无法更新的静态字段。

## 3. Kubernetes 权限

门户后端通常只需只读资源。按集群/Namespace 使用最小 ServiceAccount 或用户委托，限制 Secret 读取和 Exec。生产重启、扩缩容等动作进入受控 Runbook/工作流，而不是给插件 Cluster Admin。

## 4. CI 与制品

组件页关联 Workflow/Pipeline、最近 Commit、制品 Digest、SBOM/扫描和部署环境。显示 Tag 时同时显示 Digest；发布动作重新验证制品证明和审批。

## 5. 可观测

将 SLO、Dashboard 和当前告警关联到组件。查询失败显示 Unknown，而不是绿色；指标空数据、权限拒绝和后端超时要区分。

## 6. 缓存与限流

页面一次加载可能请求多个系统。后端使用短 TTL 缓存、请求合并、超时和有限并发，遵循各 API 配额。缓存键包含用户/权限范围，防止跨租户数据泄漏。

## 7. 端到端验收

从一个线上 Pod 反查 Component、Owner、源码、Workflow、Harbor Digest、SLO 和 Runbook；再从 Component 找到各环境真实资源。任何断链都有明确修复 Owner。
