---
title: "ACME、cert-manager 与 Vault PKI 证书自动化"
sidebar_label: "14. 证书签发与轮换自动化"
sidebar_position: 14
description: "理解 ACME 挑战、cert-manager 控制器、Vault PKI、续期窗口、Secret 更新和安全轮换。"
tags: [ACME, cert-manager, Vault PKI, 证书轮换, 自动化]
---

# ACME、cert-manager 与 Vault PKI 证书自动化

证书自动化不是定时执行一条 OpenSSL 命令。完整闭环包括身份证明、策略签发、分发、加载、监控、撤销、审计和恢复。

## 1. 生命周期

```text
声明身份与用途
→ 生成私钥/CSR
→ CA 验证申请者权限
→ 签发证书
→ 分发到 TLS 终止进程
→ 热加载并验证新连接
→ 提前续期
→ 新旧重叠
→ 回收旧证书和私钥
```

只看到 Secret 更新不能证明服务已加载新证书。

## 2. ACME

ACME 自动化域名证书签发，常见挑战：

| 挑战 | 验证方式 | 适用边界 |
| --- | --- | --- |
| HTTP-01 | CA 访问指定 HTTP 路径 | 目标可通过公网 HTTP 到达 |
| DNS-01 | 创建指定 DNS TXT 记录 | 通配符、无公网 HTTP 入口 |
| TLS-ALPN-01 | 特定 TLS/ALPN 验证 | 入口支持相应流量与协议 |

DNS-01 凭据往往能修改 DNS，风险可能高于证书本身。应限制到指定 Zone/Record、使用短期凭据并审计。

## 3. cert-manager 对象链

```text
Issuer / ClusterIssuer
        ↓
Certificate
        ↓
CertificateRequest
        ↓
Order / Challenge（ACME 时）
        ↓
Secret: tls.crt + tls.key
```

`Certificate Ready=True` 表示控制器认为目标证书已签发，不等于 Ingress、Gateway 或应用已重新加载。还要从真实入口发起握手检查序列号、SAN 和到期时间。

Issuer 是命名空间作用域，ClusterIssuer 是集群作用域；后者方便共享，也扩大误用范围，需要 RBAC 和准入策略限制。

## 4. Vault PKI

Vault PKI 适合内部证书：

- 挂载 PKI Secrets Engine；
- 配置根/中间 CA 或接入外部 CA；
- Role 约束允许域名、URI、TTL 和用途；
- 工作负载先通过 Kubernetes/Auth 等方法取得 Vault 身份；
- 按 Role 签发短期证书；
- 通过 Agent、CSI、Operator 或应用接口分发和续期。

Vault Token 的权限和寿命不能比证书策略更宽。允许任意 Common Name/SAN 的 Role 会把内部 CA 变成横向移动工具。

## 5. 续期窗口

设证书有效期为 `L`，续期提前量为 `R`，传播与修复预算为 `P`：

```text
R 必须大于：控制器重试 + CA 故障 + 分发 + 加载 + 验证 + 人工修复预算
```

短证书降低泄露后的最长有效时间，但提高 CA、控制器和分发链的可用性要求。不能只追求更短 TTL 而没有容量和故障演练。

## 6. 安全轮换顺序

同一 CA 下叶子证书轮换：

```text
签发新证书
→ 原子更新文件/Secret
→ 进程热加载
→ 从真实入口验证
→ 排空或等待旧连接
→ 清理旧私钥
```

根/中间 CA 轮换需要先扩大验证端信任，再切换签发端，最后移除旧信任。顺序反了会造成全量 `unknown ca`。

## 7. 监控

- 距离到期天数和最短剩余时间；
- Certificate/CertificateRequest/Order/Challenge 状态；
- CA 签发延迟、失败率和限额；
- Secret 资源版本与进程实际证书序列号；
- 真实入口证书链、SAN、OCSP 和握手成功率；
- 私钥访问与异常签发审计。

## 8. 练习与答案

**问题：** 为什么不能只监控 Kubernetes Secret 中证书的到期时间？

入口可能仍在内存中使用旧证书，或流量实际终止在 CDN/LB。必须同时探测真实握手结果。

**问题：** DNS-01 为什么要特别限制权限？

可修改 DNS 的凭据可能用于劫持域名验证、流量和其他记录。应限制作用域、缩短寿命并隔离保存。

## 9. 参考资料

- [RFC 8555：ACME](https://www.rfc-editor.org/rfc/rfc8555)
- [cert-manager Documentation](https://cert-manager.io/docs/)
- [Vault PKI Secrets Engine](https://developer.hashicorp.com/vault/docs/secrets/pki)
