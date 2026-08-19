---
title: "Argo Workflows 部署、RBAC、SSO 与多租户"
sidebar_label: "02. 部署、RBAC 与多租户"
sidebar_position: 2
description: "部署高可用 Controller 和 Argo Server，并使用 Namespace、ServiceAccount、SSO、网络和配额建立租户边界。"
tags: [Argo Workflows, 部署, RBAC, SSO, 多租户]
---

# Argo Workflows 部署、RBAC、SSO 与多租户

## 1. 安装前的选择

明确集群范围还是 Namespace 范围、谁能创建 Workflow、任务 Pod 使用哪个 ServiceAccount、Artifact 凭据如何下发、历史状态保存多久，以及 Controller 故障域。

生产配置应锁定 Helm Chart/镜像版本，先在预生产验证 CRD 与 Controller 兼容，再按版本文档升级。

## 2. 三层权限

```text
用户访问 Argo Server 的身份
→ 创建/查看 Workflow 的 Kubernetes RBAC
→ Workflow Pod ServiceAccount 对业务资源的权限
```

用户能提交 Workflow 往往意味着能让 Pod 执行代码。若可指定任意 ServiceAccount、HostPath、特权容器或 Node，可能越权。因此用 Admission Policy 限制 Pod 安全设置、镜像仓库、ServiceAccount 和 Node 访问。

## 3. SSO

接入 OIDC/SSO 后，将 Identity Group 映射为明确的查看、提交和管理权限。管理入口启用 TLS，限制外部暴露。Token、Cookie 和回调地址不得写入普通日志。

## 4. 多租户隔离

- 每个团队使用独立 Namespace、ResourceQuota 和 LimitRange。
- Workflow 使用专用 ServiceAccount，不使用默认高权限账户。
- NetworkPolicy 限制到 API、对象存储和必要下游。
- Artifact Repository 用前缀、Bucket Policy 和独立身份隔离。
- 设置全局、Namespace 和 Workflow 并行上限。
- 使用 Pod Security/准入策略阻止特权、宿主网络和危险挂载。

## 5. 高可用与依赖

Controller 多副本需要版本支持的 Leader Election。Argo Server 多副本依赖一致的认证和后端。Artifact 存储、归档数据库、DNS、API Server 和镜像仓库都是服务链依赖，必须各自监控和备份。

## 6. 验收

用不同租户测试：能否查看他人参数/日志/Artifact、指定高权限 ServiceAccount、创建特权 Pod、突破配额或访问其他前缀。拒绝路径也是上线标准。
