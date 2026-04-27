---
title: "K8s 学习 · Part I：基础架构与核心抽象 之 Pod"
date: 2026-03-21 10:00:00
categories: 云原生
tags: [Kubernetes, 学习路线, Pod, 工作负载, 探针]
---

# K8s 学习 · Part I：基础架构与核心抽象 之 Pod

## Pod

![节点组件与 Pod 关系](/images/K8s学习-PartI-基础架构与核心抽象/节点组件与 Pod 关系.png)

*图：节点组件与 Pod 关系*

Pod 是 Kubernetes 世界中承载一切应用与创新的“原子单元”，其精妙设计奠定了云原生架构的坚实基石。

Pod 是 Kubernetes 中最小的可部署单元，理解 Pod 的状态管理和生命周期对于掌握 Kubernetes 至关重要。

本章节将深入探讨以下核心概念：

Pod 构成与架构 - 了解 Pod 的基本组成和内部结构
Pod 生命周期管理 - 掌握 Pod 从创建到销毁的完整流程
容器启动顺序 - 理解 Pod 中多容器的启动机制和依赖关系
状态管理机制 - 学习 Pod 状态变化和管理策略
Kubernetes 通过各种控制器（Controller）来管理 Pod 的状态和生命周期。其中，kube-controller-manager 是负责运行各种控制器的核心组件，它确保集群中的 Pod 始终处于期望的状态。

在深入学习各类控制器之前，我们需要先建立对 Pod 本身及其生命周期的全面理解，这是掌握 Kubernetes 工作负载管理的基础。

## Pod 概述
Pod 是 Kubernetes 中最基本的部署和调度单元，承载着容器化应用的运行环境，是实现弹性伸缩和自动化运维的基础。

### 什么是 Pod
Pod（容器组）是 Kubernetes 中可以创建和调度的最小部署单元。每个 Pod 代表集群中运行的一个或多个容器的集合，通常用于承载一个应用实例。

Pod 封装了以下内容：

一个或多个应用容器
共享的存储卷（Volumes）
唯一的网络 IP 地址
容器运行策略配置
Pod 作为部署单元，通常由一个或多个紧密协作的容器组成，便于资源共享和进程间通信。

容器运行时支持说明：Kubernetes 现已全面支持多种符合 CRI（Container Runtime Interface）标准的运行时，如 containerd、CRI-O 等。自 2022 年起，Docker 不再作为官方默认运行时，但仍可通过额外配置支持。

### Pod 的使用模式
在 Kubernetes 集群中，Pod 有以下两种主要使用模式：

### 单容器 Pod
这是最常见的模式，即一个 Pod 运行一个容器。在此模式下：

Pod 作为单个容器的包装器
Kubernetes 直接管理 Pod，而非容器本身
提供更高层次的抽象和管理能力
### 多容器 Pod
适用于需要紧密协作的容器场景，即一个 Pod 运行多个容器：

容器间共享资源和数据
容器处于同一网络命名空间，可通过 localhost 通信
常见于边车（Sidecar）、大使（Ambassador）、适配器（Adapter）等模式
常见多容器模式包括：

边车模式（Sidecar）：主容器与辅助容器协作（如日志收集、代理）
大使模式（Ambassador）：代理容器处理外部通信
适配器模式（Adapter）：转换容器输出格式
下图展示了单容器与多容器 Pod 的结构关系：


![Pod 结构模式](/images/K8s学习-PartI-Pod/Pod 结构模式.png)

*图 1: Pod 结构模式*

### 学习资源
以下 Kubernetes 官方博客文章提供了更详细的 Pod 使用模式：

The Distributed System Toolkit: Patterns for Composite Containers - kubernetes.io
Container Design Patterns - kubernetes.io
### Pod 中的资源共享
Pod 内的多个容器可以共享以下资源，实现高效协作。

### 网络共享
每个 Pod 分配唯一的 IP 地址
Pod 内所有容器共享网络命名空间
容器间可通过 localhost 通信
共享端口空间，避免端口冲突
### 存储共享
Pod 可定义多个共享卷（Volumes）
所有容器可访问这些共享卷
支持数据持久化和容器间数据交换
常用于配置文件、日志文件共享
下图展示了典型的多容器 Pod 架构：


![多容器 Pod 架构示意图](/images/K8s学习-PartI-Pod/多容器 Pod 架构示意图.png)

*图 2: 多容器 Pod 架构示意图*

### Pod 的生命周期管理
Pod 的生命周期管理是保障应用高可用和自动化运维的关键。

### 为什么不直接使用 Pod
在生产环境中，很少直接创建和管理单个 Pod，原因如下：

短暂性：Pod 是临时的、用后即焚的实体
不自愈：Pod 故障后不会自动重启或重新调度
无副本管理：单个 Pod 无法提供高可用性
### Pod 与控制器
Kubernetes 通过控制器（Controller）来管理 Pod，实现自动化运维和弹性伸缩。常见控制器类型如下表所示：

以下表格总结了常见控制器类型及其用途：

| 控制器类型 | 用途 | 特点 |
| --- | --- | --- |
| Deployment | 无状态应用 | 副本管理、滚动更新 |
| StatefulSet | 有状态应用 | 有序部署、持久化存储 |
| DaemonSet | 节点级服务 | 每个节点运行一个 Pod |
| Job | 批处理任务 | 一次性任务执行 |
| CronJob | 定时任务 | 按计划执行任务 |

*表 1: Kubernetes 控制器类型与用途*

### Pod 扩缩容
如需运行应用的多个实例：

创建多个 Pod，每个作为独立的应用实例
在 Kubernetes 中称为副本（Replication）
通常由控制器自动管理副本数量，实现弹性伸缩
### Pod 模板
Pod 模板（Pod Template）定义了 Pod 的规格，可嵌入到各种控制器中，实现批量和自动化管理。

以下 YAML 示例展示了一个基础的 Pod 模板：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: example-pod
spec:
  containers:
  - name: app-container
    image: nginx:1.21
    ports:
    - containerPort: 80
