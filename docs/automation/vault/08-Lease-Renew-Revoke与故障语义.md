---
title: "Vault Lease、Renew、Revoke 与故障语义"
sidebar_label: "08. Lease、续租与撤销"
sidebar_position: 8
description: "理解动态 Secret 和 Token 的租约、TTL 上限、续租、级联撤销、外部清理失败与应用轮换状态机。"
tags: [Vault, Lease, Renew, Revoke, 可靠性]
---

# Vault Lease、Renew、Revoke 与故障语义

Lease 是 Vault 对动态资源生命周期的记录和管理机制，不是一只能够强制冻结所有外部系统的“倒计时开关”。掌握故障语义，才能正确设置 TTL 和应用轮换流程。

## 1. 哪些数据有 Lease

动态 Secret 通常返回：

```json
{
  "lease_id": "database/creds/payments/abc123",
  "lease_duration": 3600,
  "renewable": true,
  "data": {
    "username": "v-payments-...",
    "password": "..."
  }
}
```

Database、云凭据等动态资源常有 Lease；Service Token 也有生命周期。KV 保存的是静态值，不会因为一次读取就创建可撤销的外部资源 Lease。

## 2. 生命周期状态机

```text
Issue
  → Active
      ├── Renew 成功 → Active（更新到期时间）
      ├── Revoke → Revoking → 外部清理 → Revoked
      └── TTL 到期 → Expiring → 外部清理 → Expired
                            └── 失败 → 重试/人工对账
```

Vault 中状态变化与外部资源实际状态可能短暂或长期不一致。例如数据库网络中断时，过期账号仍可能留在数据库里。

## 3. TTL 是多层上限的结果

最终 TTL 通常受以下因素共同影响：

- 系统默认和最大 Lease TTL；
- Secret/Auth Mount Tune；
- Role 的默认/最大 TTL；
- 调用方请求值；
- 父 Token 的剩余生命周期；
- 下游能力和证书 Issuer 剩余有效期。

应用不能假设请求 `24h` 就一定得到 24 小时，要读取实际响应中的 `lease_duration` 和 `renewable`。

## 4. Renew 的准确含义

续租请求由 Vault 和 Secret Engine 重新判断，可以：

- 同意并给出新的剩余 TTL；
- 返回比请求值更短的 TTL；
- 因达到最大生命周期而拒绝；
- 因 Token、Policy、Role 或下游变化而失败。

续租不是把原始 TTL 简单累加到旧到期时间，也不能让普通 Lease 永久跨越最大 TTL。Periodic Token 是特殊模型，只要每个 Period 内由有权主体成功续租，就可以持续存在。

## 5. 什么时候开始续租

不要等到最后一秒：

```text
renew_at = issue_time + TTL × 0.5~0.7 + 有界随机抖动
```

比例要根据网络、Vault SLO、下游重建耗时和安全要求确定。发生临时错误时有限重试；若剩余时间已不足完成换证，就直接获取新凭据并切换，不再赌下一次续租。

## 6. 应用轮换状态机

```text
旧凭据和旧连接池可用
→ 申请/续租新凭据
→ 验证新凭据
→ 创建并预热新连接池
→ 原子切换新请求
→ 排空旧连接
→ Revoke 旧 Lease
→ 验证外部身份已删除
```

TLS 证书、数据库凭据和云 Token 的“验证新凭据”方式不同。应用必须将换证逻辑设计成明确状态机，而不是一个定时覆盖文件的脚本。

## 7. Token 父子关系与级联撤销

```text
父 Service Token
  ├── 子 Token A → DB Lease A
  └── 子 Token B → Cloud Lease B
```

撤销父 Token 会级联影响其子 Token 和 Lease。Orphan Token 不随普通父 Token 撤销，但需要独立续租和回收责任。部署平台若用一个父 Token 为全部应用签发子 Token，误撤销可能形成巨大故障域。

## 8. Revoke、Revoke Prefix 与 Force

- 撤销指定 Lease：影响单个资源；
- 按 Prefix 撤销：可能影响某个 Role 或整个 Mount 的大量资源；
- Force Revoke：跳过无法完成的正常撤销流程，可能在外部遗留仍有效资源。

批量或 Force 操作必须先列出影响范围、外部清理方案和回滚边界。不要把 Force 当作“更彻底”，它只是让 Vault 忘记无法正常清理的记录。

## 9. 外部撤销失败

```text
Lease 到期
→ Expiration Manager 调用 Secret Engine Revoke
→ 数据库/云 API 不可达或权限变化
→ 外部资源仍存在
→ Vault 重试，运维侧告警与对账
```

需要同时观察 Vault 和下游：

```text
Vault 活跃 Lease、撤销失败和重试
↔ 数据库用户、云访问密钥、证书状态
```

只看 Vault 的 Lease 列表无法证明下游已清理。

## 10. Vault 故障时的实际影响

| 故障 | 已运行应用 | 新实例/新连接 |
| --- | --- | --- |
| Vault 短时不可达 | 现有凭据在自身有效期内可能继续用 | 登录和签发失败 |
| Vault 长期不可达 | 到期后逐步失效 | 持续失败 |
| 下游不可达 | 现有资源视下游状态而定 | 签发/撤销可能失败 |
| KMS/Seal 故障 | 已解封节点可能暂时服务 | 重启节点可能无法解封 |
| 时钟漂移 | Token/证书被误判未生效或过期 | 登录和 TLS 异常 |

TTL 太短会把 Vault 故障快速传导给全部业务；TTL 太长会扩大泄漏窗口。正确答案是结合业务恢复时间、缓存、换证能力和身份风险量化选择。

## 11. 防止续租惊群

大量 Pod 同时创建，容易在同一时刻登录、续租和到期。应使用：

- 随机抖动；
- 分批部署；
- 有上限的指数退避；
- Agent 缓存和连接复用；
- 按 Role/Engine 做容量限制与指标拆分。

固定每秒重试既无法提高成功率，还会在 Vault 恢复瞬间压垮 Raft、Audit 和下游数据库。

## 12. 观测与排障

关注：

- Issue/Renew/Revoke 成功率与延迟；
- Lease 到期时间分布；
- Expiration/Revoke 失败；
- Auth Token 创建与续租；
- 下游 API 错误和残留身份；
- 客户端剩余 TTL、最后成功续租时间和换证结果。

日志可记录 Lease ID、Role、外部用户名、Request ID 和错误类型，但不得记录密码、Token 或私钥。

## 13. 练习与答案

**问题：Lease 到期是否等于数据库现有连接立即断开？**

答案：不等于。Vault 需要调用数据库撤销账号，调用可能失败；即使账号删除，数据库也可能允许已建立会话继续存在。必须验证具体数据库语义。

**问题：把所有 TTL 调到 5 分钟是否一定更安全？**

答案：不一定。它会显著增加登录、签发和撤销负载，并让短暂 Vault 故障更快扩散。要把泄漏窗口与恢复能力一起评估。

参考资料：

- [Lease, renew, and revoke](https://developer.hashicorp.com/vault/docs/concepts/lease)
- [Token concepts](https://developer.hashicorp.com/vault/docs/concepts/tokens)
- [Lease command](https://developer.hashicorp.com/vault/docs/commands/lease)
