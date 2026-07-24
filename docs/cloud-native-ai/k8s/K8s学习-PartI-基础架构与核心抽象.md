---
title: "K8s 学习 · Part I：基础架构与核心抽象 之 Kubernetes 架构"
date: 2026-03-19 15:02:00
categories: 云原生
tags: [Kubernetes, 学习路线, 架构, 核心抽象, etcd]
---

# K8s 学习 · Part I：基础架构与核心抽象 之 Kubernetes 架构

## 学习目标

- 建立 Kubernetes 的整体架构心智模型：控制面 / 节点、声明式、控制循环。
- 掌握核心抽象：Pod、Namespace、Label / Selector、Service、工作负载控制器。
- 能用 `kubectl` 完成常见资源的创建、查询、排错与调试。

---

## 精读目录（Part I 其余章节）

> 下列小节为 **提纲**，详细笔记可按书中顺序逐章补充。

| 章节 | 要点 |
| --- | --- |
| **开放接口** | CRI / CNI / CSI 概述 |
| **Pod** | 解析、Init / Pause / Sidecar、生命周期、探针；专文见《K8s 学习 · Part I：基础架构与核心抽象 之 Pod》 |
| **集群资源管理** | Node、Namespace、Label、污点容忍、GC、调度、QoS；专文见 [集群资源管理 · 概述](./K8s学习-PartI-集群资源管理/概述) |
| **控制器** | Deployment、StatefulSet、DaemonSet、Job、Ingress、HPA 等；专文见《K8s 学习 · Part I：基础架构与核心抽象 之 控制器》 |
| **服务发现与路由** | Service、Ingress、Gateway API |
| **身份与权限** | ServiceAccount、RBAC、SPIFFE / SPIRE（了解） |
| **网络** | Flannel / Calico / Cilium（选一深入） |
| **存储** | ConfigMap、Secret、Volume、PV、StorageClass |
| **etcd** | 角色、Raft、存储分层、与 `/registry`、只读排障 |

---

## Kubernetes 架构（精读笔记）

### 架构总览

Kubernetes 采用**分布式架构**：**控制面**与**工作节点**分离，实现决策集中与任务分布的高可用设计。

![Kubernetes 架构总览](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes%20架构总览.png)

### 控制面组件

控制面负责全局决策与事件响应，核心组件如下：

| 组件 | 描述 | 主要职责 |
| --- | --- | --- |
| **kube-apiserver** | 控制面的前端入口 | 提供 API，处理所有请求 |
| **etcd** | 一致性高可用键值存储 | 存储集群所有数据 |
| **kube-scheduler** | 监听新建 Pod | 根据资源将 Pod 调度到节点 |
| **kube-controller-manager** | 运行控制器进程 | 通过控制循环维护集群状态 |

### 节点组件

每个节点运行以下组件，负责 Pod 的实际运行与网络管理。

![节点组件与 Pod 关系](/images/K8s学习-PartI-基础架构与核心抽象/节点组件与%20Pod%20关系.png)

| 组件 | 描述 | 主要职责 |
| --- | --- | --- |
| **kubelet** | 节点代理 | 保证 Pod 中容器运行 |
| **kube-proxy** | 网络代理 | 维护节点网络规则 |
| **容器运行时** | 容器执行环境 | 运行容器（如 Docker、containerd、CRI-O） |

### Kubernetes API 与对象模型

Kubernetes API 定义了一组资源类型（对象），所有操作均通过 **API Server** 完成，负责对象的校验与配置。

#### API 概念

![Kubernetes API 请求流程](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes%20API%20请求流程)

Kubernetes API 遵循 RESTful 设计：

- 资源通过 HTTP 动词（`GET`、`POST`、`PUT`、`DELETE`、`PATCH`）访问。
- 资源按 **API 组**组织（如 `apps`、`batch`、`networking.k8s.io`）。
- 对象包含 `metadata`、`spec`、`status` 等字段。

#### 对象的声明式管理

Kubernetes 对象是集群状态的持久实体，描述：

- 运行的容器化应用  
- 可用资源  
- 行为策略  

每个对象有两个关键字段：

| 字段 | 含义 |
| --- | --- |
| **`spec`** | 用户声明的**期望状态** |
| **`status`** | Kubernetes 实际观测到的**当前状态** |

#### 对象命名与标识

