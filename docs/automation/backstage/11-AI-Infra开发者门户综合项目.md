---
title: "Backstage AI Infra 开发者门户综合项目"
sidebar_label: "11. AI Infra 门户综合项目"
sidebar_position: 11
description: "构建面向模型服务的目录、自助模板、TechDocs、GPU 配额申请、CI、Harbor、Kubernetes 和 SLO 门户。"
tags: [Backstage, AI Infra, GPU, Developer Portal, Platform Engineering, 综合项目]
---

# Backstage AI Infra 开发者门户综合项目

## 1. 目标

开发者通过一个入口创建模型服务、找到 Owner 和文档、查看构建制品、GPU 环境、SLO 和 Runbook；高风险资源仍由受控 IaC/审批系统执行。

## 2. Catalog 模型

```text
Domain: AI Platform
→ System: Online Inference
→ Component: fraud-model-service
   ├── providesApi: fraud-inference-v1
   ├── dependsOn: model-registry / redis / gpu-pool
   └── ownedBy: risk-ml-team
```

组件 Annotation 关联源码、GitHub Actions/GitLab CI、Harbor Repository、Kubernetes Selector、Dashboard 和 TechDocs。

## 3. 自助模板

模板收集 Owner、模型框架、推理运行时、GPU 类型、资源级别和 SLO，生成：

- 代码与测试骨架；
- 固定 Digest 的容器构建流程；
- Kubernetes/Helm 与策略文件；
- Dashboard、告警和 Runbook；
- Catalog Entity 与 TechDocs；
- GPU 配额/IaC PR，而不是直接创建生产资源。

## 4. 权限

普通用户可浏览所属组件并创建开发模板；生产配额、外网入口和发布需 Environment/工单审批。Backstage 后端不保存云管理员密钥，通过 OIDC 调用受限工作流。

## 5. 组件页面

显示模型/镜像 Digest、最近 Pipeline、扫描签名、各环境 Deployment、GPU/延迟/吞吐 SLI、当前告警、依赖和 Runbook。数据异常显示来源错误与更新时间，不伪装为健康。

## 6. 故障演练

- Catalog Provider 中断，页面标记陈旧但线上服务不受影响；
- CI/Harbor API 429，插件限流并降级；
- 模板外部创建超时，使用幂等键查询而不重复资源；
- 无权团队尝试查看生产日志/运行模板，被后端拒绝；
- 门户不可用时，GitOps、监控和应急流程仍可独立运行。

## 7. 验收

交付实体模型、模板、插件、权限矩阵、SLO、容量报告、恢复演练和采用率看板。衡量从创建服务到首次合规部署时间、目录完整率和故障定位时间，而不是门户页面数量。
