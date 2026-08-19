---
title: "Vault 生产 Secret 平台综合项目"
sidebar_label: "12. 生产 Secret 平台项目"
sidebar_position: 12
description: "为 Kubernetes 应用构建涵盖 OIDC、动态数据库凭据、PKI、Transit、审计和灾备的生产 Secret 平台。"
tags: [Vault, Kubernetes, 动态凭据, PKI, SRE, 综合项目]
---

# Vault 生产 Secret 平台综合项目

## 1. 场景

一个运行在 Kubernetes 的支付 API 需要读取少量静态配置、访问 PostgreSQL、提供 mTLS，并对敏感字段加密。目标不是把现有密码全部复制进 KV，而是为不同用途选择合适能力。

## 2. 架构

```text
管理员 → OIDC + MFA → Vault Policy 管理
Pod ServiceAccount → Kubernetes Auth
  ├── KV v2：第三方配置
  ├── Database：短期只读/读写账号
  ├── PKI：服务端与客户端短期证书
  └── Transit：字段加密
Vault → Raft / Auto Unseal / Audit
```

## 3. 实施顺序

1. 建立 3/5 节点、TLS、Integrated Storage 和 Auto Unseal。
2. 启用双审计目标、指标和容量告警。
3. 接入 OIDC，将管理员、审计员和应用平台组分离。
4. 为 Namespace + ServiceAccount 建 Kubernetes Auth Role。
5. 分别定义 KV、Database、PKI、Transit Policy。
6. 使用 Agent/CSI 交付文件，验证应用热重载。
7. 对批量扩容、Vault 切主和下游不可用做故障测试。
8. 完成 Raft 快照的隔离恢复。

## 4. 应用必须实现

- 任何日志、Trace 和错误响应不包含 Secret。
- Vault 请求有超时、有限退避、抖动和指标。
- 数据库凭据轮换建立新池后再排空旧池。
- 证书在过期前原子更新和热重载。
- Transit 密文保留 Key Version 和稳定 Context。
- 无法安全获取新 Secret 时按业务策略失败关闭，而非使用过期未知凭据。

## 5. SLO 与告警

定义认证和 Secret 请求成功率/延迟、动态凭据撤销时间、证书续签余量、Raft Quorum、Seal 状态、审计写入和 KMS/数据库依赖 SLO。告警必须指向可执行 Runbook。

## 6. 验收材料

交付威胁模型、权限矩阵、Policy 代码、凭据生命周期图、容量报告、恢复演练报告、轮换和泄漏应急 Runbook。平台是否“精通”的标准是能证明失败时的边界，而不只是能读写一个 Secret。
