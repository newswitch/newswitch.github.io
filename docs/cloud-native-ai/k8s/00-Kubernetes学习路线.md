---
title: "K8s 学习路线"
sidebar_position: 0
date: 2026-07-24
categories: 云原生
tags: [Kubernetes, 学习路线]
description: 按 Part I～III 组织的 Kubernetes 学习路线。
---

# K8s 学习路线

本专栏按 **Part I · 基础架构与核心抽象 → Part II · 平台能力与生产实践 → Part III · 扩展机制与新范式** 组织。

与 [Kubernetes GPU 集群专栏](../k8s-gpu/Kubernetes-GPU集群学习路线) 可并行：本专栏打 K8s 底座，GPU 专栏侧重算力与推理。

---

## 当前进度

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| Part I · Kubernetes 架构 | **已完成** | [架构 · 本章导读](./K8s学习-PartI-Kubernetes架构/本章导读) |
| Part I · 开放接口 | **已完成** | [开放接口 · 本章导读](./K8s学习-PartI-开放接口/本章导读) |
| Part I · Pod | **已完成** | [Pod · 本章导读](./K8s学习-PartI-Pod/本章导读) |
| Part I · 集群资源管理 | **已完成** | [集群资源管理 · 本章导读](./K8s学习-PartI-集群资源管理/本章导读) |
| Part I · 控制器 | **已完成** | [控制器 · 本章导读](./K8s学习-PartI-控制器/本章导读) |
| Part I · 服务发现与路由 | **已完成** | [服务发现 · 本章导读](./K8s学习-PartI-服务发现与路由/本章导读) |
| Part I · 身份与权限认证 | **已完成** | [身份认证 · 本章导读](./K8s学习-PartI-身份与权限认证/本章导读) |
| Part I · 网络 | **已完成** | [网络 · 本章导读](./K8s学习-PartI-网络/本章导读) |
| Part I · 存储 | **已完成** | [存储 · 本章导读](./K8s学习-PartI-存储/本章导读) |
| Part I | **已全部完成** | 见下方各章目录 |
| Part II · 安全 | **已完成** | [安全 · 本章导读](./K8s学习-PartII-安全/本章导读) |
| Part II · 访问集群 | **已完成** | [访问集群 · 本章导读](./K8s学习-PartII-访问集群/本章导读) |
| Part II · 扩展 Kubernetes | **已完成** | [扩展 · 本章导读](./K8s学习-PartII-扩展Kubernetes/本章导读) |
| Part II · 多集群管理 | **已完成** | [多集群 · 本章导读](./K8s学习-PartII-多集群管理/本章导读) |
| Part II · 命令与调试 | **已完成** | [命令与调试 · 本章导读](./K8s学习-PartII-命令与调试/本章导读) |
| Part II · 集群运维 | **已完成** | [集群运维 · 本章导读](./K8s学习-PartII-集群运维/本章导读) |
| Part II · 部署应用 | **已完成** | [部署应用 · 本章导读](./K8s学习-PartII-部署应用/本章导读) |
| Part II · 可观测性 | **已完成** | [可观测性 · 本章导读](./K8s学习-PartII-可观测性/本章导读) |
| Part II · 开发指南 | **已完成** | [开发指南 · 本章导读](./K8s学习-PartII-开发指南/本章导读) |
| Part II · 服务网格 | **已完成** | [服务网格 · 本章导读](./K8s学习-PartII-服务网格/本章导读) |
| Part II | **已全部完成** | 见下方各章目录 |
| Part III · Serverless | **已完成** | [Serverless · 本章导读](./K8s学习-PartIII-Serverless/本章导读) |
| Part III · 边缘计算 | **已完成** | [边缘计算 · 本章导读](./K8s学习-PartIII-边缘计算/本章导读) |
| Part III · 云原生 | **已完成** | [云原生 · 本章导读](./K8s学习-PartIII-云原生/本章导读) |
| Part III · AI 原生 | **已完成** | [AI 原生 · 本章导读](./K8s学习-PartIII-AI原生/本章导读) |
| Part III | **已全部完成** | 见下方各章目录 |

