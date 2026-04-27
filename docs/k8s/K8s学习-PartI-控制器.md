---
title: "K8s 学习 · Part I：基础架构与核心抽象 之 控制器"
date: 2026-03-24 10:00:00
categories: 云原生
tags: [Kubernetes, 学习路线, 控制器, Deployment, StatefulSet, DaemonSet, Job, HPA]
---

# K8s 学习 · Part I：基础架构与核心抽象 之 控制器

## 控制器

控制器是 Kubernetes 实现自动化运维和自愈能力的核心机制，赋予集群强大的弹性与智能调度能力。

Kubernetes 中内建了多种控制器（Controller），它们是集群中的核心组件，负责监控集群的实际状态并使其向期望状态收敛。每个控制器都可以看作是一个状态机，通过控制循环（Control Loop）来管理和调节 Pod 及其他资源的生命周期。

控制器的主要职责包括：

状态监控：持续监控资源的当前状态
差异检测：比较当前状态与期望状态的差异
状态调节：执行必要的操作以消除状态差异
事件响应：对集群中的事件做出相应的反应

所有控制器都遵循相同的基本模式：

观察：通过 API Server 监听相关资源的变化
分析：分析当前状态与期望状态的差异
执行：采取行动来修正差异
重复：持续循环执行上述过程

这种设计模式确保了 Kubernetes 集群的自愈能力和声明式管理特性。

下列图示便于理解 **API 请求路径**与**准入控制链**（Admission），与控制器通过 API Server 观察、修改资源的过程相互呼应。

![Kubernetes API 请求流程](/images/K8s学习-PartI-控制器/Kubernetes API 请求流程.svg)

*图：Kubernetes API 请求流程*

![准入控制器执行顺序](/images/K8s学习-PartI-控制器/准入控制器执行顺序.svg)

*图：准入控制器执行顺序*

## Kubernetes 中的工作负载管理

Kubernetes 工作负载管理的精髓在于灵活组合控制器与生命周期机制，实现应用的弹性、可靠与智能化运维。

本文系统梳理了 Kubernetes 工作负载管理的核心概念、主要控制器、生命周期管理与最佳实践，帮助读者理解如何高效部署和维护集群中的应用工作负载。

### 核心概念

Kubernetes 工作负载管理的核心是 Pod——Kubernetes 中最小的可部署单元。但实际生产中，Pod 通常由更高层级的控制器管理，这些控制器提供了扩缩容、滚动更新、自愈等能力。

#### Pod：基础单元

Pod 是由一个或多个容器组成的组，容器间共享存储和网络资源。Pod 是所有工作负载的基础构建块。

![Pod 结构示意图](/images/K8s学习-PartI-控制器/Pod 结构示意图.svg)

*图 1: Pod 结构示意图*

#### 工作负载资源层级

Kubernetes 提供多种控制器管理 Pod，适用于不同类型的工作负载。

![工作负载资源层级关系](/images/K8s学习-PartI-控制器/工作负载资源层级关系.svg)

*图 2: 工作负载资源层级关系*

### Deployment 控制器

Deployment 提供 Pod 和 ReplicaSet 的声明式更新。用户定义期望状态，Deployment 控制器以受控速率将实际状态调整为期望状态。

#### Deployment 基础

Deployment 管理 ReplicaSet，ReplicaSet 再管理 Pod。这种所有权链条支持滚动更新和回滚等高级特性。

![Deployment 控制器结构](/images/K8s学习-PartI-控制器/Deployment 控制器结构.svg)

*图 3: Deployment 控制器结构*

#### 滚动更新流程

滚动更新时，Deployment 创建新 ReplicaSet 并逐步扩容，同时缩减旧 ReplicaSet，确保应用高可用。

![Deployment 滚动更新流程](/images/K8s学习-PartI-控制器/Deployment 滚动更新流程.svg)

*图 4: Deployment 滚动更新流程*

### StatefulSet 控制器

StatefulSet 适用于需要以下特性的应用：

稳定、唯一的网络标识
稳定的持久化存储
有序、优雅的部署与扩缩容
有序、自动的滚动更新

#### StatefulSet 结构

与 Deployment 不同，StatefulSet 为每个 Pod 保持粘性标识，提供稳定主机名和持久卷，Pod 重调度后依然保持数据和身份。

![StatefulSet 结构示意图](/images/K8s学习-PartI-控制器/StatefulSet 结构示意图.svg)

*图 5: StatefulSet 结构示意图*

#### StatefulSet 与 Deployment 对比

| 特性 | StatefulSet | Deployment |
| --- | --- | --- |
| Pod 标识 | 稳定、有序（web-0, web-1） | 随机、临时 |
| 存储 | 稳定持久存储 | 临时或共享 |
| 扩缩容 | 有序、一次一个 | 可同时扩缩多个 Pod |
| 更新 | 有序、受控 | 可同时更新多个 Pod |
| 典型场景 | 有状态应用（数据库等） | 无状态应用 |

*表 1: StatefulSet 与 Deployment 特性对比*

### Job 与 CronJob 控制器

Job 和 CronJob 创建会运行至完成的 Pod，而非长期运行。

#### Job 类型与模式

Job 可配置为不同模式：

![Job 类型与模式](/images/K8s学习-PartI-控制器/Job 类型与模式.svg)

*图 6: Job 类型与模式*

#### CronJob 定时调度

CronJob 按时间表创建 Job，类似于 Unix 的 cron 工具。

### DaemonSet 控制器

DaemonSet 确保所有（或部分）节点上都运行一份 Pod。节点加入集群时自动添加 Pod，节点移除时自动清理。

#### DaemonSet 典型场景

DaemonSet 常用于：

集群存储守护进程
节点日志收集守护进程
节点监控守护进程

![DaemonSet 结构示意图](/images/K8s学习-PartI-控制器/DaemonSet 结构示意图.svg)

*图 7: DaemonSet 结构示意图*

### ReplicaSet 控制器

ReplicaSet 用于维持指定数量的 Pod 副本，保证应用高可用。通常由 Deployment 管理，实现滚动更新和回滚。

#### ReplicaSet 与 Deployment 关系

![Deployment 与 ReplicaSet 关系](/images/K8s学习-PartI-控制器/Deployment 与 ReplicaSet 关系.svg)

*图 8: Deployment 与 ReplicaSet 关系*

### 工作负载生命周期管理

高效的工作负载管理需理解 Pod 生命周期、健康检查与中断管理。

#### Pod 生命周期

Pod 遵循明确的生命周期，从创建到终止经历多个阶段。

![Pod 生命周期状态图](/images/K8s学习-PartI-控制器/Pod 生命周期状态图.svg)

*图 9: Pod 生命周期状态图*

#### 容器探针

Kubernetes 提供多种探针检测容器健康：

| 探针类型 | 作用 | 失败时动作 |
| --- | --- | --- |
| Liveness Probe | 检测容器是否存活 | 重启容器 |
| Readiness Probe | 检测容器是否可对外服务 | 从服务端点移除 |
| Startup Probe | 检测应用是否已启动 | 延迟存活/就绪检查 |

*表 2: 容器探针类型说明*

#### 水平 Pod 自动扩缩容

Horizontal Pod Autoscaler（HPA）可根据 CPU 或自定义指标自动扩缩 Deployment、ReplicaSet 或 StatefulSet 的 Pod 数量。

![HPA 自动扩缩容流程](/images/K8s学习-PartI-控制器/HPA 自动扩缩容流程.svg)

*图 10: HPA 自动扩缩容流程*

### 高级工作负载模式

#### Init 容器与 Sidecar 容器

Init 容器在主容器启动前依次运行并完成。Sidecar 容器与主容器并行运行，提供辅助功能。

![Pod 启动与 Sidecar 容器结构](/images/K8s学习-PartI-控制器/Pod 启动与 Sidecar 容器结构.svg)

*图 11: Pod 启动与 Sidecar 容器结构*

#### Pod 中断管理

Pod Disruption Budget（PDB）限制应用可同时中断的 Pod 数，保障高可用。

