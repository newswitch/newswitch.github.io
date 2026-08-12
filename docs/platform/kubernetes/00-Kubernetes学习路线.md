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

与 [Kubernetes GPU 集群专栏](../gpu-cluster/00-Kubernetes-GPU集群学习路线.md) 可并行：本专栏打 K8s 底座，GPU 专栏侧重算力与推理。

学习原理章节的同时，建议使用新增的 [Kubernetes 与容器命令参考库](./commands/00-Kubernetes与容器命令参考库学习路线.md)完成动手闭环。参考库包含 16 篇独立文章：前 6 篇把 `kubectl` 按 API 发现、查询、变更、Pod 调试、发布维护和权限/指标拆开，后 10 篇覆盖 Helm、Kustomize、kubeadm、etcdctl、crictl、ctr、nerdctl、Docker、Podman 工具链与 runc/OCI。原理文章解释系统为什么这样设计，命令文章负责把对象、参数、输出、安全边界和排障证据连起来。

---

## 当前进度

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| Part I · Kubernetes 架构 | **已完成** | [架构 · 本章导读](./K8s学习-PartI-Kubernetes架构/00-本章导读.md) |
| Part I · 开放接口 | **已完成** | [开放接口 · 本章导读](./K8s学习-PartI-开放接口/00-本章导读.md) |
| Part I · Pod | **已完成** | [Pod · 本章导读](./K8s学习-PartI-Pod/00-本章导读.md) |
| Part I · 集群资源管理 | **已完成** | [集群资源管理 · 本章导读](./K8s学习-PartI-集群资源管理/00-本章导读.md) |
| Part I · 控制器 | **已完成** | [控制器 · 本章导读](./K8s学习-PartI-控制器/00-本章导读.md) |
| Part I · 服务发现与路由 | **已完成** | [服务发现 · 本章导读](./K8s学习-PartI-服务发现与路由/00-本章导读.md) |
| Part I · 身份与权限认证 | **已完成** | [身份认证 · 本章导读](./K8s学习-PartI-身份与权限认证/00-本章导读.md) |
| Part I · 网络 | **已完成** | [网络 · 本章导读](./K8s学习-PartI-网络/00-本章导读.md) |
| Part I · 存储 | **已完成** | [存储 · 本章导读](./K8s学习-PartI-存储/00-本章导读.md) |
| Part I | **已全部完成** | 见下方各章目录 |
| Part II · 安全 | **已完成** | [安全 · 本章导读](./K8s学习-PartII-安全/00-本章导读.md) |
| Kubernetes 与容器命令参考库 | **已完成** | [16 篇命令与排障文章](./commands/00-Kubernetes与容器命令参考库学习路线.md) |
| Part II · 访问集群 | **已完成** | [访问集群 · 本章导读](./K8s学习-PartII-访问集群/00-本章导读.md) |
| Part II · 扩展 Kubernetes | **已完成** | [扩展 · 本章导读](./K8s学习-PartII-扩展Kubernetes/00-本章导读.md) |
| Part II · 多集群管理 | **已完成** | [多集群 · 本章导读](./K8s学习-PartII-多集群管理/00-本章导读.md) |
| Part II · 命令与调试 | **已完成** | [命令与调试 · 本章导读](./K8s学习-PartII-命令与调试/00-本章导读.md) |
| Part II · 集群运维 | **已完成** | [集群运维 · 本章导读](./K8s学习-PartII-集群运维/00-本章导读.md) |
| Part II · 部署应用 | **已完成** | [部署应用 · 本章导读](./K8s学习-PartII-部署应用/00-本章导读.md) |
| Part II · 可观测性 | **已完成** | [可观测性 · 本章导读](./K8s学习-PartII-可观测性/00-本章导读.md) |
| Part II · 开发指南 | **已完成** | [开发指南 · 本章导读](./K8s学习-PartII-开发指南/00-本章导读.md) |
| Part II · 服务网格 | **已完成** | [服务网格 · 本章导读](./K8s学习-PartII-服务网格/00-本章导读.md) |
| Part II | **已全部完成** | 见下方各章目录 |
| Part III · Serverless | **已完成** | [Serverless · 本章导读](./K8s学习-PartIII-Serverless/00-本章导读.md) |
| Part III · 边缘计算 | **已完成** | [边缘计算 · 本章导读](./K8s学习-PartIII-边缘计算/00-本章导读.md) |
| Part III · 云原生 | **已完成** | [云原生 · 本章导读](./K8s学习-PartIII-云原生/00-本章导读.md) |
| Part III · AI 原生 | **已完成** | [AI 原生 · 本章导读](./K8s学习-PartIII-AI原生/00-本章导读.md) |
| Part III | **已全部完成** | 见下方各章目录 |

