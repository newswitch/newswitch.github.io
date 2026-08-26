---
title: "推理接口认证、配额、Secret、KMS、审计与安全排查"
sidebar_label: "07. 推理接口与凭据安全"
sidebar_position: 7
description: "保护 OpenAI 兼容和流式推理接口，控制 Token 成本与连接资源，并关联身份、凭据和审计证据。"
tags: [推理安全, API认证, 配额, KMS, 审计]
---

# 推理接口认证、配额、Secret、KMS、审计与安全排查

## 1. 推理接口的资源攻击面

一个请求的成本不只由 QPS 决定：

```text
成本 ≈ Input Tokens × Prefill成本
     + Output Tokens × Decode成本
     + KV Cache驻留时间
     + 流式连接占用
```

只设置每秒请求数无法阻止超长 Prompt、超大 `max_tokens` 或大量慢速流式连接耗尽 GPU 和网关。

## 2. 身份与授权

Gateway 验证 API Key、JWT/OIDC 或 mTLS，并把稳定租户/项目身份传给后端。授权维度至少包括：

- 可访问的模型与版本；
- 最大上下文和输出 Token；
- 并发、Token/s、日/月配额；
- Tool Call、文件上传等高风险能力；
- 数据保留和日志策略。

后端只信任来自受控 Gateway 的身份 Header，防止客户端直接伪造。

## 3. 过载保护

按租户进行并发、等待队列和 Token Budget 准入；设置请求总时限、排队时限、流式 Idle Timeout 和 Body Size。客户端取消后，取消信号必须传播到 Engine，释放 KV Cache 和计算预算。

## 4. Secret 与 KMS

Secret 的 Base64 不是加密。生产需要：

- Kubernetes etcd Encryption at Rest；
- KMS/外部 Secret Manager；
- Workload Identity 和短期凭据；
- 最小挂载路径、权限和内存生命周期；
- 轮换时双版本短暂兼容；
- 日志、Trace、环境变量和错误页脱敏。

模型解密密钥应只授予目标 Runtime 身份，并限制模型前缀和环境。

## 5. 审计字段

记录 Request ID、认证主体、租户、模型不可变版本、Gateway Route、后端 Pod UID、开始结束时间、输入/输出 Token、状态、取消与策略结果。默认不要保存完整 Prompt/响应；如业务必须留存，应做分类、脱敏、加密、访问审批和生命周期控制。

## 6. 安全排查

```text
异常Token消耗
→ 租户/Key/来源/模型维度
→ 请求长度与并发
→ Gateway准入结果
→ 后端排队与KV占用
→ Key是否泄漏或客户端重试风暴
```

认证失败突增要区分 Key 过期、时钟漂移、Issuer/JWKS 故障、恶意扫描和发布配置错误。KMS 不可用时不要自动降级为明文密钥。

## 7. 验证

- 无身份、错误 Audience、过期 Token 被拒绝；
- 越权模型访问被拒绝；
- QPS、并发、Token 和上下文限制分别生效；
- 流式断开后后端资源释放；
- Secret 轮换不中断既有请求；
- 审计能从身份追踪到实际模型副本且不泄漏正文。

参考：[Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)、[Kubernetes KMS Provider](https://kubernetes.io/docs/tasks/administer-cluster/kms-provider/)、[OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)。
