---
title: "Vault 认证、Token、Policy 与 Identity"
sidebar_label: "03. 认证、Token 与 Policy"
sidebar_position: 3
description: "用 Auth Method、Entity、Alias、Group、Token 和 Policy 建立可追踪的最小权限模型。"
tags: [Vault, Auth Method, Token, Policy, Identity]
---

# Vault 认证、Token、Policy 与 Identity

## 1. 认证与授权分离

Auth Method 验证外部身份，例如 Kubernetes ServiceAccount、OIDC 用户、云实例或 AppRole。成功后 Vault 生成 Token；Token 携带策略，Policy 对 Path 赋予 Capability。

```text
外部身份
→ Auth Method Role 约束
→ Identity Entity/Alias/Group
→ Token（TTL、策略、元数据）
→ Policy Path Capability
```

## 2. Token 类型和生命周期

Token 应具有最短可用 TTL、明确最大 TTL、用途元数据和可撤销性。周期性服务需要由可信进程续租；批处理任务无需无限续租。避免创建永不过期、权限宽泛的孤儿 Token。

Accessor 可用于管理或撤销 Token，但仍属于敏感标识，不能随意公开。

## 3. Policy 设计

```hcl
path "kv/data/payments/*" {
  capabilities = ["read"]
}

path "database/creds/payments-readonly" {
  capabilities = ["read"]
}
```

Policy 以 API Path 为核心。KV v2 的数据路径包含 `data/`，元数据和删除接口路径不同。写策略前先确认挂载路径和 Engine 版本。

原则：

- 按应用、环境和动作拆分，不用全局通配；
- 人员与机器身份分离；
- Secret 管理权和消费权分离；
- `sudo`、`root`、`sys/*` 等高权限只给受控管理流程；
- Policy 代码进入 Git，使用测试身份验证允许和拒绝路径。

## 4. Identity 的作用

同一个人可以通过 OIDC、LDAP 等多个 Alias 登录并映射到统一 Entity；Group 统一授予团队策略。这样人员变化通过身份源和组管理，而不是散落在大量 Token 中。

## 5. 排障

收到 Permission Denied 时记录认证 Mount、Role、Entity、Token TTL/Policy、请求 Path 和 Operation。不要为“先恢复业务”直接附加管理员策略；先比较预期与实际授权链。