```


控制器使用 Pod 模板来创建和管理实际的 Pod 实例，确保应用的可靠性和可扩展性。

### 最佳实践
在实际使用 Pod 时，建议遵循以下最佳实践：

优先使用控制器：避免直接创建 Pod，使用 Deployment 等控制器
合理设计容器：一个 Pod 中的容器应该紧密相关
资源限制：为容器设置适当的资源请求和限制
健康检查：配置存活探针和就绪探针
标签管理：使用标签进行 Pod 的分类和选择
### 总结
Pod 是 Kubernetes 应用部署的核心单元。通过合理设计 Pod 结构、资源共享和生命周期管理，并结合控制器实现自动化运维，可以显著提升集群的弹性和可维护性。建议在生产环境中始终通过控制器管理 Pod，确保高可用和自动恢复能力。


## Pod 解析
Pod 是 Kubernetes 架构的基石，理解其设计理念和生命周期管理对于构建高可用、可扩展的容器化应用至关重要。

### Pod 数据结构概览
下图展示了 Pod 的核心数据结构，便于理解其组成和属性：


![Pod Cheatsheet 数据结构图](/images/K8s学习-PartI-Pod/Pod Cheatsheet 数据结构图.webp)

*图 1: Pod Cheatsheet 数据结构图*

### 什么是 Pod？
Pod（容器组）是 Kubernetes REST API 中的核心资源类型，也是最小的可部署和管理单元。Pod 可以理解为豌豆荚，它是一个或多个容器的集合，这些容器：

共享网络命名空间：拥有相同的 IP 地址和端口空间
共享存储卷：可以访问相同的持久化存储
协同调度：总是被调度到同一个节点上
生命周期一致：同时创建、启动和终止
Pod 为紧密耦合的应用提供了一个“逻辑主机”环境，类似于传统部署中将相关应用运行在同一台物理机或虚拟机上。

### Pod 的共享环境
Pod 中的容器共享以下环境：

Linux 命名空间：网络、IPC、UTS 等
控制组（cgroups）：资源限制和隔离
存储卷：数据持久化和共享
容器间可以通过以下方式通信：

localhost：网络通信
进程间通信（IPC）：SystemV 信号量、POSIX 共享内存等
共享文件系统：通过挂载的卷进行文件共享
### Pod 架构示意图
下图展示了多容器 Pod 的典型架构，便于理解容器间的协作关系：


![多容器 Pod 架构示意图](/images/K8s学习-PartI-Pod/多容器 Pod 架构示意图.png)

*图 2: 多容器 Pod 架构示意图*

### Pod 的设计理念
Pod 作为部署单元，提供了更高层次的抽象，简化了应用管理和资源利用。

### 简化应用管理
统一调度：相关容器总是部署在同一节点
协同生命周期：容器同时创建、启动和终止
资源共享：简化容器间的通信和数据交换
依赖管理：自动处理容器间的依赖关系
### 优化资源利用
网络共享：避免端口冲突和网络复杂性
存储共享：高效的数据交换和持久化
计算资源：合理的资源分配和限制
### Pod 的典型使用场景
Pod 支持多种设计模式，满足不同业务需求。

### 边车模式 (Sidecar Pattern)
边车模式（Sidecar Pattern）是 Kubernetes 中常见的 Pod 设计模式。在同一个 Pod 内运行主应用容器的同时，配套部署一个或多个辅助容器（边车），用于实现日志收集、数据同步、代理、监控等功能。边车容器与主容器共享网络和存储环境，提升应用的可观测性和可维护性。

以下是边车模式的典型 YAML 配置示例：

```yaml
# 示例：Web 应用 + 日志收集器
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: web-app
    image: nginx
  - name: log-collector
    image: fluentd
```

### 代理模式 (Proxy Pattern)

API 网关和后端服务
缓存代理和应用服务器
安全代理和业务容器
### 适配器模式 (Adapter Pattern)
监控数据格式转换
配置文件标准化
协议转换和桥接

### Pod 生命周期管理
Pod 的生命周期分为多个阶段，合理管理可提升系统稳定性。

### Pod 阶段 (Phase)
Pending：Pod 已创建但未调度或镜像拉取中
Running：至少有一个容器正在运行
Succeeded：所有容器成功终止且不会重启
Failed：所有容器已终止且至少一个失败
Unknown：无法获取 Pod 状态
### 重启策略
Always：总是重启（默认）
OnFailure：仅在失败时重启
Never：从不重启
### Pod 生命周期流程图
下图展示了 Pod 的生命周期主要阶段及状态转换：


![Pod 生命周期流程](/images/K8s学习-PartI-Pod/Pod 生命周期流程.svg)

*图 3: Pod 生命周期流程*

### Pod 网络和存储
Pod 提供独立的网络和存储环境，支持多种业务场景。

### 网络特性
每个 Pod 拥有唯一的集群 IP 地址
Pod 内容器共享网络命名空间
容器间通过 localhost 通信
跨 Pod 通信需要通过 Service
### 存储特性
支持多种卷类型：EmptyDir、HostPath、PVC 等
卷的生命周期与 Pod 一致
容器重启时数据保持不变
Pod 删除时临时卷被清理
### Pod 终止流程
Pod 的优雅终止遵循以下步骤：

发起删除请求：用户或控制器请求删除 Pod
标记终止状态：API Server 更新 Pod 状态为 Terminating
执行预停止钩子：运行 preStop 生命周期钩子
发送 SIGTERM 信号：通知容器进程准备关闭
等待优雅期：默认 30 秒的优雅终止期
强制终止：发送 SIGKILL 信号强制停止进程
清理资源：从 API Server 中移除 Pod 记录
### 自定义终止行为
可以通过自定义 Pod 的终止行为来实现更优雅的下线流程。例如，设置 terminationGracePeriodSeconds 参数延长优雅终止时间，并通过 preStop 生命周期钩子在容器被终止前执行清理脚本。以下是典型的自定义终止行为 YAML 示例：

```yaml
apiVersion: v1
kind: Pod
spec:
  terminationGracePeriodSeconds: 60  # 自定义优雅期
  containers:
  - name: app
    image: myapp
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "cleanup.sh"]
```

### 高级特性
Pod 支持多种安全和资源管理特性，保障集群稳定与安全。

### 安全上下文
以下是相关的代码示例：

```yaml
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
  containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL
```

### 资源管理

合理设置资源请求（requests）和限制（limits），可防止资源争用和抢占，提升集群稳定性。以下是资源管理的典型 YAML 配置示例：

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    resources:
      requests:
        memory: "128Mi"
        cpu: "100m"
      limits:
        memory: "256Mi"
        cpu: "200m"
```

### 最佳实践

Pod 设计与管理建议如下：

单一职责：每个容器专注于单一功能
无状态设计：避免在 Pod 中存储持久状态
优雅终止：实现合适的关闭逻辑
资源限制：合理设置资源请求和限制
健康检查：配置 livenessProbe、readinessProbe
安全加固：使用非 root 用户、只读根文件系统、最小化权限
### Pod 与控制器关系
虽然可以直接创建 Pod，但在生产环境中通常使用以下控制器：

Deployment：无状态应用的部署和更新
StatefulSet：有状态应用的管理
DaemonSet：节点级别的后台任务
Job/CronJob：批处理任务
这些控制器提供了自动重启、滚动更新、扩缩容等高级功能。

### 总结
Pod 是 Kubernetes 架构的核心单元。通过合理设计 Pod 结构、资源共享和生命周期管理，并结合控制器实现自动化运维，可以显著提升集群的弹性和可维护性。建议在生产环境中始终通过控制器管理 Pod，确保高可用和自动恢复能力。

## Init 容器
Init 容器是 Kubernetes Pod 生命周期管理中的关键机制，专为初始化任务和依赖准备而设计，提升了应用部署的灵活性和可维护性。

### 什么是 Init 容器
Init 容器（Init Container）是运行在 Pod 中的特殊容器，在应用容器启动之前依次执行，用于完成初始化任务。每个 Pod 可以包含多个 Init 容器，这些容器会按照定义顺序依次运行。

