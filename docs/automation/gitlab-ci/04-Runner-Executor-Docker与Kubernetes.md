---
title: "GitLab Runner、Executor、Docker 与 Kubernetes"
sidebar_label: "04. Runner 与 Executor"
sidebar_position: 4
description: "部署和隔离 Runner，选择 Shell、Docker、Kubernetes Executor，并治理 Tag、并发、镜像和缓存。"
tags: [GitLab Runner, Executor, Docker, Kubernetes]
---

# GitLab Runner、Executor、Docker 与 Kubernetes

## 1. Executor

| Executor | 优点 | 风险 |
| --- | --- | --- |
| Shell | 简单、硬件访问直接 | 宿主污染、隔离弱 |
| Docker | 环境一致 | Socket/Privileged 风险 |
| Kubernetes | 弹性和短生命周期 | 调度、镜像、集群依赖 |

## 2. Runner 分池

按信任、资源和网络划分：外部 PR、普通构建、特权镜像构建、生产发布、GPU/硬件测试。Tag 只是调度条件，必须与实际权限控制一致。

## 3. 注册与认证

使用当前 GitLab 推荐的 Runner 创建/认证流程，Token 最小权限、可轮换，不写镜像和日志。旧注册方式随版本可能弃用，以官方文档为准。

## 4. Kubernetes

使用独立 Namespace/ServiceAccount、资源 Requests/Limits、NetworkPolicy、临时 Workspace 和按 Digest 镜像。生产凭据只进入受保护发布 Job。

## 5. Privileged

Privileged 或宿主 Socket 接近节点高权限。使用专用节点、隔离构建服务和明确审批，不与不可信任务混跑。

## 6. 运维

监控 Runner 在线、并发、Job 获取、Pod Pending、OOM、磁盘、缓存和版本兼容。升级先 Drain，再小批量替换。
