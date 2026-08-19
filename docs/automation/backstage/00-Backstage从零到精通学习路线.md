---
title: "Backstage 从零到精通学习路线"
sidebar_label: "00. Backstage 学习路线"
sidebar_position: 0
description: "从软件目录和实体模型开始，掌握模板、TechDocs、插件、认证权限、Kubernetes 集成、搜索、运营和平台门户建设。"
tags: [Backstage, Developer Portal, Software Catalog, Platform Engineering, IDP, 学习路线]
---

# Backstage 从零到精通学习路线

Backstage 是构建内部开发者门户的平台框架。它不会自动成为“所有系统的真相来源”：软件目录聚合组件、Owner、系统和资源的元数据，真正的源码、CI、制品、运行状态和权限仍由各自系统负责。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [定位、架构与请求路径](./01-定位架构与请求路径.md) | 解释前后端、插件和集成关系 |
| 2 | [部署、配置、数据库与高可用](./02-部署配置数据库与高可用.md) | 运营生产 Backstage |
| 3 | [Software Catalog 实体模型](./03-SoftwareCatalog实体模型.md) | 建立 Component/System/API/Resource 关系 |
| 4 | [Location、Provider、Processor 与目录治理](./04-Location-Provider-Processor与目录治理.md) | 自动发现和维护目录质量 |
| 5 | [Software Templates 与 Scaffolder](./05-SoftwareTemplates与Scaffolder.md) | 建立安全自助脚手架 |
| 6 | [TechDocs 文档即代码](./06-TechDocs文档即代码.md) | 让文档与组件生命周期绑定 |
| 7 | [插件架构与集成开发](./07-插件架构与集成开发.md) | 扩展前端、后端和外部 API |
| 8 | [认证、权限、RBAC 与多租户](./08-认证权限RBAC与多租户.md) | 建立身份和最小权限 |
| 9 | [Kubernetes、CI、Harbor 与可观测集成](./09-Kubernetes-CI-Harbor与可观测集成.md) | 串联平台数据而不复制真相 |
| 10 | [搜索、运营、升级与故障排查](./10-搜索运营升级与故障排查.md) | 管理规模、SLO 和版本演进 |
| 11 | [AI Infra 开发者门户综合项目](./11-AI-Infra开发者门户综合项目.md) | 建立模型服务自助交付入口 |

## 2. 掌握标准

- [ ] 能解释 Catalog Entity、Relation、Location、Provider 和 Processor。
- [ ] 每个组件有 Owner、生命周期、系统边界和源码来源。
- [ ] 模板输出经过 CI/策略评审，不直接授予高权限。
- [ ] 插件后端保护 Token，浏览器不直连敏感内网 API。
- [ ] 门户不可用不导致线上服务停止运行。
- [ ] 能量化目录新鲜度、模板成功率、搜索质量和平台采用率。

## 3. 官方资料

- [Backstage Documentation](https://backstage.io/docs/overview/what-is-backstage/)
- [Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Software Templates](https://backstage.io/docs/features/software-templates/)
