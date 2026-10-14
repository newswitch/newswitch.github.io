---
title: "Vault 生产 Secret 平台综合项目"
sidebar_label: "12. 生产 Secret 平台项目"
sidebar_position: 12
description: "为 Kubernetes 应用设计涵盖身份、KV、数据库动态凭据、PKI、Transit、审计、容量和灾备的生产 Secret 平台。"
tags: [Vault, Kubernetes, 动态凭据, PKI, SRE, 综合项目]
---

# Vault 生产 Secret 平台综合项目

本项目以 Kubernetes 中的支付 API 为对象，从威胁模型、平台拓扑、应用集成、容量和灾备完整设计 Secret 平台。目标不是把所有密码复制进 KV，而是为每类 Secret 选择正确的生命周期。

## 1. 需求与非目标

支付 API 需要：

- 少量第三方静态配置；
- PostgreSQL 读写凭据；
- 服务端与客户端 mTLS 证书；
- 对数据库中的敏感字段加密；
- 人员通过 OIDC 管理，工作负载通过 Kubernetes 身份访问；
- 所有操作可审计，平台可备份恢复。

非目标：Vault 不代理数据库业务 SQL、不保存应用日志、不替代 Kubernetes NetworkPolicy，也不自动修复应用把 Secret 打印到日志的问题。

## 2. 威胁模型

先回答：

| 威胁 | 控制 |
| --- | --- |
| Git/镜像泄漏 | 不存静态生产 Token，使用原生身份登录 |
| Pod 被入侵 | 最小 Policy、短 TTL、独立 ServiceAccount |
| 节点磁盘被复制 | Barrier、磁盘权限、Auto Unseal Key 分离 |
| 管理员误操作 | OIDC/MFA、组权限、审批、审计 |
| 数据库密码泄漏 | 动态唯一账号、短 Lease、快速撤销 |
| PKI 私钥泄漏 | 短证书、CA 分层、Role 名称约束 |
| Vault 区域故障 | 异地 Snapshot、隔离恢复、DNS/LB Runbook |
| KMS Key 误删 | 删除保护、多人审批、跨账号治理 |

如果不能描述要防什么，后续 TTL、拓扑和权限都无法合理选取。

## 3. 总体架构

```text
人员 ──OIDC + MFA──┐
                    ├→ 内部 LB → Vault 3/5 节点
Pod ServiceAccount ─Kubernetes Auth      │
                                             ├→ Raft 独立持久盘
                                             ├→ KMS Auto Unseal
                                             └→ 双 Audit Device

payments-api Policy
  ├── KV v2：第三方 API 配置
  ├── Database：PostgreSQL 动态读写账号
  ├── PKI：payments.internal 证书
  └── Transit：敏感字段加密
```

生产和非生产使用独立 Mount、Policy、Kubernetes Auth 和数据库管理身份。高安全环境可使用独立 Vault 集群进一步收缩故障域。

## 4. 平台层实施顺序

1. 建立 3/5 节点 Integrated Storage、TLS 和唯一节点身份；
2. 配置 Auto Unseal，验证 KMS 权限与故障；
3. 启用两个独立 Audit Device 和 Telemetry；
4. 建立 Snapshot、异地保留和隔离恢复；
5. 接入 OIDC，拆分平台管理员、Secret 管理员、审计员；
6. 为每个 Kubernetes 集群配置独立 Auth Mount；
7. 逐个启用 KV、Database、PKI、Transit，并限制管理员 Path；
8. 完成容量、切主和依赖故障测试后再接生产应用。

先解决 Vault 自身可恢复性，再导入生产 Secret。

## 5. 身份与权限矩阵

| 主体 | 允许 | 禁止 |
| --- | --- | --- |
| `payments-api` Pod | 读指定 KV、取 DB Role、签指定证书、Transit Encrypt/Decrypt | 管理 Mount、Policy、Key |
| 发布流水线 | 写候选 KV 版本、触发受控发布 | 读不必要的 Secret 明文、Destroy |
| DBA | 配置测试数据库权限、查看对账结果 | 读取应用 KV/Transit Key |
| PKI 管理员 | 管理 Issuer/Role | 访问数据库管理凭据 |
| 审计员 | 读取受控审计副本 | 签发 Secret、修改 Policy |
| 平台管理员 | 维护 Vault/Policy | 日常使用 Root Token |

