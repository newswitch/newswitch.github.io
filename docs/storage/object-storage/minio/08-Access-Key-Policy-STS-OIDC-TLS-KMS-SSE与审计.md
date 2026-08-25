---
title: "Access Key、Policy、STS、OIDC、TLS、KMS、SSE 与审计"
sidebar_label: "08. 身份、加密与审计"
sidebar_position: 8
description: "建立 MinIO 身份认证、最小权限、临时凭据、传输加密、服务端加密和审计体系。"
tags: [MinIO, Policy, STS, OIDC, TLS, KMS, SSE]
---

# Access Key、Policy、STS、OIDC、TLS、KMS、SSE 与审计

对象存储安全分为身份、授权、传输加密、静态加密和审计。只启用 TLS 不能阻止合法账号越权，只启用 SSE 也不能保护网络中的明文凭据。

## 1. 请求安全路径

```text
Client
→ TLS校验Endpoint
→ SigV4验证Access Key/临时Token
→ Policy判断Action/Resource/Condition
→ 可选SSE/KMS加解密
→ Audit记录
```

## 2. 身份选择

| 身份 | 用途 |
| --- | --- |
| Root | 初始管理和紧急操作，日常禁用 |
| 长期 Access Key | 遗留服务，需严格轮换 |
| Service Account | 从父身份派生、限定应用 |
| STS 临时凭据 | 工作负载短期访问 |
| OIDC/LDAP 等外部身份 | 人员/平台统一认证 |

Kubernetes 工作负载优先使用短期凭据和工作负载身份映射，避免把长期 Root Key 写入所有 Pod。

## 3. Policy

Policy 按 S3 Action、Bucket/Object ARN 和 Condition 授权。List Bucket 与 Get Object 是不同权限；应用只读模型 Prefix 时，不应获得 Delete、Policy 或其他 Bucket 权限。

策略测试覆盖允许和拒绝，不使用通配 `s3:*` 作为快速修复。显式 Deny、Bucket Policy、用户 Policy 和 STS Policy 的组合按目标版本验证。

## 4. TLS

证书 SAN 覆盖 S3 域名和 Console 域名，客户端严格校验 CA。轮换使用新旧 CA 重叠期，并监控过期、握手失败和旧协议。节点间与 LB 回源是否加密要明确，不能只看外部 HTTPS。

## 5. SSE 与 KMS

服务端加密可使用服务管理密钥或 KMS。KMS 的可用性、权限、密钥轮换和备份成为读取路径的一部分：对象仍在但密钥不可用时，数据等同不可用。

加密不替代 Object Lock、版本或备份。记录对象加密方式和 Key ID，但日志不输出数据密钥。

## 6. 审计

审计记录身份、来源、Bucket/Key、Action、结果、Request ID 和时间，并发送到独立受保护后端。Key 可能含敏感业务信息，访问和保留同样受控。

## 7. 验收

用只读身份尝试 PUT/DELETE，验证拒绝；签发短期 STS 并等待过期；轮换证书和 KMS Key；停止 KMS 观察读写边界；追踪一次对象访问到审计记录。

参考：[MinIO Identity and Access Management](https://min.io/docs/minio/linux/administration/identity-access-management.html)、[Server-Side Encryption](https://min.io/docs/minio/linux/administration/server-side-encryption.html)。