### Init 容器的核心特性
| 特性 | Init 容器 | 应用容器 |
| --- | --- | --- |
| 运行方式 | 顺序执行，运行至完成 | 并行运行，持续运行 |
| 重启策略 | 失败时重启整个 Pod | 根据 restartPolicy 处理 |
| 就绪探针 | 不支持 readinessProbe | 支持各种探针 |
| 生命周期 | 一次性执行 | 长期运行 |

*表 1: Init 容器与应用容器的核心特性对比*

顺序执行：多个 Init 容器按照定义顺序一个接一个地运行
必须成功：每个 Init 容器都必须成功完成，下一个容器才能启动
阻塞启动：所有 Init 容器成功完成后，应用容器才开始启动
独立镜像：Init 容器可以使用与应用容器不同的镜像
### 与普通容器的区别
Init 容器支持应用容器的大部分特性，但在生命周期、重启策略等方面有显著差异。

### Init 容器的使用场景
Init 容器适用于多种初始化和依赖准备场景。常见用例如下：

依赖服务检查：等待数据库、缓存等依赖服务就绪
数据预处理：下载配置文件、克隆 Git 仓库、生成动态配置
权限和安全设置：修改文件权限、创建用户、设置证书
资源准备：初始化数据库 schema、创建目录结构、安装依赖包
下图展示了 Init 容器在 Pod 启动流程中的作用：


![Init 容器执行流程](/images/K8s学习-PartI-Pod/Init 容器执行流程.svg)

*图 1: Init 容器执行流程*

### 使用示例
### 基础示例
以下 YAML 展示了一个包含两个 Init 容器的 Pod 配置：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
  labels:
    app: myapp
spec:
  containers:
  - name: myapp-container
    image: busybox:1.35
    command: ['sh', '-c', 'echo The app is running! && sleep 3600']
  initContainers:
  - name: init-myservice
    image: busybox:1.35
    command: ['sh', '-c', 'until nslookup myservice.default.svc.cluster.local; do echo waiting for myservice; sleep 2; done;']
  - name: init-mydb
    image: busybox:1.35
    command: ['sh', '-c', 'until nslookup mydb.default.svc.cluster.local; do echo waiting for mydb; sleep 2; done;']
```

### 配套服务定义

为确保 Init 容器能通过 DNS 访问依赖服务，需定义对应的 Service：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myservice
spec:
  ports:
  - protocol: TCP
    port: 80
    targetPort: 9376
---
apiVersion: v1
kind: Service
metadata:
  name: mydb
spec:
  ports:
  - protocol: TCP
    port: 80
    targetPort: 9377
```

### 实际应用示例

以下 YAML 展示了更复杂的 Init 容器用法：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app-pod
spec:
  initContainers:
  # 1. 等待数据库就绪
  - name: wait-for-db
    image: postgres:13
    command: ['sh', '-c']
    args:
    - |
      until pg_isready -h postgres-service -p 5432 -U myuser; do
        echo "Waiting for postgres..."
        sleep 2
      done
  # 2. 运行数据库迁移
  - name: db-migration
    image: myapp:latest
    command: ['python', 'manage.py', 'migrate']
    env:
    - name: DATABASE_URL
      value: "postgresql://myuser:mypass@postgres-service:5432/mydb"
  containers:
  - name: web-app
    image: myapp:latest
    ports:
    - containerPort: 8000
```

### 运行时行为

Init 容器的执行顺序和失败处理如下：

Pod 被调度到节点
网络和存储卷初始化
Init 容器按顺序依次执行
所有 Init 容器成功后，应用容器启动
若 Init 容器失败，Kubernetes 会根据 Pod 的 restartPolicy 重启 Pod
restartPolicy: Never 时，Pod 不会重启
restartPolicy: Always 或 OnFailure 时，会重启整个 Pod
以下情况会导致 Init 容器重新执行：

Init 容器镜像更新
Pod 基础设施容器重启
Pod 被删除重建
### 资源管理
Init 容器的资源请求和限制有独特的计算方式：

有效初始请求：所有 Init 容器中某资源的最大值
Pod 有效请求：max(有效初始请求，所有应用容器请求之和)
以下 YAML 展示了 Init 容器的资源配置：

```yaml
spec:
  initContainers:
  - name: init-container
    image: busybox
    resources:
      requests:
        memory: "64Mi"
        cpu: "250m"
      limits:
        memory: "128Mi"
        cpu: "500m"
```

### 存储卷共享
Init 容器可与应用容器共享存储卷，实现数据预处理和传递：

```yaml
spec:
  initContainers:
  - name: init-data
    image: busybox
    command: ['sh', '-c', 'echo "Hello" > /shared-data/message']
    volumeMounts:
    - name: shared-storage
      mountPath: /shared-data
  containers:
  - name: app
    image: nginx
    volumeMounts:
    - name: shared-storage
      mountPath: /usr/share/nginx/html
  volumes:
  - name: shared-storage
    emptyDir: {}
```

### 监控和调试
在使用 kubectl 工具监控和调试 Init 容器时，可通过以下命令查看 Pod 及其 Init 容器的状态和日志：

```bash
# 查看 Pod 状态
kubectl get pod myapp-pod

# 查看详细信息
kubectl describe pod myapp-pod

# 查看 Init 容器日志
kubectl logs myapp-pod -c init-myservice
kubectl logs myapp-pod -c init-mydb
```

常见状态说明：

Init:0/2：2 个 Init 容器中的第 1 个正在运行
Init:1/2：第 1 个 Init 容器完成，第 2 个正在运行
PodInitializing：所有 Init 容器完成，Pod 正在初始化
Running：Pod 启动成功
### 最佳实践
Init 容器的设计和实现建议如下：

保持幂等性
Init 容器的代码应具备幂等性，能安全重复执行：

```bash
# 检查文件是否存在再下载
if [ ! -f /data/config.json ]; then
  curl -o /data/config.json https://config-server/config.json
fi
```

设置合理的超时
通过 activeDeadlineSeconds 避免 Init 容器无限等待：

```yaml
spec:
  activeDeadlineSeconds: 300  # 5 分钟超时
  initContainers:
  - name: wait-service
    image: busybox
    command: ['sh', '-c', 'sleep 10']
```

适当的资源配置
为 Init 容器设置合理的资源限制：

```yaml
initContainers:
- name: data-downloader
  image: alpine/curl
  resources:
    requests:
      memory: "64Mi"
      cpu: "100m"
    limits:
      memory: "128Mi"
      cpu: "200m"
```

使用轻量级镜像
选择合适的基础镜像以减少启动时间：

使用 alpine 替代 ubuntu
构建专用的 Init 容器镜像
利用多阶段构建减小镜像大小
### 版本兼容性
| 版本 | 支持方式 | 说明 |
| --- | --- | --- |
| Kubernetes 1.6+ | spec.initContainers 字段 | 推荐，主流用法 |
| Kubernetes 1.5 | beta 注解 | 已废弃 |
| 当前版本 | 完全支持 | 功能稳定 |

*表 2: Init 容器在不同 Kubernetes 版本中的支持情况*

现代 Kubernetes 集群应始终使用 spec.initContainers 字段定义 Init 容器。

### 总结
Init 容器为 Kubernetes Pod 提供了灵活的初始化机制，适用于依赖检查、数据准备、安全配置等多种场景。通过合理设计 Init 容器及其资源配置，可显著提升应用部署的可靠性和自动化水平。建议在实际项目中充分利用 Init 容器，规范初始化流程，提升集群运维效率。


## Pause 容器
Pause 容器（Infra 容器）是 Kubernetes Pod 架构的核心机制，负责实现容器间命名空间共享和 Pod 生命周期管理，是多容器协作的基础。

### Pause 容器配置
Pause 容器的镜像配置在 kubelet 参数中，以下为常见配置方式：

```bash
# Kubernetes 默认配置
--pod-infra-container-image=registry.k8s.io/pause:3.9