![Pod Disruption Budget 示意图](/images/K8s学习-PartI-控制器/Pod Disruption Budget 示意图.svg)

*图 12: Pod Disruption Budget 示意图*

### 最佳实践

#### 资源管理

始终为容器指定资源请求与限制，确保合理调度，防止资源争用。

#### 高可用配置

对于关键工作负载，建议：

使用多副本 Deployment
配置 Pod Disruption Budget
配置 Liveness/Readiness 探针
使用 Pod 反亲和性分布副本
跨可用区部署实现地理冗余

#### 扩缩容策略

| 扩缩容类型 | 控制器 | 适用场景 |
| --- | --- | --- |
| 水平扩缩容 | HorizontalPodAutoscaler | 无状态应用、负载波动 |
| 垂直扩缩容 | VerticalPodAutoscaler | 不能水平扩展的应用 |
| 集群扩缩容 | Cluster Autoscaler | 整体集群容量自动管理 |

*表 3: Kubernetes 扩缩容类型与场景*

#### Pod 生命周期管理

配置合适的启动、存活、就绪探针
设置 terminationGracePeriodSeconds 实现优雅关闭
应用需正确处理终止信号
使用 Init 容器处理依赖与启动需求
利用 preStop 钩子做清理操作

#### 工作负载控制器选择指南

根据应用需求选择合适的控制器：

![工作负载控制器选择流程](/images/K8s学习-PartI-控制器/工作负载控制器选择流程.svg)

*图 13: 工作负载控制器选择流程*

该流程图有助于根据实际需求选择最合适的工作负载控制器。

### 总结

Kubernetes 工作负载管理体系为应用的部署、扩缩容、高可用和生命周期管理提供了强大支撑。理解各类控制器的适用场景与特性，合理配置探针、资源和中断预算，是保障集群稳定与业务连续性的关键。通过最佳实践，用户可实现高效、自动化的工作负载运维管理。

## Deployment

Deployment 控制器为 Kubernetes 无状态应用提供了声明式部署、弹性伸缩与高可用保障，是现代云原生架构的核心基石。

### 概述

Deployment 为 Pod 和 ReplicaSet 提供了声明式定义（declarative）方法，用来替代以前的 ReplicationController 来方便地管理应用。它是 Kubernetes 中管理无状态应用的核心控制器。

### 主要功能

Deployment 支持多种核心功能，便于高效管理应用生命周期：

创建管理：定义 Deployment 来创建 Pod 和 ReplicaSet
滚动更新：支持应用的滚动升级和回滚
弹性伸缩：支持应用的扩容和缩容
暂停控制：可以暂停和继续 Deployment 的部署过程

### 快速示例

以下是一个简单的 nginx 应用 Deployment 配置示例：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.20
        ports:
        - containerPort: 80
```

### 常用操作命令

常见的 Deployment 运维命令如下：

```bash
# 扩容应用
kubectl scale deployment nginx-deployment --replicas 10

# 设置自动扩缩容
kubectl autoscale deployment nginx-deployment --min=10 --max=15 --cpu-percent=80

# 更新镜像
kubectl set image deployment/nginx-deployment nginx=nginx:1.21

# 回滚到上一版本
kubectl rollout undo deployment/nginx-deployment
```

### 架构图解

下图展示了 Deployment 控制器的核心架构与资源关系。

![Deployment 控制器结构](/images/K8s学习-PartI-控制器/Deployment 控制器结构.svg)

*图 1: Kubernetes Deployment Cheatsheet（架构与资源关系）*

### 核心概念

Deployment 通过声明式更新能力，自动管理 Pod 和 ReplicaSet 的生命周期。只需描述期望的目标状态，Deployment Controller 会自动驱动实际状态向目标状态收敛。

| 场景 | 说明 |
| --- | --- |
| 应用部署 | 创建 ReplicaSet，后台自动创建 Pod |
| 滚动更新 | 更新 PodTemplateSpec 触发新版本部署 |
| 版本回滚 | 回滚到历史稳定版本 |
| 应用扩缩容 | 动态调整副本数以应对负载变化 |
| 部署控制 | 支持暂停、恢复、批量修改 |
| 状态监控 | 监控部署进度与健康状态 |
| 历史清理 | 清理旧 ReplicaSet，节省资源 |

*表 1: Deployment 典型应用场景*

注意：不要手动管理由 Deployment 创建的 ReplicaSet，否则会与 Deployment Controller 产生冲突。

### 创建 Deployment

#### 基本创建

使用 kubectl 创建 Deployment：

```bash
kubectl create -f nginx-deployment.yaml --record
```

`--record` 参数可记录变更历史，便于后续回滚和审计。

#### 查看状态

创建后可通过以下命令查看 Deployment 状态：

```bash
kubectl get deployments
kubectl get rs
kubectl get pods --show-labels
```

Deployment 状态字段说明：

| 字段 | 含义 |
| --- | --- |
| DESIRED | 期望副本数（.spec.replicas） |
| CURRENT | 当前副本数（.status.replicas） |
| UP-TO-DATE | 最新副本数（.status.updatedReplicas） |
| AVAILABLE | 可用副本数（.status.availableReplicas） |

*表 2: Deployment 状态字段说明*

#### 查看关联资源

查看 ReplicaSet：

```bash
kubectl get rs
```

```text
NAME                          DESIRED   CURRENT   READY   AGE
nginx-deployment-2035384211   3         3         3       18s
```

查看 Pod：

```bash
kubectl get pods --show-labels
```

```text
NAME                                READY   STATUS    RESTARTS   AGE   LABELS
nginx-deployment-2035384211-7ci7o   1/1     Running   0          18s   app=nginx,pod-template-hash=2035384211
nginx-deployment-2035384211-kzszj   1/1     Running   0          18s   app=nginx,pod-template-hash=2035384211
nginx-deployment-2035384211-qqcnn   1/1     Running   0          18s   app=nginx,pod-template-hash=2035384211
```

### Pod Template Hash 标签
Deployment Controller 会自动为 Pod 添加 pod-template-hash 标签，用于区分不同版本的 ReplicaSet 管理的 Pod，避免冲突。

### 更新 Deployment

#### 触发更新

只有当 Deployment 的 Pod template（.spec.template）发生变更（如标签、镜像等）时，才会触发滚动更新（rollout）。

#### 镜像更新

更新 nginx 镜像版本：

```bash
kubectl set image deployment/nginx-deployment nginx=nginx:1.21
```

或通过编辑方式：

```bash
kubectl edit deployment/nginx-deployment
```

#### 监控更新状态

查看 rollout 状态：

```bash
kubectl rollout status deployment/nginx-deployment
```

#### 滚动更新过程

Deployment 默认采用滚动更新策略，保证服务可用性：

maxUnavailable：最多有 25% 的 Pod 不可用
maxSurge：最多有 25% 的 Pod 超出期望数量

查看更新过程中的 ReplicaSet 变化：

```bash
kubectl get rs
```

```text
NAME                          DESIRED   CURRENT   READY   AGE
nginx-deployment-1564180365   3         3         3       6s
nginx-deployment-2035384211   0         0         0       36s
```

#### Rollover（并行滚动更新）
若在滚动更新过程中再次修改 Deployment，会立即创建新的 ReplicaSet，并终止之前的更新过程，确保最新变更优先生效。

#### Label Selector 更新

不建议直接修改 label selector。若必须修改，需同步更新 Pod template 的 label，避免产生孤儿 ReplicaSet。

### 版本回滚

#### 回滚场景与操作

当部署出现问题时，可通过以下命令回滚：

```bash
kubectl rollout undo deployment/nginx-deployment
kubectl rollout undo deployment/nginx-deployment --to-revision=2
```

查看历史版本：

```bash
kubectl rollout history deployment/nginx-deployment
kubectl rollout history deployment/nginx-deployment --revision=2
```

通过 `.spec.revisionHistoryLimit` 控制历史版本保留数量：

```yaml
spec:
  revisionHistoryLimit: 10