| 标识 | 描述 | 示例 |
| --- | --- | --- |
| **Name** | 用户自定义名称 | `nginx-deployment` |
| **UID** | 系统生成的全局唯一标识 | `a8f3d1c8-0aeb-11e9-a4c2-000c29ed5138` |
| **Namespace** | 命名空间范围 | `default`、`kube-system` |

命名空间内资源名称唯一；**集群级资源**全局唯一。

#### 标签与选择器

**标签（Label）** 是附加在对象上的键值对，用于组织和筛选对象。

![标签与选择器示例](/images/K8s学习-PartI-基础架构与核心抽象/标签与选择器示例.png)

常见用途：

- 服务选择 Pod  
- 对象分组与组织  
- 批量操作对象  

#### 字段选择器（Field Selector）

可根据对象字段筛选资源，例如：

```bash
kubectl get pods --field-selector status.phase=Running
```

下面按资源汇总**常用、且多在排障/运维里会用到的核心字段**（是否都能用于 `kubectl ... --field-selector` 与 **Kubernetes 版本**有关；拿不准时用 `kubectl get <资源> --show-managed-fields=false -o yaml` 对照实际对象，或查当前版本文档）。

| 资源类型 | 支持的核心字段 | 字段含义（通俗版） |
| --- | --- | --- |
| **Pod（核心）** | `status.phase` | Pod **顶层阶段**：`Running` / `Pending` / `Failed` / `Succeeded` / `Unknown`（粗粒度，细粒度还要看 Conditions 与容器状态）。 |
| | `spec.nodeName` | Pod **落在哪个节点**上；未调度时往往为空。 |
| | `spec.serviceAccountName` | Pod 使用的 **ServiceAccount**（鉴权身份）。 |
| | `metadata.namespace` | Pod 所属的 **命名空间**（跨命名空间列表时配合筛选常用）。 |
| | `status.podIP` | 分配给该 Pod 的 **集群内 IP**（未分配前可能为空）。 |
| **Node（核心）** | `spec.unschedulable` | 节点是否被标记为 **不可调度**：`true` = cordon 后不再调度新 Pod；`false` = 正常参与调度。 |
| | `metadata.name` | **节点对象名**（通常与主机名一致），用于按名单挑节点。 |
| | `metadata.labels.<键>` | 按 **节点标签**筛选时需写全键名，例如 `metadata.labels.env=prod`（是否支持取决于版本；**日常更常用**的是带 `--selector` 的 **Label Selector**）。 |
| **Event（排障）** | `involvedObject.kind` | 事件挂在哪种资源上，例如 `Pod`、`Node`、`Deployment`。 |
| | `involvedObject.name` | 上述资源的 **具体名字**（例如某个 Pod / Node 名）。 |
| | `reason` | 事件 **原因码**，如 `FailedScheduling`、`NodeNotReady`（便于和日志、告警对齐）。 |
| | `type` | 事件 **级别**：`Normal` 多为预期流程；`Warning` 多表示异常或风险，排障优先看。 |
| **Service（网络）** | `spec.type` | Service **对外暴露形态**：`ClusterIP` / `NodePort` / `LoadBalancer` / `ExternalName`。 |
| | `metadata.namespace` | Service 所在 **命名空间**。 |
| **Deployment（部署）** | `metadata.namespace` | Deployment 所在 **命名空间**。 |
| | `spec.replicas` | **期望副本数**（**仅部分 Kubernetes 版本**支持作为 field selector；不支持时用 Label 或 jsonpath/`grep` 过滤）。 |
| **Namespace（命名空间）** | `status.phase` | 命名空间 **生命周期状态**：`Active` = 正常使用；`Terminating` = 正在删除、资源尚未清完（卡删除时常查它）。 |

> **易混点（Node）**：`Node` 对象 **没有** 与 Pod 同名的 `status.phase`。你在 `kubectl get node` 里看到的 **Ready / NotReady / Unknown** 来自 **`status.conditions`**（如 `Ready`），一般 **不能** 用一条简单的 `--field-selector status.phase=...` 当 Node 用；要看就绪请 `describe node` 或查 `conditions`。

##### 常用命令速查

**1. Pod 筛选（最常用）**

