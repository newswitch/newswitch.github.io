---
title: "LLM 发布 Manifest 与模型制品完整性"
sidebar_label: "04. 发布 Manifest 与制品完整性"
sidebar_position: 4
description: "将权重、Tokenizer、模板、镜像、参数、评测和许可证组织成不可变发布Manifest，并执行摘要、签名与准入。"
tags: [MLOps, LLMOps, Manifest, 模型制品, 供应链安全]
---

# LLM 发布 Manifest 与模型制品完整性

生产发布的不是“一个模型名字”，而是一组必须共同变化的制品：

```text
权重/量化权重
+ config.json
+ Tokenizer与特殊Token
+ Chat Template与Parser
+ 推理镜像
+ 启动参数
+ 评测报告
+ 许可证与来源
```

发布Manifest把这组内容绑定成可验证、可审计、可回滚的版本。

## 1. URI、Tag、Digest

| 标识 | 特点 | 用途 |
| --- | --- | --- |
| 路径/URI | 指向位置，可被覆盖 | 定位存储 |
| Tag/Alias | 人类可读、可移动 | `candidate`、`champion`语义 |
| Version ID | Registry中的版本 | 审计和关系 |
| Digest | 内容摘要、不可变身份 | 生产固定与校验 |

生产部署最终应解析到不可变Version和Digest，不能长期依赖`latest`或可变Alias。

## 2. Manifest最小字段

```yaml
schema_version: "1"
release_id: qwen-prod-2026-08-24.1
model:
  name: qwen-prod
  source_revision: <commit>
  artifact_uri: s3://models/qwen/<digest>/
  manifest_sha256: <hash>
  dtype: bfloat16
  quantization: none
tokenizer:
  revision: <commit>
  files_sha256: <hash>
  chat_template_sha256: <hash>
runtime:
  image: registry.example/vllm-ascend@sha256:<digest>
  engine_args_sha256: <hash>
  hardware: atlas-800i-a2
evaluation:
  report_uri: s3://eval/<report>.json
  report_sha256: <hash>
source:
  code_revision: <commit>
  dataset_snapshot: <id>
  license: <spdx-id>
```

## 3. 为什么目录哈希不够

简单目录哈希可能受文件顺序、时间戳和平台影响。推荐：

1. 生成排序后的文件Manifest；
2. 每个文件记录相对路径、大小和SHA256；
3. 对Manifest本身计算Digest；
4. 对Digest签名；
5. 推理启动时校验Manifest而非重新发明排序规则。

## 4. 构建流程

```text
可信源下载到临时目录
→ 恶意文件/许可证/Remote Code审查
→ 转换或量化
→ 生成文件Manifest
→ 执行接口/精度/性能评测
→ 保存评测报告
→ 生成Release Manifest
→ 签名并上传不可变存储
→ Registry登记候选版本
```

失败的候选制品也应有审计记录，但不能获得可部署状态。

## 5. 签名证明什么

数字签名可以证明Manifest由受信身份签发且内容未被修改。它不能自动证明：

- 模型没有后门；
- 训练数据合法；
- 评测充分；
- 量化没有精度回归；
- 签名私钥未泄漏。

因此签名是供应链控制之一，要和来源、扫描、评测、审批和运行时策略组合。

## 6. Registry与Artifact Store职责

```text
Artifact Store：保存大文件和Manifest
Model Registry：保存版本、状态、Alias、审批和血缘
Git：保存部署期望状态与Manifest引用
Container Registry：保存推理镜像
```

不应把数百GB权重提交到Git，也不应让模型Registry中的可变Alias直接成为生产唯一坐标。

## 7. 部署准入

Admission/Pipeline检查：

```text
Manifest Schema有效
→ 签名有效
→ 所有Digest存在且匹配
→ 评测门禁通过
→ 目标硬件/框架兼容
→ 镜像无阻断级漏洞
→ 许可证策略通过
→ 允许进入目标环境
```

准入失败应在启动前阻止发布，而不是让Pod启动后才从日志发现模型不兼容。

## 8. 运行时证明

Pod Annotation或状态端点公开低敏感度坐标：

```text
release_id
model_manifest_digest
tokenizer_digest
image_digest
engine_args_digest
```

事故中可从一个响应/Pod反查完整发布证据。不要将签名私钥或敏感存储凭据放进这些元数据。

## 9. 回滚

回滚对象是整个Release Manifest：

```text
模型
Tokenizer
模板/Parser
镜像
参数
路由和兼容配置
```

只回滚权重、保留新Tokenizer或参数，会得到从未评测过的组合。

## 10. 密钥与权限

- CI使用短期身份签名；
- 私钥不写入仓库和普通Secret；
- 生产只需要验证公钥/信任策略；
- Artifact Store对象版本化且禁止覆盖；
- 转换、评测、签名和发布角色分权；
- 所有Alias移动有审计事件。

## 11. 门禁清单

```text
[ ] 每个文件有路径、大小和摘要
[ ] Remote Code和许可证已审查
[ ] 量化制品记录转换链与校准集
[ ] Tokenizer/Template/Parser进入Manifest
[ ] 推理镜像固定Digest
[ ] 评测报告有摘要且不可覆盖
[ ] Manifest经过受信身份签名
[ ] 生产准入验证签名和兼容策略
[ ] Pod可反查release_id
[ ] 回滚使用完整旧Manifest
```

## 12. 官方资料

- [MLflow Artifact Store](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [OCI Image Specification](https://github.com/opencontainers/image-spec)
- [Sigstore Cosign](https://docs.sigstore.dev/cosign/)
- [ORAS](https://oras.land/docs/)
