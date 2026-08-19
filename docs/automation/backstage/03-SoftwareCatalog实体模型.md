---
title: "Backstage Software Catalog 实体模型"
sidebar_label: "03. Software Catalog 实体模型"
sidebar_position: 3
description: "掌握 Entity Envelope、Kind、Metadata、Spec、Component、System、API、Resource、Group 和 User 关系。"
tags: [Backstage, Software Catalog, Entity, Component, System]
---

# Backstage Software Catalog 实体模型

## 1. Entity Envelope

实体通常包含 `apiVersion`、`kind`、`metadata` 和 `spec`。唯一引用由 Kind、Namespace 和 Name 组成；显示标题可以变化，稳定名称用于关系和自动化。

## 2. 常用 Kind

| Kind | 表达什么 | 示例 |
| --- | --- | --- |
| Component | 可部署/复用的软件单元 | API 服务、网站、模型服务 |
| System | 协同实现业务能力的一组组件 | 支付系统、推理平台 |
| Domain | 更高层业务域 | 电商、风控 |
| API | 提供或消费的接口 | OpenAPI、gRPC、事件 Schema |
| Resource | 软件依赖的基础资源 | 数据库、队列、Bucket |
| Group/User | 组织和人员 | 平台组、服务 Owner |
| Location | 实体来源 | Git 文件、URL |

不要为每个 Pod 或临时实例创建 Catalog Entity；目录表达可管理的软件与平台边界，不是实时资源清单。

## 3. Owner

Owner 应映射可维护的 Group，而不是长期绑定个人。Owner 负责元数据质量、运行和生命周期，但不必自动获得所有生产权限。组织目录与权限系统可以关联，语义仍需分离。

## 4. Relation

关系表达 `partOf`、`providesApi`、`consumesApi`、`dependsOn`、`ownedBy` 等。部分关系由 Spec 派生，避免手工维护正反两边造成冲突。

## 5. Annotation 与 Label

Label 用于分类和筛选；Annotation 保存插件集成引用，如源码、CI 或 Kubernetes 标识。Annotation 值属于外部输入，插件后端必须验证，不能让实体任意指定内网 URL 或高权限资源。

## 6. 生命周期

定义 `experimental`、`production`、`deprecated` 等组织标准，并建立进入、弃用和删除流程。目录不是只添加不清理；无 Owner、来源失效和长期未更新实体要告警。

## 7. 建模验收

从一个业务系统开始，画出 Domain → System → Component → API/Resource，并能从任一组件找到 Owner、源码、文档、运行环境和依赖。