---

## Part I · 基础架构与核心抽象

### Kubernetes 架构（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-Kubernetes架构/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-Kubernetes架构/概述) | 控制面 / 节点 |
| [设计理念](./K8s学习-PartI-Kubernetes架构/设计理念) | 分层与 API |
| [Etcd 解析](./K8s学习-PartI-Kubernetes架构/Etcd解析) | 存储与一致性 |
| [资源对象](./K8s学习-PartI-Kubernetes架构/资源对象) | 对象模型 |

### 开放接口（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-开放接口/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-开放接口/概述) | CRI / CNI / CSI 总览 |
| [CRI](./K8s学习-PartI-开放接口/容器运行时接口-CRI) | 容器运行时接口 |
| [CNI](./K8s学习-PartI-开放接口/容器网络接口-CNI) | 容器网络接口 |
| [CSI](./K8s学习-PartI-开放接口/容器存储接口-CSI) | 容器存储接口 |

### Pod（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-Pod/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-Pod/概述) | 什么是 Pod、单/多容器模式、资源共享 |
| [Pod 解析](./K8s学习-PartI-Pod/Pod解析) | 结构、设计理念、与控制器关系 |
| [Init 容器](./K8s学习-PartI-Pod/Init容器) | 顺序初始化、资源与排障 |
| [Pause 容器](./K8s学习-PartI-Pod/Pause容器) | Infra 容器与命名空间共享 |
| [Sidecar 容器](./K8s学习-PartI-Pod/Sidecar容器) | 边车模式与原生 Sidecar |
| [生命周期](./K8s学习-PartI-Pod/Pod生命周期) | Phase、Condition、重启策略 |
| [Pod Hook](./K8s学习-PartI-Pod/Pod-Hook) | postStart / preStop |
| [中断预算](./K8s学习-PartI-Pod/Pod中断预算) | PDB 与自愿中断 |
| [探针](./K8s学习-PartI-Pod/存活与就绪探针) | Liveness / Readiness / Startup |

### 集群资源管理（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-集群资源管理/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-集群资源管理/概述) | 机制总览 |
| [Node](./K8s学习-PartI-集群资源管理/Node) | 节点 |
| [Namespace](./K8s学习-PartI-集群资源管理/Namespace) | 命名空间 |
| [Label](./K8s学习-PartI-集群资源管理/Label) | 标签 |
| [Annotation](./K8s学习-PartI-集群资源管理/Annotation) | 注解 |
| [污点和容忍](./K8s学习-PartI-集群资源管理/污点和容忍) | Taint / Toleration |
| [垃圾收集](./K8s学习-PartI-集群资源管理/垃圾收集) | GC |
| [资源调度](./K8s学习-PartI-集群资源管理/资源调度) | 调度 |
| [服务质量等级](./K8s学习-PartI-集群资源管理/服务质量等级) | QoS |

### 控制器（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-控制器/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-控制器/概述) | 工作负载总览 |
| [Deployment](./K8s学习-PartI-控制器/Deployment) | 无状态 |
| [StatefulSet](./K8s学习-PartI-控制器/StatefulSet) | 有状态 |
| [DaemonSet](./K8s学习-PartI-控制器/DaemonSet) | 每节点一份 |
| [RC / ReplicaSet](./K8s学习-PartI-控制器/ReplicationController与ReplicaSet) | 副本控制器 |
| [Job](./K8s学习-PartI-控制器/Job) | 批处理 |
| [CronJob](./K8s学习-PartI-控制器/CronJob) | 定时任务 |
| [Ingress 控制器](./K8s学习-PartI-控制器/Ingress控制器) | 入口 |
| [HPA](./K8s学习-PartI-控制器/HPA) | 水平扩缩 |
| [准入控制器](./K8s学习-PartI-控制器/准入控制器) | Admission |