```bash
# 多条件用英文逗号连接（逻辑与）
kubectl get pods --field-selector status.phase=Running,spec.nodeName=node-1

# 否定：筛「非 Running」的 Pod（排查异常）
kubectl get pods --field-selector status.phase!=Running

# 按 ServiceAccount 筛
kubectl get pods --field-selector spec.serviceAccountName=default
```

**2. Node 筛选（运维排障）**

```bash
# 不可调度（cordon / 维护中常见）
kubectl get nodes --field-selector spec.unschedulable=true

# 「非 Ready」节点：Node API 无 status.phase，不能写 status.phase=NotReady
# 下面用 STATUS 列（来自 Ready 条件）快速过滤：
kubectl get nodes --no-headers | awk '$2 != "Ready" { print $1 "\t" $2 }'
```

**3. Event 筛选（快速定位告警）**

> `kubectl get events` 默认只看**当前命名空间**；要看全集群请加 **`-A`**（或 `-n <ns>`）。

```bash
kubectl get events --field-selector type=Warning

kubectl get events -A --field-selector type=Warning,involvedObject.kind=Pod

kubectl get events -A --field-selector reason=NodeNotReady
```

**4. Service / Namespace 筛选**

```bash
# 所有 NodePort 类型的 Service（当前命名空间；跨 NS 加 -A）
kubectl get svc --field-selector spec.type=NodePort

# 卡在 Terminating 的命名空间（删不干净时常查）
kubectl get ns --field-selector status.phase=Terminating
```

**5. Deployment（可选，视集群版本）**

```bash
# 部分版本支持按期望副本数筛；不支持会报错，可改用 label 或 jsonpath
kubectl get deploy --field-selector spec.replicas=3
```

### 命名空间与资源隔离

命名空间用于在单集群内隔离资源，适合多租户场景。

![命名空间资源隔离示意](/images/K8s学习-PartI-基础架构与核心抽象/命名空间资源隔离示意.png)

Kubernetes 默认包含四个命名空间：

| 命名空间 | 说明 |
| --- | --- |
| **default** | 默认命名空间 |
| **kube-system** | 系统组件 |
| **kube-public** | 所有用户可读，公开资源 |
| **kube-node-lease** | 节点心跳（Lease）对象 |

### 对象所有权与垃圾回收

Kubernetes 通过 **`ownerReference`** 管理对象生命周期，实现级联删除。

![对象所有权与级联删除](/images/K8s学习-PartI-基础架构与核心抽象/对象所有权与级联删除.png)

删除对象时可选择策略：

| 策略 | 说明 |
| --- | --- |
| **前台删除** | 先删除依赖对象，再删除所有者 |
| **后台删除** | 立即删除所有者，依赖对象在后台清理 |
| **孤立删除** | 仅删除所有者，保留依赖对象 |

### API Server 工作机制

API Server 是控制面的核心，负责各组件间通信与 API 暴露。

#### 请求处理流程

![API Server 请求处理流程](/images/K8s学习-PartI-基础架构与核心抽象/API%20Server%20请求处理流程.png)

典型顺序：

1. **认证** — 校验客户端身份  
2. **鉴权** — 检查权限  
3. **准入控制** — 执行策略或修改对象  
4. **校验** — 结构合法性检查  
5. **存储** — 持久化到 etcd  

#### Server-Side Apply（SSA）

支持多客户端协作管理资源字段，自动冲突检测与合并。

![Server-Side Apply 工作原理](/images/K8s学习-PartI-基础架构与核心抽象/Server-Side%20Apply%20工作原理.png)

主要特性：

- 跟踪字段归属  
- 冲突自动检测与提示  
- 支持控制器与人工协作  

### Kubernetes 扩展机制（总览）

Kubernetes 支持多种扩展方式，无需修改核心代码即可适配不同场景。

![Kubernetes 扩展点](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes%20扩展点.png)

| 扩展类型 | 作用 | 示例 |
| --- | --- | --- |
| **自定义资源** | 扩展 API 对象类型 | CRD、API 聚合 |
| **准入 Webhook** | 拦截 API 请求校验 / 变更 | ValidatingWebhook、MutatingWebhook |
| **调度扩展** | 自定义 Pod 调度逻辑 | 调度插件、多调度器 |
| **认证模块** | 新增认证方式 | OIDC、Webhook Token Auth |
| **网络插件** | 实现 Pod 网络 | Calico、Cilium、Flannel |
| **存储插件** | 支持多种存储系统 | CSI 插件 |

### 日志与监控