# 早期版本配置（已过时）
--pod-infra-container-image=gcr.io/google_containers/pause-amd64:3.0
```

注意：自 Kubernetes 1.25 起，Pause 容器镜像默认为 registry.k8s.io/pause:3.9，支持多架构。

Pause 容器可自定义，官方源代码见 Kubernetes GitHub 仓库，采用 C 语言实现。

### 容器特点
Pause 容器具备以下显著特性：

轻量级：镜像极小，约 300-700KB
持久运行：始终处于 Pause（暂停）状态
多架构支持：兼容 AMD64、ARM64 等主流架构
资源消耗极低：几乎不占用 CPU 和内存
### 设计背景
Pod 是 Kubernetes 的基本调度单元，本质为逻辑概念。为实现 Pod 内多容器高效共享资源，需打破 Linux Namespace 和 cgroups 的隔离。Kubernetes 通过 Pause 容器实现网络和存储共享，具体包括：

网络共享：通过 Network Namespace
存储共享：通过 Volume 挂载
### 实现原理
Pause 容器的核心作用是为 Pod 内所有业务容器提供统一的命名空间基础。下图展示了 Pause 容器实现网络共享的流程：


![Pause 容器网络共享机制](/images/K8s学习-PartI-Pod/Pause 容器网络共享机制.svg)

*图 1: Pause 容器网络共享机制*

### 网络共享机制
Pod 内容器的网络共享按如下步骤实现：

创建 Pause 容器，持有 Network Namespace
业务容器通过 --net=container:pause 加入同一 Network Namespace
所有容器共享 IP、端口、路由表等网络资源
### 关键特性
统一网络视图：Pod 内所有容器共享网络设备、IP、MAC 地址
生命周期管理：Pod 生命周期等同于 Pause 容器生命周期
独立更新：可单独更新业务容器，无需重建整个 Pod
### 实际作用
Pause 容器在 Pod 中承担以下职责：

命名空间共享基础：Network、IPC、PID Namespace 共享
Init 进程角色：作为 Pod 内 PID 1，负责回收僵尸进程和信号处理
### 查看运行状态
可通过以下命令在节点上查看 Pause 容器运行情况：

```bash
crictl ps | grep pause
```

示例输出：

```text
9cec6c0ef583   registry.k8s.io/pause:3.9   3 hours ago   Running   k8s_POD_nginx-deployment-...
5a5ef33b0d58   registry.k8s.io/pause:3.9   3 hours ago   Running   k8s_POD_redis-cluster-...
```

### 实战演示
下图展示了 Pause 容器在 Pod 内部的资源共享机制：


![Pause 容器示意图](/images/K8s学习-PartI-Pod/Pause 容器示意图.webp)

*图 2: Pause 容器示意图*

### 步骤一：启动 Pause 容器
手动启动 Pause 容器作为命名空间基础：

```bash
docker run -d --name pause -p 8880:80 --ipc=shareable registry.k8s.io/pause:3.9
```

### 步骤二：启动 Nginx 容器并共享命名空间
通过 --net=container:pause 等参数将 Nginx 容器加入 Pause 容器命名空间：

```bash
cat <<EOF > nginx.conf
error_log stderr;
events { worker_connections 1024; }
http {
    access_log /dev/stdout combined;
    server {
        listen 80 default_server;
        server_name example.com www.example.com;
        location / {
            proxy_pass http://127.0.0.1:2368;
        }
    }
}
EOF

docker run -d --name nginx \
  -v $(pwd)/nginx.conf:/etc/nginx/nginx.conf \
  --net=container:pause \
  --ipc=container:pause \
  --pid=container:pause \
  nginx
```

### 步骤三：启动 Ghost 应用容器
将 Ghost 容器加入 Pause 容器命名空间，实现多容器协作：

```bash
docker run -d --name ghost \
  --net=container:pause \
  --ipc=container:pause \
  --pid=container:pause \
  ghost
```

访问 http://localhost:8880/ 即可看到 Ghost 博客界面。

### 验证共享效果
进入 Ghost 容器查看进程：

```bash
docker exec -it ghost ps aux
```

示例输出：

```text
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.0   1024     4 ?        Ss   13:49   0:00 /pause
root         5  0.0  0.1  32432  5736 ?        Ss   13:51   0:00 nginx: master process
systemd+     9  0.0  0.0  32980  3304 ?        S    13:51   0:00 nginx: worker process
node        10  0.3  2.0 1254200 83788 ?       Ssl  13:53   0:03 node current/index.js
```

可见：

Pause 容器进程 PID 为 1（Init 进程）
所有容器进程在同一 PID 命名空间
容器间可通过 localhost 通信
### 版本演进
| Kubernetes 版本 | Pause 容器版本 | 主要变化 |
| --- | --- | --- |
| 1.20 及以前 | pause:3.2 | 基础功能 |
| 1.21-1.24 | pause:3.5 | 多架构支持 |
| 1.25+ | pause:3.9 | 镜像仓库迁移到 registry.k8s.io |

*表 1: Pause 容器版本演进与变化*

### 最佳实践
Pause 容器相关建议如下：

镜像选择：使用与集群版本匹配的 Pause 容器镜像
网络配置：确保 Pause 容器镜像在所有节点可用
监控观察：通过 Pause 容器状态判断 Pod 健康
故障排查：Pause 容器异常通常意味着整个 Pod 存在问题
### 总结
Pause 容器是 Kubernetes Pod 内部资源共享和生命周期管理的基础。通过 Pause 容器实现命名空间统一，保障多容器高效协作和稳定运行。建议在实际运维中关注 Pause 容器状态，提升故障排查和集群可靠性。

## Sidecar 容器

Sidecar 容器模式是实现 Kubernetes 应用关注点分离和增强可观测性的关键手段，广泛应用于日志、监控、服务网格等场景。

### Sidecar 容器的特点

Sidecar 容器（Sidecar Container）是指与主容器（Main Container）共同运行在同一个 Pod 内的辅助容器。它们具有如下特点：

共享资源：与主容器共享网络命名空间、存储卷和生命周期。
松耦合：功能独立，可单独更新和维护。
透明性：对主应用透明，无需修改主应用代码。
可重用性：可在多个不同应用中复用。
下图展示了 Sidecar 容器与主容器的协作关系：

![Sidecar 容器与主容器协作关系](/images/K8s学习-PartI-Pod/Sidecar 容器与主容器协作关系.svg)

*图 1: Sidecar 容器与主容器协作关系*

### 常见使用场景

Sidecar 容器模式适用于多种场景，以下为典型用例：

日志收集

Sidecar 容器可用于日志收集，将主容器日志转发到日志系统。主容器与日志收集 Sidecar 通过共享卷（如 emptyDir）实现日志文件共享。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-sidecar
spec:
  containers:
  - name: app
    image: my-app:latest
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log
  - name: log-collector
    image: fluent/fluent-bit:latest
    volumeMounts:
    - name: shared-logs
      mountPath: /var/log
  volumes:
  - name: shared-logs
    emptyDir: {}
```

