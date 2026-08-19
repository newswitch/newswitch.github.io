---
title: "Vault Lease、Renew、Revoke 与故障语义"
sidebar_label: "08. Lease、续租与撤销"
sidebar_position: 8
description: "理解动态 Secret 和 Token 的租约生命周期、续租、撤销、级联关系与异常恢复。"
tags: [Vault, Lease, Renew, Revoke, 可靠性]
---

# Vault Lease、Renew、Revoke 与故障语义

## 1. Lease 是什么

动态 Secret 通常带有 Lease ID、Duration 和 Renewable 标志。Lease 表示 Vault 对外部资源生命周期的管理承诺，不等同于外部系统一定会在 TTL 瞬间终止连接。

```text
Issue → Use → Renew（可选）→ Revoke/Expire → 外部清理
```

Token 还可能形成父子关系；撤销父 Token 可能级联撤销子 Token 和其创建的租约。Orphan Token 改变这种关系，必须有明确理由。

## 2. 续租策略

在 TTL 的一部分时间提前续租，并加入抖动。失败时区分可恢复网络错误、权限失效、最大 TTL 到达和 Secret Engine 错误。到达最大 TTL 后通常要重新认证/申请，而不是无限续租。

应用应在旧凭据仍有效时准备新凭据和新连接，切换后再关闭旧资源。

## 3. 撤销并非总是即时成功

Vault 撤销数据库账号、云凭据时依赖下游系统。如果下游不可达，可能进入待重试/失败状态。需要监控撤销队列和异常账户，而不能只观察 Lease 已过期。

应建立对账：

```text
Vault 活跃/失败 Lease
↔ 数据库、云平台、PKI 中实际存在的身份
```

## 4. 灾难情况下的取舍

- Vault 不可达：现有凭据在自身有效期内可能继续工作，新实例/新连接可能失败。
- 下游不可达：Vault 可能无法生成和撤销凭据。
- 时钟漂移：Token 和证书被错误判断为未生效或过期。
- 大量同时续租：恢复时产生惊群。

根据服务 SLO 选择 TTL。过短会放大 Vault 故障，过长会扩大泄漏窗口；答案是结合缓存、故障恢复和身份风险做容量化取舍。

## 5. 观测指标

关注认证/发放/续租/撤销成功率和延迟、活跃 Lease、失败 Revoke、下游 API 错误、Token 使用量和到期分布。日志关联 Lease ID 时应脱敏并限制访问。