Kubernetes 提供多种日志与监控能力，便于集群与应用运维。

#### 系统组件日志

| 组件 | Linux 路径 | Windows 路径 |
| --- | --- | --- |
| kube-apiserver | `/var/log/kube-apiserver.log` | `C:\var\logs\kube-apiserver.log` |
| kube-scheduler | `/var/log/kube-scheduler.log` | `C:\var\logs\kube-scheduler.log` |
| kube-controller-manager | `/var/log/kube-controller-manager.log` | `C:\var\logs\kube-controller-manager.log` |
| kubelet | `/var/log/kubelet.log` | `C:\var\logs\kubelet.log` |
| containers | `/var/log/pods/<namespace>_<pod-name>_<uid>/<container-name>/` | `C:\var\log\pods\<namespace>_<pod-name>_<uid>\<container-name>\` |

#### 指标采集

Kubernetes 组件通过 **`/metrics`** 端点暴露 Prometheus 格式指标。

![Kubernetes 指标采集流程](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes%20指标采集流程.png)

这些指标有助于集群健康与性能监控。

#### 分布式追踪

Kubernetes 支持分布式追踪，便于跨组件监控与故障排查。

![Kubernetes 分布式追踪流程](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes%20分布式追踪流程.png)

系统组件可通过 **OpenTelemetry** 等协议记录操作延迟与依赖关系。

### 本节小结

本节梳理了 Kubernetes 的**核心架构**、**对象模型**、**命名空间**、**对象管理与扩展**、**可观测性**等基础内容。掌握这些概念，是高效使用与运维集群的前提；其余 Part I 专题可按上文「精读目录」逐章展开。

---

## Kubernetes 的设计理念

> 与《Kubernetes 教程》「设计理念」章节对应：分层视角、API/控制面设计原则，以及核心 API 对象速览。

### 分层架构

Kubernetes 采用**分层架构**，从底层基础设施到上层应用形成完整技术栈。

![Kubernetes 分层架构](/images/K8s学习-PartI-基础架构与核心抽象/Kubernetes%20分层架构.png)

| 层次 | 说明 |
| --- | --- |
| **核心层** | 最核心能力：对外提供 API 构建上层应用，对内提供**插件式**执行环境。 |
| **应用层** | **部署**（无状态 / 有状态 / 批处理 / 集群应用等）与 **路由**（服务发现、DNS 等）。 |
| **管理层** | **度量**（基础设施、容器、网络等）、**自动化**（扩缩容、动态 Provision 等）、**策略**（RBAC、Quota、PSP、NetworkPolicy 等）。 |
| **接口层** | `kubectl`、客户端 SDK、集群联邦（Federation）等。 |

**生态系统**（接口层之上）：可粗分为 **集群外部** 与 **集群内部** 两类能力。

- **Kubernetes 外部**：日志、监控、配置管理、CI/CD、Workflow、FaaS、OTS、ChatOps 等。  
- **Kubernetes 内部**：CRI、CNI、CVI、镜像仓库、Cloud Provider、集群自身配置与管理等。  

### API 设计原则

对云/分布式系统而言，**API 处于设计统领地位**：每支持一项新能力，往往会引入对应 **API 对象**；理解 API 近似于抓住系统的「牛鼻子」。常见原则如下：

1. **声明式（Declarative）**  
   相对命令式，重复应用同一期望状态更**稳定**，适合易丢消息、易重复的分布式环境；对用户更友好，便于隐藏实现细节、保留持续优化空间。声明式 API 多以**名词**表达目标对象（如 `Service`、`Volume`）。

2. **对象互补且可组合**  
   倾向「高内聚、松耦合」的分解方式，提高可重用性。Kubernetes 作为调度与管理平台，其「业务」就是管理容器与工作负载。

3. **高层 API 面向操作意图**  
   从业务与意图出发设计，而非过早绑定实现细节。

4. **低层 API 服从高层控制需求**  
   低层 API 为高层服务，减少冗余、提高复用，以需求驱动而非单纯炫技。

5. **避免无意义的简单封装**  
   不在外部无法感知的层面藏「黑魔法」。例如 **StatefulSet** 与 **ReplicaSet** 用不同对象区分有状态/无状态集合，而不是一个 RS 内部偷偷分支。

6. **操作复杂度与对象规模的关系可控**  
   典型要求：API 操作复杂度不超过 **O(N)**（N 为对象数量），否则难以水平扩展。

7. **对象状态不依赖网络连接是否瞬时可用**  
   分布式环境下断连常见，API 语义需能应对网络抖动。

8. **尽量避免操作机制依赖难以同步的全局状态**。

### 控制机制设计原则

- **只依赖当前可观测状态**：便于故障后重置到稳定状态，控制逻辑仍可预期运行。  
- **假设错误必然发生**：物理故障、外部依赖、自身代码错误均需容错。  
- **避免复杂状态机**：控制逻辑勿依赖无法被其他子系统观测的「内部状态」。  
- **假设请求可能被拒绝或误解析**：子系统可能来自不同团队，错误不得拖垮整体稳定性。  
- **模块可自愈**：断连其他模块时不应自我崩溃。  
- **必要时优雅降级**：基本功能不依赖高级功能，避免高级故障拖垮整体，并便于迭代高级能力。  

### 核心技术概念与 API 对象

**API 对象**是集群中的管理单元；新能力常伴随新对象（例如副本集对应 **ReplicaSet / RS**）。

#### 三类通用字段

| 部分 | 作用 |
| --- | --- |
| **metadata** | 标识对象：`namespace`、`name`、`uid`、**labels** 等（如 `env=dev/testing/production` 区分环境）。 |
| **spec** | 用户期望的 **Desired State**（如期望 Pod 副本数为 3）。 |
| **status** | 系统观测到的 **Current State**（如当前副本数为 2）；控制器据此向 spec 收敛。 |

集群配置通过 **`spec`** 表达期望状态，操作以**声明式**为主：同一「副本数=3」提交多次结果一致；而「副本数+1」类命令式重复执行则易错。

#### Pod

运行应用或服务的**最小调度单元**，可包含多容器。设计理念：多容器**共享网络与存储命名空间**，通过进程间通信、文件共享组合成服务（例如 Nginx + 同步侧车）。  

业务形态可粗分为：长期运行、批处理、节点守护、有状态等，常见对应控制器：**Deployment**、**Job**、**DaemonSet**、**StatefulSet**（后文 Part I 各章会展开）。

#### 副本控制器（Replication Controller，RC）

早期保证 Pod **副本数**的对象：少了就启、多了就删；即使副本为 1，也比裸跑 Pod 更易维持可用。偏**长期伺服**场景；现多被 RS/Deployment 替代。

#### 副本集（ReplicaSet，RS）

新一代 RC，**选择器更灵活**。实践中常与 **Deployment** 配合，很少单独使用。

#### 部署（Deployment）

表示对集群的一次**版本/规模更新**：新建服务、滚动升级等。滚动升级可理解为**新 RS 扩容 + 旧 RS 缩容至 0** 的复合过程，用单一 RS 难以表达，故用 Deployment 抽象。

#### 服务（Service）

解决 **Pod IP 不稳定** 下的稳定访问：配合服务发现与负载均衡。集群内常通过 **Cluster IP** 访问；节点侧负载均衡与 **kube-proxy** 的实现相关（每节点一份代理，随规模水平扩展）。

#### 任务（Job）

**批处理**型工作负载：有始有终，完成后 Pod 退出。完成语义依 `spec.completions` 等策略：单 Pod 成功、定数成功、工作队列全局成功等。

#### 后台支撑服务集（DaemonSet）

保证**每个节点（或选定节点）**运行某类 Pod：日志、监控、存储代理等节点级支撑组件常见。

#### 有状态服务集（StatefulSet）

由早期 PetSet 演进而来（1.9 GA）。**无状态**（cattle / 可替换）与**有状态**（pet / 稳定标识）对照：RS 下 Pod 名随机、可替换；StatefulSet 下 **Pod 标识稳定**，与**独立存储**绑定，故障重建后延续同一逻辑身份。适用于数据库、ZooKeeper、etcd 等；也可在「虚拟机式」有状态工作负载场景使用（配合外部可靠存储）。

#### 集群联邦（Federation）

跨可用区、Region、云厂商时，单集群通常聚焦**同一地域**内网络与时延；Federation 面向**多集群**注册与协调：联邦控制面在各子集群同步对象，跨集群流量常结合 DNS 负载均衡。V1 尽量不改子集群机制；V2 在保留 K8s API 同时扩展联邦专用接口（演进以官方文档为准）。

#### 存储卷（Volume）

作用域为 **Pod**（多容器共享），区别于 Docker「单容器卷」。支持 `emptyDir`、`hostPath`、NFS、云盘、Ceph/GlusterFS 等；**PVC** 让使用者不必关心后端存储实现细节。

#### 持久卷（PV）与声明（PVC）

**PV** 由管理员配置，**PVC** 由使用者声明，关系类比 **Node / Pod**：提供方与消费方分离。

#### 节点（Node）

工作负载运行所在主机（物理机/虚拟机）；历史上曾称 Minion。统一特征是运行 **kubelet** 管理本节点容器。

#### 密钥对象（Secret）

存放密码、证书等敏感数据，避免明文写入清单；通过引用注入 Pod，减少暴露面。

#### 用户帐户与服务帐户（User / Service Account）

**用户账户**面向人，通常**跨 namespace**；**ServiceAccount** 面向进程与 Pod，与**特定 namespace** 绑定。

#### 命名空间（Namespace）

提供逻辑隔离；初始常见 **default**、**kube-system** 等，管理员可按需新建。

#### RBAC 访问授权

相对 ABAC，引入 **Role** 与 **RoleBinding**：策略绑定到角色，用户再绑定角色，便于扩展与复用。

### 本节总结

Kubernetes 最核心的两条设计理念：**容错性**（稳定与安全的基础）与**易扩展性**（对变更友好、快速迭代）。

Leslie Lamport 对分布式系统的划分——**安全性（Safety）** 与 **活性（Liveness）**——与上述理念相契合：前者「不该发生的别发生」，后者「在合理时间内把事情做成」。K8s 在引入 RBAC、Federation、StatefulSet（由 PetSet 演进）等能力时，对两类性质的分界有助于保持版本迭代节奏。

---

## Etcd 解析

> **etcd** 是 Kubernetes 控制面的**事实存储**：集群对象与状态经 **kube-apiserver** 持久化到 etcd。强一致、高可用由 **Raft** 共识保障，是云原生里最常见的协调/配置存储之一。

### 简介

etcd 是**分布式键值存储**，在 Kubernetes 中负责保存**资源对象与集群状态**。日常变更应走 **Kubernetes API**，仅在排障、学习或灾备场景下再直接碰 etcd。

### 核心职责与特性

| 维度 | 说明 |
| --- | --- |
| **职责** | 存储对象状态与元数据；支撑配置与协调类需求（锁、选举等，视使用方式而定）。 |
| **一致性** | **Raft** 共识，线性化写入；少数节点故障仍可服务（满足多数派）。 |
| **接口** | **gRPC**（v3）；`etcdctl`、各语言 **clientv3**。 |

**常见特性归纳**：API 清晰、TLS 与 RBAC、MVCC 与 **Watch**、WAL + 快照与压缩、适合作为控制面后端。

---

### 架构与请求路径

etcd 为 **Client / Server** 多副本集群；客户端通过 **clientv3** 或 **etcdctl** 访问。

#### 系统架构

下图展示主要组件及交互关系。

![Etcd 系统架构](/images/K8s学习-PartI-基础架构与核心抽象/Etcd%20系统架构.png)

| 组件 | 作用 |
| --- | --- |
| **客户端接口** | gRPC API、客户端库 |
| **EtcdServer** | 处理请求、协调 Raft、集成子系统 |
| **认证** | 身份校验与 **RBAC** |
| **MVCC 存储** | 带修订版本（revision）的键值 |
| **租约（Lease）** | TTL、临时键 |
| **Raft** | 日志复制与选主 |
| **持久化** | **WAL**、**bbolt** 等 |

#### 请求处理流程

读可分为**串行化读**（可能略旧）与**线性化读**（更贴近最新已提交数据）；写经 **Raft** 复制后再应用到状态机。

![Etcd 请求处理流程](/images/K8s学习-PartI-基础架构与核心抽象/Etcd%20请求处理流程.png)

---

### EtcdServer、Raft 与存储

#### EtcdServer 与 Raft 节点

**EtcdServer** 是中央协调单元（实现可参考上游 `server/etcdserver/server.go`）：应用请求、成员变更、租约与 **Watch**、快照与压缩等。**raftNode**（如 `raft.go`）封装 Raft 与 EtcdServer 的衔接。

![Raft 节点与 EtcdServer 交互](/images/K8s学习-PartI-基础架构与核心抽象/Raft%20节点与%20EtcdServer%20交互.png)

**Raft 侧要点**：选主、日志复制、成员变更、安全规则避免脑裂。

#### 存储层次

![Etcd 存储层次结构](/images/K8s学习-PartI-基础架构与核心抽象/Etcd%20存储层次结构.png)

| 层次 | 说明 |
| --- | --- |
| **MVCC** | 多版本键值，支持按 **revision** 查询与 Watch |
| **bbolt** | 持久化 B+ 树后端 |
| **WAL** | 先写日志，崩溃恢复 |
| **快照** | 压缩日志、加速恢复与新成员加入 |

#### 认证与授权

![Etcd 认证与授权流程](/images/K8s学习-PartI-基础架构与核心抽象/Etcd%20认证与授权流程.png)

- 用户认证（如证书、密码、JWT 等，以实际配置为准）  
- **RBAC**（角色、权限）  
- **TLS** 加密客户端与集群通信  

---

### 与 Kubernetes 的集成

Kubernetes 使用 **etcd v3 API**（性能与功能更好）。设置：

```bash
export ETCDCTL_API=3
```

早期部分网络插件曾用 v2，现代栈一般已统一到 v3。

#### `/registry` 数据布局（示意）

Kubernetes 将资源存放在 **`/registry`** 下，例如：

```text
/registry/
├── pods/
├── services/
├── deployments/
├── configmaps/
├── secrets/
├── namespaces/
├── nodes/
├── persistentvolumes/
├── persistentvolumeclaims/
├── storageclasses/
├── customresourcedefinitions/
└── ...
```

更一般的模式：

```text
/registry/<资源类型复数>/
├── <namespace>/<对象名>     # 命名空间级
└── <集群级对象名>           # 集群级
```

> **警告**：除只读排障外，**不要**直接改 etcd 中的 Kubernetes 数据，应通过 **API Server**，否则易造成集群状态损坏。

#### 使用 etcdctl 只读访问

```bash
# 单次命令指定 v3
ETCDCTL_API=3 etcdctl get /registry/namespaces/default -w=json | jq .
```

**kubeadm 等集群**通常对 etcd 启用 **TLS**，需带证书（路径以实际节点为准）：

```bash
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/peer.crt \
  --key=/etc/kubernetes/pki/etcd/peer.key \
  get /registry/namespaces/default -w=json | jq .