---

## Part I · 基础架构与核心抽象

### Kubernetes 架构（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-Kubernetes架构/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-Kubernetes架构/01-概述.md) | 控制面 / 节点 |
| [设计理念](./K8s学习-PartI-Kubernetes架构/02-设计理念.md) | 分层与 API |
| [Etcd 解析](./K8s学习-PartI-Kubernetes架构/03-Etcd解析.md) | 存储与一致性 |
| [资源对象](./K8s学习-PartI-Kubernetes架构/04-资源对象.md) | 对象模型 |

### 开放接口（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-开放接口/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-开放接口/01-概述.md) | CRI / CNI / CSI 总览 |
| [CRI](./K8s学习-PartI-开放接口/02-容器运行时接口-CRI.md) | 容器运行时接口 |
| [CNI](./K8s学习-PartI-开放接口/03-容器网络接口-CNI.md) | 容器网络接口 |
| [CSI](./K8s学习-PartI-开放接口/04-容器存储接口-CSI.md) | 容器存储接口 |

### Pod（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-Pod/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-Pod/01-概述.md) | 什么是 Pod、单/多容器模式、资源共享 |
| [Pod 解析](./K8s学习-PartI-Pod/02-Pod解析.md) | 结构、设计理念、与控制器关系 |
| [Init 容器](./K8s学习-PartI-Pod/03-Init容器.md) | 顺序初始化、资源与排障 |
| [Pause 容器](./K8s学习-PartI-Pod/04-Pause容器.md) | Infra 容器与命名空间共享 |
| [Sidecar 容器](./K8s学习-PartI-Pod/05-Sidecar容器.md) | 边车模式与原生 Sidecar |
| [生命周期](./K8s学习-PartI-Pod/06-Pod生命周期.md) | Phase、Condition、重启策略 |
| [Pod Hook](./K8s学习-PartI-Pod/07-Pod-Hook.md) | postStart / preStop |
| [中断预算](./K8s学习-PartI-Pod/08-Pod中断预算.md) | PDB 与自愿中断 |
| [探针](./K8s学习-PartI-Pod/09-存活与就绪探针.md) | Liveness / Readiness / Startup |

### 集群资源管理（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-集群资源管理/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-集群资源管理/01-概述.md) | 机制总览 |
| [Node](./K8s学习-PartI-集群资源管理/02-Node.md) | 节点 |
| [Namespace](./K8s学习-PartI-集群资源管理/03-Namespace.md) | 命名空间 |
| [Label](./K8s学习-PartI-集群资源管理/04-Label.md) | 标签 |
| [Annotation](./K8s学习-PartI-集群资源管理/05-Annotation.md) | 注解 |
| [污点和容忍](./K8s学习-PartI-集群资源管理/06-污点和容忍.md) | Taint / Toleration |
| [垃圾收集](./K8s学习-PartI-集群资源管理/07-垃圾收集.md) | GC |
| [资源调度](./K8s学习-PartI-集群资源管理/08-资源调度.md) | 调度 |
| [服务质量等级](./K8s学习-PartI-集群资源管理/09-服务质量等级.md) | QoS |

### 控制器（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-控制器/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-控制器/01-概述.md) | 工作负载总览 |
| [Deployment](./K8s学习-PartI-控制器/02-Deployment.md) | 无状态 |
| [StatefulSet](./K8s学习-PartI-控制器/03-StatefulSet.md) | 有状态 |
| [DaemonSet](./K8s学习-PartI-控制器/04-DaemonSet.md) | 每节点一份 |
| [RC / ReplicaSet](./K8s学习-PartI-控制器/05-ReplicationController与ReplicaSet.md) | 副本控制器 |
| [Job](./K8s学习-PartI-控制器/06-Job.md) | 批处理 |
| [CronJob](./K8s学习-PartI-控制器/07-CronJob.md) | 定时任务 |
| [Ingress 控制器](./K8s学习-PartI-控制器/08-Ingress控制器.md) | 入口 |
| [HPA](./K8s学习-PartI-控制器/09-HPA.md) | 水平扩缩 |
| [准入控制器](./K8s学习-PartI-控制器/10-准入控制器.md) | Admission |

