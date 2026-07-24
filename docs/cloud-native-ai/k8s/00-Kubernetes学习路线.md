---
title: "K8s 学习路线"
sidebar_position: 0
date: 2026-07-24
categories: 云原生
tags: [Kubernetes, 学习路线]
description: 按 Part I～III 组织的 Kubernetes 学习路线；目录对齐 Jimmy Song《Kubernetes 教程》，已迁入章节保留转载说明。
---

# K8s 学习路线

本专栏按 **Part I · 基础架构与核心抽象 → Part II · 平台能力与生产实践 → Part III · 扩展机制与新范式** 组织，目录对齐 [Jimmy Song《Kubernetes 教程》](https://jimmysong.io/zh/book/kubernetes-handbook/)。已迁入章节正文转载自该手册（[CC BY‑NC‑SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)），文首标明出处，仅供个人非商业学习。

与 [Kubernetes GPU 集群专栏](../k8s-gpu/00-Kubernetes-GPU集群学习路线) 可并行：本专栏打 K8s 底座，GPU 专栏侧重算力与推理。

---

## 当前进度

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| Part I · Kubernetes 架构 | **已迁入手册全文** | [架构 · 本章导读](./K8s学习-PartI-Kubernetes架构/00-本章导读) |
| Part I · 开放接口 | **已迁入手册全文** | [开放接口 · 本章导读](./K8s学习-PartI-开放接口/00-本章导读) |
| Part I · Pod | **已迁入手册全文** | [Pod · 本章导读](./K8s学习-PartI-Pod/00-本章导读) |
| Part I · 集群资源管理 | **已迁入手册全文** | [集群资源管理 · 本章导读](./K8s学习-PartI-集群资源管理/00-本章导读) |
| Part I · 控制器 | **已迁入手册全文** | [控制器 · 本章导读](./K8s学习-PartI-控制器/00-本章导读) |
| Part I · 服务发现与路由 | **已迁入手册全文** | [服务发现 · 本章导读](./K8s学习-PartI-服务发现与路由/00-本章导读) |
| Part I · 身份与权限认证 | **已迁入手册全文** | [身份认证 · 本章导读](./K8s学习-PartI-身份与权限认证/00-本章导读) |
| Part I · 网络 | **已迁入手册全文** | [网络 · 本章导读](./K8s学习-PartI-网络/00-本章导读) |
| Part I · 存储 | **已迁入手册全文** | [存储 · 本章导读](./K8s学习-PartI-存储/00-本章导读) |
| Part I | **已全部迁完** | 见下方各章目录 |
| Part II · 安全 | **已迁入手册全文** | [安全 · 本章导读](./K8s学习-PartII-安全/00-本章导读) |
| Part II · 访问集群 | **已迁入手册全文** | [访问集群 · 本章导读](./K8s学习-PartII-访问集群/00-本章导读) |
| Part II · 扩展 Kubernetes | **已迁入手册全文** | [扩展 · 本章导读](./K8s学习-PartII-扩展Kubernetes/00-本章导读) |
| Part II · 多集群管理 | **已迁入手册全文** | [多集群 · 本章导读](./K8s学习-PartII-多集群管理/00-本章导读) |
| Part II · 命令与调试 | **已迁入手册全文** | [命令与调试 · 本章导读](./K8s学习-PartII-命令与调试/00-本章导读) |
| Part II · 集群运维 | **已迁入手册全文** | [集群运维 · 本章导读](./K8s学习-PartII-集群运维/00-本章导读) |
| Part II · 部署应用 | **已迁入手册全文** | [部署应用 · 本章导读](./K8s学习-PartII-部署应用/00-本章导读) |
| Part II · 可观测性 | **已迁入手册全文** | [可观测性 · 本章导读](./K8s学习-PartII-可观测性/00-本章导读) |
| Part II · 开发指南 | **已迁入手册全文** | [开发指南 · 本章导读](./K8s学习-PartII-开发指南/00-本章导读) |
| Part II · 服务网格 | **已迁入手册全文** | [服务网格 · 本章导读](./K8s学习-PartII-服务网格/00-本章导读) |
| Part II | **已全部迁完** | 见下方各章目录 |
| Part III · Serverless | **已迁入手册全文** | [Serverless · 本章导读](./K8s学习-PartIII-Serverless/00-本章导读) |
| Part III · 边缘计算 | **已迁入手册全文** | [边缘计算 · 本章导读](./K8s学习-PartIII-边缘计算/00-本章导读) |
| Part III · 云原生 | **已迁入手册全文** | [云原生 · 本章导读](./K8s学习-PartIII-云原生/00-本章导读) |
| Part III · AI 原生 | **已迁入手册全文** | [AI 原生 · 本章导读](./K8s学习-PartIII-AI原生/00-本章导读) |
| Part III | **已全部迁完** | 见下方各章目录与 [Part III 总览](./K8s学习-PartIII-扩展机制与新范式) |

---

## Part I · 基础架构与核心抽象

对照手册：[Kubernetes 教程 · Part I](https://jimmysong.io/zh/book/kubernetes-handbook/)

### Kubernetes 架构（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-Kubernetes架构/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-Kubernetes架构/01-概述) | 控制面 / 节点 |
| [设计理念](./K8s学习-PartI-Kubernetes架构/02-设计理念) | 分层与 API |
| [Etcd 解析](./K8s学习-PartI-Kubernetes架构/03-Etcd解析) | 存储与一致性 |
| [资源对象](./K8s学习-PartI-Kubernetes架构/04-资源对象) | 对象模型 |

正文转载自 [Jimmy Song《Kubernetes 教程》· Kubernetes 架构](https://jimmysong.io/zh/book/kubernetes-handbook/architecture/)，CC BY‑NC‑SA 4.0。

### 开放接口（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-开放接口/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-开放接口/01-概述) | CRI / CNI / CSI 总览 |
| [CRI](./K8s学习-PartI-开放接口/02-容器运行时接口-CRI) | 容器运行时接口 |
| [CNI](./K8s学习-PartI-开放接口/03-容器网络接口-CNI) | 容器网络接口 |
| [CSI](./K8s学习-PartI-开放接口/04-容器存储接口-CSI) | 容器存储接口 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 开放接口](https://jimmysong.io/zh/book/kubernetes-handbook/interfaces/)，CC BY‑NC‑SA 4.0。

### Pod（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-Pod/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-Pod/01-概述) | 什么是 Pod、单/多容器模式、资源共享 |
| [Pod 解析](./K8s学习-PartI-Pod/02-Pod解析) | 结构、设计理念、与控制器关系 |
| [Init 容器](./K8s学习-PartI-Pod/03-Init容器) | 顺序初始化、资源与排障 |
| [Pause 容器](./K8s学习-PartI-Pod/04-Pause容器) | Infra 容器与命名空间共享 |
| [Sidecar 容器](./K8s学习-PartI-Pod/05-Sidecar容器) | 边车模式与原生 Sidecar |
| [生命周期](./K8s学习-PartI-Pod/06-Pod生命周期) | Phase、Condition、重启策略 |
| [Pod Hook](./K8s学习-PartI-Pod/07-Pod-Hook) | postStart / preStop |
| [中断预算](./K8s学习-PartI-Pod/08-Pod中断预算) | PDB 与自愿中断 |
| [探针](./K8s学习-PartI-Pod/09-存活与就绪探针) | Liveness / Readiness / Startup |

正文转载自 [Jimmy Song《Kubernetes 教程》· Pod](https://jimmysong.io/zh/book/kubernetes-handbook/pod/)，CC BY‑NC‑SA 4.0。

### 集群资源管理（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-集群资源管理/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-集群资源管理/01-概述) | 机制总览 |
| [Node](./K8s学习-PartI-集群资源管理/02-Node) | 节点 |
| [Namespace](./K8s学习-PartI-集群资源管理/03-Namespace) | 命名空间 |
| [Label](./K8s学习-PartI-集群资源管理/04-Label) | 标签 |
| [Annotation](./K8s学习-PartI-集群资源管理/05-Annotation) | 注解 |
| [污点和容忍](./K8s学习-PartI-集群资源管理/06-污点和容忍) | Taint / Toleration |
| [垃圾收集](./K8s学习-PartI-集群资源管理/07-垃圾收集) | GC |
| [资源调度](./K8s学习-PartI-集群资源管理/08-资源调度) | 调度 |
| [服务质量等级](./K8s学习-PartI-集群资源管理/09-服务质量等级) | QoS |

正文转载自 [Jimmy Song《Kubernetes 教程》· 集群资源管理](https://jimmysong.io/zh/book/kubernetes-handbook/cluster/)，CC BY‑NC‑SA 4.0。

### 控制器（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-控制器/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-控制器/01-概述) | 工作负载总览 |
| [Deployment](./K8s学习-PartI-控制器/02-Deployment) | 无状态 |
| [StatefulSet](./K8s学习-PartI-控制器/03-StatefulSet) | 有状态 |
| [DaemonSet](./K8s学习-PartI-控制器/04-DaemonSet) | 每节点一份 |
| [RC / ReplicaSet](./K8s学习-PartI-控制器/05-ReplicationController与ReplicaSet) | 副本控制器 |
| [Job](./K8s学习-PartI-控制器/06-Job) | 批处理 |
| [CronJob](./K8s学习-PartI-控制器/07-CronJob) | 定时任务 |
| [Ingress 控制器](./K8s学习-PartI-控制器/08-Ingress控制器) | 入口 |
| [HPA](./K8s学习-PartI-控制器/09-HPA) | 水平扩缩 |
| [准入控制器](./K8s学习-PartI-控制器/10-准入控制器) | Admission |

正文转载自 [Jimmy Song《Kubernetes 教程》· 控制器](https://jimmysong.io/zh/book/kubernetes-handbook/controllers/)，CC BY‑NC‑SA 4.0。

### 服务发现与路由（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-服务发现与路由/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-服务发现与路由/01-概述) | 总览 |
| [Service](./K8s学习-PartI-服务发现与路由/02-Service) | Service |
| [拓扑感知路由](./K8s学习-PartI-服务发现与路由/03-拓扑感知路由) | Topology Aware Routing |
| [Ingress](./K8s学习-PartI-服务发现与路由/04-Ingress) | Ingress |
| [Gateway API](./K8s学习-PartI-服务发现与路由/05-Gateway-API) | Gateway API |
| [Gateway API 推理扩展](./K8s学习-PartI-服务发现与路由/06-Gateway-API推理扩展) | 推理扩展 |
| [迁移到 Gateway API](./K8s学习-PartI-服务发现与路由/07-迁移到Gateway-API) | 从 Ingress 迁移 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 服务发现与路由](https://jimmysong.io/zh/book/kubernetes-handbook/service-discovery/)，CC BY‑NC‑SA 4.0。

### 身份与权限认证（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-身份与权限认证/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-身份与权限认证/01-概述) | 总览 |
| [ServiceAccount](./K8s学习-PartI-身份与权限认证/02-ServiceAccount) | 服务账号 |
| [RBAC](./K8s学习-PartI-身份与权限认证/03-RBAC) | 基于角色的访问控制 |
| [SPIFFE](./K8s学习-PartI-身份与权限认证/04-SPIFFE) | 工作负载身份 |
| [SPIRE](./K8s学习-PartI-身份与权限认证/05-SPIRE) | SPIFFE 运行时 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 身份与权限认证](https://jimmysong.io/zh/book/kubernetes-handbook/auth/)，CC BY‑NC‑SA 4.0。

### 网络（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-网络/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-网络/01-概述) | 网络模型总览 |
| [Flannel](./K8s学习-PartI-网络/02-Flannel) | 覆盖网络 |
| [Calico](./K8s学习-PartI-网络/03-Calico) | 策略 / 非 Overlay |
| [Cilium](./K8s学习-PartI-网络/04-Cilium) | eBPF 网络 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 网络](https://jimmysong.io/zh/book/kubernetes-handbook/networking/)，CC BY‑NC‑SA 4.0。

### 存储（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-存储/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartI-存储/01-概述) | 存储系统总览 |
| [配置与密文管理](./K8s学习-PartI-存储/02-配置与密文管理) | ConfigMap / Secret 总述 |
| [ConfigMap](./K8s学习-PartI-存储/03-ConfigMap) | 配置 |
| [Secret](./K8s学习-PartI-存储/04-Secret) | 密文 |
| [ConfigMap 热更新](./K8s学习-PartI-存储/05-ConfigMap热更新) | 热更新 |
| [Volume](./K8s学习-PartI-存储/06-Volume) | 卷 |
| [持久化卷](./K8s学习-PartI-存储/07-持久化卷) | PV / PVC |
| [Storage Class](./K8s学习-PartI-存储/08-StorageClass) | 动态供给 |
| [本地持久化存储](./K8s学习-PartI-存储/09-本地持久化存储) | Local PV |

正文转载自 [Jimmy Song《Kubernetes 教程》· 存储](https://jimmysong.io/zh/book/kubernetes-handbook/storage/)，CC BY‑NC‑SA 4.0。

> **Part I 已全部迁完。**

---

## Part II · 平台能力与生产实践

对照手册：[Kubernetes 教程 · Part II](https://jimmysong.io/zh/book/kubernetes-handbook/)；总览仍见 [平台能力与生产实践](./K8s学习-PartII-平台能力与生产实践)。

### 安全（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartII-安全/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-安全/01-概述) | 安全总览 |
| [认证与鉴权](./K8s学习-PartII-安全/02-认证与鉴权) | Authn / Authz |
| [ValidatingWebhook](./K8s学习-PartII-安全/03-ValidatingWebhook) | 验证 Webhook |
| [NetworkPolicy](./K8s学习-PartII-安全/04-NetworkPolicy) | 网络策略 |
| [管理集群中的 TLS](./K8s学习-PartII-安全/05-管理集群中的TLS) | TLS |
| [Kubelet 的认证授权](./K8s学习-PartII-安全/06-Kubelet的认证授权) | Kubelet |
| [TLS Bootstrap](./K8s学习-PartII-安全/07-TLS-Bootstrap) | 节点证书引导 |
| [IP 伪装代理](./K8s学习-PartII-安全/08-IP伪装代理) | IP masquerade |
| [Kubeconfig 用户认证授权](./K8s学习-PartII-安全/09-Kubeconfig用户认证授权) | kubeconfig |
| [kubeconfig 或 token 认证](./K8s学习-PartII-安全/10-kubeconfig和token认证) | 认证方式 |
| [用户与身份认证](./K8s学习-PartII-安全/11-用户与身份认证) | 用户身份 |
| [安全最佳实践](./K8s学习-PartII-安全/12-Kubernetes安全最佳实践) | 最佳实践 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 安全](https://jimmysong.io/zh/book/kubernetes-handbook/security/)，CC BY‑NC‑SA 4.0。

### 访问集群（已迁入手册全文）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartII-访问集群/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-访问集群/01-概述) | 访问方式总览 |
| [kubectl](./K8s学习-PartII-访问集群/02-kubectl命令行工具) | 命令行 |
| [集群访问方式详解](./K8s学习-PartII-访问集群/03-集群访问方式详解) | 方法总览 |
| [kubeconfig 与跨集群](./K8s学习-PartII-访问集群/04-kubeconfig与跨集群访问) | 多集群 |
| [端口转发](./K8s学习-PartII-访问集群/05-端口转发访问) | port-forward |
| [通过 Service 访问](./K8s学习-PartII-访问集群/06-通过Service访问) | Service |
| [从外部访问 Pod](./K8s学习-PartII-访问集群/07-从外部访问Pod) | 外部访问 |
| [k9s](./K8s学习-PartII-访问集群/08-k9s) | 终端 UI |
| [Devtron](./K8s学习-PartII-访问集群/09-Devtron) | 应用平台 |
| [Dashboard](./K8s学习-PartII-访问集群/10-Kubernetes-Dashboard) | Web UI |

正文转载自 [Jimmy Song《Kubernetes 教程》· 访问集群](https://jimmysong.io/zh/book/kubernetes-handbook/access/)，CC BY‑NC‑SA 4.0。

### 扩展 Kubernetes（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-扩展Kubernetes/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-扩展Kubernetes/01-概述) | 扩展总览 |
| [API 扩展机制](./K8s学习-PartII-扩展Kubernetes/02-API扩展机制) | API Extension |
| [APIService](./K8s学习-PartII-扩展Kubernetes/03-APIService) | API 聚合层 |
| [CRD](./K8s学习-PartII-扩展Kubernetes/04-CRD) | 自定义资源定义 |
| [控制器与 Operator](./K8s学习-PartII-扩展Kubernetes/05-控制器与Operator模式) | Controller / Operator |
| [Kubebuilder](./K8s学习-PartII-扩展Kubernetes/06-Kubebuilder) | 开发脚手架 |
| [Operator SDK](./K8s学习-PartII-扩展Kubernetes/07-Operator-SDK) | Operator 工具链 |
| [Admission Webhook](./K8s学习-PartII-扩展Kubernetes/08-Admission-Webhook扩展) | 准入扩展总览 |
| [Validating Webhook](./K8s学习-PartII-扩展Kubernetes/09-Validating-Webhook扩展) | 验证 |
| [Mutating Webhook](./K8s学习-PartII-扩展Kubernetes/10-Mutating-Webhook扩展) | 变更 |
| [调度架构扩展](./K8s学习-PartII-扩展Kubernetes/11-调度架构扩展) | 调度扩展 |
| [Scheduler Framework](./K8s学习-PartII-扩展Kubernetes/12-Scheduler-Framework插件) | 调度插件 |
| [DRA](./K8s学习-PartII-扩展Kubernetes/13-动态资源分配-DRA) | 动态资源分配 |
| [GPU 与 AI 调度](./K8s学习-PartII-扩展Kubernetes/14-GPU与AI调度) | GPU / AI |

正文转载自 [Jimmy Song《Kubernetes 教程》· 扩展](https://jimmysong.io/zh/book/kubernetes-handbook/extend/)，CC BY‑NC‑SA 4.0。可与 [k8s-gpu 专栏](../k8s-gpu/00-Kubernetes-GPU集群学习路线) 对照阅读 DRA / GPU 调度篇。

### 多集群管理（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-多集群管理/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-多集群管理/01-概述) | 多集群管理总览 |
| [多集群架构与 API 演进](./K8s学习-PartII-多集群管理/02-多集群架构与API演进) | Federation / MCS / Gateway |
| [Karmada](./K8s学习-PartII-多集群管理/03-Karmada) | 多集群编排 |
| [k0rdent](./K8s学习-PartII-多集群管理/04-k0rdent) | 多集群控制平面 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 多集群](https://jimmysong.io/zh/book/kubernetes-handbook/multi-cluster/)，CC BY‑NC‑SA 4.0。

### 命令与调试（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-命令与调试/00-本章导读) | 章节引言与目录 |
| [使用 kubectl](./K8s学习-PartII-命令与调试/01-使用kubectl) | 命令行基础 |
| [kubectl 速查表](./K8s学习-PartII-命令与调试/02-kubectl速查表) | 常用命令速查 |
| [调试 Kubernetes](./K8s学习-PartII-命令与调试/03-调试Kubernetes) | 排障流程 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 命令与调试](https://jimmysong.io/zh/book/kubernetes-handbook/cli/)，CC BY‑NC‑SA 4.0。

### 集群运维（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-集群运维/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-集群运维/01-概述) | 集群运维总览 |
| [调度与资源管理](./K8s学习-PartII-集群运维/02-调度与资源管理) | 调度与资源 |
| [集群生命周期管理](./K8s学习-PartII-集群运维/03-集群生命周期管理) | kubeadm 创建 / 升级 / 维护 |
| [版本发布管理](./K8s学习-PartII-集群运维/04-版本发布管理) | 版本与发布 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 集群运维](https://jimmysong.io/zh/book/kubernetes-handbook/operation/)，CC BY‑NC‑SA 4.0。升级相关另见提纲页 [集群升级](./K8s学习-PartII-集群升级)。

### 部署应用（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-部署应用/00-本章导读) | 章节引言与目录 |
| [Terraform](./K8s学习-PartII-部署应用/01-Terraform) | IaC 管理集群与应用 |
| [Helm](./K8s学习-PartII-部署应用/02-Helm) | 包管理 |
| [应用开发部署流程](./K8s学习-PartII-部署应用/03-应用开发部署流程) | 开发与部署流程 |
| [迁移传统应用](./K8s学习-PartII-部署应用/04-迁移传统应用) | 以 Hadoop YARN 为例 |
| [部署有状态应用](./K8s学习-PartII-部署应用/05-部署有状态应用) | StatefulSet |
| [CI/CD](./K8s学习-PartII-部署应用/06-CI-CD) | 持续集成与交付 |
| [Kustomize](./K8s学习-PartII-部署应用/07-Kustomize) | 配置管理 |
| [ArgoCD](./K8s学习-PartII-部署应用/08-ArgoCD) | GitOps |
| [Argo Rollout](./K8s学习-PartII-部署应用/09-Argo-Rollout) | 渐进式交付 |
| [Volcano](./K8s学习-PartII-部署应用/10-Volcano) | 批处理调度 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 部署应用](https://jimmysong.io/zh/book/kubernetes-handbook/devops/)，CC BY‑NC‑SA 4.0。

### 可观测性（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-可观测性/00-本章导读) | 章节引言与目录 |
| [概览](./K8s学习-PartII-可观测性/01-概览) | 可观测性总览 |
| [监控系统](./K8s学习-PartII-可观测性/02-监控系统) | Metrics / Prometheus |
| [Kiali](./K8s学习-PartII-可观测性/03-Kiali) | 服务网格观测 |
| [日志管理](./K8s学习-PartII-可观测性/04-日志管理) | Logging |
| [链路追踪](./K8s学习-PartII-可观测性/05-链路追踪) | Tracing |
| [可视化仪表板](./K8s学习-PartII-可观测性/06-可视化仪表板) | Dashboards |
| [告警系统](./K8s学习-PartII-可观测性/07-告警系统) | Alerting |
| [OpenTelemetry](./K8s学习-PartII-可观测性/08-OpenTelemetry) | 可观测性标准 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 可观测性](https://jimmysong.io/zh/book/kubernetes-handbook/observability/)，CC BY‑NC‑SA 4.0。

### 开发指南（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-开发指南/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartII-开发指南/01-概述) | 开发总览 |
| [SIG 与工作组](./K8s学习-PartII-开发指南/02-SIG与工作组) | 社区组织 |
| [配置开发环境](./K8s学习-PartII-开发指南/03-配置开发环境) | 本地开发环境 |
| [client-go 示例](./K8s学习-PartII-开发指南/04-client-go示例) | 客户端库示例 |
| [client-go informer 源码分析](./K8s学习-PartII-开发指南/05-client-go-informer源码分析) | Informer 源码 |
| [测试指南](./K8s学习-PartII-开发指南/06-测试指南) | 测试 |
| [Operator](./K8s学习-PartII-开发指南/07-Operator) | Operator 开发 |
| [高级开发指南](./K8s学习-PartII-开发指南/08-高级开发指南) | 进阶 |
| [社区贡献](./K8s学习-PartII-开发指南/09-社区贡献) | 参与贡献 |
| [Minikube](./K8s学习-PartII-开发指南/10-Minikube) | 本地集群 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 开发指南](https://jimmysong.io/zh/book/kubernetes-handbook/develop/)，CC BY‑NC‑SA 4.0。

### 服务网格（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-服务网格/00-本章导读) | 章节引言与目录 |
| [什么是服务网格](./K8s学习-PartII-服务网格/01-什么是服务网格) | Service Mesh 概念 |
| [什么是 Istio](./K8s学习-PartII-服务网格/02-什么是Istio) | Istio 简介 |
| [你是否需要 Istio](./K8s学习-PartII-服务网格/03-你是否需要Istio) | 选型考量 |
| [什么是 Envoy](./K8s学习-PartII-服务网格/04-什么是Envoy) | Envoy 代理 |
| [服务网格部署模式](./K8s学习-PartII-服务网格/05-服务网格部署模式) | 部署模式 |
| [Envoy 构建模块](./K8s学习-PartII-服务网格/06-Envoy构建模块) | Envoy 组件 |
| [HTTP 连接管理器](./K8s学习-PartII-服务网格/07-HTTP连接管理器) | HCM |

正文转载自 [Jimmy Song《Kubernetes 教程》· 服务网格](https://jimmysong.io/zh/book/kubernetes-handbook/service-mesh/)，CC BY‑NC‑SA 4.0。

---

## Part III · 扩展机制与新范式

对照手册：[Kubernetes 教程 · Part III](https://jimmysong.io/zh/book/kubernetes-handbook/)；总览见 [扩展机制与新范式](./K8s学习-PartIII-扩展机制与新范式)。

与 GPU / AI 相关内容可与 [k8s-gpu 专栏](../k8s-gpu/00-Kubernetes-GPU集群学习路线) 对照阅读。

### Serverless（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-Serverless/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-Serverless/01-概述) | Serverless 总览 |
| [Knative](./K8s学习-PartIII-Serverless/02-Knative) | Knative 简介 |
| [Knative Serving](./K8s学习-PartIII-Serverless/03-Knative-Serving) | Serving |
| [Knative Eventing](./K8s学习-PartIII-Serverless/04-Knative-Eventing) | Eventing |
| [Kubernetes 原生模式](./K8s学习-PartIII-Serverless/05-Kubernetes原生Serverless模式) | 原生模式 |
| [OpenFaaS](./K8s学习-PartIII-Serverless/06-OpenFaaS) | OpenFaaS |

正文转载自 [Jimmy Song《Kubernetes 教程》· Serverless](https://jimmysong.io/zh/book/kubernetes-handbook/serverless/)，CC BY‑NC‑SA 4.0。

### 边缘计算（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-边缘计算/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-边缘计算/01-概述) | 边缘计算总览 |
| [KubeEdge](./K8s学习-PartIII-边缘计算/02-KubeEdge) | 云原生边缘框架 |
| [K3s](./K8s学习-PartIII-边缘计算/03-K3s) | 轻量发行版 |
| [OpenYurt](./K8s学习-PartIII-边缘计算/04-OpenYurt) | 零侵入边缘平台 |
| [SuperEdge](./K8s学习-PartIII-边缘计算/05-SuperEdge) | 单集群多区域 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 边缘计算](https://jimmysong.io/zh/book/kubernetes-handbook/edge-computing/)，CC BY‑NC‑SA 4.0。

### 云原生（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-云原生/00-本章导读) | 章节引言与目录 |
| [什么是云原生](./K8s学习-PartIII-云原生/01-什么是云原生) | 概念 |
| [设计哲学](./K8s学习-PartIII-云原生/02-云原生的设计哲学) | 设计理念 |
| [次世代应用](./K8s学习-PartIII-云原生/03-Kubernetes次世代云原生应用) | Post-K8s |
| [应用定义](./K8s学习-PartIII-云原生/04-云原生应用的定义) | 应用定义 |
| [快速入门](./K8s学习-PartIII-云原生/05-云原生快速入门) | 入门 |
| [CNCF](./K8s学习-PartIII-云原生/06-CNCF) | 基金会 |
| [社区](./K8s学习-PartIII-云原生/07-云原生社区) | 中国社区 |
| [角色与分工](./K8s学习-PartIII-云原生/08-角色与分工) | 角色 |
| [规范模型](./K8s学习-PartIII-云原生/09-云原生应用规范模型) | 规范 |

正文转载自 [Jimmy Song《Kubernetes 教程》· 云原生](https://jimmysong.io/zh/book/kubernetes-handbook/cloud-native/)，CC BY‑NC‑SA 4.0。

### AI 原生（已迁入手册全文）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-AI原生/00-本章导读) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-AI原生/01-概述) | AI 原生总览 |
| [从云原生到 AI 原生](./K8s学习-PartIII-AI原生/02-从云原生到AI原生) | 演进 |
| [AI 基础设施](./K8s学习-PartIII-AI原生/03-Kubernetes-AI基础设施架构) | 基础设施 |
| [AI Gateway](./K8s学习-PartIII-AI原生/04-AI-Gateway) | 网关 |
| [大模型部署](./K8s学习-PartIII-AI原生/05-大模型部署与调优) | 部署调优 |
| [vLLM](./K8s学习-PartIII-AI原生/06-vLLM实践) | vLLM |
| [工作负载调度](./K8s学习-PartIII-AI原生/07-AI工作负载调度) | 调度 |
| [推理优化](./K8s学习-PartIII-AI原生/08-模型推理优化) | 推理优化 |
| [可观测性](./K8s学习-PartIII-AI原生/09-AI应用可观测性) | 观测 |
| [安全与最佳实践](./K8s学习-PartIII-AI原生/10-安全与最佳实践) | 安全 |
| [HAMi](./K8s学习-PartIII-AI原生/11-HAMi) | 算力虚拟化 |
| [设备插件](./K8s学习-PartIII-AI原生/12-设备插件) | Device Plugin |
| [AI 工作组](./K8s学习-PartIII-AI原生/13-AI相关工作组) | 社区 WG |

正文转载自 [Jimmy Song《Kubernetes 教程》· AI 原生](https://jimmysong.io/zh/book/kubernetes-handbook/ai-native/)，CC BY‑NC‑SA 4.0。

---

## 迁入原则

1. **目录对齐手册**，按章分文件，一篇一事。  
2. **正文转载手册**（CC BY‑NC‑SA 4.0），文首标明出处与原链接。  
3. **仅供个人非商业学习**；勘误以上游为准。  

---

## 参考与致谢

- [Jimmy Song · Kubernetes 教程](https://jimmysong.io/zh/book/kubernetes-handbook/)（CC BY‑NC‑SA 4.0）  
- [Kubernetes 官方文档](https://kubernetes.io/zh-cn/docs/home/)