```

| 参数 | 含义 |
| --- | --- |
| `--cacert` | CA 证书 |
| `--cert` / `--key` | 客户端证书与私钥 |
| `-w` | 输出格式，如 `json`、`table` |

**常用只读示例**：

```bash
ETCDCTL_API=3 etcdctl get /registry/namespaces --prefix -w=json | jq .
ETCDCTL_API=3 etcdctl get /registry --prefix --keys-only
ETCDCTL_API=3 etcdctl get /registry/minions --prefix
ETCDCTL_API=3 etcdctl get /registry/minions/<node-name>
ETCDCTL_API=3 etcdctl watch /registry/pods --prefix
```

#### 键值与 base64

API 返回的 **key / value** 常为 **base64**，需解码查看路径或内容：

```bash
echo "L3JlZ2lzdHJ5L25hbWVzcGFjZXMvZGVmYXVsdA==" | base64 -d
# 输出示例：/registry/namespaces/default
```

批量列出解码后的 key（需在可访问 etcd 的环境执行，并视情况加上 TLS 参数）：

```bash
#!/bin/bash
export ETCDCTL_API=3
keys=$(etcdctl get /registry --prefix -w json | jq -r '.kvs[].key')
for key in $keys; do
  echo "$key" | base64 -d
done | sort
```

按资源类型粗略统计（示例脚本，依赖 `etcdctl` 与 `base64`）：

```bash
#!/bin/bash
export ETCDCTL_API=3
etcdctl get /registry --prefix --keys-only | while read -r key; do
  echo "$key" | base64 -d