### 服务发现与路由（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-服务发现与路由/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-服务发现与路由/概述) | 总览 |
| [Service](./K8s学习-PartI-服务发现与路由/Service) | Service |
| [拓扑感知路由](./K8s学习-PartI-服务发现与路由/拓扑感知路由) | Topology Aware Routing |
| [Ingress](./K8s学习-PartI-服务发现与路由/Ingress) | Ingress |
| [Gateway API](./K8s学习-PartI-服务发现与路由/Gateway-API) | Gateway API |
| [Gateway API 推理扩展](./K8s学习-PartI-服务发现与路由/Gateway-API推理扩展) | 推理扩展 |
| [迁移到 Gateway API](./K8s学习-PartI-服务发现与路由/迁移到Gateway-API) | 从 Ingress 迁移 |

### 身份与权限认证（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-身份与权限认证/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-身份与权限认证/概述) | 总览 |
| [ServiceAccount](./K8s学习-PartI-身份与权限认证/ServiceAccount) | 服务账号 |
| [RBAC](./K8s学习-PartI-身份与权限认证/RBAC) | 基于角色的访问控制 |
| [SPIFFE](./K8s学习-PartI-身份与权限认证/SPIFFE) | 工作负载身份 |
| [SPIRE](./K8s学习-PartI-身份与权限认证/SPIRE) | SPIFFE 运行时 |

### 网络（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-网络/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-网络/概述) | 网络模型总览 |
| [Flannel](./K8s学习-PartI-网络/Flannel) | 覆盖网络 |
| [Calico](./K8s学习-PartI-网络/Calico) | 策略 / 非 Overlay |
| [Cilium](./K8s学习-PartI-网络/Cilium) | eBPF 网络 |

### 存储（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-存储/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-存储/概述) | 存储系统总览 |
| [配置与密文管理](./K8s学习-PartI-存储/配置与密文管理) | ConfigMap / Secret 总述 |
| [ConfigMap](./K8s学习-PartI-存储/ConfigMap) | 配置 |
| [Secret](./K8s学习-PartI-存储/Secret) | 密文 |
| [ConfigMap 热更新](./K8s学习-PartI-存储/ConfigMap热更新) | 热更新 |
| [Volume](./K8s学习-PartI-存储/Volume) | 卷 |
| [持久化卷](./K8s学习-PartI-存储/持久化卷) | PV / PVC |
| [Storage Class](./K8s学习-PartI-存储/StorageClass) | 动态供给 |
| [本地持久化存储](./K8s学习-PartI-存储/本地持久化存储) | Local PV |

> **Part I 已全部完成。**

---

## Part II · 平台能力与生产实践

### 安全（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartII-安全/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-安全/概述) | 安全总览 |
| [认证与鉴权](./K8s学习-PartII-安全/认证与鉴权) | Authn / Authz |
| [ValidatingWebhook](./K8s学习-PartII-安全/ValidatingWebhook) | 验证 Webhook |
| [NetworkPolicy](./K8s学习-PartII-安全/NetworkPolicy) | 网络策略 |
| [管理集群中的 TLS](./K8s学习-PartII-安全/管理集群中的TLS) | TLS |
| [Kubelet 的认证授权](./K8s学习-PartII-安全/Kubelet的认证授权) | Kubelet |
| [TLS Bootstrap](./K8s学习-PartII-安全/TLS-Bootstrap) | 节点证书引导 |
| [IP 伪装代理](./K8s学习-PartII-安全/IP伪装代理) | IP masquerade |
| [Kubeconfig 用户认证授权](./K8s学习-PartII-安全/Kubeconfig用户认证授权) | kubeconfig |
| [kubeconfig 或 token 认证](./K8s学习-PartII-安全/kubeconfig和token认证) | 认证方式 |
| [用户与身份认证](./K8s学习-PartII-安全/用户与身份认证) | 用户身份 |
| [安全最佳实践](./K8s学习-PartII-安全/Kubernetes安全最佳实践) | 最佳实践 |

