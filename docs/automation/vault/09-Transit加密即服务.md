---
title: "Vault Transit 加密即服务"
sidebar_label: "09. Transit 加密即服务"
sidebar_position: 9
description: "使用 Transit 完成加解密、签名、HMAC、数据密钥、派生密钥、轮换和 Rewrap，并理解性能与不可恢复边界。"
tags: [Vault, Transit, Encryption, Key Rotation, HMAC]
---

# Vault Transit 加密即服务

Transit Engine 保存并使用密钥，但不保存应用业务明文。应用把待处理数据发送给 Vault，获得带版本信息的密文或签名；主密钥不离开 Vault 的保护边界。

## 1. 能力与边界

| 能力 | 用途 | 不应混淆为 |
| --- | --- | --- |
| Encrypt/Decrypt | 字段级、小 Payload 加密 | 大文件存储或 TLS 隧道 |
| Sign/Verify | 消息、制品、事务签名 | 数据保密 |
| HMAC | 完整性、稳定伪名 | 可逆加密 |
| Data Key | 应用侧信封加密 | 可随意记录的普通 API 响应 |
| Rewrap | 不暴露明文地升级密文 Key Version | 改变业务加密算法的万能迁移 |

Transit 不保存业务密文，也不替应用维护“这条密文属于哪个用户”。数据模型、授权和密文存储仍由应用负责。

## 2. Encrypt/Decrypt 数据流

```text
应用把明文 Base64 编码
→ POST transit/encrypt/customer-data
→ Vault 使用当前 Key Version 加密
→ 返回 vault:v3:<ciphertext>
→ 应用把密文与必要元数据持久化

读取时：
应用提交密文
→ Policy 允许 decrypt
→ Vault 根据 v3 选择对应 Key Version
→ 返回 Base64 明文
```

Base64 只是编码，不是加密。应用应限制 Payload 大小，避免把大文件和无限用户输入直接送入 Vault。

## 3. Key、Key Type 与用途

创建 Key 前先确定用途：对称加密、RSA/ECDSA 签名、HMAC 或派生密钥需要不同 Key Type 和 API 能力。创建后部分属性不能无损改变。

每个安全域使用独立 Key：

```text
transit/keys/payments-card-token
transit/keys/audit-signing
transit/keys/customer-envelope
```

不要让整个公司共用一个名为 `default` 的万能 Key，否则权限、轮换和事故影响范围都无法隔离。

## 4. 权限按动作拆分

```hcl
path "transit/encrypt/customer-data" {
  capabilities = ["update"]
}

path "transit/decrypt/customer-data" {
  capabilities = ["update"]
}

path "transit/keys/customer-data" {
  capabilities = ["deny"]
}
```

生产者可能只需 Encrypt，消费者才需 Decrypt；验证者只需 Verify，签名服务才需 Sign。业务应用通常无权读取 Key 配置、轮换、导出、备份或删除 Key。

注意 Transit 的动作接口在 Vault Policy 中常使用 `update` Capability，即使语义上是解密读取结果。

## 5. Key Version 与轮换

密文前缀记录 Key Version：

```text
vault:v1:...
vault:v2:...
vault:v3:...
```

轮换会创建新版本：新加密使用最新版，旧密文仍由旧版本解密。轮换本身不会自动重写数据库中的历史密文。

完整迁移：

```text
Rotate 产生 v4
→ 新写入使用 v4
→ 扫描旧密文
→ Rewrap 为 v4
→ 验证业务读取和覆盖率
→ 提高 min_decryption_version
→ 经过审批后再考虑归档/销毁旧版本
```

在确认所有历史、备份、消息队列、冷数据和灾备副本已迁移前，不能提高最小解密版本。

## 6. Rewrap 为什么不暴露明文

Rewrap 在 Vault 内部解密旧密文并用当前版本重新加密，响应只返回新密文：

```text
vault:v2:ciphertext
→ Transit 内部 decrypt + encrypt
→ vault:v4:ciphertext
```

调用方仍需有 Rewrap 相应路径权限，并负责原子更新业务数据库。若更新一半失败，要能识别每条密文版本并继续迁移。

## 7. Derived Key 与 Context

派生 Key 用主 Key 和 Context 生成实际加密密钥，可把租户或对象域隔离：

