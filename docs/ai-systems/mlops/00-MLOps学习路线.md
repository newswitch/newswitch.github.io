---
title: "MLOps 学习路线"
sidebar_label: "00. MLOps 学习路线"
sidebar_position: 0
tags: [MLOps, MLflow, Model Registry, Evaluation, GitOps, Argo, 学习路线]
description: "围绕可复现、可追溯、可评测和可回滚，学习实验追踪、模型制品与血缘、评测门禁、Pipeline、GitOps 和渐进式发布。"
---

# MLOps 学习路线

MLOps 不是“在 Kubernetes 上跑一个训练 Job”，也不是只安装 MLflow。
它要回答模型从实验到生产全过程中的五个问题：

1. 这个结果是由哪份代码、数据、配置和环境产生的？
2. 生产部署的到底是哪一个不可变模型制品？
3. 候选模型用什么证据证明可以晋级？
4. 发布失败时如何自动停止并快速回到已知稳定版本？
5. 线上表现如何回流到下一轮实验，而不破坏审计和数据治理？

```mermaid
flowchart LR
    A["代码 / 数据 / 配置"] --> B["训练或转换"]
    B --> C["实验追踪"]
    C --> D["不可变模型制品"]
    D --> E["离线评测门禁"]
    E --> F["模型注册与晋级"]
    F --> G["GitOps 期望状态"]
    G --> H["Shadow / Canary"]
    H --> I["在线 SLO 与质量"]
    I --> J["提升或回滚"]
    I --> A
```

## 1. 模块边界

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| Experiment Tracking | 记录 Run、参数、指标、标签、制品引用 | 证明模型可以上线 |
| Artifact Store | 保存权重、Tokenizer、评测报告等大文件 | 提供完整审批工作流 |
| Model Registry | 模型版本、标签、Alias 和晋级关系 | 直接替代 GitOps |
| Evaluation Gate | 比较候选与基线，作出通过/拒绝判断 | 承担线上流量路由 |
| Pipeline | 编排构建、评测、注册和发布任务 | 保存所有业务状态 |
| GitOps | 审计并协调 Kubernetes 期望状态 | 保存数百 GB 模型权重 |
| Progressive Delivery | Shadow、Canary、分析和回滚 | 替代离线质量评测 |

## 2. 学习顺序

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 01 | [MLOps 与供应链命令参考库](./commands/00-MLOps与供应链命令参考库.md) | 能操作MLflow、DVC、Argo CD、Trivy、Cosign和ORAS，并理解每个写操作的边界 |
| 02 | [MLflow 实验追踪、模型注册与制品血缘](./01-MLflow实验追踪模型注册与制品血缘.md) | 能从生产模型反查代码、数据、环境、评测和制品摘要 |
| 03 | [模型评测门禁与版本晋级](./02-模型评测门禁与版本晋级.md) | 能把正确性、安全、性能和兼容性变成可执行策略 |
| 04 | [Pipeline、GitOps、Canary、Shadow 与回滚](./03-Pipeline-GitOps-Canary-Shadow与回滚.md) | 能设计从构建到渐进发布、分析和回滚的状态机 |

推荐前置：

- Kubernetes Job、Deployment、Service、Secret 和 RBAC。
- 容器镜像、OCI Digest 和对象存储。
- Prometheus Counter/Histogram 和 SLO。
- 大模型 Tokenization、Prefill、Decode、KV Cache。
- Git 分支、Pull Request、签名和审计基础。

## 3. 必须固定的版本坐标

一个模型版本不能只写成 `llama-70b-v3`。至少需要：

```yaml
model:
  registry_name: chat-70b
  registry_version: "42"
  artifact_uri: s3://model-artifacts/chat-70b/sha256/...
  artifact_sha256: ...
  source_revision: 4f0c...
  dataset_snapshot: s3://datasets/eval/2026-08-01/manifest.json
  tokenizer_revision: ...
  chat_template_sha256: ...
  image_digest: registry.example.com/vllm@sha256:...
  engine_args_sha256: ...
  dtype: bfloat16
  quantization: none
  evaluation_report_sha256: ...
```

Alias（如 `candidate`、`champion`）用于表达可变的人类语义；生产清单最终应解析并固定到实际版本和 Digest，
否则同一个 Git Commit 在不同时间可能加载不同模型。

## 4. MLOps 与 LLMOps 的关系

LLMOps 在传统模型生命周期上增加：

- Prompt、System Prompt 和 Chat Template 版本。
- Tokenizer 与特殊 Token。
- 基座模型、微调权重和 LoRA Adapter 组合。
- RAG 索引、Embedding 模型和语料快照。
- 自动评审器版本及其偏差。
- TTFT、TPOT、KV Cache、上下文长度和推理成本。
- Prompt/Response 隐私、内容安全和反馈回流。

这些都应进入血缘和评测清单，而不是只记录一个模型权重 URI。

## 5. 一条正确的晋级路径

```text
Run 完成
→ 制品上传并校验
→ 注册不可变 Model Version
→ 生成 Evaluation Manifest
→ 与当前 Champion 比较
→ 评测策略全部通过
→ Candidate Alias 指向该版本
→ 修改部署仓库中的具体版本/Digest
→ Pull Request 审批
→ GitOps 同步
→ Shadow
→ 小流量 Canary
→ 在线分析
→ 提升 Champion 或回滚
```

注册成功不等于可以发布；发布成功也不等于模型已经证明长期有效。

## 6. 模块综合实验

完成一个小模型或规则模型的全流程：

1. 训练两个候选版本。
2. 记录代码 Commit、数据清单、参数、指标和制品。
3. 注册两个不可变模型版本。
4. 以当前版本为 Baseline，执行正确性、性能和兼容性门禁。
5. 只允许通过的版本获得 `candidate` Alias。
6. Pipeline 生成部署 PR，清单固定模型版本、镜像 Digest 和参数摘要。
7. 在测试环境加载并做 Smoke Test。
8. 复制流量做 Shadow，比较结果但不返回给用户。
9. 执行 5% → 20% → 50% Canary。
10. 注入错误率或 TTFT 回归，验证自动中止和回滚。
11. 从线上 Pod 反查完整血缘。

## 7. 模块验收

- [ ] 能区分 Backend Store、Artifact Store 和 Model Registry。
- [ ] 每个 Run 都记录代码、数据、环境和配置坐标。
- [ ] 模型制品不可覆盖，并有内容摘要。
- [ ] 生产部署不直接依赖可变 Alias。
- [ ] 评测门禁同时覆盖质量、安全、性能、兼容性和成本。
- [ ] 候选与基线使用相同数据、硬件和负载条件。
- [ ] Pipeline 步骤幂等，重试不会重复注册或重复发布。
- [ ] CI 没有直接修改生产集群的长期凭据。
- [ ] Git 保存期望状态和制品引用，不保存大模型权重。
- [ ] Shadow 对隐私、成本和副作用有明确控制。
- [ ] Canary 能按版本观测 TTFT、TPOT、错误率和完成率。
- [ ] 回滚覆盖模型、Tokenizer、Template、镜像和启动参数。
- [ ] 能从线上 Revision 反查完整证据链。

## 8. 官方资料

- [MLflow Tracking](https://mlflow.org/docs/latest/tracking/)
- [MLflow Model Registry Workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/)
- [MLflow Artifact Store](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/)
- [Argo Workflows DAG](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/)
- [Argo CD Automated Sync](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
- [Argo Rollouts Analysis](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/)
- [KServe](https://kserve.github.io/website/)