### 访问集群（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartII-访问集群/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-访问集群/概述) | 访问方式总览 |
| [kubectl](./K8s学习-PartII-访问集群/kubectl命令行工具) | 命令行 |
| [集群访问方式详解](./K8s学习-PartII-访问集群/集群访问方式详解) | 方法总览 |
| [kubeconfig 与跨集群](./K8s学习-PartII-访问集群/kubeconfig与跨集群访问) | 多集群 |
| [端口转发](./K8s学习-PartII-访问集群/端口转发访问) | port-forward |
| [通过 Service 访问](./K8s学习-PartII-访问集群/通过Service访问) | Service |
| [从外部访问 Pod](./K8s学习-PartII-访问集群/从外部访问Pod) | 外部访问 |
| [k9s](./K8s学习-PartII-访问集群/k9s) | 终端 UI |
| [Devtron](./K8s学习-PartII-访问集群/Devtron) | 应用平台 |
| [Dashboard](./K8s学习-PartII-访问集群/Kubernetes-Dashboard) | Web UI |

### 扩展 Kubernetes（已完成）

可与 [k8s-gpu 专栏](../k8s-gpu/Kubernetes-GPU集群学习路线) 对照阅读 DRA / GPU 调度篇。

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-扩展Kubernetes/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-扩展Kubernetes/概述) | 扩展总览 |
| [API 扩展机制](./K8s学习-PartII-扩展Kubernetes/API扩展机制) | API Extension |
| [APIService](./K8s学习-PartII-扩展Kubernetes/APIService) | API 聚合层 |
| [CRD](./K8s学习-PartII-扩展Kubernetes/CRD) | 自定义资源定义 |
| [控制器与 Operator](./K8s学习-PartII-扩展Kubernetes/控制器与Operator模式) | Controller / Operator |
| [Kubebuilder](./K8s学习-PartII-扩展Kubernetes/Kubebuilder) | 开发脚手架 |
| [Operator SDK](./K8s学习-PartII-扩展Kubernetes/Operator-SDK) | Operator 工具链 |
| [Admission Webhook](./K8s学习-PartII-扩展Kubernetes/Admission-Webhook扩展) | 准入扩展总览 |
| [Validating Webhook](./K8s学习-PartII-扩展Kubernetes/Validating-Webhook扩展) | 验证 |
| [Mutating Webhook](./K8s学习-PartII-扩展Kubernetes/Mutating-Webhook扩展) | 变更 |
| [调度架构扩展](./K8s学习-PartII-扩展Kubernetes/调度架构扩展) | 调度扩展 |
| [Scheduler Framework](./K8s学习-PartII-扩展Kubernetes/Scheduler-Framework插件) | 调度插件 |
| [DRA](./K8s学习-PartII-扩展Kubernetes/动态资源分配-DRA) | 动态资源分配 |
| [GPU 与 AI 调度](./K8s学习-PartII-扩展Kubernetes/GPU与AI调度) | GPU / AI |

### 多集群管理（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-多集群管理/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-多集群管理/概述) | 多集群管理总览 |
| [多集群架构与 API 演进](./K8s学习-PartII-多集群管理/多集群架构与API演进) | Federation / MCS / Gateway |
| [Karmada](./K8s学习-PartII-多集群管理/Karmada) | 多集群编排 |
| [k0rdent](./K8s学习-PartII-多集群管理/k0rdent) | 多集群控制平面 |

### 命令与调试（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-命令与调试/本章导读) | 章节引言与目录 |
| [使用 kubectl](./K8s学习-PartII-命令与调试/使用kubectl) | 命令行基础 |
| [kubectl 速查表](./K8s学习-PartII-命令与调试/kubectl速查表) | 常用命令速查 |
| [调试 Kubernetes](./K8s学习-PartII-命令与调试/调试Kubernetes) | 排障流程 |

### 集群运维（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-集群运维/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-集群运维/概述) | 集群运维总览 |
| [调度与资源管理](./K8s学习-PartII-集群运维/调度与资源管理) | 调度与资源 |
| [集群生命周期管理](./K8s学习-PartII-集群运维/集群生命周期管理) | kubeadm 创建 / 升级 / 维护 |
| [版本发布管理](./K8s学习-PartII-集群运维/版本发布管理) | 版本与发布 |

