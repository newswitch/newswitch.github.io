---
title: "External Secrets Operator 架构与 Reconcile 路径"
sidebar_label: "06. ESO 架构与 Reconcile"
sidebar_position: 6
description: "理解 ExternalSecret、SecretStore、Provider、Controller 与 Kubernetes Secret 的持续协调路径。"
tags: [External Secrets Operator, Kubernetes, Controller, Reconcile, SecretStore]
---

# External Secrets Operator 架构与 Reconcile 路径

## 1. 主要对象

| 对象 | 作用 |
| --- | --- |
| `SecretStore` | Namespace 范围的后端和认证配置 |
| `ClusterSecretStore` | 集群范围可复用后端，权限更敏感 |
| `ExternalSecret` | 声明远端数据如何映射到目标 Secret |
| Provider | 对接 Vault、云 Secret Manager 等后端 |
| Controller | Watch 对象并持续 Reconcile |
| Kubernetes Secret | 工作负载最终读取的本地对象 |

## 2. 一次协调

```text
ExternalSecret 事件/刷新到期
→ 解析 Store 与 Provider 配置
→ 使用工作负载/控制器身份认证后端
→ 读取指定远端 Key/Version/Property
→ 解码、转换和模板渲染
→ 创建或更新目标 Kubernetes Secret
→ 写入 Condition、时间和错误状态
→ 等待下一次刷新
```

## 3. 期望状态

Controller 重启后从 API 对象恢复，不依赖内存进度。远端读取和目标写入可能分开成功，因此 Reconcile 必须可重复；应用侧也要能接受 Secret 版本变化。

## 4. 四层成功

1. 后端存在新值；
2. ESO 成功读取并更新 Secret；
3. Pod Volume/环境或应用配置看到新值；
4. 应用连接/证书真正切换并通过验证。

只看到 `ExternalSecret Ready=True` 不证明应用已生效。

## 5. 数据路径风险

ESO Controller/Provider 能读取外部 Secret，API Server/etcd 保存目标 Secret，kubelet 把值交给 Pod。每一层都需要最小权限、加密、日志脱敏和审计。

## 6. 方案边界

若不能接受 Secret 持久化到 etcd，考虑 Vault Agent/CSI 或应用直连。若需要数据库动态账号和 Lease，单纯周期同步静态值可能无法表达续租和撤销语义。