done | cut -d'/' -f3 | sort | uniq -c | sort -nr
```

**带 TLS 的遍历示例**：

```bash
#!/bin/bash
export ETCDCTL_API=3
ETCD_OPTS=""
if [ -f "/etc/kubernetes/pki/etcd/ca.crt" ]; then
  ETCD_OPTS="--cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/peer.crt \
    --key=/etc/kubernetes/pki/etcd/peer.key"
fi
etcdctl $ETCD_OPTS get /registry --prefix -w json | \
  jq -r '.kvs[].key' | while read -r key; do
  echo "$key" | base64 -d
done | sort
```

`get` 的 JSON 输出示例（结构示意）：

```json
{
  "count": 1,
  "header": {
    "cluster_id": 12091028579527406772,
    "member_id": 16557816780141026208,
    "raft_term": 36,
    "revision": 29253467
  },
  "kvs": [
    {
      "create_revision": 5,
      "key": "L3JlZ2lzdHJ5L25hbWVzcGFjZXMvZGVmYXVsdA==",
      "mod_revision": 5,
      "value": "azhzAAoPCgJ2MRIJTmFtZXNwYWNlEmIKSAoHZGVmYXVsdBIAGgAiACokZTU2YzMzMDgtMWVhOC0xMWU3LThjZDctZjRlOWQ0OWY4ZWQwMgA4AEILCIn4sscFEKOg9xd6ABIMCgprdWJlcm5ldGVzGggKBkFjdGl2ZRoAIgA=",
      "version": 1
    }
  ]
}
```

---

### 集群、成员与客户端

etcd 通过 **Raft** 容忍节点故障；集群可通过静态配置、发现服务或 DNS 等方式组建；支持动态 **member add/remove**，以及 **learner** 等模式（以版本文档为准）。

![Etcd 集群形成与成员管理](/images/K8s学习-PartI-基础架构与核心抽象/Etcd%20集群形成与成员管理.png)

**Raft 简要**：同一时刻一个 **Leader**；写请求经 Leader 复制日志；多数派确认后提交并应用到状态机。

客户端以 **gRPC** 为主，并可有 HTTP/JSON 网关。**clientv3**（Go）提供 KV、Watch、Lease、锁与选举等能力。

![Etcd 客户端库结构](/images/K8s学习-PartI-基础架构与核心抽象/Etcd%20客户端库结构.png)

**etcdctl** 覆盖 put/get/del、watch、lease、user/role、member、endpoint health 等子命令。

---

### 网络插件、备份与运维

部分 CNI 曾将配置放在 etcd（前缀因插件而异，仅作排障参考）：

```bash
ETCDCTL_API=3 etcdctl get /calico --prefix
ETCDCTL_API=3 etcdctl get /coreos.com/network --prefix
```

**快照（备份）**：

```bash
ETCDCTL_API=3 etcdctl snapshot save "/backup/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db"
ETCDCTL_API=3 etcdctl snapshot status /backup/etcd-snapshot.db
```

**恢复**会重建数据目录，务必先在**隔离环境**验证，并严格按官方流程与集群版本操作：

```bash
ETCDCTL_API=3 etcdctl snapshot restore /backup/etcd-snapshot.db \
  --data-dir=/var/lib/etcd-restore \
  --initial-cluster-token=etcd-cluster-restore