### 部署应用（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-部署应用/本章导读) | 章节引言与目录 |
| [Terraform](./K8s学习-PartII-部署应用/Terraform) | IaC 管理集群与应用 |
| [Helm](./K8s学习-PartII-部署应用/Helm) | 包管理 |
| [应用开发部署流程](./K8s学习-PartII-部署应用/应用开发部署流程) | 开发与部署流程 |
| [迁移传统应用](./K8s学习-PartII-部署应用/迁移传统应用) | 以 Hadoop YARN 为例 |
| [部署有状态应用](./K8s学习-PartII-部署应用/部署有状态应用) | StatefulSet |
| [CI/CD](./K8s学习-PartII-部署应用/CI-CD) | 持续集成与交付 |
| [Kustomize](./K8s学习-PartII-部署应用/Kustomize) | 配置管理 |
| [ArgoCD](./K8s学习-PartII-部署应用/ArgoCD) | GitOps |
| [Argo Rollout](./K8s学习-PartII-部署应用/Argo-Rollout) | 渐进式交付 |
| [Volcano](./K8s学习-PartII-部署应用/Volcano) | 批处理调度 |

### 可观测性（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-可观测性/本章导读) | 章节引言与目录 |
| [概览](./K8s学习-PartII-可观测性/概览) | 可观测性总览 |
| [监控系统](./K8s学习-PartII-可观测性/监控系统) | Metrics / Prometheus |
| [Kiali](./K8s学习-PartII-可观测性/Kiali) | 服务网格观测 |
| [日志管理](./K8s学习-PartII-可观测性/日志管理) | Logging |
| [链路追踪](./K8s学习-PartII-可观测性/链路追踪) | Tracing |
| [可视化仪表板](./K8s学习-PartII-可观测性/可视化仪表板) | Dashboards |
| [告警系统](./K8s学习-PartII-可观测性/告警系统) | Alerting |
| [OpenTelemetry](./K8s学习-PartII-可观测性/OpenTelemetry) | 可观测性标准 |

### 开发指南（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-开发指南/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-开发指南/概述) | 开发总览 |
| [SIG 与工作组](./K8s学习-PartII-开发指南/SIG与工作组) | 社区组织 |
| [配置开发环境](./K8s学习-PartII-开发指南/配置开发环境) | 本地开发环境 |
| [client-go 示例](./K8s学习-PartII-开发指南/client-go示例) | 客户端库示例 |
| [client-go informer 源码分析](./K8s学习-PartII-开发指南/client-go-informer源码分析) | Informer 源码 |
| [测试指南](./K8s学习-PartII-开发指南/测试指南) | 测试 |
| [Operator](./K8s学习-PartII-开发指南/Operator) | Operator 开发 |
| [高级开发指南](./K8s学习-PartII-开发指南/高级开发指南) | 进阶 |
| [社区贡献](./K8s学习-PartII-开发指南/社区贡献) | 参与贡献 |
| [Minikube](./K8s学习-PartII-开发指南/Minikube) | 本地集群 |

### 服务网格（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-服务网格/本章导读) | 章节引言与目录 |
| [什么是服务网格](./K8s学习-PartII-服务网格/什么是服务网格) | Service Mesh 概念 |
| [什么是 Istio](./K8s学习-PartII-服务网格/什么是Istio) | Istio 简介 |
| [你是否需要 Istio](./K8s学习-PartII-服务网格/你是否需要Istio) | 选型考量 |
| [什么是 Envoy](./K8s学习-PartII-服务网格/什么是Envoy) | Envoy 代理 |
| [服务网格部署模式](./K8s学习-PartII-服务网格/服务网格部署模式) | 部署模式 |
| [Envoy 构建模块](./K8s学习-PartII-服务网格/Envoy构建模块) | Envoy 组件 |
| [HTTP 连接管理器](./K8s学习-PartII-服务网格/HTTP连接管理器) | HCM |