```

设置为 0 则不保留历史版本，但会失去回滚能力。

### 扩缩容操作

#### 手动扩缩容

扩容到 10 个副本：

```bash
kubectl scale deployment nginx-deployment --replicas 10
```

#### 自动扩缩容

设置基于 CPU 使用率的自动扩缩容：

```bash
kubectl autoscale deployment nginx-deployment --min=10 --max=15 --cpu-percent=80
```

删除自动扩缩容：

```bash
kubectl get hpa
kubectl delete hpa nginx-deployment
```

#### 比例扩容
滚动更新期间扩容，Deployment Controller 会按比例在新旧 ReplicaSet 之间分配新增副本，降低风险。

例如：

当前有 10 个副本，maxSurge=3，maxUnavailable=2
如果此时扩容到 15 个副本，新增的 5 个副本会按比例分配到新旧 ReplicaSet 中

### 暂停和恢复

#### 暂停 Deployment

在需要进行多次修改时，可以先暂停 Deployment：

```bash
kubectl rollout pause deployment/nginx-deployment
```

#### 进行修改

暂停期间可以进行多次修改而不触发滚动更新：

```bash
# 更新镜像
kubectl set image deployment/nginx-deployment nginx=nginx:1.21

# 更新资源限制
kubectl set resources deployment nginx-deployment -c=nginx --limits=cpu=200m,memory=512Mi
```

#### 恢复 Deployment

完成所有修改后恢复 Deployment：

```bash
kubectl rollout resume deployment/nginx-deployment
```

恢复后会一次性应用所有修改，触发一次滚动更新。

### Deployment 状态

#### 进行中（Progressing）
当 Deployment 执行以下任务之一时标记为 progressing 状态：

正在创建新的 ReplicaSet
正在扩容已有的 ReplicaSet
正在缩容已有的 ReplicaSet
有新的可用 Pod 出现

#### 完成（Complete）

当 Deployment 具备以下特性时标记为 complete 状态：

可用副本数等于或超过期望副本数
所有副本都已更新到指定版本
没有旧的 Pod 存在

检查完成状态：

```bash
kubectl rollout status deployment/nginx-deployment
echo $?  # 返回 0 表示成功
```

示例输出：

```text
deployment "nginx-deployment" successfully rolled out
```

#### 失败（Failed）
Deployment 可能因为以下原因失败：

无效的镜像引用
健康检查失败
镜像拉取错误
权限不足
资源限制
应用配置错误
进度超时

设置进度超时时间：

```bash
kubectl patch deployment/nginx-deployment -p '{"spec":{"progressDeadlineSeconds":600}}'
```

超时后会在 Deployment 状态中添加 Reason=ProgressDeadlineExceeded 的条件。

### 高级用例

#### 金丝雀发布

通过多个 Deployment 实现金丝雀发布：

```yaml
# 稳定版本
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-stable
spec:
  replicas: 9
  selector:
    matchLabels:
      app: nginx
      version: stable
  template:
    metadata:
      labels:
        app: nginx
        version: stable
    spec:
      containers:
      - name: nginx
        image: nginx:1.20

---
# 金丝雀版本
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
      version: canary
  template:
    metadata:
      labels:
        app: nginx
        version: canary
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
```

### Deployment Spec 详解

#### 必需字段

.spec.template：Pod 模板，唯一必需字段，结构与 Pod 相同但无需 apiVersion 和 kind，需指定标签和重启策略

#### 可选字段

.spec.replicas：期望 Pod 数量，默认 1
.spec.selector：label selector，必须与模板标签匹配
.spec.strategy：更新策略，支持 Recreate 和 RollingUpdate
maxUnavailable、maxSurge：滚动更新参数
progressDeadlineSeconds、minReadySeconds、revisionHistoryLimit、paused 等高级配置

完整配置示例：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.20
        ports:
        - containerPort: 80
        resources:
          limits:
            cpu: 100m
            memory: 128Mi
          requests:
            cpu: 50m
            memory: 64Mi
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 25%
      maxSurge: 25%
  progressDeadlineSeconds: 600
  minReadySeconds: 5
  revisionHistoryLimit: 10
```

### 最佳实践

为 Deployment 和 Pod 设置清晰、语义化的标签，避免选择器冲突
合理配置 CPU、内存 requests/limits，设置健康检查
使用 --record 参数记录变更历史，合理设置 revisionHistoryLimit
监控 Deployment 状态，建立自动告警和健康检查机制

### 总结

Deployment 控制器为 Kubernetes 提供了声明式、自动化的无状态应用管理能力。通过合理配置和最佳实践，可实现高可用、弹性伸缩、平滑升级与快速回滚，助力云原生架构的持续演进。

StatefulSet
StatefulSet 控制器为 Kubernetes 有状态应用提供了稳定标识、持久存储和有序部署，是数据库、消息队列等关键服务高可用的基础保障。

StatefulSet 是 Kubernetes 中专门用于管理有状态应用的控制器。与 Deployment 和 ReplicaSet 为无状态服务设计不同，StatefulSet 为 Pod 提供唯一标识，并保证部署和扩缩容的有序性。

应用场景
StatefulSet 主要解决有状态服务的问题，其典型应用场景包括：

稳定的持久化存储：Pod 重新调度后仍能访问相同的持久化数据，基于 PVC 实现
稳定的网络标识：Pod 重新调度后 PodName 和 HostName 保持不变，基于 Headless Service 实现
有序部署和扩展：Pod 按照定义的顺序依次部署（从 0 到 N-1），下一个 Pod 运行前所有之前的 Pod 必须处于 Running 和 Ready 状态
有序收缩和删除：按照从 N-1 到 0 的顺序进行
有序滚动更新：支持分段更新和金丝雀发布
核心组件
StatefulSet 由以下几个关键部分组成：

Headless Service：用于定义网络标识的 DNS 域
volumeClaimTemplates：用于创建 PersistentVolumes 的模板
StatefulSet 规约：定义具体应用的配置
DNS 命名规则
StatefulSet 中每个 Pod 的 DNS 格式如下，便于集群内服务发现和通信：

`<statefulSetName>-<ordinal>.<serviceName>.<namespace>.svc.cluster.local`

其中：

statefulSetName：StatefulSet 的名称
ordinal：Pod 的序号（从 0 开始）
serviceName：Headless Service 的名称
namespace：所在的命名空间
cluster.local：集群域名
适用条件
StatefulSet 适用于具有以下一个或多个需求的应用：

稳定且唯一的网络标识
稳定的持久化存储
有序的部署和扩缩容
有序的删除和终止
有序的自动滚动更新
如果应用不需要稳定的标识符或有序部署，建议使用 Deployment 或 ReplicaSet。

使用限制
给定 Pod 的存储必须由 PersistentVolume Provisioner 根据 storage class 配置，或由管理员预先配置
删除或缩容 StatefulSet 不会删除相关联的存储卷，需要手动清理
StatefulSet 需要 Headless Service 来管理 Pod 的网络身份
不建议将 pod.Spec.TerminationGracePeriodSeconds 设置为 0，这样做不安全
基础示例
以下 YAML 示例展示了一个典型的 nginx StatefulSet 配置方式：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  ports:
  - port: 80
    name: web
  clusterIP: None
  selector:
    app: nginx
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      terminationGracePeriodSeconds: 10
      containers:
      - name: nginx
        image: nginx:1.20
        ports:
        - containerPort: 80
          name: web
        volumeMounts:
        - name: www
          mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
  - metadata:
      name: www
    spec:
      accessModes: [ "ReadWriteOnce" ]
      storageClassName: "fast-ssd"
      resources:
        requests:
          storage: 1Gi
