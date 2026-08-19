---
title: "GitLab CI Cache、Artifact、Package 与镜像"
sidebar_label: "05. Cache、Artifact 与制品"
sidebar_position: 5
description: "区分缓存、Job Artifact、Package Registry 和容器镜像，建立可重现构建和不可变晋级。"
tags: [GitLab CI, Cache, Artifact, Package Registry, Container Image]
---

# GitLab CI Cache、Artifact、Package 与镜像

## 1. 边界

| 对象 | 是否可丢失 | 用途 |
| --- | --- | --- |
| Cache | 是 | 依赖/编译加速 |
| Job Artifact | 按保留期 | 阶段传递、报告、证据 |
| Package/Harbor | 否，按发布策略 | 可交付制品 |

## 2. Cache Key

包含锁文件、平台、工具链和架构。Cache 命中不应改变构建语义。避免不同信任分支共享可执行缓存造成投毒。

## 3. Artifact

只上传必要路径，设置大小和保留期。报告与生产制品分开；Artifact 可能包含源码、日志和 Secret，下载权限需控制。

## 4. 镜像

构建一次，记录 Digest、SBOM、扫描和签名。环境晋级引用同一 Digest，不用 `latest` 或重新构建同一版本。

## 5. 依赖代理/仓库

代理缓存提高稳定性但仍要校验来源和 Hash。缓存故障应降低速度，不应悄悄切换不可信公网源。

## 6. 清理

保留当前生产、灾备和回滚版本；清理规则先做预览并按引用保护。