### 服务发现与路由（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-服务发现与路由/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-服务发现与路由/01-概述.md) | 总览 |
| [Service](./K8s学习-PartI-服务发现与路由/02-Service.md) | Service |
| [拓扑感知路由](./K8s学习-PartI-服务发现与路由/03-拓扑感知路由.md) | Topology Aware Routing |
| [Ingress](./K8s学习-PartI-服务发现与路由/04-Ingress.md) | Ingress |
| [Gateway API](./K8s学习-PartI-服务发现与路由/05-Gateway-API.md) | Gateway API |
| [Gateway API 推理扩展](./K8s学习-PartI-服务发现与路由/06-Gateway-API推理扩展.md) | 推理扩展 |
| [迁移到 Gateway API](./K8s学习-PartI-服务发现与路由/07-迁移到Gateway-API.md) | 从 Ingress 迁移 |

### 身份与权限认证（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-身份与权限认证/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-身份与权限认证/01-概述.md) | 总览 |
| [ServiceAccount](./K8s学习-PartI-身份与权限认证/02-ServiceAccount.md) | 服务账号 |
| [RBAC](./K8s学习-PartI-身份与权限认证/03-RBAC.md) | 基于角色的访问控制 |
| [SPIFFE](./K8s学习-PartI-身份与权限认证/04-SPIFFE.md) | 工作负载身份 |
| [SPIRE](./K8s学习-PartI-身份与权限认证/05-SPIRE.md) | SPIFFE 运行时 |

### 网络（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-网络/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-网络/01-概述.md) | 网络模型总览 |
| [Flannel](./K8s学习-PartI-网络/02-Flannel.md) | 覆盖网络 |
| [Calico](./K8s学习-PartI-网络/03-Calico.md) | 策略 / 非 Overlay |
| [Cilium](./K8s学习-PartI-网络/04-Cilium.md) | eBPF 网络 |

### 存储（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartI-存储/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartI-存储/01-概述.md) | 存储系统总览 |
| [配置与密文管理](./K8s学习-PartI-存储/02-配置与密文管理.md) | ConfigMap / Secret 总述 |
| [ConfigMap](./K8s学习-PartI-存储/03-ConfigMap.md) | 配置 |
| [Secret](./K8s学习-PartI-存储/04-Secret.md) | 密文 |
| [ConfigMap 热更新](./K8s学习-PartI-存储/05-ConfigMap热更新.md) | 热更新 |
| [Volume](./K8s学习-PartI-存储/06-Volume.md) | 卷 |
| [持久化卷](./K8s学习-PartI-存储/07-持久化卷.md) | PV / PVC |
| [Storage Class](./K8s学习-PartI-存储/08-StorageClass.md) | 动态供给 |
| [本地持久化存储](./K8s学习-PartI-存储/09-本地持久化存储.md) | Local PV |

> **Part I 已全部完成。**

---

## Part II · 平台能力与生产实践

### 安全（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartII-安全/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartII-安全/01-概述.md) | 安全总览 |
| [认证与鉴权](./K8s学习-PartII-安全/02-认证与鉴权.md) | Authn / Authz |
| [ValidatingWebhook](./K8s学习-PartII-安全/03-ValidatingWebhook.md) | 验证 Webhook |
| [NetworkPolicy](./K8s学习-PartII-安全/04-NetworkPolicy.md) | 网络策略 |
| [管理集群中的 TLS](./K8s学习-PartII-安全/05-管理集群中的TLS.md) | TLS |
| [Kubelet 的认证授权](./K8s学习-PartII-安全/06-Kubelet的认证授权.md) | Kubelet |
| [TLS Bootstrap](./K8s学习-PartII-安全/07-TLS-Bootstrap.md) | 节点证书引导 |
| [IP 伪装代理](./K8s学习-PartII-安全/08-IP伪装代理.md) | IP masquerade |
| [Kubeconfig 用户认证授权](./K8s学习-PartII-安全/09-Kubeconfig用户认证授权.md) | kubeconfig |
| [kubeconfig 或 token 认证](./K8s学习-PartII-安全/10-kubeconfig和token认证.md) | 认证方式 |
| [用户与身份认证](./K8s学习-PartII-安全/11-用户与身份认证.md) | 用户身份 |
| [安全最佳实践](./K8s学习-PartII-安全/12-Kubernetes安全最佳实践.md) | 最佳实践 |

### 访问集群（已完成）