服务网格代理

在服务网格（Service Mesh）场景中，Sidecar 容器作为代理（如 Envoy、Istio Proxy）部署于每个应用 Pod 内，实现流量管理、可观测性和安全等功能。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-proxy
spec:
  containers:
  - name: app
    image: my-app:latest
    ports:
    - containerPort: 8080
  - name: envoy-proxy
    image: envoyproxy/envoy:latest
    ports:
    - containerPort: 9901
```

配置热更新

Sidecar 容器可用于监听 ConfigMap 变更，实现配置热更新，无需重启主容器。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-config-watcher
spec:
  containers:
  - name: app
    image: my-app:latest
    volumeMounts:
    - name: config-volume
      mountPath: /etc/config
  - name: config-watcher
    image: config-watcher:latest
    volumeMounts:
    - name: config-volume
      mountPath: /etc/config
  volumes:
  - name: config-volume
    configMap:
      name: app-config
```

### 与 Init 容器的区别

Sidecar 容器与 Init 容器（Init Container）在运行时机、生命周期等方面存在本质区别。下表进行对比说明：

| 特性 | Sidecar 容器 | Init 容器 |
| --- | --- | --- |
| 运行时机 | 与主容器同时运行 | 主容器启动前运行 |
| 生命周期 | 与主容器相同 | 运行完成后退出 |
| 数量限制 | 可有多个 | 可有多个，顺序执行 |
| 主要用途 | 持续辅助服务 | 初始化任务 |

*表 1: Sidecar 容器与 Init 容器的区别*

### 最佳实践

在实际应用中，建议遵循以下最佳实践以提升 Sidecar 容器的可维护性和稳定性。

资源管理

为 Sidecar 容器合理分配资源，避免影响主业务容器：

```yaml
containers:
- name: sidecar
  image: sidecar:latest
  resources:
    requests:
      memory: "64Mi"
      cpu: "50m"
    limits:
      memory: "128Mi"
      cpu: "100m"
```

健康检查

为 Sidecar 容器配置健康检查（如 livenessProbe 和 readinessProbe）：

```yaml
containers:
- name: sidecar
  image: sidecar:latest
  livenessProbe:
    httpGet:
      path: /health
      port: 8080
    initialDelaySeconds: 30
    periodSeconds: 10
```

优雅关闭

通过 preStop 钩子实现 Sidecar 容器的优雅关闭：

```yaml
containers:
- name: sidecar
  image: sidecar:latest
  lifecycle:
    preStop:
      exec:
        command: ["/bin/sh", "-c", "sleep 10"]
```

### 注意事项

在设计和使用 Sidecar 容器时需关注以下问题：

资源消耗：每个 Sidecar 容器都会消耗额外的 CPU 和内存资源。
复杂性提升：增加 Pod 复杂性，调试和监控难度提升。
网络通信：需考虑容器间网络通信和端口冲突。
版本管理：需协调主容器与 Sidecar 容器的版本更新。

### 总结

Sidecar 容器模式是 Kubernetes 实现关注点分离和增强应用能力的重要方式。通过合理设计 Sidecar 容器，可将日志、监控、安全等横切关注点从主应用中解耦，提升系统的模块化和可维护性。在实际应用中需权衡其带来的灵活性与复杂性，结合最佳实践实现高效的云原生架构。


## Pod 的生命周期

Pod 生命周期管理是 Kubernetes 自动化运维和高可用保障的核心，合理配置探针和重启策略可显著提升应用的健壮性和弹性。

### Pod 阶段（Phase）

Pod 的 status 字段包含一个 PodStatus 对象，其中的 phase 字段表示 Pod 在生命周期中的当前状态。Pod 的阶段（phase）是对 Pod 在其生命周期中状态的高层次概括，并非容器或 Pod 状态的详细汇总。

阶段类型

下表总结了 Pod phase 字段的所有可能取值及其含义：

| 阶段 | 描述 |
| --- | --- |
| Pending | Pod 已被 Kubernetes 接受，但一个或多个容器尚未创建完成。包括调度等待时间和镜像拉取时间 |
| Running | Pod 已绑定到节点，所有容器已创建，至少有一个容器正在运行、启动或重启 |
| Succeeded | Pod 中所有容器已成功终止，且不会重启 |
| Failed | Pod 中所有容器已终止，至少有一个容器因失败而终止（退出码非零或被系统终止） |
| Unknown | 无法获取 Pod 状态，通常因与 Pod 所在节点通信失败导致 |

*表 1: Pod 阶段类型说明*

下图展示了 Pod 生命周期中状态的变化流程：

![Pod 生命周期状态变化流程](/images/K8s学习-PartI-Pod/Pod 生命周期状态变化流程.svg)

*图 1: Pod 生命周期状态变化流程*

### Pod 状态（Status）
Pod 具有 PodStatus 对象，包含 PodCondition 数组。每个 PodCondition 包含：

type：条件类型，可能值包括：
PodScheduled：Pod 是否已被调度
Ready：Pod 是否准备好接收流量
Initialized：所有初始化容器是否成功完成
ContainersReady：Pod 中所有容器是否就绪
status：条件状态，值为 True、False 或 Unknown

### 容器探针（Probes）

探针（Probe）是 kubelet 对容器执行的定期健康检查。kubelet 通过调用容器实现的处理程序来执行诊断。

探针类型

下表总结了三种常见探针类型及其判定标准：

| 探针类型 | 描述 | 成功条件 |
| --- | --- | --- |
| ExecAction | 执行指定命令 | 命令退出码为 0 |
| TCPSocketAction | TCP 端口检查 | 端口可连接 |
| HTTPGetAction | HTTP GET 请求 | 响应状态码 200-399 |

*表 2: 容器探针类型与判定标准*
每次探测返回以下结果之一：

Success（成功）：容器通过诊断
Failure（失败）：容器未通过诊断
Unknown（未知）：诊断失败，不采取行动

探针种类

存活探针（Liveness Probe）
检测容器是否正在运行
失败时 kubelet 杀死容器，按重启策略处理
未配置时默认为 Success
就绪探针（Readiness Probe）
检测容器是否准备好接收流量
失败时从 Service 端点中移除 Pod IP
未配置时默认为 Success
启动探针（Startup Probe）
自 Kubernetes 1.16 起支持，用于慢启动容器：

检测容器是否已启动
启动探针成功前，其他探针被禁用
适用于启动时间较长的应用

探针使用指南

存活探针：适用于进程无法自愈或需自动重启的场景
就绪探针：用于控制流量路由，适合需预热或加载数据的应用
启动探针：为慢启动容器提供更长启动窗口

探针配置示例

