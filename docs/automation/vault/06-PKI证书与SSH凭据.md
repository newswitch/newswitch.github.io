---
title: "Vault PKI、证书与 SSH 凭据"
sidebar_label: "06. PKI 与 SSH 凭据"
sidebar_position: 6
description: "使用 Vault PKI 和 SSH Secret Engine 建立 CA 分层、Role 约束、短期签发、吊销、轮换和故障排查体系。"
tags: [Vault, PKI, TLS, SSH, 证书]
---

# Vault PKI、证书与 SSH 凭据

PKI 和 SSH Secret Engine 都在做“用短期签名身份替代长期共享密钥”。难点不在签发命令，而在信任链、名称授权、续签、吊销和 CA 轮换。

## 1. CA 分层与故障域

```text
离线 Root CA
  ├── 生产 Intermediate CA（Vault PKI Mount）
  │     ├── 服务端证书
  │     └── mTLS 客户端证书
  └── 非生产 Intermediate CA（另一个 Mount/集群）
        └── 测试证书
```

Root CA 应离线或高度隔离，只用于签发和轮换 Intermediate。Vault 在线保存 Intermediate 私钥，泄漏影响被该中间 CA 的名称范围和有效期约束。

生产与测试不应共享同一个无限制 Intermediate。按环境、信任域和用途拆分 Mount，可以独立设置 Role、TTL、CRL 和管理权限。

## 2. 证书请求与验证链

```text
工作负载使用 Vault 身份登录
→ 请求 pki/issue/<role>，提交 Common Name/SAN
→ Policy 允许使用指定 Role
→ Role 判断名称、TTL、Key Usage 是否允许
→ Vault 使用当前 Issuer 签名
→ 返回 Leaf Certificate、Private Key 和 Chain
→ 应用原子写入文件并重载
→ 对端从 Leaf 逐级验证到受信 Root
```

Policy 只控制能否访问 Role，真正限制“可以签哪个名字”的是 PKI Role。二者必须同时正确。

## 3. PKI Role 的名称边界

Role 至少要约束：

- Allowed Domains 和是否允许 Subdomain；
- URI SAN、IP SAN、Email SAN 的允许范围；
- Server Auth、Client Auth 等 Key Usage；
- RSA/ECDSA/Ed25519 等密钥类型和长度；
- 最大 TTL；
- 是否允许通配符和 Bare Domain。

禁止为了省事允许任意名称。能访问 `pki/issue/web` 的工作负载如果可签发 `*.example.com`，就可能伪装整个域的服务。

## 4. TTL 的上限链

最终证书有效期不会只由客户端请求决定：

```text
请求 TTL
∩ Role max_ttl
∩ Mount max_lease_ttl
∩ Issuer/Intermediate 剩余有效期
= 实际证书 TTL
```

Intermediate 快到期时，新 Leaf 即使请求较长 TTL 也会被限制。需要同时告警：Root、Intermediate、Issuer 和 Leaf 的到期时间，而不是只看应用证书。

## 5. 私钥在哪里生成

常见模型：

1. Vault 生成私钥并随响应返回，调用方安全写入；
2. 调用方本地生成私钥和 CSR，Vault 只签名；
3. 私钥由 HSM/KMS 或硬件设备持有，Vault 处理相应签名流程。

CSR 模型减少私钥经过网络和 Vault 响应的机会，但调用方必须正确生成、保存和销毁私钥。无论哪种模型，都不能把私钥输出到普通日志、ConfigMap 或 Git。

## 6. 应用怎样安全更新证书

推荐流程：

```text
在 NotAfter 前足够早开始续签
→ 把新 key/cert/chain 写到临时文件
→ 校验私钥与证书匹配、链完整、名称和时间正确
→ 原子替换文件或目录链接
→ 通知进程平滑重载
→ 验证新连接使用新序列号
→ 延迟清理旧文件
```

环境变量通常不会随文件更新。很多进程也只在启动时读取证书；Sidecar 更新文件不代表服务已热加载。

续签提前量要覆盖 Vault 故障、网络抖动、发布窗口和应用重载时间，并加入随机抖动，避免所有实例同一秒签发。

## 7. 吊销、CRL 与 OCSP

Vault 可以记录证书吊销并发布 CRL，部分场景还可使用 OCSP。真正阻断取决于依赖方是否获取和检查撤销状态：

```text
Vault 标记吊销
→ CRL/OCSP 更新并可访问
→ 网关、客户端或 TLS 库刷新
→ 后续握手拒绝该证书
```