```

Pod 身份管理
StatefulSet 通过序数和 DNS 规则为每个 Pod 提供唯一身份，便于服务发现和数据隔离。

序数标识
对于有 N 个副本的 StatefulSet，每个副本都有一个唯一的整数序数，范围在 [0,N) 之间。

稳定的网络标识
每个 Pod 的主机名遵循 $(statefulset 名称)-$(序数) 的模式。上述示例将创建名为 web-0、web-1、web-2 的 Pod。

DNS 解析示例：

集群域	Service	StatefulSet	Pod DNS	Pod 主机名
cluster.local	default/nginx	default/web	web-{0..N-1}.nginx.default.svc.cluster.local	web-{0..N-1}
表 1: StatefulSet Pod DNS 解析示例
稳定存储
Kubernetes 会为每个 VolumeClaimTemplate 创建 PersistentVolume。Pod 重新调度时，volumeMounts 会挂载对应的 PersistentVolume。需要注意的是，删除 Pod 或 StatefulSet 时，PersistentVolume 不会被自动删除。

部署和扩缩容保证
StatefulSet 在部署和扩缩容过程中，严格保证 Pod 的有序性和依赖关系。

有序创建：Pod 按 `{0..N-1}` 顺序创建和部署
有序删除：Pod 按 `{N-1..0}` 逆序终止
扩容前提：执行扩容前，所有前序 Pod 必须处于 Running 和 Ready 状态
缩容前提：终止 Pod 前，所有后续 Pod 必须完全关闭
Pod 管理策略
StatefulSet 支持两种 Pod 管理策略，适应不同业务场景。

OrderedReady（默认）
按序启动和终止 Pod，确保前一个 Pod 就绪后再启动下一个。

Parallel
并行启动和终止所有 Pod，不等待其他 Pod 状态。

```yaml
spec:
  podManagementPolicy: "Parallel"
```

更新策略
StatefulSet 支持多种更新策略，满足不同的升级需求。

OnDelete
手动删除 Pod 后才会重新创建新版本的 Pod。

```yaml
spec:
  updateStrategy:
    type: OnDelete
```

RollingUpdate（推荐）
自动滚动更新，按序数从大到小更新 Pod。

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0
```

分区更新
通过设置 partition 参数可以实现分段更新：

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 2  # 只更新序数 >= 2 的 Pod
```

实际操作示例
以下命令展示了 StatefulSet 的常用运维操作。

部署 StatefulSet
```bash
# 创建 StatefulSet
kubectl apply -f web.yaml

# 查看 Service 和 StatefulSet
kubectl get service nginx
kubectl get statefulset web

# 查看自动创建的 PVC
kubectl get pvc

# 查看 Pod 状态
kubectl get pods -l app=nginx

基本运维操作
# 扩容到 5 个副本
kubectl scale statefulset web --replicas=5

# 缩容到 3 个副本
kubectl patch statefulset web -p '{"spec":{"replicas":3}}'

# 更新镜像
kubectl patch statefulset web --type='json' \
  -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value":"nginx:1.21"}]'

# 删除 StatefulSet（保留 PVC）
kubectl delete statefulset web

# 删除 Service
kubectl delete service nginx

# 清理 PVC（可选）
kubectl delete pvc www-web-0 www-web-1 www-web-2

DNS 验证
# 创建测试 Pod 验证 DNS 解析
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- nslookup web-0.nginx.default.svc.cluster.local
```

高级示例：ZooKeeper 集群
以下 YAML 示例展示了生产级 ZooKeeper StatefulSet 的配置方式：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: zk-headless
  labels:
    app: zookeeper
spec:
  ports:
  - port: 2888
    name: server
  - port: 3888
    name: leader-election
  clusterIP: None
  selector:
    app: zookeeper
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: zk
spec:
  serviceName: zk-headless
  replicas: 3
  selector:
    matchLabels:
      app: zookeeper
  template:
    metadata:
      labels:
        app: zookeeper
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - zookeeper
            topologyKey: kubernetes.io/hostname
      containers:
      - name: zookeeper
        image: zookeeper:3.7
        ports:
        - containerPort: 2181
          name: client
        - containerPort: 2888
          name: server
        - containerPort: 3888
          name: leader-election
        env:
        - name: ZK_REPLICAS
          value: "3"
        - name: ZK_HEAP_SIZE
          value: "1G"
        - name: ZK_CLIENT_PORT
          value: "2181"
        - name: ZK_SERVER_PORT
          value: "2888"
        - name: ZK_ELECTION_PORT
          value: "3888"
        readinessProbe:
          exec:
            command:
            - sh
            - -c
            - "echo ruok | nc localhost 2181 | grep imok"
          initialDelaySeconds: 10
          timeoutSeconds: 5
        livenessProbe:
          exec:
            command:
            - sh
            - -c
            - "echo ruok | nc localhost 2181 | grep imok"
          initialDelaySeconds: 10
          timeoutSeconds: 5
        volumeMounts:
        - name: datadir
          mountPath: /data
      securityContext:
        runAsUser: 1000
        fsGroup: 1000
  volumeClaimTemplates:
  - metadata:
      name: datadir
    spec:
      accessModes: [ "ReadWriteOnce" ]
      storageClassName: "fast-ssd"
      resources:
        requests:
          storage: 10Gi
```

外部访问
对于需要从集群外部访问 StatefulSet 中特定 Pod 的场景，可以通过以下方式实现。

方法一：NodePort Service
```bash
# 为特定 Pod 添加标签
kubectl label pod zk-0 instance=zk-0
kubectl label pod zk-1 instance=zk-1

# 暴露为 NodePort 服务
kubectl expose pod zk-0 --port=2181 --target-port=2181 \
  --name=zk-0-external --selector=instance=zk-0 --type=NodePort

kubectl expose pod zk-1 --port=2181 --target-port=2181 \
  --name=zk-1-external --selector=instance=zk-1 --type=NodePort
```

方法二：LoadBalancer Service
```yaml
apiVersion: v1
kind: Service
metadata:
  name: zk-0-lb
spec:
  type: LoadBalancer
  ports:
  - port: 2181
    targetPort: 2181
  selector:
    statefulset.kubernetes.io/pod-name: zk-0
```

最佳实践
在生产环境中，建议遵循以下最佳实践以提升有状态服务的可靠性和可维护性。

资源配置：合理设置 CPU 和内存资源限制
存储选择：根据性能需求选择合适的 StorageClass
健康检查：配置适当的 readiness 和 liveness 探针
反亲和性：使用 Pod 反亲和性确保高可用性
监控告警：配置完善的监控和告警机制
备份策略：制定数据备份和恢复策略
故障排查
常见问题及解决方案如下：

Pod 启动失败：检查存储配置和资源限制
DNS 解析问题：验证 Headless Service 配置
数据丢失：确认 PVC 配置和存储类设置
更新卡住：检查 Pod 反亲和性和资源可用性
总结
StatefulSet 是 Kubernetes 管理有状态应用的核心控制器，提供稳定标识、持久存储和有序部署等能力。通过合理配置 Headless Service、PVC、Pod 管理策略和更新策略，可以高效支撑数据库、消息队列等关键业务场景。建议结合最佳实践和监控体系，持续优化有状态服务的高可用性和可维护性。

## DaemonSet
DaemonSet 控制器为 Kubernetes 提供了节点级系统服务的自动化部署能力，是集群可观测性与基础设施运维的关键保障。

### DaemonSet 概述
DaemonSet 是 Kubernetes 中的一种控制器，确保在集群中的每个（或特定）节点上运行一个 Pod 副本。当有新节点加入集群时，DaemonSet 会自动在新节点上创建 Pod；当节点从集群中移除时，对应的 Pod 也会被回收。删除 DaemonSet 时，它创建的所有 Pod 都会被删除。

### 典型使用场景
DaemonSet 适用于需要在每个节点上运行系统级服务的场景。常见用例如下：

存储服务：如在每个节点上运行分布式存储守护进程（glusterd、ceph）
日志收集：如 fluentd、filebeat、logstash 等日志代理
监控代理：如 Prometheus Node Exporter、collectd、Datadog Agent、New Relic Agent
网络组件：如 CNI 网络插件或网络代理
### DaemonSet 配置规范
DaemonSet 资源定义包含必需字段和可选字段，合理配置可满足不同节点管理需求。

#### 基本结构
apiVersion：API 版本
kind：资源类型
metadata：元数据信息
spec：规格定义
#### Pod 模板配置
.spec.template 是 DaemonSet 的核心配置，定义要创建的 Pod 模板：

