---
title: "Cosign 与 ORAS 命令详解"
sidebar_label: "05. Cosign 与 ORAS 命令详解"
sidebar_position: 5
description: "使用Cosign签名和验证镜像/制品，以ORAS推拉模型、SBOM和证明，建立基于OCI Digest的AI供应链。"
tags: [Cosign, ORAS, OCI, Sigstore, 模型制品, SBOM, 签名]
---

# Cosign 与 ORAS 命令详解

OCI Registry不仅能保存容器镜像，也可保存模型目录、Tokenizer、SBOM、评测报告和证明。ORAS负责OCI artifact的推拉与发现；Cosign负责签名、验证和attestation。安全目标不是“存在一个签名”，而是验证digest、签名身份、issuer、透明日志/Bundle和策略。

## 1. 版本与对象身份 `[R]`

```bash
cosign version
cosign help
oras version
oras help
```

所有生产操作使用digest：

```text
registry.example/ai/model@sha256:<digest>
```

Tag是可变指针，签名和部署门禁都要解析并锁定digest。

## 2. ORAS推送模型制品 `[W]`

先生成清单和哈希，再推送：

```bash
oras push registry.example/ai/qwen:2026-08-13 \
  --artifact-type application/vnd.example.ai.model.v1 \
  model/:application/vnd.example.ai.model.layer.v1.tar+gzip \
  manifest.json:application/json
```

CLI对目录打包、media type和annotation的语法会随版本演进，以当前帮助为准。推送后解析digest并记录：

```bash
oras manifest fetch registry.example/ai/qwen:2026-08-13
oras resolve registry.example/ai/qwen:2026-08-13
```

## 3. ORAS拉取与发现 `[R/A]`

```bash
oras pull registry.example/ai/qwen@sha256:<digest> --output ./verify
oras manifest fetch registry.example/ai/qwen@sha256:<digest>
oras discover registry.example/ai/qwen@sha256:<digest>
```

拉取到空目录，验证manifest、层media type、文件清单和哈希后，再原子切换发布路径。`--output` 已存在时确认覆盖行为，避免混入旧文件。

## 4. Registry认证

```bash
oras login registry.example
oras logout registry.example
cosign login registry.example
```

密码/Token优先从stdin或credential helper输入。工作负载身份只授权目标repository的pull/push；签名身份与制品上传身份可以分离。

## 5. Cosign签名 `[W]`

Keyless示意：

```bash
cosign sign registry.example/ai/qwen@sha256:<digest>
```

密钥方式：

```bash
cosign sign --key <kms-or-key-reference> registry.example/ai/qwen@sha256:<digest>
```

生产使用KMS/HSM或CI工作负载身份，不在磁盘明文存私钥。签名前确认目标digest、OIDC identity、issuer、Registry支持和透明日志策略。非交互确认参数必须在CI中明确，不在人工Shell无审查使用。

## 6. 验证身份 `[R]`

```bash
cosign verify \
  --certificate-identity '<expected-identity>' \
  --certificate-oidc-issuer '<expected-issuer>' \
  registry.example/ai/qwen@sha256:<digest>
```

只运行 `cosign verify IMAGE` 而不约束identity/issuer，可能接受不受信签名。密钥方式使用固定公钥或KMS引用。离线验证要携带可信根、Bundle和策略，不能仅因为网络不可用而跳过证明检查。

## 7. Attestation与SBOM `[W/R]`

```bash
cosign attest \
  --predicate sbom.cdx.json \
  --type cyclonedx \
  --key <kms-reference> \
  IMAGE@DIGEST

cosign verify-attestation \
  --type cyclonedx \
  --certificate-identity '<identity>' \
  --certificate-oidc-issuer '<issuer>' \
  IMAGE@DIGEST
```

证明类型、predicate schema和CLI v2/v3差异明显，发布前锁定版本。SBOM、漏洞报告、模型评测和数据血缘应分别使用明确predicate type，验证后还要由策略引擎判断内容是否满足门禁。

## 8. Blob签名

```bash
cosign sign-blob --bundle model.sigstore.json model.tar
cosign verify-blob \
  --bundle model.sigstore.json \
  --certificate-identity '<identity>' \
  --certificate-oidc-issuer '<issuer>' \
  model.tar
```

Cosign v3默认更强调Bundle；不要混用旧版独立signature/certificate示例。Blob与Bundle必须一起归档，并记录工具版本和可信根。

## 9. 删除与复制边界 `[D]`

ORAS可能支持copy、tag、manifest delete等操作。复制前验证源digest与目标Registry保留referrer；删除artifact可能同时影响签名、SBOM和证明可发现性。Registry GC和保留策略必须理解subject/referrer关系，避免镜像还在但签名被清理。

## 10. 常见故障

| 现象 | 首要检查 |
|---|---|
| Tag验证通过后部署了另一内容 | 验证后未锁digest，存在Tag竞态 |
| verify有签名但策略仍拒绝 | identity/issuer、Bundle、时间、predicate和门禁条件 |
| discover看不到SBOM | Registry referrer支持、media type、复制/GC行为 |
| 大模型推送中断 | Registry层大小/超时、分层策略、重试和临时上传清理 |
| 拉取后模型不完整 | OCI manifest、层解包、文件清单和应用级哈希 |
| Keyless在CI失败 | OIDC token权限、issuer/audience、时间同步和网络 |

## 11. 掌握标准 {/* #掌握标准 */}

能用ORAS按digest交付模型；能用Cosign验证明确身份；能发布并验证SBOM/评测attestation；能设计Registry复制、保留和GC而不丢签名关系；能阻止Tag竞态。

## 12. 官方资料 {/* #官方资料 */}

- [Cosign documentation](https://docs.sigstore.dev/cosign/)
- [ORAS CLI documentation](https://oras.land/docs/commands/oras/)
