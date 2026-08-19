---
title: "Temporal 数据、Payload Codec、身份与安全"
sidebar_label: "07. 数据、Codec 与安全"
sidebar_position: 7
description: "控制 Workflow Payload、Metadata、加密 Codec、mTLS、Namespace 授权、搜索属性和日志中的敏感数据。"
tags: [Temporal, Payload Codec, Encryption, mTLS, Security]
---

# Temporal 数据、Payload Codec、身份与安全

## 1. History 中有什么

Workflow/Activity 输入输出、Signal/Update 和失败信息可能进入 Event History 并按保留策略保存。不要传模型、大文件、完整日志和长期 Secret；传对象存储引用、Digest 和最小业务字段。

## 2. Data Converter 与 Codec

SDK Data Converter 将对象序列化为 Payload；Codec 可在客户端/Worker 边界压缩或加密 Payload。加密密钥在 KMS/HSM 管理，包含 Key Version，并设计轮换和历史解密。

Server 通常无法理解加密 Payload，Web UI/CLI 调试需要受控 Codec Server 或本地解密能力。它会扩大明文访问面，必须认证授权和审计。

## 3. Metadata 仍可能泄漏

即使 Payload 加密，Namespace、Workflow Type/ID、Task Queue、时间、状态、Search Attribute 和错误类型仍可见。Workflow ID 不包含身份证号、Token 或其他敏感值。

## 4. 传输与身份

Client/Worker 到 Service 使用 TLS/mTLS 或受支持身份机制。按 Namespace、Workflow 操作和系统身份最小授权；生产 Worker 不能访问其他租户队列。

## 5. Search Attribute

只索引查询所需、低敏感且受控基数的数据。属性更新有 Schema/枚举；高基数会增加存储和查询压力。Search 不是业务数据库，结果用于可见性而非财务事实。

## 6. 日志与错误

Replay 可能让普通日志重复，使用 SDK Replay-aware Logging。Activity 错误需分类但不包含请求 Secret/完整响应。日志关联 Namespace、Workflow ID（非敏感）、Run ID、Activity 和 Attempt。

## 7. 数据删除

定义 History Retention、业务数据删除和备份生命周期。删除 Workflow 可见性记录不自动删除外部对象；外部删除也不会修改已有 History。合规删除需要跨系统工作流和证据。