---

## Part III · 扩展机制与新范式

与 GPU / AI 相关内容可与 [k8s-gpu 专栏](../k8s-gpu/Kubernetes-GPU集群学习路线) 对照阅读。

### Serverless（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-Serverless/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-Serverless/概述) | Serverless 总览 |
| [Knative](./K8s学习-PartIII-Serverless/Knative) | Knative 简介 |
| [Knative Serving](./K8s学习-PartIII-Serverless/Knative-Serving) | Serving |
| [Knative Eventing](./K8s学习-PartIII-Serverless/Knative-Eventing) | Eventing |
| [Kubernetes 原生模式](./K8s学习-PartIII-Serverless/Kubernetes原生Serverless模式) | 原生模式 |
| [OpenFaaS](./K8s学习-PartIII-Serverless/OpenFaaS) | OpenFaaS |

### 边缘计算（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-边缘计算/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-边缘计算/概述) | 边缘计算总览 |
| [KubeEdge](./K8s学习-PartIII-边缘计算/KubeEdge) | 云原生边缘框架 |
| [K3s](./K8s学习-PartIII-边缘计算/K3s) | 轻量发行版 |
| [OpenYurt](./K8s学习-PartIII-边缘计算/OpenYurt) | 零侵入边缘平台 |
| [SuperEdge](./K8s学习-PartIII-边缘计算/SuperEdge) | 单集群多区域 |

### 云原生（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-云原生/本章导读) | 章节引言与目录 |
| [什么是云原生](./K8s学习-PartIII-云原生/什么是云原生) | 概念 |
| [设计哲学](./K8s学习-PartIII-云原生/云原生的设计哲学) | 设计理念 |
| [次世代应用](./K8s学习-PartIII-云原生/Kubernetes次世代云原生应用) | Post-K8s |
| [应用定义](./K8s学习-PartIII-云原生/云原生应用的定义) | 应用定义 |
| [快速入门](./K8s学习-PartIII-云原生/云原生快速入门) | 入门 |
| [CNCF](./K8s学习-PartIII-云原生/CNCF) | 基金会 |
| [社区](./K8s学习-PartIII-云原生/云原生社区) | 中国社区 |
| [角色与分工](./K8s学习-PartIII-云原生/角色与分工) | 角色 |
| [规范模型](./K8s学习-PartIII-云原生/云原生应用规范模型) | 规范 |

### AI 原生（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-AI原生/本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-AI原生/概述) | AI 原生总览 |
| [从云原生到 AI 原生](./K8s学习-PartIII-AI原生/从云原生到AI原生) | 演进 |
| [AI 基础设施](./K8s学习-PartIII-AI原生/Kubernetes-AI基础设施架构) | 基础设施 |
| [AI Gateway](./K8s学习-PartIII-AI原生/AI-Gateway) | 网关 |
| [大模型部署](./K8s学习-PartIII-AI原生/大模型部署与调优) | 部署调优 |
| [vLLM](./K8s学习-PartIII-AI原生/vLLM实践) | vLLM |
| [工作负载调度](./K8s学习-PartIII-AI原生/AI工作负载调度) | 调度 |
| [推理优化](./K8s学习-PartIII-AI原生/模型推理优化) | 推理优化 |
| [可观测性](./K8s学习-PartIII-AI原生/AI应用可观测性) | 观测 |
| [安全与最佳实践](./K8s学习-PartIII-AI原生/安全与最佳实践) | 安全 |
| [HAMi](./K8s学习-PartIII-AI原生/HAMi) | 算力虚拟化 |
| [设备插件](./K8s学习-PartIII-AI原生/设备插件) | Device Plugin |
| [AI 工作组](./K8s学习-PartIII-AI原生/AI相关工作组) | 社区 WG |

---

## 参考

- [Kubernetes 官方文档](https://kubernetes.io/zh-cn/docs/home/)
