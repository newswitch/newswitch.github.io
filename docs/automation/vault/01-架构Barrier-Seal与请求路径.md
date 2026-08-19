---
title: "Vault 架构、Barrier、Seal 与请求路径"
sidebar_label: "01. 架构、Seal 与请求路径"
sidebar_position: 1
description: "理解 Vault 如何通过存储屏障、Seal、认证、策略、Secret Engine 和审计处理一次请求。"
tags: [Vault, Seal, Barrier, 架构, Secret]
---

# Vault 架构、Barrier、Seal 与请求路径

## 1. 组件边界

Vault 服务接收 API 请求，认证身份、匹配策略、路由到相应 Backend，并将持久数据加密后写入 Storage Backend。存储系统只看到密文，不应依赖它理解 Vault 数据结构。

```text
Client
→ TLS/API Listener
→ Authentication
→ Token/Identity/Policy
→ Logical Backend（KV、Database、PKI、Transit…）
→ Storage Barrier 加密
→ Integrated Storage 或受支持后端
→ Audit Device 记录请求/响应元数据
```

## 2. Seal 与 Unseal

Vault 启动后默认 Sealed，无法读取保护数据。解封的目标是恢复用于打开加密屏障的能力，而不是解密并把全部 Secret 放进内存。

| 模式 | 特点 | 运营要求 |
| --- | --- | --- |
| Shamir | 初始化产生多个 Key Share，达到阈值解封 | Share 分离保管、定期演练 |
| Auto Unseal | 由 KMS/HSM 等外部密钥服务解封 | 外部服务权限、可用性和灾备 |

自动解封降低重启操作成本，但把外部密钥系统变成关键依赖。恢复时仍需保护恢复密钥和外部 KMS 权限。

## 3. 初始化产物

初始化会产生解封/恢复材料和初始 Root Token。它们不是普通应用 Secret：应在受控仪式中生成、分离保存、限制访问并验证恢复流程。不要在终端录屏、聊天、CI 日志或仓库中留下这些材料。

## 4. 一次请求为何被拒绝

按顺序判断：

1. Vault 是否可达并已解封；
2. 客户端是否通过正确 Auth Method 认证；
3. Token 是否有效、未过期且 Namespace 正确；
4. Policy 对规范化 Path 和 Capability 是否允许；
5. Secret Engine 是否启用且配置完整；
6. 下游数据库、CA、KMS 或云 API 是否成功。

## 5. Standby 行为

高可用集群只有 Active 节点处理写入和大部分请求，Standby 会转发或重定向。负载均衡健康检查必须识别 Vault HA 状态，不能因 Standby 返回不同状态就误判整个集群不可用。
