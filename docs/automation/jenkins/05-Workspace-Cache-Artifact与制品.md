---
title: "Jenkins Workspace、Cache、Artifact 与制品"
sidebar_label: "05. Workspace、Cache 与制品"
sidebar_position: 5
description: "区分 Workspace、Stash、Cache、构建归档和外部制品仓库，建立不可变交付和保留策略。"
tags: [Jenkins, Workspace, Cache, Artifact, Harbor]
---

# Jenkins Workspace、Cache、Artifact 与制品

## 1. 区别

| 对象 | 生命周期 | 用途 |
| --- | --- | --- |
| Workspace | 单个 Agent/任务附近 | 源码和临时构建文件 |
| Stash | Pipeline 内短期 | Stage 间少量文件传递 |
| Cache | 可复用、可丢失 | 依赖和编译加速 |
| Artifact Archive | 构建记录 | 测试报告和小型证据 |
| 制品仓库 | 跨环境长期 | 包、镜像、SBOM 和签名 |

## 2. Workspace

任务不能依赖上次残留。构建前使用干净目录，结束清理但先上传所需证据。并行构建不共享可写 Workspace。

## 3. Cache

Cache Key 包含依赖锁、平台和工具链。Cache Miss 只影响速度，不能改变产物语义；不缓存 Secret 和未验证执行结果。

## 4. 制品

一次构建，多环境晋级。使用版本和 Digest，不在生产重新构建。制品关联 Commit、构建号、测试、SBOM 和签名。

## 5. 保留

构建日志、测试报告、制品和缓存使用不同保留策略。清理前保护当前生产和回滚版本。