```text
Master Key + Context(customer-42) → Derived Key A
Master Key + Context(customer-73) → Derived Key B
```

同一密文解密时必须提供完全相同的 Context。Context 不是 Secret，但属于不可丢失的加密元数据；字符编码、大小写或租户 ID 迁移变化都会导致无法解密。

不要把用户可控 Context 当授权边界。Policy 仍需阻止调用者任意解密其他租户数据。

## 8. Convergent Encryption 的风险

收敛加密允许相同条件下相同明文产生可比较结果，可能支持去重或查询，但会泄露“两个值是否相同”等信息，并对 Nonce、Context 和算法使用提出严格要求。

只有在明确威胁模型和业务必要性后使用。普通字段加密应保留随机性，不能为了方便数据库查询就默认打开收敛模式。

## 9. Data Key 与信封加密

大对象不应整体发送给 Transit。信封加密流程：

```text
应用请求 Data Key
→ Vault 返回 Plaintext Data Key + Wrapped Data Key
→ 应用用 Plaintext Data Key 在本地流式加密大对象
→ 立即从内存清理 Plaintext Key
→ 保存 Ciphertext Object + Wrapped Data Key + 算法/Nonce/Context
```

解密时只把 Wrapped Data Key 交给 Vault，获得短暂明文 Data Key 后在本地解密。Data Key API 响应本身高度敏感，不能写日志或监控 Label。

加密格式必须记录算法、版本、Nonce/IV、AAD、Wrapped Key 和 Context，否则未来无法可靠解密。

## 10. Sign、Verify 与 HMAC

- Sign/Verify 提供非对称或支持的签名能力，证明消息来自持有私钥的一方；
- HMAC 使用共享密钥产生完整性校验，不能由第三方独立验证；
- Hash 只是摘要，没有 Secret Key，不能证明来源。

签名前要定义序列化格式。JSON 字段顺序、空格、Unicode 和时间格式不稳定，会导致同一逻辑对象产生不同字节。应先做规范化编码，再签名。

## 11. 高可用与性能

在线 Transit 把 Vault 放进应用数据路径：

```text
业务延迟 = 网络 + TLS + Vault Policy/Audit + 加密计算 + Raft（仅需持久化的操作）
```

评估：

- 单条和 Batch API 吞吐；
- Payload 大小分布；
- P50/P95/P99；
- Vault 切主和限流时的错误；
- Audit 写入量；
- 应用连接复用和超时；
- 重试是否会重复业务写入。

批量接口减少网络往返，但单批过大会增加内存、尾延迟和失败重试成本。以压测确定批大小。

## 12. 故障与恢复边界

| 故障 | 影响 |
| --- | --- |
| Vault 不可达 | 在线加解密、签名全部受影响 |
| Key 被误删/旧版本不可用 | 对应历史数据可能永久不可恢复 |
| Context 丢失 | 派生密文无法解密 |
| Policy 错配 | 生产者可能获得不必要 Decrypt 权限 |
| 密文数据库回滚 | 可能重新出现已停止支持的旧版本密文 |
| Audit 阻塞 | Transit 请求也会变慢或失败 |

Vault Snapshot 保护 Transit Key 状态，但还必须备份业务密文和 Context 元数据，并进行成套恢复测试。

## 13. 练习与答案

**问题：Key Rotate 后是否可以立即删除 v1？**

答案：不可以。历史密文仍标记 `vault:v1`，要先完成 Rewrap、验证全部数据和灾备副本，再按审批提高最小解密版本。

**问题：Transit 是否适合直接加密 2 GB 模型文件？**

答案：不适合。应使用 Data Key 做应用侧流式信封加密，Transit 只保护较小的数据密钥。

**问题：Context 不是 Secret，是否可以不保存？**

答案：不可以。派生密钥解密需要完全相同的 Context；丢失它相当于丢失必要的加密元数据。

参考资料：

- [Transit secrets engine](https://developer.hashicorp.com/vault/docs/secrets/transit)
- [Transit API](https://developer.hashicorp.com/vault/api-docs/secret/transit)
- [Transit key rotation](https://developer.hashicorp.com/vault/tutorials/encryption-as-a-service/eaas-transit-key-rotation)