Pod 模板与标准 Pod 规范相同，但不需要 apiVersion 和 kind
必须指定适当的标签以便选择器匹配
restartPolicy 必须设置为 Always（默认值）
#### Pod 选择器
.spec.selector 用于选择管理的 Pod，支持 matchLabels 和 matchExpressions 两种方式。选择器必须与 Pod 模板的标签匹配，否则 API 会拒绝创建。

#### 节点选择
可通过以下方式限制 Pod 运行的节点：

nodeSelector：基于节点标签选择
nodeAffinity：更灵活的节点亲和性规则
tolerations：容忍节点污点
如果未指定节点选择条件，DaemonSet 默认在所有节点上创建 Pod。

#### 调度机制
DaemonSet 的调度机制与普通 Pod 不同，具备如下特点：

预定调度：Pod 创建时已指定目标节点（.spec.nodeName）
绕过调度器：不依赖 kube-scheduler
容忍不可调度：忽略节点的 unschedulable 状态
集群启动友好：可在调度器启动前创建 Pod
#### 污点和容忍
DaemonSet Pod 自动添加以下容忍配置：

| 污点键 | Effect |
| --- | --- |
| node.kubernetes.io/not-ready | NoExecute |
| node.kubernetes.io/unreachable | NoExecute |
| node.kubernetes.io/disk-pressure | NoSchedule |
| node.kubernetes.io/memory-pressure | NoSchedule |
| node.kubernetes.io/unschedulable | NoSchedule |

*表 1: DaemonSet Pod 默认容忍的污点*
#### 通信模式
DaemonSet Pod 的通信模式多样，常见方式如下：

Push 模式：Pod 主动向外部服务推送数据（如监控指标）
NodeIP + 固定端口：通过 hostNetwork: true 或 hostPort，结合节点 IP 和端口访问服务
DNS 发现：通过 Headless Service 进行 DNS 查询，获取所有 Pod 的 IP
Service 负载均衡：通过普通 Service 随机访问某节点上的 Pod（无法指定特定节点）
#### 更新和维护
DaemonSet 支持多种更新与维护策略，便于系统级服务的平滑升级。

#### 滚动更新
Kubernetes 1.6+ 支持 DaemonSet 滚动更新：

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

#### 更新触发条件
以下情况会触发 DaemonSet 更新：

修改 Pod 模板规范
更改节点标签（影响节点选择）
修改选择器规则
#### 手动管理
可通过 `--cascade=orphan` 选项删除 DaemonSet 但保留 Pod，便于后续手动管理。

### 最佳实践
为 DaemonSet Pod 设置适当的资源请求和限制：

```yaml
resources:
  requests:
    memory: "64Mi"
    cpu: "250m"
  limits:
    memory: "128Mi"
    cpu: "500m"
```

配置安全上下文，特别是需要访问主机资源时：

```yaml
securityContext:
  privileged: true
  hostNetwork: true
  hostPID: true
```

配置存活探针和就绪探针，提升服务可用性：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
```

### 与其他控制器的比较
下表对比了 DaemonSet 与其他常见控制器的适用场景和特性。

| 控制器类型 | 主要特性 | 适用场景 |
| --- | --- | --- |
| DaemonSet | 每节点一个 Pod，节点覆盖 | 系统级守护进程 |
| Deployment | 指定副本数，高可用与分担 | 无状态服务 |
| StaticPod | kubelet 直接管理，配置简单 | 特殊场景、功能有限 |
| Job/CronJob | 一次性/定时任务 | 批处理、定时任务 |

*表 2: DaemonSet 与其他控制器对比*
### 总结
DaemonSet 控制器为 Kubernetes 提供了节点级服务的自动化部署能力，适用于日志收集、监控、网络等系统级场景。合理配置和管理 DaemonSet，有助于提升集群的可观测性、可维护性和基础设施弹性。


## ReplicationController 和 ReplicaSet
ReplicationController 和 ReplicaSet 是 Kubernetes 保证 Pod 副本高可用和自动恢复的核心机制，为集群提供弹性和稳定性，是现代云原生应用部署的基础。

ReplicationController 和 ReplicaSet 都是 Kubernetes 中用于管理 Pod 副本的控制器，它们确保指定数量的 Pod 副本始终在集群中运行。

### ReplicationController
ReplicationController（RC）是 Kubernetes 早期版本中用于管理 Pod 副本的控制器。它的主要功能包括：

确保容器应用的副本数始终保持在用户定义的副本数
当有 Pod 异常退出时，自动创建新的 Pod 来替代
当存在多余的 Pod 时，自动回收多出来的 Pod
### ReplicaSet
ReplicaSet（RS）是 ReplicationController 的升级版本，在新版本的 Kubernetes 中建议使用 ReplicaSet 来取代 ReplicationController。

#### 主要特性
ReplicaSet 继承了 RC 的核心能力，并在标签选择器和兼容性方面做了增强。

基本功能：与 ReplicationController 相同，管理 Pod 副本数量
增强的选择器：支持更灵活的标签选择器，包括集合式选择器
更好的兼容性：与现代 Kubernetes 特性更好地集成
#### 与 ReplicationController 的区别
下表总结了 ReplicaSet 与 ReplicationController 的主要区别，便于理解两者的演进关系。

| 特性 | ReplicationController | ReplicaSet |
| --- | --- | --- |
| 标签选择器 | 仅支持相等性选择器 | 支持集合式选择器和相等性选择器 |
| API 版本 | v1 | apps/v1 |
| 推荐使用 | 已弃用 | 推荐使用 |

*表 1: ReplicationController 与 ReplicaSet 对比*

#### 使用建议
虽然 ReplicaSet 可以独立使用，但强烈建议使用 Deployment 来自动管理 ReplicaSet，原因如下：

Deployment 提供了声明式更新功能
支持滚动更新（rolling update）
提供回滚功能
避免与其他控制器机制的兼容性问题
#### ReplicaSet 配置示例
以下 YAML 示例展示了一个典型的 ReplicaSet 配置方式：

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: frontend-rs
  labels:
    app: guestbook
    tier: frontend
spec:
  # 指定副本数量
  replicas: 3
  # 标签选择器
  selector:
    matchLabels:
      tier: frontend
    matchExpressions:
      - key: tier
        operator: In
        values: [frontend]
  # Pod 模板
  template:
    metadata:
      labels:
        app: guestbook
        tier: frontend
    spec:
      containers:
      - name: php-redis
        image: gcr.io/google_samples/gb-frontend:v3
        resources:
          requests:
            cpu: 100m
            memory: 100Mi
          limits:
            cpu: 200m
            memory: 200Mi
        env:
        - name: GET_HOSTS_FROM
          value: dns
        ports:
        - containerPort: 80
          protocol: TCP
```

### 常用操作
在日常运维中，ReplicaSet 的管理操作主要包括创建、查询、扩缩容和删除等。

#### 创建 ReplicaSet
以下命令用于创建 ReplicaSet 资源：

```bash
kubectl apply -f replicaset.yaml
```

#### 查看 ReplicaSet 状态
可以通过如下命令查看 ReplicaSet 及其 Pod 的详细状态：

```bash
kubectl get rs
kubectl describe rs frontend-rs
```

#### 扩缩容
通过如下命令调整副本数量，实现弹性伸缩：

```bash
kubectl scale rs frontend-rs --replicas=5
```

#### 删除 ReplicaSet
删除 ReplicaSet 及其关联 Pod 的命令如下：

```bash
kubectl delete rs frontend-rs
```

### 最佳实践
在生产环境中，建议遵循以下最佳实践以提升副本管理的可靠性和可维护性。

优先使用 Deployment：在生产环境中，建议使用 Deployment 而不是直接使用 ReplicaSet
合理设置资源限制：为容器设置适当的 CPU 和内存限制
使用健康检查：配置 livenessProbe 和 readinessProbe 确保 Pod 健康
标签规范：使用清晰、一致的标签命名规范
### 总结
ReplicationController 和 ReplicaSet 是 Kubernetes 保证 Pod 副本高可用的基础机制。随着 Kubernetes 的演进，ReplicaSet 已成为主流，建议结合 Deployment 进行副本管理，实现声明式升级、滚动更新和自动回滚等高级能力。合理配置资源、健康检查和标签，有助于提升集群的稳定性和运维效率。