```

**监控与维护**：暴露 **Prometheus** 指标；健康检查如 `/health`、`/livez`、`/readyz`（以版本为准）。定期 **compact / defrag**、监控延迟与磁盘、规划升级。

---

### 安全与排障要点

- **TLS**：节点间与客户端访问建议全程 TLS。  
- **RBAC**：限制谁能访问 etcd。  
- **排障命令示例**：

```bash
ETCDCTL_API=3 etcdctl endpoint health
ETCDCTL_API=3 etcdctl member list
ETCDCTL_API=3 etcdctl endpoint status --cluster -w table
```

```bash
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/pods --prefix
```

| 注意项 | 说明 |
| --- | --- |
| **生产操作** | 避免手改 `/registry` 数据 |
| **权限** | 通常需在控制平面节点或具备证书的环境执行 |
| **与 kubectl 差异** | etcd 中存的是 API Server 视角的序列化形态 |
| **版本** | 不同 K8s/etcd 版本路径与封装格式可能演进 |

### 本节小结

etcd 提供**强一致**的键值存储与**高可用**复制，是 Kubernetes **状态真相源**的底座。理解其与 **API Server**、**Raft**、**/registry** 的关系，有利于控制面排障、容量规划与灾备设计；更深实现可参考 etcd 官方文档与源码中的 **EtcdServer / Raft / 存储** 分层。
