---
title: "Backstage TechDocs 文档即代码"
sidebar_label: "06. TechDocs 文档即代码"
sidebar_position: 6
description: "设计文档源码、构建、发布、存储、权限、搜索和生命周期，让服务文档与组件持续关联。"
tags: [Backstage, TechDocs, Documentation as Code, MkDocs, 搜索]
---

# Backstage TechDocs 文档即代码

## 1. 文档链路

```text
组件仓库 Markdown / mkdocs 配置
→ CI 或 TechDocs Builder
→ 生成静态站点
→ 发布到对象存储
→ Backstage TechDocs 展示与搜索
```

生产推荐由受控 CI 构建发布，避免门户后端在浏览请求时执行仓库中的不可信插件或构建代码。

## 2. 文档与 Entity

Catalog Annotation 关联文档来源。组件页面显示 Owner、最后构建、源码 Commit 和文档入口。仓库移动/组件重命名时同步更新引用并建立迁移检查。

## 3. 内容结构

每个生产服务至少包含：定位和 Owner、架构/依赖、部署与配置、SLO/监控、容量、常见故障、Runbook、数据/安全边界、变更和灾备。API 参考不能替代运行文档。

## 4. 构建安全

- 固定文档工具和插件版本；
- Runner 不获得生产 Secret；
- 禁止任意网络下载和危险宏/插件；
- 输出扫描脚本和敏感内容；
- 对象存储按组件/租户限制写权限；
- 生成物包含源码 SHA 和构建证明。

## 5. 权限

内部文档可能包含拓扑和排障信息，不能默认全员公开。访问控制要与 Entity、Group 和文档存储一致；搜索索引不能泄漏无权页面摘要。

## 6. 新鲜度

在功能变更 PR 中同步修改文档；按最后更新、代码变化和运行事故建立陈旧度提示。文档 Owner 定期验证 Runbook，不能只统计页面存在。

## 7. 故障排查

页面缺失时依次检查 Entity Annotation、源码路径、构建日志、生成物、对象存储、权限和前端路由。显示旧文档则核对源码 SHA、缓存、发布 Key 和索引更新时间。
