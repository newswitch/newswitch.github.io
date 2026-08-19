---
title: "GitLab CI Needs、DAG、Child 与多项目流水线"
sidebar_label: "03. Needs、DAG 与子流水线"
sidebar_position: 3
description: "使用 needs 构建 DAG，设计 Matrix、Parent/Child 和多项目流水线的状态与制品边界。"
tags: [GitLab CI, DAG, needs, Child Pipeline, Multi-project]
---

# GitLab CI Needs、DAG、Child 与多项目流水线

## 1. Stage 与 DAG

Stage 提供粗粒度顺序，`needs` 表达 Job 的真实依赖，让无关任务提前运行。依赖图必须同时表达制品需求，不能只追求更快。

## 2. Matrix

平台/版本矩阵会放大 Job 数、Runner 和制品。只保留受支持组合，失败结果逐项展示，不能用一个总体成功覆盖缺失组合。

## 3. Parent/Child

适合 Monorepo 按组件生成子流水线。父流水线需要明确等待/状态传播、变量、Artifact 和取消关系。

## 4. Multi-project

跨仓库触发适合平台与应用解耦，但要固定目标 Ref/版本并限制 Token 权限。不要默认触发对方主分支的可变配置。

## 5. 取消与旧流水线

新 Commit 到来可取消可中断测试，但生产部署需要 Resource Group/版本检查，防止旧流水线晚到覆盖新版本。

## 6. 规模

监控 Pipeline 创建时间、Job 总数、关键路径、Runner 分池和下游 API 配额。巨大 YAML 拆分不能解决错误架构依赖。