| 篇 | 内容 |
| --- | --- |
| [本章导读](./K8s学习-PartII-访问集群/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartII-访问集群/01-概述.md) | 访问方式总览 |
| [kubectl](./K8s学习-PartII-访问集群/02-kubectl命令行工具.md) | 命令行 |
| [集群访问方式详解](./K8s学习-PartII-访问集群/03-集群访问方式详解.md) | 方法总览 |
| [kubeconfig 与跨集群](./K8s学习-PartII-访问集群/04-kubeconfig与跨集群访问.md) | 多集群 |
| [端口转发](./K8s学习-PartII-访问集群/05-端口转发访问.md) | port-forward |
| [通过 Service 访问](./K8s学习-PartII-访问集群/06-通过Service访问.md) | Service |
| [从外部访问 Pod](./K8s学习-PartII-访问集群/07-从外部访问Pod.md) | 外部访问 |
| [k9s](./K8s学习-PartII-访问集群/08-k9s.md) | 终端 UI |
| [Devtron](./K8s学习-PartII-访问集群/09-Devtron.md) | 应用平台 |
| [Dashboard](./K8s学习-PartII-访问集群/10-Kubernetes-Dashboard.md) | Web UI |

### 扩展 Kubernetes（已完成）

可与 [k8s-gpu 专栏](../gpu-cluster/00-Kubernetes-GPU集群学习路线.md) 对照阅读 DRA / GPU 调度篇。

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-扩展Kubernetes/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartII-扩展Kubernetes/01-概述.md) | 扩展总览 |
| [API 扩展机制](./K8s学习-PartII-扩展Kubernetes/02-API扩展机制.md) | API Extension |
| [APIService](./K8s学习-PartII-扩展Kubernetes/03-APIService.md) | API 聚合层 |
| [CRD](./K8s学习-PartII-扩展Kubernetes/04-CRD.md) | 自定义资源定义 |
| [控制器与 Operator](./K8s学习-PartII-扩展Kubernetes/05-控制器与Operator模式.md) | Controller / Operator |
| [Kubebuilder](./K8s学习-PartII-扩展Kubernetes/06-Kubebuilder.md) | 开发脚手架 |
| [Operator SDK](./K8s学习-PartII-扩展Kubernetes/07-Operator-SDK.md) | Operator 工具链 |
| [Admission Webhook](./K8s学习-PartII-扩展Kubernetes/08-Admission-Webhook扩展.md) | 准入扩展总览 |
| [Validating Webhook](./K8s学习-PartII-扩展Kubernetes/09-Validating-Webhook扩展.md) | 验证 |
| [Mutating Webhook](./K8s学习-PartII-扩展Kubernetes/10-Mutating-Webhook扩展.md) | 变更 |
| [调度架构扩展](./K8s学习-PartII-扩展Kubernetes/11-调度架构扩展.md) | 调度扩展 |
| [Scheduler Framework](./K8s学习-PartII-扩展Kubernetes/12-Scheduler-Framework插件.md) | 调度插件 |
| [DRA](./K8s学习-PartII-扩展Kubernetes/13-动态资源分配-DRA.md) | 动态资源分配 |
| [GPU 与 AI 调度](./K8s学习-PartII-扩展Kubernetes/14-GPU与AI调度.md) | GPU / AI |

### 多集群管理（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-多集群管理/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartII-多集群管理/01-概述.md) | 多集群管理总览 |
| [多集群架构与 API 演进](./K8s学习-PartII-多集群管理/02-多集群架构与API演进.md) | Federation / MCS / Gateway |
| [Karmada](./K8s学习-PartII-多集群管理/03-Karmada.md) | 多集群编排 |
| [k0rdent](./K8s学习-PartII-多集群管理/04-k0rdent.md) | 多集群控制平面 |

### 命令与调试（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-命令与调试/00-本章导读.md) | 章节引言与目录 |
| [使用 kubectl](./K8s学习-PartII-命令与调试/01-使用kubectl.md) | 命令行基础 |
| [kubectl 速查表](./K8s学习-PartII-命令与调试/02-kubectl速查表.md) | 常用命令速查 |
| [调试 Kubernetes](./K8s学习-PartII-命令与调试/03-调试Kubernetes.md) | 排障流程 |

### 集群运维（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-集群运维/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartII-集群运维/01-概述.md) | 集群运维总览 |
| [调度与资源管理](./K8s学习-PartII-集群运维/02-调度与资源管理.md) | 调度与资源 |
| [集群生命周期管理](./K8s学习-PartII-集群运维/03-集群生命周期管理.md) | kubeadm 创建 / 升级 / 维护 |
| [版本发布管理](./K8s学习-PartII-集群运维/04-版本发布管理.md) | 版本与发布 |

