---
title: "Vault 认证、Token、Policy 与 Identity"
sidebar_label: "03. 认证、Token 与 Policy"
sidebar_position: 3
description: "从 Auth Method、Token 生命周期、Policy 求值和 Identity 映射建立可审计的最小权限模型。"
tags: [Vault, Auth Method, Token, Policy, Identity]
---

# Vault 认证、Token、Policy 与 Identity

认证回答“你是谁”，授权回答“你能做什么”，Token 把这两者带到后续请求中，Identity 则把多个登录来源归并为稳定主体。四者混在一起配置，最容易产生长期 Token 和通配符策略。

## 1. 完整授权链

```text
外部身份
  → Auth Method 校验凭据
  → Auth Role 限制可登录对象
  → Alias 映射到 Entity
  → Entity/Group 附加 Policy
  → 签发有 TTL 的 Token
  → Policy 对 Path + Operation 求值
  → Secret Engine 执行请求
```

一个请求获准不只是因为 Token 上列出了某个 Policy。还要同时满足 Token 有效、Path 正确、操作 Capability 允许、显式 Deny 未命中，以及 Engine 自身约束通过。

## 2. Auth Method 怎样选

| 使用者 | 常见 Auth Method | 选择重点 |
| --- | --- | --- |
| Kubernetes 工作负载 | Kubernetes Auth | ServiceAccount、Namespace、Audience、短期 JWT |
| 人员 | OIDC/JWT、LDAP | MFA、组映射、离职回收、浏览器流程 |
| 云主机/函数 | AWS、Azure、GCP Auth | 平台实例身份和账号边界 |
| 无平台身份的自动化 | AppRole | Secret ID 交付、CIDR、用途和 TTL |
| 紧急管理 | 受控 Root 生成流程 | 多人审批、短时使用、立即撤销 |

不要让应用使用人员 OIDC，也不要为了省事向 Kubernetes Pod 分发长期 Root Token。优先选择能验证工作负载原生身份、无需预置长期 Secret 的方式。

## 3. Mount、Role 与 Accessor

同一种 Auth Method 可以多次挂载：

```text
auth/kubernetes-prod/
auth/kubernetes-dev/
auth/oidc-employees/
```

每个 Mount 有唯一 Accessor。Alias 与 Accessor 关联，而不是只看路径显示名称。移动或重建 Auth Mount 会改变 Accessor，Identity 映射可能随之失效。

Role 用于约束某一类登录：允许哪些 ServiceAccount、Namespace、OIDC Claim、云角色或 AppRole Secret ID，并决定 Token Policy 与 TTL。Role 不是 Policy 的替代品。

## 4. Token 类型与生命周期

| 类型 | 特点 | 适用场景 |
| --- | --- | --- |
| Service Token | 完整功能，可续租，可形成父子关系 | 长运行服务、交互会话 |
| Batch Token | 轻量、加密编码、不作为普通 Token 对象持久化，能力有限 | 大规模短任务 |
| Periodic Token | 在每个周期内成功续租即可持续工作 | 长运行且需可撤销的服务 |
| Orphan Token | 没有普通父 Token 依赖 | 受控基础设施服务，不应默认使用 |
| Root Token | 绕过普通 Policy 检查 | 初始化和极短时紧急恢复 |

TTL 受多层限制：请求值、Role、Auth Mount Tune、系统默认/最大 TTL 会共同决定最终值。续租不是无限延长；非 Periodic Token 通常不能突破创建时适用的最大生命周期。

```bash
vault token lookup
vault token lookup -accessor <accessor>
vault token renew <token-or-lease>
vault token revoke <token>
```

Token Accessor 不能直接用于业务请求，但可以查询元数据和撤销 Token，仍应按敏感标识管理。

## 5. 父子、级联撤销与 Orphan

Service Token 默认形成父子树。撤销父 Token 会级联撤销子 Token 及其 Lease：

```text
部署系统 Token
  ├── 应用 A Token → DB Lease A
  └── 应用 B Token → PKI Lease B
```

这是强大的清理机制，也意味着不能随意让多个无关系统共享父 Token。Orphan Token 脱离普通父链，适合必须跨越调用者生命周期的受控服务，但会减弱自然级联回收能力。

## 6. Policy 的 Path 和 Capability

```hcl
path "kv/data/payments/config" {
  capabilities = ["read"]
}

path "database/creds/payments-readonly" {
  capabilities = ["read"]
}

path "kv/metadata/payments/*" {
  capabilities = ["list"]
}

path "sys/*" {
  capabilities = ["deny"]
}
```

常见 Capability 包括 `create`、`read`、`update`、`delete`、`list`、`patch` 和 `sudo`。它们映射 Vault 逻辑操作，不应简单等同 HTTP Method。显式 `deny` 优先于其他允许规则。

