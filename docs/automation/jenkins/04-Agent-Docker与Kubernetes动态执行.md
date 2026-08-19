---
title: "Jenkins Agent、Docker 与 Kubernetes 动态执行"
sidebar_label: "04. Agent 与动态执行"
sidebar_position: 4
description: "设计静态、容器和 Kubernetes Agent，处理镜像、Workspace、网络、ServiceAccount、资源与缓存隔离。"
tags: [Jenkins, Agent, Docker, Kubernetes, CI]
---

# Jenkins Agent、Docker 与 Kubernetes 动态执行

## 1. Agent 选择

| 类型 | 优点 | 风险 |
| --- | --- | --- |
| 静态 VM | 稳定、适合硬件工具 | 漂移、空闲成本、残留 Workspace |
| Docker | 环境可复制 | Docker Socket 高权限、宿主隔离 |
| Kubernetes Pod | 弹性、短生命周期 | 调度、镜像拉取、集群依赖 |

## 2. Agent 镜像

固定 Digest，包含最小工具链和 CA，不在启动时下载未知最新依赖。镜像升级先测试 Pipeline 兼容。

## 3. Kubernetes

- 独立 Namespace 和 ServiceAccount。
- Requests/Limits 与节点选择明确。
- 不默认挂载高权限 Token。
- Workspace 使用临时卷；缓存和制品独立。
- GPU/特权构建使用专用节点池和审批。

## 4. Docker Socket

挂载宿主 Docker Socket 通常接近宿主 root 权限。优先隔离构建服务、Rootless/专用 Builder 或组织标准方案。

## 5. 连接与回收

监控 Agent Provision 时间、离线率、Executor 使用、Pod Pending 和残留资源。Controller/Agent 网络中断时任务结果可能未知，发布动作需要幂等确认。