### 部署应用（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-部署应用/00-本章导读.md) | 章节引言与目录 |
| [Terraform](./K8s学习-PartII-部署应用/01-Terraform.md) | IaC 管理集群与应用 |
| [Helm](./K8s学习-PartII-部署应用/02-Helm.md) | 包管理 |
| [应用开发部署流程](./K8s学习-PartII-部署应用/03-应用开发部署流程.md) | 开发与部署流程 |
| [迁移传统应用](./K8s学习-PartII-部署应用/04-迁移传统应用.md) | 以 Hadoop YARN 为例 |
| [部署有状态应用](./K8s学习-PartII-部署应用/05-部署有状态应用.md) | StatefulSet |
| [CI/CD](./K8s学习-PartII-部署应用/06-CI-CD.md) | 持续集成与交付 |
| [Kustomize](./K8s学习-PartII-部署应用/07-Kustomize.md) | 配置管理 |
| [ArgoCD](./K8s学习-PartII-部署应用/08-ArgoCD.md) | GitOps |
| [Argo Rollout](./K8s学习-PartII-部署应用/09-Argo-Rollout.md) | 渐进式交付 |
| [Volcano](./K8s学习-PartII-部署应用/10-Volcano.md) | 批处理调度 |

### 可观测性（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-可观测性/00-本章导读.md) | 章节引言与目录 |
| [概览](./K8s学习-PartII-可观测性/01-概览.md) | 可观测性总览 |
| [监控系统](./K8s学习-PartII-可观测性/02-监控系统.md) | Metrics / Prometheus |
| [Kiali](./K8s学习-PartII-可观测性/03-Kiali.md) | 服务网格观测 |
| [日志管理](./K8s学习-PartII-可观测性/04-日志管理.md) | Logging |
| [链路追踪](./K8s学习-PartII-可观测性/05-链路追踪.md) | Tracing |
| [可视化仪表板](./K8s学习-PartII-可观测性/06-可视化仪表板.md) | Dashboards |
| [告警系统](./K8s学习-PartII-可观测性/07-告警系统.md) | Alerting |
| [OpenTelemetry](./K8s学习-PartII-可观测性/08-OpenTelemetry.md) | 可观测性标准 |

### 开发指南（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-开发指南/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartII-开发指南/01-概述.md) | 开发总览 |
| [SIG 与工作组](./K8s学习-PartII-开发指南/02-SIG与工作组.md) | 社区组织 |
| [配置开发环境](./K8s学习-PartII-开发指南/03-配置开发环境.md) | 本地开发环境 |
| [client-go 示例](./K8s学习-PartII-开发指南/04-client-go示例.md) | 客户端库示例 |
| [client-go informer 源码分析](./K8s学习-PartII-开发指南/05-client-go-informer源码分析.md) | Informer 源码 |
| [测试指南](./K8s学习-PartII-开发指南/06-测试指南.md) | 测试 |
| [Operator](./K8s学习-PartII-开发指南/07-Operator.md) | Operator 开发 |
| [高级开发指南](./K8s学习-PartII-开发指南/08-高级开发指南.md) | 进阶 |
| [社区贡献](./K8s学习-PartII-开发指南/09-社区贡献.md) | 参与贡献 |
| [Minikube](./K8s学习-PartII-开发指南/10-Minikube.md) | 本地集群 |

### 服务网格（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartII-服务网格/00-本章导读.md) | 章节引言与目录 |
| [什么是服务网格](./K8s学习-PartII-服务网格/01-什么是服务网格.md) | Service Mesh 概念 |
| [什么是 Istio](./K8s学习-PartII-服务网格/02-什么是Istio.md) | Istio 简介 |
| [你是否需要 Istio](./K8s学习-PartII-服务网格/03-你是否需要Istio.md) | 选型考量 |
| [什么是 Envoy](./K8s学习-PartII-服务网格/04-什么是Envoy.md) | Envoy 代理 |
| [服务网格部署模式](./K8s学习-PartII-服务网格/05-服务网格部署模式.md) | 部署模式 |
| [Envoy 构建模块](./K8s学习-PartII-服务网格/06-Envoy构建模块.md) | Envoy 组件 |
| [HTTP 连接管理器](./K8s学习-PartII-服务网格/07-HTTP连接管理器.md) | HCM |

