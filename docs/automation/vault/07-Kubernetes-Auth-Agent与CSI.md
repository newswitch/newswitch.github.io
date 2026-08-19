---
title: "Vault Kubernetes Auth、Agent 与 CSI"
sidebar_label: "07. Kubernetes 集成"
sidebar_position: 7
description: "理解 ServiceAccount 身份验证以及 Agent Injector、CSI 和应用直连三种 Secret 交付方式。"
tags: [Vault, Kubernetes, Agent Injector, CSI, ServiceAccount]
---

# Vault Kubernetes Auth、Agent 与 CSI

## 1. 身份链

```text
Pod 使用指定 ServiceAccount
→ 获得短期投射 Token
→ Vault Kubernetes Auth 校验 Token
→ Role 校验 Namespace、ServiceAccount 和 Audience
→ 返回受 Policy 约束的 Vault Token
→ 获取 Secret/证书/动态凭据
```

不要让所有 Pod 使用默认 ServiceAccount，也不要让一个 Role 匹配整个集群的任意 Namespace。

## 2. 三种交付模式

| 模式 | 优点 | 代价与边界 |
| --- | --- | --- |
| Agent Injector | 模板、缓存、续租、文件输出 | Sidecar 资源、注解和生命周期 |
| CSI Provider | 以 Volume 挂载，应用无需 SDK | 更新/同步语义需验证，依赖节点插件 |
| 应用 SDK 直连 | 细粒度控制和动态 API | 应用承担认证、重试、续租和脱敏 |

不要默认把 Vault Secret 同步为长期 Kubernetes Secret；这样会重新引入 etcd 持久化、RBAC 和轮换问题。若业务必须同步，要明确加密、权限和清理。

## 3. Agent 文件交付

- 使用内存卷或严格文件权限。
- 模板原子写入，避免应用读取半个文件。
- 明确 Init 先取 Secret 与 Sidecar 持续续租的职责。
- 应用支持文件重载，否则轮换只更新文件不更新连接。
- 日志中不输出模板结果和 Token。

## 4. 可靠性

Vault 暂时不可达时，新 Pod 可能无法启动，现有 Pod 则取决于本地 Secret 有效期和缓存。需要根据业务定义：失败关闭还是使用仍有效缓存、最多容忍多久、何时阻止发布。

避免 Pod 同时启动或轮换造成认证风暴。使用启动抖动、有限退避、连接复用和 Vault 端容量监控。

## 5. 排障路径

1. 查看 Pod ServiceAccount、Namespace 和投射 Token Audience。
2. 检查 Auth Mount 和 Role 的绑定条件。
3. 检查 Policy 的实际 API Path。
4. 查看 Injector/CSI/Agent 状态和日志。
5. 检查网络策略、DNS、TLS、时间和 Vault Seal/HA 状态。
6. 用受限测试 Pod 验证身份，不复制生产 Token 到本地。