KV v2 特别容易写错：数据、元数据、删除、恢复和销毁使用不同 API Path。CLI 会隐藏部分转换，但 Policy 仍按真实 API Path 求值。

## 7. 通配符为什么危险

```hcl
path "kv/data/*" {
  capabilities = ["read"]
}
```

这意味着所有拿到 Policy 的主体都能读取该 Mount 下所有数据。更合理的边界通常包含环境、团队和应用：

```text
kv/data/prod/payments/api
kv/data/prod/payments/worker
kv/data/dev/payments/*
```

管理权和消费权要拆开：应用只读某个 Secret；平台流水线可以写候选版本；少量管理员能配置 Mount，但不能让所有运维人员默认读明文业务 Secret。

## 8. Identity：Entity、Alias 与 Group

```text
Entity: alice
  ├── Alias: OIDC subject 123 @ oidc accessor
  └── Alias: LDAP alice @ ldap accessor

Group: payments-sre
  └── Policies: payments-read, incident-debug
```

Entity 表示稳定主体，Alias 表示它在某个 Auth Mount 中的身份。Group 可以是内部维护，也可以由外部身份源映射。这样人员换登录方式时，不必复制大量 Policy 或长期 Token。

需要防止重复 Entity：如果同一个人通过不同 Auth Method 登录，却没有正确 Alias 映射，就会形成多个不可关联的审计主体。

## 9. AppRole 不等于用户名密码

AppRole 常由 Role ID 和 Secret ID 完成登录：

```text
Role ID：标识角色，可相对稳定
Secret ID：证明调用者获准使用该角色，应短期、受限、可审计
```

Secret ID 应通过可信的 Pull/Wrap 流程交付，限制 TTL、使用次数和 CIDR；不要把 Role ID 与长期 Secret ID 一起写进镜像、Helm values 或 Git。

当平台已有 Kubernetes 或云原生身份时，优先使用对应 Auth Method，减少额外引导 Secret。

## 10. Response Wrapping

Response Wrapping 会返回短期单次使用的 Wrapping Token，接收方解包后才得到真实 Secret。它适合把 Secret ID、临时凭据或恢复材料通过中间系统传递：

```text
签发方 → Wrapping Token → 中间传输 → 最终接收方 unwrap
```

如果中间人提前解包，最终接收方再次解包会失败，从而暴露被截取迹象。Wrapping 不能替代安全通道，但能缩短明文暴露时间并提供一次性语义。

## 11. 验证授权而不是猜

```bash
vault token capabilities kv/data/payments/config
vault token lookup
vault read identity/entity/name/alice
vault auth list -detailed
vault policy read payments-api
```

排查 `permission denied` 时记录：

1. 实际 Auth Mount 和 Role；
2. Token 的 Entity、Policies、TTL 和 Namespace；
3. 客户端发出的真实 API Path；
4. Operation/Capability；
5. 是否命中 `deny`；
6. Engine 是否存在以及版本是否正确。

不要直接附加管理员 Policy 验证，这会掩盖 Path 或身份映射错误。

## 12. Policy 测试方法

每个身份至少验证三类用例：

```text
必须允许：读取本应用生产配置
必须拒绝：读取其他应用配置
必须拒绝：修改 Auth、Policy、Mount 和 Audit
```

测试身份和测试 Secret 应与生产数据隔离。Policy 进入 Git，通过代码评审、静态检查和集成测试发布；修改后记录影响的 Role、Group 和现有 Token。

## 13. Break-glass 与 Root

日常运维不应保存可随时使用的 Root Token。正确流程是：

1. 多人批准进入应急；
2. 使用恢复材料执行 Generate-root 流程；
3. 限定操作窗口和来源网络；
4. 全程审计并记录 Request ID；
5. 完成后立即撤销 Root Token；
6. 复核是否创建了长期子凭据或修改了 Policy。

## 14. 练习与答案

**问题：Policy 中允许 `read`，为什么 `vault kv list` 仍失败？**

答案：`list` 是独立 Capability，KV v2 列举通常访问 `metadata/` 路径，而读取数据访问 `data/` 路径。需要确认真实 API Path 并只授予必要的 `list`。

**问题：应用 Token 的 TTL 很短，为什么仍能长期运行？**

答案：可信 Agent 或应用可以在有效期内续租 Token，或重新使用平台身份登录获得新 Token。长期运行不要求长期静态 Token。

**问题：把 Token 变成 Orphan 是否更可靠？**

答案：它避免父 Token 撤销带来的级联影响，但也失去自然回收关系。只有明确理解所有权、续租和撤销路径后才应使用。

参考资料：

- [Authentication](https://developer.hashicorp.com/vault/docs/concepts/auth)
- [Tokens](https://developer.hashicorp.com/vault/docs/concepts/tokens)
- [Policies](https://developer.hashicorp.com/vault/docs/concepts/policies)
- [Identity](https://developer.hashicorp.com/vault/docs/concepts/identity)
