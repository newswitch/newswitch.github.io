---
title: "模型、镜像、Dataset 与 Checkpoint 供应链安全"
sidebar_label: "03. AI 制品供应链安全"
sidebar_position: 3
description: "用不可变坐标、签名、来源证明、反序列化边界和权限隔离保护 AI 制品完整性。"
tags: [模型安全, 镜像, Dataset, Checkpoint, Sigstore, SLSA]
---

# 模型、镜像、Dataset 与 Checkpoint 供应链安全

## 1. AI 发布单元不止容器镜像

```text
运行结果 = 容器镜像
         + 模型权重与配置
         + Tokenizer/Chat Template
         + Remote Code/自定义算子
         + Runtime参数
         + Driver/设备兼容层
```

只签名镜像，模型目录仍可被替换，最终服务依然不可验证。

## 2. 不可变坐标

| 制品 | 推荐坐标 |
| --- | --- |
| OCI 镜像 | Registry/Repo@sha256:Digest |
| 模型 | Repo + Commit/Revision + 文件 Hash |
| Dataset | Manifest ID + Shard Checksum |
| Checkpoint | Run ID + Step + Manifest + Shard Hash |
| Python 依赖 | Lockfile + Wheel Hash |
| Runtime 配置 | Git Revision + Schema Version |

可变 Tag 和路径可作为人类别名，但部署解析后必须记录不可变值。

## 3. 来源与晋级

构建系统生成 SBOM、签名和 Provenance，测试环境验证兼容性、性能和安全，再把同一 Digest 晋级到生产。生产禁止重新构建“相同版本”。

Admission 可以校验镜像签名；模型下载器也应校验允许的 Registry/Repository、Revision、Size 和 Checksum。校验失败时 Fail Closed，不能降级为忽略。

## 4. 反序列化风险

Python Pickle 和允许 Remote Code 的模型仓库可能执行代码。安全边界包括：

- 优先使用 Safetensors 等纯数据格式；
- 默认禁用不必要的 Trust Remote Code；
- 在隔离环境审查和转换第三方模型；
- 限制 Loader 网络、文件系统和凭据；
- 自定义算子和 Wheel 进入同一供应链扫描；
- 不把模型来源声明等同于安全证明。

## 5. Dataset 与 Checkpoint

Dataset 污染可能来自错误权限、生成管线或缓存不一致。Checkpoint 能包含优化器、随机数、调度器和 Python 对象，也必须视为可执行/敏感制品。

训练恢复前验证 Run、模型结构、World Size、格式版本和 Manifest；从不可信来源恢复时先在隔离环境检查。

## 6. 缓存安全

节点模型缓存保存高价值权重。需要独立文件系统、最小权限、加密策略、租户键空间、使用结束后的引用管理和节点退役擦除。HostPath 缓存不能让普通 Pod 浏览其他模型。

## 7. 验证链

```text
身份验证
→ 获取Manifest
→ 验证签名/Provenance
→ 校验每个对象Hash
→ 安全格式加载
→ 记录实际Revision
→ 服务身份与模型身份写入指标
```

参考：[SLSA Specification](https://slsa.dev/spec/)、[Sigstore Cosign](https://docs.sigstore.dev/cosign/)、[Safetensors](https://huggingface.co/docs/safetensors/)。