以下 YAML 展示了三种探针的典型配置：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: probe-example
spec:
  containers:
  - name: app
    image: nginx:1.20
    ports:
    - containerPort: 80
    startupProbe:
      httpGet:
        path: /
        port: 80
      initialDelaySeconds: 10
      periodSeconds: 5
      failureThreshold: 12  # 60 秒启动窗口
    livenessProbe:
      httpGet:
        path: /health
        port: 80
      initialDelaySeconds: 15
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /ready
        port: 80
      initialDelaySeconds: 5
      periodSeconds: 5
      timeoutSeconds: 3
      successThreshold: 1
      failureThreshold: 3
```

### 就绪门控（Readiness Gates）

自 Kubernetes 1.14 起，Pod 支持扩展就绪检测机制。可在 PodSpec 中设置 readinessGates，指定额外的就绪条件：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: readiness-gate-example
spec:
  readinessGates:
    - conditionType: "example.com/load-balancer-ready"
  containers:
  - name: app
    image: nginx:1.20
status:
  conditions:
    - type: Ready
      status: "True"
      lastTransitionTime: "2023-01-01T00:00:00Z"
    - type: "example.com/load-balancer-ready"
      status: "True"
      lastTransitionTime: "2023-01-01T00:00:00Z"
```

Pod 被认为就绪需满足：

所有容器状态为 Ready
所有 readinessGates 条件为 True

### 重启策略（Restart Policy）

PodSpec 的 restartPolicy 字段控制容器重启行为。下表总结了三种重启策略及其适用场景：

| 策略 | 描述 | 适用场景 |
| --- | --- | --- |
| Always | 总是重启（默认） | 长期运行的服务 |
| OnFailure | 失败时重启 | 批处理任务 |
| Never | 从不重启 | 一次性任务 |

*表 3: Pod 重启策略与适用场景*
重启延迟：采用指数退避算法（10s, 20s, 40s, 80s, 160s, 300s）
重置条件：容器成功运行 10 分钟后重置延迟
节点限制：容器只能在同一节点重启

### Pod 生命周期管理

Kubernetes 通过控制器实现 Pod 生命周期的自动化管理。下表总结了常见控制器类型及其重启策略要求：

| 控制器 | 适用场景 | 重启策略要求 |
| --- | --- | --- |
| Deployment/ReplicaSet | 无状态应用 | Always |
| StatefulSet | 有状态应用 | Always |
| DaemonSet | 节点级服务 | Always |
| Job | 批处理任务 | OnFailure/Never |
| CronJob | 定时任务 | OnFailure/Never |

*表 4: Pod 控制器类型与重启策略要求*

### 生命周期事件
Pod 生命周期主要包括以下阶段：

创建阶段
API Server 验证并存储 Pod 规格
调度器选择节点
kubelet 拉取镜像并创建容器
运行阶段
容器启动并运行
探针持续检查健康状态
根据检查结果更新 Pod 状态
终止阶段
发送 SIGTERM 信号
等待优雅终止期（默认 30 秒）
发送 SIGKILL 强制终止

### 实际应用场景

Pod 生命周期管理和重启策略的选择需结合实际业务需求。以下为典型场景示例：

场景 1：Web 应用部署

适用于 Deployment 控制器，长期运行服务，重启策略为 Always：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
      - name: web
        image: nginx:1.20
        ports:
        - containerPort: 80
        livenessProbe:
          httpGet:
            path: /health
            port: 80
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "64Mi"
            cpu: "250m"
          limits:
            memory: "128Mi"
            cpu: "500m"
```

场景 2：批处理任务

适用于 Job 控制器，一次性或有限次数运行的任务，重启策略为 OnFailure：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-processing
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
      - name: processor
        image: data-processor:latest
        command: ["python", "process.py"]
        resources:
          requests:
            memory: "512Mi"
            cpu: "1"
          limits:
            memory: "1Gi"
            cpu: "2"
```

### 故障排查
在 Pod 生命周期管理中，常见问题及排查建议如下：

Pod 一直处于 Pending 状态
检查节点资源是否充足
验证镜像是否可拉取
确认 PVC 是否可用
容器频繁重启
检查探针配置是否合理
查看容器日志和事件
验证资源限制设置
Pod 无法接收流量
检查就绪探针状态
验证 Service 配置
确认网络策略设置

常用调试命令如下：

```bash
# 查看 Pod 状态
kubectl get pods -o wide

# 查看 Pod 详细信息
kubectl describe pod <pod-name>

# 查看 Pod 日志
kubectl logs <pod-name> -c <container-name>

# 查看 Pod 事件
kubectl get events --field-selector involvedObject.name=<pod-name>

# 进入容器调试
kubectl exec -it <pod-name> -c <container-name> -- /bin/bash
```

### 最佳实践

合理配置探针：根据应用特性设置合适的超时和重试参数，避免探针过于频繁或宽松
优化启动时间：使用启动探针为慢启动应用提供缓冲，优化镜像和启动流程
资源管理：设置合理的资源请求和限制，监控资源使用
优雅终止：处理 SIGTERM 信号，设置合适的 terminationGracePeriodSeconds

### 总结

Pod 生命周期管理是 Kubernetes 自动化运维和高可用的基础。通过合理配置探针、重启策略和生命周期事件，能够有效提升应用的健壮性和弹性。建议结合实际业务场景，灵活运用生命周期管理机制，保障集群稳定运行。

## Pod Hook

Pod Hook 让容器在关键生命周期节点自动执行自定义逻辑，是实现优雅启动与终止的核心机制，提升了 Kubernetes 运维的灵活性与可靠性。

### Pod Hook 生命周期管理与最佳实践

Pod Hook（钩子，Lifecycle Hook）是 Kubernetes 容器生命周期管理的重要机制，由 kubelet 负责执行。
Hook 在容器启动后或终止前运行，为容器提供了在关键时刻执行自定义逻辑的能力。

### Hook 类型

Kubernetes 支持两种类型的 Hook，分别适用于不同的场景。

Exec Hook

Exec Hook 用于在容器内执行命令或脚本，常用于初始化或清理操作。

```yaml
lifecycle:
  postStart:
    exec:
      command: ["/bin/sh", "-c", "echo 'Container started' > /tmp/started"]
```

HTTP Hook

HTTP Hook 用于向指定端点发送 HTTP 请求，适合与外部服务集成或通知。

```yaml
lifecycle:
  preStop:
    httpGet:
      path: /shutdown
      port: 8080
      scheme: HTTP
```

### 生命周期事件

Pod Hook 包含两个关键事件，分别在容器启动和终止时触发。

PostStart Hook
触发时机：容器创建后立即执行
执行方式：与容器主进程异步运行
阻塞行为：Kubernetes 会等待 postStart 完成后才将容器状态设置为 RUNNING
使用场景：初始化配置、注册服务、预热缓存等
PreStop Hook
触发时机：容器终止前执行
执行方式：同步阻塞调用
超时时间：默认 30 秒（可通过 terminationGracePeriodSeconds 配置）
使用场景：优雅关闭、清理资源、保存状态等

### 配置示例

