---
title: "Vault PKI、证书与 SSH 凭据"
sidebar_label: "06. PKI 与 SSH 凭据"
sidebar_position: 6
description: "使用 Vault PKI 和 SSH Secret Engine 签发短期身份，掌握 CA 分层、Role 约束、吊销和轮换。"
tags: [Vault, PKI, TLS, SSH, 证书]
---

# Vault PKI、证书与 SSH 凭据

## 1. CA 分层

Root CA 应离线或高度隔离，Vault 通常托管一个有期限的 Intermediate CA 用于在线签发：

```text
Offline Root CA
  → Vault Intermediate CA（按环境/信任域）
      → 服务证书或客户端证书（短 TTL）
```

这样 Vault 在线密钥泄漏的影响受 Intermediate 范围和期限约束，Root 可重新建立信任链。

## 2. PKI Role

Role 限制允许域名、子域名、URI SAN、IP SAN、Key Usage、算法和最大 TTL。不能让任意工作负载请求任意生产域名；身份与可签名称必须绑定。

## 3. 短期证书生命周期

证书签发后由 Agent、Sidecar 或应用保存到受限文件。应用需要监控文件并原子重载，不能每次更新都造成全量中断。证书 TTL 应覆盖续签抖动，但足够短以减少对大规模吊销的依赖。

检查四个时间：当前时间、证书 Not Before、Not After、续签提前量。时钟漂移是常见故障源。

## 4. 吊销与 CRL

制定泄漏后的撤销、CRL/OCSP 分发和依赖方刷新策略。只在 Vault 中撤销但消费者不检查撤销状态，无法真正阻断。大规模短期证书可降低 CRL 压力，但不能取消应急响应。

## 5. SSH Secret Engine

推荐使用 SSH CA 签发短期用户证书，而不是分发长期私钥。Role 限制 Principal、扩展、来源和 TTL；主机信任 CA 公钥并记录登录身份。

不要让 Vault 返回的短期凭据进入 Shell 历史、工单或共享目录。紧急访问应有 MFA、审批、短 TTL 和会话审计。

## 6. 轮换演练

演练 Intermediate CA 续期和交叉信任：先分发新信任链，再双签/迁移签发，验证全部消费者，最后移除旧 CA。直接替换 CA 会导致大面积 TLS 故障。