## Job
Job 控制器让 Kubernetes 能够可靠地管理一次性批处理任务，自动完成调度、重试和清理，是实现自动化批量计算和数据处理的基础能力。

Job 是 Kubernetes 中专门用于批处理任务的控制器，负责管理仅执行一次的任务。它确保批处理任务中的一个或多个 Pod 成功完成，并在任务结束后自动清理。

### Job 工作原理
Job 控制器会持续监控 Pod 的状态，直到指定数量的 Pod 成功完成。与长期运行的服务不同，Job 适用于以下场景：

数据处理和分析任务
批量计算作业
数据库迁移
定期清理任务
### Job 规范配置
在实际使用中，合理配置 Job 资源对于任务的可靠性和资源利用率至关重要。

基本配置项
spec.template：Pod 模板，格式与 Pod 规范相同
restartPolicy：仅支持 Never 或 OnFailure
spec.completions：指定需要成功完成的 Pod 数量，默认为 1
spec.parallelism：指定并行运行的 Pod 数量，默认为 1
spec.backoffLimit：指定失败重试次数，默认为 6
spec.activeDeadlineSeconds：指定 Job 的最大运行时间，超时后终止
spec.ttlSecondsAfterFinished：指定 Job 完成后的保留时间
完整示例
以下 YAML 示例展示了一个典型 Job 的配置方式：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pi-calculation
  labels:
    app: pi-job
spec:
  completions: 3
  parallelism: 2
  backoffLimit: 4
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        app: pi-job
    spec:
      containers:
      - name: pi
        image: perl:5.34
        command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
        resources:
          limits:
            cpu: 100m
            memory: 128Mi
          requests:
            cpu: 50m
            memory: 64Mi
      restartPolicy: Never
```

创建和查看 Job 的常用命令如下：

```bash
# 创建 Job
kubectl apply -f pi-job.yaml

# 查看 Job 状态
kubectl get jobs

# 查看 Pod 状态
kubectl get pods -l app=pi-job

# 查看日志
kubectl logs -l app=pi-job
```

### Job 执行模式
Kubernetes Job 支持多种执行模式，满足不同批处理需求。

单次执行模式
completions: 1, parallelism: 1
适用于单个任务的简单执行
并行执行模式
completions: N, parallelism: M
同时运行 M 个 Pod，直到总共有 N 个 Pod 成功完成
工作队列模式
不设置 completions，设置 parallelism: N
Pod 从共享队列中获取任务，直到队列为空
### 最佳实践
在生产环境中，建议遵循以下最佳实践以提升 Job 的可靠性和可维护性。

资源管理
为 Job Pod 设置资源限制和请求
使用 ttlSecondsAfterFinished 自动清理完成的 Job
合理设置 backoffLimit 避免无限重试
错误处理
选择合适的 restartPolicy
设置 activeDeadlineSeconds 避免任务无限运行
在应用代码中实现幂等性
监控和日志
使用标签选择器管理相关 Pod
配置日志收集确保任务输出可追溯
监控 Job 的完成状态和执行时间
### 与 Bare Pod 的对比
下表对比了 Bare Pod（裸 Pod）与 Job 控制器的主要区别，帮助理解为何推荐使用 Job 管理一次性任务。

| 特性 | Bare Pod | Job |
| --- | --- | --- |
| 节点故障恢复 | ❌ 不会重新调度 | ✅ 自动创建新 Pod |
| 失败重试 | ❌ 需要手动处理 | ✅ 自动重试机制 |
| 并行执行 | ❌ 需要手动管理 | ✅ 内置并行控制 |
| 完成状态跟踪 | ❌ 需要外部监控 | ✅ 自动状态管理 |

*表 1: Bare Pod 与 Job 控制器对比*
因此，即使应用只需要运行一个 Pod，也推荐使用 Job 而不是 Bare Pod。

### 总结
Job 控制器为 Kubernetes 提供了强大的批处理能力，支持任务的自动调度、重试、并行和清理。通过合理配置和最佳实践，可以显著提升批处理任务的可靠性和资源利用率。建议在所有一次性任务场景下优先使用 Job 控制器，避免直接使用 Bare Pod。

## CronJob
CronJob 机制让 Kubernetes 能够原生支持定时任务编排，实现自动化运维、数据备份等周期性作业的高效管理。

CronJob 管理基于时间的 Job，即可以在给定时间点只运行一次，也可以周期性地在给定时间点运行。一个 CronJob 对象类似于 crontab（cron table）文件中的一行。它根据指定的预定计划周期性地运行一个 Job，格式可以参考 Cron。

### 前提条件
CronJob 自 Kubernetes v1.21 起已成为稳定版本（batch/v1），在所有受支持的 Kubernetes 版本中均可直接使用。

### 典型用例
CronJob 适用于多种自动化场景，常见用例如下：

在指定时间点运行一次性任务
创建周期性运行的任务，例如数据库备份、发送报告邮件、清理临时文件、健康检查等
### CronJob 规格说明
CronJob 资源定义包含必需字段和可选字段，合理配置可满足不同调度需求。

#### 必需字段
.spec.schedule：调度配置，指定任务运行周期，格式遵循 Cron 语法
.spec.jobTemplate：Job 模板，指定需要运行的任务，格式同 Job
#### 可选字段
.spec.startingDeadlineSeconds：启动 Job 的期限（秒）。如果因任何原因错过调度时间，超过此期限的 Job 将被视为失败。未指定则无期限限制
.spec.concurrencyPolicy：并发策略，指定如何处理 CronJob 创建的 Job 的并发执行：
Allow（默认）：允许并发运行 Job
Forbid：禁止并发运行，如果前一个未完成，则跳过下一个
Replace：取消当前运行的 Job，用新的替换
#### 注意
并发策略仅适用于同一个 CronJob 创建的 Job。不同 CronJob 之间创建的 Job 总是允许并发运行。
.spec.suspend：挂起标志，设置为 true 时，后续所有执行都会被挂起。对已开始执行的 Job 不起作用。默认值为 false
.spec.successfulJobsHistoryLimit 和 .spec.failedJobsHistoryLimit：历史记录限制，指定保留多少个完成和失败的 Job。默认值分别为 3 和 1，设置为 0 表示完成后不保留相关类型的 Job
### 创建 CronJob
可以通过 YAML 文件或 kubectl 命令创建 CronJob 资源。

#### 使用 YAML 文件
以下是 CronJob 的 YAML 配置示例：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello
spec:
  schedule: "*/1 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: hello
            image: busybox:1.35
            args:
            - /bin/sh
            - -c
            - date; echo Hello from the Kubernetes cluster
          restartPolicy: OnFailure
```

```bash
kubectl apply -f cronjob.yaml
```

#### 使用 kubectl 命令
也可以直接通过命令行创建 CronJob：

```bash
kubectl create cronjob hello --schedule="*/1 * * * *" --image=busybox:1.35 -- /bin/sh -c "date; echo Hello from the Kubernetes cluster"
```

### 管理 CronJob
日常运维中，需关注 CronJob 的状态、相关 Job 和 Pod 的执行情况。

#### 查看 CronJob 状态
```bash
kubectl get cronjob
kubectl describe cronjob hello
```

#### 查看相关 Job 和 Pod
```bash
kubectl get jobs
kubectl get pods --selector=job-name=hello-1202039034
kubectl logs hello-1202039034-x7db5
```

### CronJob 限制和注意事项
在实际使用 CronJob 时，需注意以下限制和设计要点。

#### 调度可靠性
CronJob 在每次调度时间内大概会创建一个 Job 对象。说大概是因为在特定环境下可能会：

创建两个 Job
一个 Job 都没创建
因此，Job 操作应该设计为幂等的。

#### 时区处理
CronJob 调度基于控制平面运行的时区。如果控制平面在不同时区的多个节点上运行，调度时间可能会不可预测。

