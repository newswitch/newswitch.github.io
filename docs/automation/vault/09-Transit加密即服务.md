---
title: "Vault Transit 加密即服务"
sidebar_label: "09. Transit 加密即服务"
sidebar_position: 9
description: "使用 Transit Engine 完成加解密、签名、HMAC、数据密钥和密钥版本轮换，而不暴露主密钥。"
tags: [Vault, Transit, Encryption, Key Rotation, HMAC]
---

# Vault Transit 加密即服务

Transit Engine 保存和使用密钥，但不保存业务明文。应用把数据发送给 Vault，获得带版本信息的密文；主密钥不离开 Vault 的保护边界。

## 1. 能力边界

| 能力 | 典型用途 |
| --- | --- |
| Encrypt/Decrypt | 字段级或小数据加密 |
| Sign/Verify | 业务消息或制品证明 |
| HMAC | 完整性和不可逆标识 |
| Data Key | 信封加密大对象 |
| Rewrap | 不暴露明文地升级密文密钥版本 |

Transit 不是大文件传输代理。大对象应使用数据密钥在应用侧进行经过评审的信封加密，并安全清理明文密钥。

## 2. 密文版本

密文包含使用的 Key Version。轮换创建新版本，新加密使用新版本，旧密文仍可由允许的旧版本解密。配置最小解密版本前，应先完成数据 Rewrap 和兼容验证。

删除/销毁旧密钥版本可能使历史数据永久不可恢复，必须有数据清单、备份、审批和恢复测试。

## 3. Context 与派生密钥

启用派生密钥时，Context 参与生成实际数据密钥。相同明文在不同 Context 下隔离，但应用必须稳定保存 Context；丢失或不一致会导致无法解密。Context 不是 Secret，也不能替代访问控制。

## 4. 可用性与性能

应用每次加解密都调用 Vault 会增加网络和 Vault 压力。评估批量 API、连接复用、Payload 大小、吞吐、P95/P99、故障时行为和重试上限。加密请求不是天然幂等的业务操作，重试要保留请求语义。

## 5. Policy

分离 `encrypt`、`decrypt`、`sign`、`verify` 和密钥管理权限。很多生产者只需加密，消费者才需要解密；业务应用通常无权轮换、导出或删除密钥。