以下 YAML 示例展示了如何为 Pod 配置 postStart 和 preStop 两种 Hook。
postStart Hook 会在容器启动后执行指定命令，preStop Hook 会在容器终止前向指定端点发送 HTTP 请求，实现优雅关闭。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: lifecycle-demo
spec:
  containers:
  - name: lifecycle-demo-container
    image: nginx:1.21
    lifecycle:
      postStart:
        exec:
          command: ["/bin/sh", "-c", "echo 'Hello from postStart' > /usr/share/message"]
      preStop:
        httpGet:
          path: /api/shutdown
          port: 80
          scheme: HTTP
  terminationGracePeriodSeconds: 60
```

### 重要注意事项
在使用 Pod Hook 时，需关注以下细节以确保稳定性和可维护性。

失败处理：如果 postStart 或 preStop Hook 失败，容器将被终止
执行顺序：postStart Hook 不保证在容器入口点之前执行
资源限制：Hook 继承容器的资源限制
网络访问：HTTP Hook 需要确保网络连通性

### 调试 Hook

Hook 的执行日志不会直接暴露在 Pod 事件中，调试时可参考以下方法。

查看 Pod 事件

建议首先通过 kubectl describe pod 命令查看 Pod 的事件（Events）信息。
虽然 Hook 的详细输出不会直接显示在事件中，但可以通过事件了解 Hook 是否被触发以及是否有失败记录。

```bash
kubectl describe pod <pod-name>
```

常见错误事件

FailedPostStartHook：postStart Hook 执行失败
FailedPreStopHook：preStop Hook 执行失败

调试技巧

在 Hook 中添加日志输出到文件
使用简单的测试命令验证 Hook 逻辑
检查容器的网络和权限配置

### 最佳实践

为了提升 Pod Hook 的可靠性和可维护性，建议遵循以下最佳实践：

保持 Hook 逻辑简单可靠，避免复杂操作
确保 Hook 可以安全地重复执行（幂等性）
为 preStop Hook 设置合适的超时时间
在 Hook 中添加适当的错误处理逻辑
充分测试 Hook 在各种场景下的行为

### 总结

Pod Hook 是 Kubernetes 容器生命周期管理的关键机制，
通过 postStart 和 preStop 事件，开发者可实现容器的优雅启动与终止，提升系统的自动化和稳定性。
合理配置和调试 Hook，有助于构建高可用、易维护的云原生应用。

## Pod 中断与 PDB（Pod 中断预算）

Pod 中断预算（PDB）是保障 Kubernetes 关键应用高可用与安全运维的核心机制，合理配置可有效降低中断风险，提升集群稳定性。

### Pod 中断预算机制与高可用实践

Pod 中断预算（Pod Disruption Budget，简称 PDB）是 Kubernetes 中用于保护应用程序可用性的重要机制。
本文将帮助应用程序开发者构建高可用应用，同时为集群管理员提供安全执行自动化运维操作的指导。

### 中断类型：自愿与非自愿

Pod 的生命周期可能因各种原因而终止，主要分为两大类：非自愿中断和自愿中断。

非自愿中断
非自愿中断是指由于不可预见的硬件或系统故障导致的 Pod 终止，主要包括：

硬件故障：节点物理机器故障
操作失误：管理员意外删除虚拟机实例
基础设施问题：云提供商故障、虚拟化层异常
系统故障：内核崩溃（kernel panic）
网络分区：节点因网络问题与集群失联
资源耗尽：节点资源不足导致 Pod 被驱逐
注意：除资源不足外，这些情况并非 Kubernetes 特有，而是分布式系统的常见挑战。

### 自愿中断

自愿中断是指由人为操作或自动化流程主动触发的 Pod 终止，分为以下几类：

应用程序维护操作：删除或更新 Deployment 等工作负载控制器、修改 Pod 模板导致重新部署、直接删除 Pod（通常为误操作）
集群运维操作：节点排空（drain）进行维护或升级、集群缩容时移除节点、资源调度优化时迁移 Pod
这些操作可能由管理员手动执行，也可能通过自动化工具完成。建议向集群管理员或云服务提供商确认是否启用了相关自动化功能。

### 应对中断的策略

针对不同类型的中断，需采取相应的防护和管理措施。

减轻非自愿中断的影响
资源配置：为 Pod 正确配置资源请求和限制
应用程序复制：部署多副本应用程序（无状态应用和有状态应用）
分布式部署：使用反亲和性策略将副本分散到不同机架或可用区
管理自愿中断
不同集群的自愿中断频率差异很大。基础的 Kubernetes 集群可能很少发生自愿中断，但生产环境通常需要定期进行：

节点系统更新
集群版本升级
自动扩缩容操作
Kubernetes 通过 Pod 中断预算机制来平衡运维需求与服务可用性。

### Pod 中断预算的工作机制

Pod 中断预算（PDB）是一种 Kubernetes 资源对象，用于限制同时发生自愿中断的 Pod 数量。
它通过以下方式保护应用程序：

最小可用副本数：确保始终有足够数量的 Pod 运行
最大不可用副本数：限制同时中断的 Pod 数量
标签选择器：精确指定受保护的 Pod 范围

### 工作流程

Pod 中断预算的典型工作流程如下：

创建 PDB：应用程序所有者为关键服务定义中断预算
中断请求：管理员或自动化工具通过 Eviction API 请求驱逐 Pod
预算检查：Kubernetes 验证驱逐操作是否违反 PDB 约束
执行或拒绝：满足预算要求时执行驱逐，否则拒绝请求

### 重要特性

仅限自愿中断：PDB 无法阻止非自愿中断
优雅终止：通过 Eviction API 驱逐的 Pod 会按照 terminationGracePeriodSeconds 优雅关闭
滚动更新兼容：控制器（如 Deployment）在滚动更新时不受 PDB 限制

### 实践示例：节点维护场景

以下示例展示了 PDB 在节点维护场景下的实际应用。

初始状态

下表展示了 3 节点集群的初始 Pod 分布：

| node-1 | node-2 | node-3 |
| --- | --- | --- |
| pod-a available | pod-b available | pod-c available |
| pod-x available | | |

*表 1: 节点维护初始状态示意表*

其中 pod-a、pod-b、pod-c 属于同一个 Deployment，配置了要求至少 2 个副本可用的 PDB。

第一步：排空 node-1

管理员执行 kubectl drain node-1，Pod 状态如下：

| node-1 draining | node-2 | node-3 |
| --- | --- | --- |
| pod-a terminating | pod-b available | pod-c available |
| pod-x terminating | | |

*表 2: 排空 node-1 后 Pod 状态*

控制器检测到 pod 终止，创建替代 Pod：

| node-1 draining | node-2 | node-3 |
| --- | --- | --- |
| pod-a terminating | pod-b available | pod-c available |
| pod-x terminating | pod-d starting | pod-y |

*表 3: 新 Pod 创建中状态*

第二步：等待新 Pod 就绪

| node-1 drained | node-2 | node-3 |
| --- | --- | --- |
| pod-b available | pod-c available | |
| pod-d available | pod-y | |

*表 4: 新 Pod 就绪后状态*

第三步：尝试排空 node-2
当管理员尝试排空 node-2 时，系统会：

成功驱逐 pod-b（仍有 2 个副本可用）
拒绝驱逐 pod-d（会导致可用副本少于 2 个）
最终状态可能如下：

| node-1 drained | node-2 draining | node-3 | no node |
| --- | --- | --- | --- |
| pod-c available | pod-e pending | | |
| pod-d available | pod-y | | |

*表 5: 排空 node-2 后可能状态*

此时需要增加集群容量或等待资源释放才能继续维护操作。

### 角色分离与最佳实践
Pod 中断预算支持以下角色分离，便于团队协作和职责明确。

应用程序所有者：定义业务可用性要求，创建 PDB
集群管理员：执行基础设施维护，遵循 PDB 约束
平台团队：提供自动化工具，集成 Eviction API

### 集群维护策略

根据不同需求选择合适的维护策略，见下表：

| 策略 | 停机时间 | 资源成本 | 自动化程度 | 适用场景 |
| --- | --- | --- | --- | --- |
| 接受停机 | 有 | 低 | 高 | 测试环境 |
| 蓝绿部署 | 无 | 高 | 中 | 关键业务 |
| PDB + 滚动维护 | 无 | 低 | 高 | 生产推荐 |

*表 6: 集群维护策略对比表*

### 配置建议

合理配置 PDB 和应用架构，有助于提升系统可用性和维护效率。

### PDB 最佳实践
合理设置预算：平衡可用性和维护效率
测试验证：在非生产环境验证 PDB 行为
监控告警：跟踪中断事件和预算使用情况
文档记录：明确记录中断容忍度要求

### 应用程序设计

实现优雅关闭处理
支持快速启动和健康检查
设计无状态或状态可恢复的架构

### 总结

Pod 中断预算（PDB）是 Kubernetes 集群高可用和安全运维的关键保障。
通过合理配置 PDB、优化应用架构和团队协作，可有效降低中断风险，提升服务稳定性和自动化运维能力。

## 配置 Pod 的 liveness 和 readiness 探针

Liveness 和 Readiness 探针是 Kubernetes 健康检查的核心机制，合理配置可提升应用的高可用性和自动化运维能力。

### 探针概述

Kubernetes 通过探针（Probe）机制动态感知容器的健康和服务可用性，自动实现自愈和流量调度。

![Kubernetes 探针生命周期流程](/images/K8s学习-PartI-Pod/Kubernetes 探针生命周期流程.svg)

*图 1: Kubernetes 探针生命周期流程*

### Liveness Probe（存活探针）
Kubelet 使用 liveness probe 判断容器是否需要重启。当进程死锁或进入不可恢复状态时，liveness 探针可自动触发重启，提升系统自愈能力。

### Readiness Probe（就绪探针）

Kubelet 使用 readiness probe 判断容器是否已准备好接收流量。只有所有容器就绪，Pod 才会加入 Service 负载均衡池，避免流量打到未准备好的实例。

### 探针类型与配置

Kubernetes 支持三种探针类型，分别适用于不同场景。

基于命令的 Liveness 探针

适用于进程内部健康状态可通过命令检测的场景。

```yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    test: liveness
  name: liveness-exec