#### Job 管理职责
Job 负责重试创建 Pod，并决定 Pod 组的成功或失败
CronJob 不会检查 Pod 的状态
### 删除 CronJob
删除 CronJob 资源不会自动删除其创建的 Job 和 Pod，需手动清理相关资源。

#### 删除 CronJob 资源
```bash
kubectl delete cronjob hello
```

#### 重要
删除 CronJob 不会自动删除其创建的 Job 和 Pod。需要手动清理。
#### 清理相关资源
```bash
kubectl get jobs
kubectl delete job hello-1201907962 hello-1202039034
kubectl delete jobs --all  # 谨慎使用
```

#### 批量清理脚本
```bash
# 删除特定 CronJob 创建的所有 Job
kubectl delete jobs -l job-name --selector='job-name=hello'

# 删除超过一定时间的已完成 Job
kubectl delete job $(kubectl get job -o jsonpath='{.items[?(@.status.conditions[0].type=="Complete")].metadata.name}')
```

### 最佳实践
为 Job 模板中的容器设置适当的资源请求和限制
合理设置 restartPolicy 和 backoffLimit，配置重试策略
监控 CronJob 的执行状态和失败情况，及时告警
确保容器日志能够被适当收集和保存
保证 Job 执行幂等，避免重复执行造成问题
定期清理历史 Job，避免资源累积
### 总结
CronJob 机制为 Kubernetes 提供了原生的定时任务调度能力，适用于自动化运维、周期性数据处理等场景。合理配置并结合最佳实践，可提升集群的自动化水平和资源利用效率。

## Ingress 控制器
Ingress 控制器是 Kubernetes 网络流量管理的关键组件，决定了外部请求如何安全、高效地路由到集群内部服务，是实现弹性和可扩展网络架构的基础。

在 Kubernetes 集群中，若希望 Ingress 资源能够正常工作，必须部署至少一个 Ingress 控制器。与作为 kube-controller-manager 组件自动启动的其他控制器不同，Ingress 控制器需要用户根据实际需求单独部署和管理。选择合适的 Ingress 控制器对于集群的网络能力和安全性至关重要。

### 官方支持的控制器
Kubernetes 社区官方维护和支持多种 Ingress 控制器，适用于不同的云平台和场景。下表总结了主流官方控制器及其适用环境。

| 控制器名称 | 适用平台/说明 |
| --- | --- |
| AWS Load Balancer Controller | 专为 AWS 环境设计 |
| GCE Ingress Controller | Google Cloud 原生支持 |
| NGINX Ingress Controller | 基于 NGINX 的开源实现 |

*表 1: Kubernetes 官方支持的 Ingress 控制器*

### 第三方控制器
除了官方控制器，社区还提供了丰富的第三方 Ingress 控制器选择，满足不同云环境、企业级和开源需求。

| 类别 | 控制器名称 | 说明/适用场景 | 链接 |
| --- | --- | --- | --- |
| 云服务商 | AKS 应用程序网关 Ingress 控制器 | Microsoft Azure 集成 | 文档 |
| 云服务商 | 阿里云 MSE Ingress | 阿里云微服务引擎 | 文档 |
| 云服务商 | OCI Native Ingress Controller | Oracle Cloud Infrastructure | GitHub |
| 企业级/商业 | Citrix Ingress 控制器 | 企业级负载均衡与安全 | GitHub |
| 企业级/商业 | F5 BIG-IP Ingress 服务 | 高级流量管理与安全 | 文档 |
| 企业级/商业 | FortiADC Ingress 控制器 | 集成 Fortinet 安全能力 | 文档 |
| 企业级/商业 | NGINX Ingress 控制器（商业版） | NGINX Plus 增强功能 | 官网 |
| 企业级/商业 | Wallarm Ingress Controller | 集成 WAF，API 安全 | 官网 |
| 开源社区 | Apache APISIX Ingress 控制器 | 高性能 API 网关 | GitHub |
| 开源社区 | Traefik Kubernetes Ingress 提供程序 | 现代反向代理 | 文档 |
| 开源社区 | Contour | 基于 Envoy 的 Ingress 控制器 | 官网 |
| 开源社区 | Emissary-Ingress | 云原生 API 网关 | 官网 |
| 开源社区 | Istio Ingress | 服务网格集成 | 文档 |
| 开源社区 | Kong Ingress 控制器 | 云原生 API 网关 | GitHub |
| 开源社区 | HAProxy Ingress | 基于 HAProxy 的负载均衡器 | 官网 |
| 新兴/专业化 | Cilium Ingress 控制器 | 基于 eBPF 的网络方案 | 文档 |
| 新兴/专业化 | Higress | 阿里云原生网关 | GitHub |
| 新兴/专业化 | Kusk Gateway | OpenAPI 驱动的 API 网关 | 官网 |
| 新兴/专业化 | ngrok Kubernetes Ingress 控制器 | 隧道与边缘连接 | GitHub |
| 新兴/专业化 | Pomerium Ingress 控制器 | 零信任网络访问 | 文档 |

*表 2: 第三方 Ingress 控制器*

### 多控制器管理
在复杂的生产环境中，往往需要同时运行多个 Ingress 控制器，以满足不同业务或团队的需求。Kubernetes 提供了灵活的机制来实现多控制器共存和精细化流量管理。

#### 使用 IngressClass 资源
通过 IngressClass 资源，可以在同一集群中部署和管理多个 Ingress 控制器。以下 YAML 示例展示了如何定义一个名为 nginx 的 IngressClass：

```yaml
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: nginx
spec:
  controller: k8s.io/ingress-nginx
```

#### 指定控制器类型
创建 Ingress 资源时，可以通过 ingressClassName 字段明确指定所用控制器类型。以下 YAML 示例演示了如何将 Ingress 资源绑定到特定控制器：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: example-ingress
spec:
  ingressClassName: nginx
  rules:
  - host: example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: example-service
            port:
              number: 80