如果客户端从不检查 CRL/OCSP，控制面中的“已吊销”不会自动阻断流量。短 TTL 能减少泄漏窗口和 CRL 压力，但不能替代私钥泄漏时的隔离和应急响应。

需要监控 CRL 大小、生成时间、分发可达性和消费者刷新状态。

## 8. Intermediate CA 轮换

安全轮换不是直接覆盖旧 CA：

1. 生成新 Intermediate Key/CSR；
2. 由 Root CA 签发；
3. 导入新 Issuer，暂不删除旧 Issuer；
4. 将新旧信任链分发到全部消费者；
5. 切换默认签发 Issuer；
6. 验证新 Leaf 在所有入口和客户端可用；
7. 等待旧 Leaf 退出或到期；
8. 最后移除旧 CA 信任并归档证据。

Vault 新版本支持在一个 PKI Mount 中管理多个 Issuer，但实际命令和功能要按部署版本验证。轮换前必须在预生产演练。

## 9. ACME 的边界

Vault PKI 可以在合适版本和配置下提供 ACME 接口，使标准客户端自动申请和续签证书。ACME 只是协议入口，仍需要限制 Directory、Role、EAB/认证边界、域名和签发速率。

不要因为使用 Certbot 或其他 ACME Client，就绕过工作负载身份和名称授权设计。

## 10. SSH CA 模型

传统做法把长期私钥复制给人和自动化；SSH CA 则让 Vault 签发短期用户证书：

```text
用户/自动化登录 Vault
→ 请求 ssh/sign/<role>
→ Role 限制 Principal、TTL 和扩展
→ Vault 用 SSH CA 签名用户公钥
→ 目标主机信任 SSH CA 公钥
→ sshd 校验证书和 Principal
```

目标主机只分发 CA 公钥，不需要预置每个人的公钥。人员离职或角色变化后停止签发，新证书很快失效。

## 11. 用户证书、主机证书与 Principal

- User Certificate：证明登录者身份，目标主机通过 `TrustedUserCAKeys` 信任；
- Host Certificate：证明 SSH Server 身份，客户端信任 Host CA；
- Principal：证书允许声明的逻辑身份，不等同任意 Linux 用户名。

Role 要限制可签 Principal，不能让普通用户请求 `root`。目标主机还需把 Principal 映射到允许的系统账号，并结合 `sudo`、命令限制和会话审计。

## 12. 排障路径

### 12.1 TLS/PKI {/* #tlspki */}

```bash
openssl x509 -in tls.crt -noout -subject -issuer -dates -serial -ext subjectAltName
openssl verify -CAfile root-ca.crt -untrusted intermediate-ca.crt tls.crt
openssl s_client -connect service.example:443 -servername service.example -showcerts
```

检查顺序：系统时间 → 名称/SAN → Leaf 到期 → Chain 顺序 → Root Trust → Key Usage → CRL/OCSP → 服务是否加载新文件。

### 12.2 SSH Certificate {/* #ssh-certificate */}

```bash
ssh-keygen -L -f id_ed25519-cert.pub
ssh -vvv user@host
journalctl -u sshd
```

检查签名 CA、证书类型、Valid After/Before、Principal、目标 `sshd_config` 和账号映射。

## 13. 上线验收

- 非授权工作负载不能签生产域名；
- 通配符、IP SAN 和 Client Auth 仅按需开放；
- 证书能自动续签且应用真正热加载；
- Vault/P KI 短时不可用不会立即造成全量过期；
- CRL/OCSP 的消费者行为经过验证；
- Intermediate 双信任轮换已经演练；
- SSH Role 不能签 `root` 等越权 Principal；
- 私钥、证书响应和 SSH 凭据不进入日志。

## 14. 练习与答案

**问题：证书 TTL 只有 24 小时，是否可以不做吊销？**

答案：不能一概而论。短 TTL 降低泄漏窗口，但高风险私钥泄漏仍可能需要立即隔离、吊销和阻断；依赖方是否检查撤销状态也必须验证。

**问题：Sidecar 已更新证书文件，为什么客户端看到的仍是旧证书？**

答案：服务进程可能没有重新读取文件、重载失败、连接复用仍使用旧 TLS Session，或流量命中了其他未更新实例。要验证进程和真实握手结果。

参考资料：

- [PKI secrets engine](https://developer.hashicorp.com/vault/docs/secrets/pki)
- [PKI considerations](https://developer.hashicorp.com/vault/docs/secrets/pki/considerations)
- [SSH secrets engine](https://developer.hashicorp.com/vault/docs/secrets/ssh)