spec:
  containers:
  - name: liveness
    image: registry.k8s.io/busybox
    args:
    - /bin/sh
    - -c
    - touch /tmp/healthy; sleep 30; rm -rf /tmp/healthy; sleep 600
    livenessProbe:
      exec:
        command:
        - cat
        - /tmp/healthy
      initialDelaySeconds: 5
      periodSeconds: 5
```

说明：

periodSeconds：每 5 秒探测一次
initialDelaySeconds：启动后 5 秒首次探测
探针执行 cat /tmp/healthy，返回 0 视为健康，否则重启容器
测试流程：

创建 Pod：

```bash
kubectl apply -f exec-liveness.yaml
```

在 30 秒内查看 Pod 状态：

```bash
kubectl describe pod liveness-exec
```

35 秒后再次查看，会发现 liveness probe 失败的事件：

```bash
kubectl get pod liveness-exec
```

基于 HTTP 的 Liveness 探针

HTTP GET 请求是另一种常用的 liveness probe 方式：

```yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    test: liveness
  name: liveness-http
spec:
  containers:
  - name: liveness
    image: registry.k8s.io/liveness
    args:
    - /server
    livenessProbe:
      httpGet:
        path: /healthz
        port: 8080
        httpHeaders:
        - name: X-Custom-Header
          value: Awesome
      initialDelaySeconds: 3
      periodSeconds: 3
```

说明：

kubelet 向 8080 端口 /healthz 发送 HTTP GET
2xx/3xx 状态码为健康，其他为失败

基于 TCP 的 Liveness/Readiness 探针

适用于无需 HTTP 接口的 TCP 服务。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: goproxy
  labels:
    app: goproxy
spec:
  containers:
  - name: goproxy
    image: registry.k8s.io/goproxy:0.1
    ports:
    - containerPort: 8080
    livenessProbe:
      tcpSocket:
        port: 8080
      initialDelaySeconds: 15
      periodSeconds: 20
    readinessProbe:
      tcpSocket:
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 10
```

说明：

kubelet 尝试连接 8080 端口，连通即健康

### Readiness 探针配置示例

Readiness 探针常用于应用启动慢、需预热等场景。

```yaml
readinessProbe:
  exec:
    command:
    - cat
    - /tmp/healthy
  initialDelaySeconds: 5
  periodSeconds: 5
```

HTTP/TCP 配置方式与 livenessProbe 相同，仅字段名不同。

### 使用命名端口

可用命名端口提升配置可读性：

```yaml
ports:
- name: liveness-port
  containerPort: 8080

livenessProbe:
  httpGet:
    path: /healthz
    port: liveness-port
```

### 探针配置参数

![探针参数关系](/images/K8s学习-PartI-Pod/探针参数关系.svg)

*图 2: 探针参数关系*

通用参数
initialDelaySeconds：首次探测前等待时间（默认 0）
periodSeconds：探测频率（默认 10，最小 1）
timeoutSeconds：探测超时（默认 1，最小 1）
successThreshold：连续成功次数（默认 1，liveness 必须为 1）
failureThreshold：连续失败次数（默认 3，最小 1）
HTTP 探针特有参数
host：目标主机名（默认 Pod IP）
scheme：协议（默认 HTTP，可选 HTTPS）
path：访问路径
httpHeaders：自定义请求头
port：目标端口

### 启动探针（Startup Probe）【2024 新推荐】

更新（2024）

Kubernetes 1.16+ 支持 startupProbe，用于检测容器启动阶段健康，适合启动慢的应用。
配置 startupProbe 后，liveness/readiness 探针会在启动探针通过后才生效，避免误杀。

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

### 最佳实践
合理设置超时时间：避免因网络延迟导致误判
区分使用场景：
Liveness probe：检测进程是否需要重启
Readiness probe：检测服务是否可对外提供流量
Startup probe：适用于启动慢的服务
谨慎配置失败阈值：防止临时故障导致频繁重启
监控探针事件：通过 kubectl describe pod 及时发现探针异常
避免探针本身影响性能：探针命令/接口应高效、轻量