---

## Part III · 扩展机制与新范式

与 GPU / AI 相关内容可与 [k8s-gpu 专栏](../gpu-cluster/00-Kubernetes-GPU集群学习路线.md) 对照阅读。

### Serverless（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-Serverless/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-Serverless/01-概述.md) | Serverless 总览 |
| [Knative](./K8s学习-PartIII-Serverless/02-Knative.md) | Knative 简介 |
| [Knative Serving](./K8s学习-PartIII-Serverless/03-Knative-Serving.md) | Serving |
| [Knative Eventing](./K8s学习-PartIII-Serverless/04-Knative-Eventing.md) | Eventing |
| [Kubernetes 原生模式](./K8s学习-PartIII-Serverless/05-Kubernetes原生Serverless模式.md) | 原生模式 |
| [OpenFaaS](./K8s学习-PartIII-Serverless/06-OpenFaaS.md) | OpenFaaS |

### 边缘计算（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-边缘计算/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-边缘计算/01-概述.md) | 边缘计算总览 |
| [KubeEdge](./K8s学习-PartIII-边缘计算/02-KubeEdge.md) | 云原生边缘框架 |
| [K3s](./K8s学习-PartIII-边缘计算/03-K3s.md) | 轻量发行版 |
| [OpenYurt](./K8s学习-PartIII-边缘计算/04-OpenYurt.md) | 零侵入边缘平台 |
| [SuperEdge](./K8s学习-PartIII-边缘计算/05-SuperEdge.md) | 单集群多区域 |

### 云原生（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-云原生/00-本章导读.md) | 章节引言与目录 |
| [什么是云原生](./K8s学习-PartIII-云原生/01-什么是云原生.md) | 概念 |
| [设计哲学](./K8s学习-PartIII-云原生/02-云原生的设计哲学.md) | 设计理念 |
| [次世代应用](./K8s学习-PartIII-云原生/03-Kubernetes次世代云原生应用.md) | Post-K8s |
| [应用定义](./K8s学习-PartIII-云原生/04-云原生应用的定义.md) | 应用定义 |
| [快速入门](./K8s学习-PartIII-云原生/05-云原生快速入门.md) | 入门 |
| [CNCF](./K8s学习-PartIII-云原生/06-CNCF.md) | 基金会 |
| [社区](./K8s学习-PartIII-云原生/07-云原生社区.md) | 中国社区 |
| [角色与分工](./K8s学习-PartIII-云原生/08-角色与分工.md) | 角色 |
| [规范模型](./K8s学习-PartIII-云原生/09-云原生应用规范模型.md) | 规范 |

### AI 原生（已完成）

| 篇 | 说明 |
| --- | --- |
| [本章导读](./K8s学习-PartIII-AI原生/00-本章导读.md) | 章节引言与目录 |
| [概述](./K8s学习-PartIII-AI原生/01-概述.md) | AI 原生总览 |
| [从云原生到 AI 原生](./K8s学习-PartIII-AI原生/02-从云原生到AI原生.md) | 演进 |
| [AI 基础设施](./K8s学习-PartIII-AI原生/03-Kubernetes-AI基础设施架构.md) | 基础设施 |
| [AI Gateway](./K8s学习-PartIII-AI原生/04-AI-Gateway.md) | 网关 |
| [大模型部署](./K8s学习-PartIII-AI原生/05-大模型部署与调优.md) | 部署调优 |
| [vLLM](./K8s学习-PartIII-AI原生/06-vLLM实践.md) | vLLM |
| [工作负载调度](./K8s学习-PartIII-AI原生/07-AI工作负载调度.md) | 调度 |
| [推理优化](./K8s学习-PartIII-AI原生/08-模型推理优化.md) | 推理优化 |
| [可观测性](./K8s学习-PartIII-AI原生/09-AI应用可观测性.md) | 观测 |
| [安全与最佳实践](./K8s学习-PartIII-AI原生/10-安全与最佳实践.md) | 安全 |
| [HAMi](./K8s学习-PartIII-AI原生/11-HAMi.md) | 算力虚拟化 |
| [设备插件](./K8s学习-PartIII-AI原生/12-设备插件.md) | Device Plugin |
| [AI 工作组](./K8s学习-PartIII-AI原生/13-AI相关工作组.md) | 社区 WG |

---

## 参考

- [Kubernetes 官方文档](https://kubernetes.io/zh-cn/docs/home/)