```

#### 默认控制器设置
如果未在 Ingress 资源中指定 ingressClassName，Kubernetes 会自动应用默认的 IngressClass。可以通过为 IngressClass 资源添加如下注解来设置默认控制器：

```yaml
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
```

### 选择建议
选择合适的 Ingress 控制器时，建议综合考虑以下因素，以确保网络架构的稳定性和可扩展性。

| 考虑因素 | 说明 |
| --- | --- |
| 云环境兼容性 | 优先选择与云平台深度集成的控制器 |
| 功能需求 | 是否需要 WAF、缓存、认证等高级功能 |
| 性能要求 | 控制器的性能表现和资源消耗 |
| 社区支持 | 项目活跃度和文档完善性 |
| 运维复杂度 | 部署、配置和维护的易用性 |

*表 3: Ingress 控制器选择建议*

### 总结
Ingress 控制器是 Kubernetes 网络流量管理的核心，直接影响集群的可扩展性、安全性和高可用性。合理选择和配置 Ingress 控制器，结合 IngressClass 等机制实现多控制器协同，是构建现代云原生网络架构的关键。建议根据实际业务需求、云平台特性和团队运维能力，选择最适合的 Ingress 控制器方案，并持续关注社区动态和最佳实践。


## Horizontal Pod Autoscaling
HPA（Horizontal Pod Autoscaler）让 Kubernetes 集群中的 Pod 数量能够根据负载自动扩缩容，实现资源的弹性管理，是自动化运维的核心能力之一。

应用的资源使用率通常都有高峰和低谷的时候，如何削峰填谷，提高集群的整体资源利用率，让 service 中的 Pod 个数自动调整呢？这就有赖于 Horizontal Pod Autoscaling 了，顾名思义，使 Pod 水平自动缩放。

HPA 是最能体现 Kubernetes 相比传统运维价值的功能之一，不再需要手动扩容，真正实现了自动化运维，还可以基于自定义指标进行扩缩容。

### 概述
HPA 属于 Kubernetes 中的 autoscaling SIG（Special Interest Group），其下有两个主要特性：

Arbitrary/Custom Metrics in the Horizontal Pod Autoscaler#117
Monitoring Pipeline Metrics HPA API #118

### 版本演进
Kubernetes HPA 的功能随着版本不断演进，主要里程碑如下：

Kubernetes 1.2：引入 HPA 机制
Kubernetes 1.6：从 kubelet 获取指标转为通过 API server、Heapster 或 kube-aggregator 获取
Kubernetes 1.6+：支持自定义指标
现在：推荐使用 autoscaling/v2 API

### 架构原理
Horizontal Pod Autoscaling 仅适用于 Deployment 和 ReplicaSet，由 API server 和 controller 共同实现。

下图展示了 HPA 的整体架构：

![HPA 自动扩缩容流程](/images/K8s学习-PartI-控制器/HPA 自动扩缩容流程.svg)

*图 1: HPA 示意图*

### 工作机制
HPA 通过控制循环实现自动扩缩容，循环周期由 controller manager 的 --horizontal-pod-autoscaler-sync-period 参数指定（默认 30 秒）。

每个周期内，controller manager 会执行以下步骤：

查询指标：从 resource metric API 或自定义 metric API 获取指标。
计算利用率：
Resource metrics：计算与容器 resource request 的百分比。
自定义 metrics：使用原始值进行比较。
Object metrics：获取单个对象的指标与目标值比较。
计算副本数：基于所有指标计算新的副本数，取最大值。
执行扩缩容：通过 Scale 子资源调整副本数。

### 注意
如果 Pod 的容器没有设置 resource request，则无法定义 CPU 利用率，HPA 不会对该指标采取任何操作。

### 支持的指标类型
Kubernetes HPA 支持多种指标类型，具体如下：

#### API 版本对比
下表对比了不同 API 版本下 HPA 支持的指标类型。

| API 版本 | 支持的指标 |
| --- | --- |
| autoscaling/v1 | CPU 利用率 |
| autoscaling/v2 | CPU、内存、自定义指标、多指标组合 |

*表 1: HPA 不同 API 版本支持的指标类型*

#### 指标获取方式
HPA 控制器可通过以下两种方式获取指标：

直接 Heapster 访问：通过 API 服务器的服务代理查询 Heapster。
REST 客户端访问：通过 metrics API 获取指标。

### 基本使用
在实际运维中，HPA 的使用非常灵活，支持命令行和 YAML 配置两种方式。

#### kubectl 命令
以下是常用的 HPA 管理命令：

```bash
# 基本管理命令
kubectl create hpa
kubectl get hpa
kubectl describe hpa
kubectl delete hpa

# 快速创建 HPA
kubectl autoscale deployment nginx --min=2 --max=10 --cpu-percent=80
```

#### 命令参数说明
kubectl autoscale 命令的参数说明如下：

```bash
kubectl autoscale (-f FILENAME | TYPE NAME | TYPE/NAME) [--min=MINPODS] --max=MAXPODS [--cpu-percent=CPU] [flags]
```

示例：为 Deployment foo 创建 autoscaler，CPU 利用率达到 80% 时扩缩容，副本数在 2-5 之间：

```bash
kubectl autoscale deployment foo --min=2 --max=5 --cpu-percent=80
```

#### YAML 配置示例
通过 YAML 文件可以更灵活地配置 HPA，支持多指标扩缩容。

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 80
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

#### 滚动更新注意事项
✅ 支持：HPA 绑定到 Deployment，支持滚动更新
❌ 不支持：HPA 直接绑定到 ReplicationController 进行滚动更新
原因：滚动更新会创建新的 ReplicationController，HPA 不会自动绑定到新的 RC。

### 自定义指标配置
HPA 支持基于自定义指标的扩缩容，需满足一定的前提条件。

#### 前提条件
要使用自定义指标，需完成如下配置：

Controller Manager 配置：

```bash
--horizontal-pod-autoscaler-use-rest-clients=true
--master=http://API_SERVER_ADDRESS:8080
```

API Server 配置（Kubernetes 1.7+）：

```bash
--requestheader-client-ca-file=/etc/kubernetes/ssl/ca.pem
--requestheader-allowed-names=aggregator
--requestheader-extra-headers-prefix=X-Remote-Extra-
--requestheader-group-headers=X-Remote-Group
--requestheader-username-headers=X-Remote-User
--proxy-client-cert-file=/etc/kubernetes/ssl/kubernetes.pem
--proxy-client-key-file=/etc/kubernetes/ssl/kubernetes-key.pem
```

#### APIService 配置
创建自定义指标 API 服务的 YAML 示例：

```yaml
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1beta2.custom-metrics.metrics.k8s.io
spec:
  insecureSkipTLSVerify: true
  group: custom-metrics.metrics.k8s.io
  groupPriorityMinimum: 1000
  versionPriority: 5
  service:
    name: custom-metrics-apiserver
    namespace: custom-metrics
  version: v1beta2
```

#### Prometheus 集成
通过 Prometheus Operator 可以实现自定义指标的采集与暴露。

部署 Prometheus Operator：

```bash
kubectl apply -f prometheus-operator.yaml
```

验证自定义指标 API：

```bash
kubectl get --raw="/apis/custom-metrics.metrics.k8s.io/v1beta2" | jq .
```

自定义指标 HPA 示例：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-custom-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "100"
  - type: Object
    object:
      metric:
        name: requests-per-second
      describedObject:
        apiVersion: networking.k8s.io/v1
        kind: Ingress
        name: main-route
      target:
        type: Value
        value: "10k"
```

### 多指标支持
Kubernetes 1.6 及以上版本支持基于多个指标的扩缩容。

HPA 会根据每个指标分别计算所需副本数
取所有指标计算结果中的最大值作为最终扩缩容结果
需确保所有指标都满足要求

#### 指标类型说明
下表总结了 HPA 支持的指标类型及其用途。

| 指标类型 | 描述 | 用途 |
| --- | --- | --- |
| Resource | CPU、内存等资源指标 | 基础资源监控 |
| Pods | Pod 级别的自定义指标 | 应用特定指标 |
| Object | Kubernetes 对象指标 | 外部资源监控 |
| External | 外部系统指标 | 云服务指标 |

*表 2: HPA 支持的指标类型及用途*

### 最佳实践
在实际生产环境中，建议遵循以下最佳实践：

#### 资源请求设置
合理设置 Pod 的资源请求和限制，有助于 HPA 精确扩缩容。

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

#### 合理的扩缩容参数
通过配置 behavior 字段，可以优化扩缩容的平滑性，避免频繁波动。

```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
    - type: Percent
      value: 10
      periodSeconds: 60
  scaleUp:
    stabilizationWindowSeconds: 60
    policies:
    - type: Percent
      value: 50
      periodSeconds: 60
```

#### 监控和告警
监控 HPA 状态和扩缩容事件
设置合理的告警阈值
定期检查指标的准确性

### 故障排除
在使用 HPA 过程中，常见问题及排查方法如下：

#### 常见问题
HPA 不生效

检查 Pod 是否设置了 resource requests
验证 metrics-server 是否正常运行
确认 HPA 配置正确
自定义指标无法获取

检查自定义指标 API 是否注册
验证 APIService 配置
确认指标数据源正常
频繁扩缩容

调整 stabilizationWindowSeconds
优化指标阈值设置
检查应用负载模式
#### 调试命令
以下命令可用于排查 HPA 相关问题：

```bash
# 查看 HPA 状态
kubectl describe hpa `<hpa-name>`

# 查看 HPA 事件
kubectl get events --field-selector involvedObject.kind=HorizontalPodAutoscaler

# 查看可用指标
kubectl get --raw "/apis/metrics.k8s.io/v1/nodes" | jq .
kubectl get --raw "/apis/custom-metrics.metrics.k8s.io/v1beta2" | jq .
```

### 总结
HPA 是 Kubernetes 自动化运维的核心能力之一，能够根据多种指标实现 Pod 的自动扩缩容。通过合理配置资源请求、自定义指标和扩缩容策略，可以显著提升集群资源利用率和应用弹性。实际生产中，建议结合监控和告警体系，持续优化 HPA 策略，确保系统稳定高效运行。