Policy 按能力拆分，不建立“payments-admin = 全部 sys/* + 全部 Secret”的万能角色。

## 6. Kubernetes 工作负载身份

```text
Namespace: payments-prod
ServiceAccount: payments-api
Audience: vault
Vault Auth Role: payments-api-prod
Token Policy: payments-api-prod
Token TTL: 依据换证与故障恢复能力设置
```

该 Role 只绑定精确 Namespace 和 ServiceAccount。Deployment 禁止使用 Default ServiceAccount，不把 Vault Token 写入 Kubernetes Secret。

交付方式选择：

- KV/PKI 文件：Agent Injector，模板写入内存卷并通知热重载；
- Database：应用通过统一库或 Agent 获取，应用自己执行连接池换代；
- Transit：应用 SDK 在线调用；
- 只有旧应用必须使用原生 Secret 时才使用 VSO，并保护 etcd。

## 7. KV 发布闭环

```text
流水线以 CAS 写入候选版本
→ 在测试工作负载读取和验证
→ 分批通知生产 Agent/应用加载
→ 观察错误和依赖 API
→ 记录当前稳定版本
→ 轮换外部旧凭据
```

回滚是让应用重新使用经过验证的旧版本，不是随意删除最新版。永久 Destroy 由独立高风险流程处理。

## 8. PostgreSQL 动态凭据

配置专用管理身份，只能创建具有特定 Role 的短期用户。应用换池：

```text
旧账号/连接池
→ 到期前请求新 Lease
→ 创建新池并执行只读/写入健康检查
→ 流量切新池
→ 排空旧会话
→ Revoke 旧 Lease
→ 对账数据库用户
```

压测 Pod 批量重建时的账号创建 DDL、连接数和撤销能力。数据库不可达时既可能签发失败，也可能留下撤销失败账号。

## 9. PKI 与 mTLS

使用离线 Root 为生产 Intermediate 签名，PKI Role 只允许 `*.payments.svc.internal` 中受控名称，并限制 Server/Client Auth 和 TTL。

证书文件更新流程必须验证：

- Key 与 Certificate 匹配；
- Chain 完整；
- 应用原子重载成功；
- 真实 TLS 握手已使用新 Serial；
- 旧连接在容忍窗口内排空。

在 Intermediate 轮换中先分发双信任，再切换签发，最后删除旧信任。

## 10. Transit 数据模型

为支付敏感字段建立独立 Key，例如 `payments-customer-data`。数据库保存：

```text
ciphertext: vault:v3:...
key_name: payments-customer-data
context: 稳定且可恢复的租户上下文
schema_version: 业务加密封装版本
```

应用 Role 获得 Encrypt/Decrypt，无权 Rotate、Export 或删除 Key。轮换后后台任务 Rewrap 历史密文，覆盖率达到要求后才提高最小解密版本。

## 11. 应用可靠性要求

- Vault 请求设置连接、读取和总超时；
- 使用有限指数退避和随机抖动；
- 错误分类为网络、认证、授权、Lease、Engine 和下游；
- Secret、Token、JWT、私钥不进入 Log/Trace/Error Response；
- 指标记录剩余 TTL 和最后成功轮换时间，不记录敏感值；
- 旧凭据仍有效时准备新凭据；
- 明确何时 Fail Closed，何时短期使用仍有效缓存。

“捕获异常后继续用旧密码”没有时间上限，就会把动态凭据重新变成长生命周期 Secret。

## 12. 容量估算

假设高峰扩容 1000 个 Pod，每个 Pod 启动需要：

```text
1 次 Kubernetes Login
1 次 KV Read
1 次 Database Credential Issue
1 次 PKI Issue
持续 Token/Lease Renew
```

这不是 1000 次请求，而是至少 4000 次初始请求、Raft/Audit 写入和 1000 次数据库用户 DDL。还需计入失败重试、Sidecar 和后续续租。

通过分批发布、抖动和复用降低峰值，并分别压测 Kubernetes API、Vault、Audit 和 PostgreSQL。

## 13. SLO 与告警

| 能力 | 指标 |
| --- | --- |
| Auth | Login 成功率、P99、TokenReview 错误 |
| KV | Read/Write、CAS 冲突、版本增长 |
| Database | Issue/Revoke、连接延迟、残留用户 |
| PKI | Issue、续签余量、CRL、Issuer 到期 |
| Transit | Encrypt/Decrypt P99、Payload、错误 |
| Core | Seal、Active、Raft Peer、磁盘、Audit |
| 客户端 | 剩余 TTL、最后成功换证、重试 |

告警指向具体 Runbook。例如 `Database Revoke Failed` 的 Runbook 与 `Vault Sealed` 完全不同。

## 14. 上线故障演练

1. 停一个 Raft Follower；
2. Active Step-down；
3. 一个 Audit Device 失败；
4. KMS 短时不可达但不重启已解封节点；
5. PostgreSQL 管理连接中断；
6. Kubernetes TokenReview 不可达；
7. Agent 文件更新但应用故意不重载；
8. Transit Key Rotate + 部分 Rewrap 失败；
9. 从 Snapshot 在隔离环境恢复全部能力。

每次记录实际影响、检测时间、恢复时间、数据差异和客户端行为。

## 15. 交付物

- 威胁模型和信任边界图；
- Raft/KMS/TLS/Audit 拓扑；
- 身份与 Policy 矩阵；
- Mount、Role、TTL 和所有者清单；
- 应用换证状态机；
- 容量测试报告；
- Snapshot 恢复和 CA 轮换报告；
- 故障 Runbook 与值班告警；
- Root/Recovery/Break-glass 管理记录。

## 16. 练习与答案

**问题：为什么不把数据库密码、TLS 私钥和字段加密 Key 全部放进 KV？**

答案：它们生命周期不同。Database 能创建可撤销的唯一账号，PKI 管理证书信任和吊销，Transit 让主 Key 不离开 Vault；KV 只保存静态值，无法提供这些语义。

**问题：平台完成 Raft HA 后，为什么还要压测 PostgreSQL？**

答案：动态凭据签发和撤销会调用数据库执行 DDL。Vault 可用不代表数据库管理连接、账号上限和 DDL 能承受 Pod 重建峰值。

参考资料：

- [Vault Documentation](https://developer.hashicorp.com/vault/docs)
- [Production hardening](https://developer.hashicorp.com/vault/docs/concepts/production-hardening)
- [Vault on Kubernetes](https://developer.hashicorp.com/vault/docs/platform/k8s)
