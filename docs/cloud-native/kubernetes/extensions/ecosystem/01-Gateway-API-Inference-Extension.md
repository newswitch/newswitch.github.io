---
title: "Gateway API Inference Extension：智能负载均衡原理与使用"
sidebar_label: "01. Gateway API Inference Extension：智能负载均衡原理与使用"
sidebar_position: 1
description: "本项目的智能负载均衡指：在 Inference Gateway 中，由 Endpoint Picker (EPP) 根据请求内容、SLO、后端实时状态（KV 缓存、队列、前缀缓存命中、预测延迟等）为每个推理请求选择最合适的模型服务 Pod，而不是简单轮询或随机。"
tags: [Gateway API, 推理, 负载均衡, Kubernetes, 大模型, Inference]
date: 2026-02-19 12:00:00
categories: 云原生
---

# Gateway API Inference Extension：智能负载均衡原理与使用

## 1. 第一篇：概览 {/* #第一篇概览 */}

## 2. 概述 {/* #一概述 */}

### 2.1 什么是智能负载均衡 {/* #11-什么是智能负载均衡 */}

本项目的智能负载均衡指：在 **Inference Gateway** 中，由 **Endpoint Picker (EPP)** 根据请求内容、SLO、后端实时状态（KV 缓存、队列、前缀缓存命中、预测延迟等）为每个推理请求**选择最合适的模型服务 Pod**，而不是简单轮询或随机。

目标包括：

- 满足请求的 **TTFT/TPOT SLO**；
- 提高 **GPU/NPU 利用率**（在满足 SLO 的前提下尽量“塞满”）；
- 利用 **前缀缓存** 降低首 token 延迟；
- 支持 **LoRA**、多模型名、流量拆分等路由与改写。

### 2.2 在整体架构中的位置 {/* #12-在整体架构中的位置 */}

- **网关**（Envoy/Istio/Kgateway/NGINX 等）：按 HTTPRoute/InferencePool 匹配请求，并通过 **ext-proc** 把请求交给 EPP。
- **EPP**：实现 ext-proc 协议，内部完成**路由（含 model 改写）→ 准入 → 调度（智能负载均衡）**，再通过 **HeaderMutation / DynamicMetadata / BodyMutation** 把选中的 endpoint 和（可选）修改后的 body 返回给网关。
- **模型服务**：真正跑推理的 Pod；EPP 只做“选谁”，不转发流量。

智能负载均衡的核心在 EPP 的 **Scheduling Layer**：Filter → Scorer(s) → Picker。

### 2.3 网关除智能负载均衡外的其他作用 {/* #13-网关除智能负载均衡外的其他作用 */}

本项目的 Inference Gateway（网关 + EPP）在**智能负载均衡**之外，还提供以下能力：

| 能力 | 说明 |
|------|------|
| **模型名路由与改写（Routing Layer）** | 通过 **InferenceModelRewrite** CRD 将请求 body 中的 `model` 做别名映射、默认回退、按权重流量拆分（Canary），改写后的 model 写回 body 并转发到后端，便于多版本、多 LoRA 的灰度与切换。 |
| **优先级与准入（InferenceObjective / Capacity）** | **InferenceObjective** 为请求定义**优先级**（Priority）；请求通过 header `x-gateway-inference-objective` 关联到某个 Objective。当池子**饱和**（所有端点超过配置的阈值）时，**负优先级**的请求会被**拒绝**（如返回 429），高优先级请求仍可被调度或排队，实现不同业务之间的容量隔离与保障。 |
| **流控与公平性（Flow Controller，部分 WIP）** | 规划中的 Flow Controller 将基于优先级、公平性（Fairness）与队列配置，在网关侧做更细粒度的排队与准入，确保多租户/多 workload 共享池子时的公平与 SLO。当前已有基于饱和度的准入（负优先级拒绝）。 |
| **LoRA 亲和与多池路由** | **LoRA Affinity Scorer** 根据请求所需的 LoRA 与各 Pod 已加载的 LoRA 做打分，优先选已加载该 LoRA 的 Pod。若需**多个 InferencePool**（如不同基座模型或不同 LoRA 集合）共用一个入口，可配合 **Body Based Router (BBR)**：BBR 解析 body 中的 model，查表得到 base model，设置 `X-Gateway-Base-Model-Name` 等 header，由网关按 header 路由到对应 InferencePool，再由各池的 EPP 做智能负载均衡。 |
| **端到端可观测性** | 暴露与 SLO、延迟预测、前缀缓存、请求计数等相关的 **Prometheus 指标**，便于监控尾延迟、SLO 违反率、预测准确度、负载均衡效果；可与 Grafana 等集成，用于告警与容量规划。 |
| **声明式 API 与运维** | 通过 **InferencePool**、**InferenceObjective**、**InferenceModelRewrite**、**HTTPRoute** 等 Kubernetes 原生 API 做声明式配置，支持多池、多目标、灰度发布、蓝绿与节点/模型/框架的滚动更新（见 `inferencepool-rollout`、`adapter-rollout` 等文档）。 |

因此，**智能负载均衡**是网关在“选哪个 Pod”上的核心能力；**路由与改写、优先级与准入、LoRA 与多池、可观测与声明式运维**共同构成完整的推理网关能力。

### 2.4 从大模型部署到请求的完整路径 {/* #14-从大模型部署到请求的完整路径 */}

本节分三部分：**一、一步一步怎么配置**（从模型部署到网关与推理池）；**二、部署完成后模型与网关如何对外发布**；**三、请求进来时如何一步一步解析、经过哪些服务、最终到达模型**。

#### 2.4.1 一步一步怎么配置 {/* #141-一步一步怎么配置 */}

按以下顺序完成配置后，流量即可从公网/内网入口到达大模型。

| 步骤 | 做什么 | 要点 |
|------|--------|------|
| **1. 部署模型服务** | 在集群中运行推理引擎（如 vLLM、SGLang） | 使用 **Deployment**（单机/单 Pod）或 **LWS（LeaderWorkerSet）**（多节点分片）。为 Pod 打**固定 label**（如 `app: vllm-llama3-8b-instruct`），暴露 HTTP 端口（如 8000），提供 OpenAI 兼容接口。若用 LWS，流量通常打到各组 **Leader Pod**。此时模型仅在集群内可访问，尚未对外发布。 |
| **2. 安装 CRD 与网关** | 让集群支持 Inference Extension，并部署网关 | 安装 **Inference Extension CRDs**（InferencePool、InferenceObjective、InferenceModelRewrite 等，见下框）；安装支持 **Gateway API + ext-proc** 的网关（如 Istio、Kgateway、NGINX Gateway Fabric），并开启对 Inference Extension 的支持（如 Istio 的 `ENABLE_GATEWAY_API_INFERENCE_EXTENSION=true`）。 |
| **3. 创建 Gateway** | 定义对外入口 | 创建 **Gateway** 资源（如 `inference-gateway`）：指定监听端口（如 80）、协议等。网关实现会为该 Gateway 分配入口 **IP 或域名**，这是**网关对外发布的地址**。 |
| **4. 创建 HTTPRoute** | 把路径绑定到推理池 | 创建 **HTTPRoute**：`parentRefs` 指向上一步的 Gateway，`backendRefs` 指向 **InferencePool**（而不是 Service）。匹配的路径（如 `/` 或 `/v1`）的流量会被网关转交给该 InferencePool 对应的处理链路。 |
| **5. 部署 InferencePool + EPP** | 定义“推理池”并挂上 EPP | 用 **InferencePool Helm Chart** 部署：**InferencePool**（`spec.selector.matchLabels` 与步骤 1 的 Pod label 一致，`targetPorts` 与模型端口一致，`endpointPickerRef` 指向 EPP Service）+ **EPP**（ext-proc 服务）。可选：创建 **InferenceObjective**、**InferenceModelRewrite**。 |

**Inference Extension 中的主要 CRD 简介：**

| 资源 | 作用 | 简要说明 |
|------|------|----------|
| **InferencePool** | 推理池 | 通过 **selector** 指定哪些 Pod 属于该池、**targetPorts** 指定端口、**endpointPickerRef** 关联 EPP。HTTPRoute 的 backendRef 指向 InferencePool，流量经网关 + EPP 调度到池内某一 Pod。 |
| **InferenceObjective** | 推理目标 / 优先级 | **priority**（整数，可为负）+ **poolRef**（所属池）。请求通过 header `x-gateway-inference-objective` 关联同名 Objective，供 EPP 准入与流控。 |
| **InferenceModelRewrite** | 模型名改写与流量拆分 | 针对某池的 **rules**：请求 body 的 `model` 匹配则改写为目标模型名；可配 **weight** 做 Canary/A/B。 |

#### 2.4.2 部署完成后：模型与网关是如何对外发布的 {/* #142-部署完成后模型与网关是如何对外发布的 */}

- **网关如何对外发布**
  **Gateway** 资源定义了监听端口与协议；网关控制器会为该 Gateway 分配**入口 IP 或域名**（具体方式取决于实现，如 LoadBalancer、NodePort、或 Ingress 的 host）。客户端**只接触这个地址**，不直接访问集群内的 Pod 或 Service。因此“网关对外发布”= 对外暴露 **Gateway 的地址**，请求发往该地址即进入网关。

- **模型如何对外发布**
  模型 Pod 本身**不直接对外暴露**。对外暴露的是 **Gateway 地址 + HTTPRoute 匹配的路径**：
  1）HTTPRoute 的 backendRef 指向 **InferencePool**，表示“该路径的流量由这个推理池承接”；
  2）InferencePool 通过 **selector** 声明“哪些 Pod 属于这个池”，EPP 根据池内 Pod 做智能调度；
  3）网关在转发前通过 **ext-proc** 调用 EPP，拿到“应转发到哪个 Pod 的 ip:port”后再转发。
  因此，“模型对外发布”= 通过 **InferencePool + HTTPRoute** 把“路径 → 推理池 → 池内 Pod”的关系打通，对外只暴露 Gateway 的地址；客户端访问 `http://<Gateway-地址>/<路径>` 即可间接访问到池内被选中的模型 Pod。

下面给出 **InferencePool** 与 **InferenceObjective** 的 YAML 定义示例，便于配置步骤 5 时查阅。

**InferencePool 如何定义（YAML 示例）**
InferencePool 是 Kubernetes CRD，`apiVersion` 为 `inference.networking.k8s.io/v1`，`kind` 为 `InferencePool`。核心字段在 `spec` 下：

| 字段 | 必填 | 说明 |
|------|------|------|
| **selector** | 是 | 标签选择器，仅支持 `matchLabels`（键值对）。同命名空间内 label 匹配的 Pod 视为该池的候选；与部署模型服务时给 Pod 打的 label 对应。 |
| **targetPorts** | 是 | 端口列表，每项为 `number: <端口号>`（1–65535）。EPP 会按 `podIP:portNumber` 寻址；多端口时每个组合都是独立 endpoint。 |
| **endpointPickerRef** | 是 | 对 EPP 的引用：`name`（Service 名）、`kind: Service`、`port.number`（EPP 服务端口，如 9002）。可选 `failureMode: FailOpen` / `FailClose`（EPP 不可用时的行为）。 |
| **appProtocol** | 否 | 应用协议，默认 `http`；可设为 `kubernetes.io/h2c`（HTTP/2 明文，如 gRPC）。 |

示例（与部署步骤中的 label、端口一致即可）：

```yaml
apiVersion: inference.networking.k8s.io/v1
kind: InferencePool
metadata:
  name: vllm-llama3-8b-instruct-pool
  namespace: default
spec:
  selector:
    matchLabels:
      app: vllm-llama3-8b-instruct
  targetPorts:
    - number: 8000
  endpointPickerRef:
    name: epp
    kind: Service
    port:
      number: 9002
```

**InferenceObjective 如何定义（YAML 示例）**
InferenceObjective 使用扩展 API 组 `inference.networking.x-k8s.io/v1alpha2`，`kind` 为 `InferenceObjective`。用于为某一类推理请求指定**优先级**及所属**推理池**；请求通过 HTTP header `x-gateway-inference-objective` 携带与资源 **metadata.name** 相同的值，EPP 据此查找该 Objective 并应用其 priority 与 poolRef。

| 字段 | 必填 | 说明 |
|------|------|------|
| **poolRef** | 是 | 所属推理池的引用。**name** 为 InferencePool 名称（必填）；**group** 默认为 `inference.networking.k8s.io`；**kind** 默认为 `InferencePool`。池必须与 InferenceObjective 同命名空间。 |
| **priority** | 否 | 整数优先级，数值越高越优先；可为负数。未设置时实现按 0 处理。池饱和时，负优先级请求可能被拒绝（如 429）；同优先级内做公平调度。 |

示例：定义两个 Objective，分别对应高优先级业务与低优先级业务，并指向同一推理池。

```yaml
apiVersion: inference.networking.x-k8s.io/v1alpha2
kind: InferenceObjective
metadata:
  name: high-priority-app
  namespace: default
spec:
  priority: 10
  poolRef:
    name: vllm-llama3-8b-instruct-pool
---
apiVersion: inference.networking.x-k8s.io/v1alpha2
kind: InferenceObjective
metadata:
  name: low-priority-app
  namespace: default
spec:
  priority: -5
  poolRef:
    name: vllm-llama3-8b-instruct-pool
```

客户端在请求头中设置 `x-gateway-inference-objective: high-priority-app` 或 `low-priority-app`，即可关联到对应 Objective。

#### 2.4.3 请求进来时：一步一步解析、经过哪些服务、最终到达模型 {/* #143-请求进来时一步一步解析经过哪些服务最终到达模型 */}

**请求会经过哪些服务（链路概览）**

一次推理请求从客户端到模型 Pod，依次经过 **3 类实体**（网关是入口，EPP 是决策点，模型服务是终点）：

```text
客户端
  → [1] 网关（Gateway 实现，如 Envoy）
  → [2] EPP（Endpoint Picker，经 ext-proc 被网关调用）
  → [3] 模型服务 Pod（如 vLLM）
  → 响应原路返回：模型 Pod → 网关 → 客户端
```

网关与 EPP 之间是 **ext-proc** 协议（网关把请求头/体发给 EPP，EPP 返回要转发的目标 endpoint 及可选 body 改写）；**实际转发到 Pod 的仍是网关**，EPP 只做“选谁”，不转发流量。

**每一步在做什么（解析与处理）**

| 步骤 | 所在位置 | 解析 / 处理内容 |
|------|----------|-----------------|
| ① 请求进入网关 | 网关 | 客户端请求到达 **Gateway 入口地址**（如 `http://<IP>:80/v1/completions`）。网关根据 **HTTPRoute** 匹配路径，发现 backendRef 指向 **InferencePool**，因此需要先通过 ext-proc 向该池的 EPP 请求“转发目标”。 |
| ② 网关通过 ext-proc 调用 EPP | 网关 ↔ EPP | 网关将请求通过 **ext-proc** 发给 EPP：先发 **RequestHeaders**（path、header），再发 **RequestBody**（含 `model`、`prompt` 等的 JSON），带 EndOfStream。请求在网关侧缓冲，**不**在未得 EPP 响应前转发。 |
| ③ EPP 处理 RequestHeaders | EPP | 若请求**无 body** 或已 EndOfStream，则直接选一个池内 Pod 返回 endpoint；否则仅记录，等待 body。 |
| ④ EPP 处理 RequestBody（EndOfStream=true）| EPP | **解析**：从 body 取 `model`，从 header 取 `x-gateway-inference-objective` 等。**路由**：查 InferenceModelRewrite，改写 `model`（若有规则）。**准入**：查 InferenceObjective 得优先级；池饱和且优先级为负则返回 429。**调度**：PodLocator 从 Datastore 取该 InferencePool 的候选 Pod 列表及 metrics → Filter → Scorer(s) → Picker → 得到目标 **ip:port**。**响应网关**：通过 ext-proc 返回 HeaderMutation（`x-gateway-destination-endpoint`）、DynamicMetadata（`envoy.lb`）、可选 BodyMutation（改写后的 body）。 |
| ⑤ 网关按 EPP 返回转发 | 网关 | 根据 EPP 返回的 **x-gateway-destination-endpoint** / **envoy.lb** 将请求转发到该 **Pod ip:port**；若存在 BodyMutation 则使用改写后的 body。 |
| ⑥ 模型服务处理请求 | 模型 Pod | 请求到达目标 Pod 上的模型服务（如 vLLM），解析 body、执行推理、返回结果。响应经网关返回客户端。 |

**名词说明**：**InferencePool** 的 **selector**（`spec.selector.matchLabels`）指定哪些 Pod 属于该池；**PodLocator** 从 **Datastore** 取该池的候选 Pod 列表（控制器已按 selector watch 并写入），供 Filter/Scorer/Picker 使用。请求在目标 Pod 执行完成后，EPP 可能更新前缀缓存、上报延迟等，用于后续调度，与本次“到达模型”的时序无关。

#### 2.4.4 小结（路径一览） {/* #144-小结路径一览 */}

| 阶段 | 内容 |
|------|------|
| **配置顺序** | 部署模型（label + 端口）→ 安装 CRD + 网关 → 创建 Gateway → 创建 HTTPRoute → 部署 InferencePool + EPP。 |
| **发布方式** | 网关：对外暴露 **Gateway 的地址**。模型：通过 **HTTPRoute → InferencePool** 把路径绑定到池，再经 EPP 选 Pod，对外只暴露 Gateway 地址。 |
| **请求经过的服务** | 客户端 → **网关** →（ext-proc）**EPP** → **模型 Pod**；网关做入口与转发，EPP 做路由/准入/选 Pod，模型 Pod 执行推理。 |

## 3. 第二篇：原理（由整体到组件） {/* #第二篇原理由整体到组件 */}

## 4. 智能负载均衡的整体数据流 {/* #二智能负载均衡的整体数据流 */}

```text
请求进入网关 → ext-proc 调用 EPP
    ↓
解析 body（model 等）→ InferenceModelRewrite 改写 model
    ↓
InferenceObjective / 准入控制
    ↓
PodLocator：按 InferencePool 得到候选 Pod 列表（并拉取各 Pod 的 metrics）
    ↓
========== 智能负载均衡 ==========
  Filter(s)   → 过滤不满足约束的端点（如并发超限；不健康 Pod 已在 Datastore 层排除）
  Scorer(s)   → 对每个端点打分（0~1，可带权重）
  合并分数   → 各 Scorer 加权求和得到每个端点的总得分
  Picker      → 按总得分做加权随机（A-Res）选出 1 个（或少量）endpoint
==========
    ↓
将选中的 endpoint 通过 x-gateway-destination-endpoint + envoy.lb metadata 返回给网关
（可选）将改写后的 body 通过 BodyMutation 返回
    ↓
网关按 EPP 返回的 endpoint 做 subset 负载均衡，转发请求
```

- **输入**：当前请求（body、header）、候选 Pod 列表、各 Pod 的 metrics（KV、队列等）、前缀缓存索引、延迟预测结果（若启用）。
- **输出**：一个（或带 fallback 的多个）`ip:port`，以及可选的新 body。

### 4.1 池饱和判断与准入 {/* #21-池饱和判断与准入 */}

准入阶段会判断当前推理池是否**饱和**；若饱和且请求为**负优先级**，则直接拒绝（如 429），不进入调度。下面说明 EPP 如何判断池饱和。

**1. 饱和的定义**

- EPP 通过 **SaturationDetector** 接口得到池的负载程度：`Saturation(ctx, 候选Pod列表)` 返回 0～1 的数值。
- **池饱和**：返回值 **≥ 1.0**。此时准入逻辑可拒绝“可丢弃”的请求；Flow Controller 也会停止向调度派发（HoL blocking）。

**2. 默认实现：Utilization Detector（队列 + KV 缓存）**

- 对当前 **InferencePool 的候选 Pod 列表**，用每个 Pod 的 **WaitingQueueSize**（排队长度）和 **KVCacheUsagePercent**（KV 缓存利用率）计算一个 0～1 的 **PodSaturationScore**，再对全池**取平均**得到 Saturation。
- 单 Pod 分数采用 **Roofline 思路**：取“算力”与“显存”中更吃紧的一边：
  - `qRatio = WaitingQueueSize / QueueDepthThreshold`
  - `kvRatio = KVCacheUsagePercent / KVCacheUtilThreshold`
  - **PodScore = max(qRatio, kvRatio)**（再限制在 [0,1]）
- 若某 Pod 的 metrics 为 nil 或超过 **MetricsStalenessThreshold** 未更新，该 Pod 按 **1.0** 计（视为已满）。
- **默认配置**（可覆盖）：
  - **QueueDepthThreshold** = 5（排队深度超过该值认为该 Pod 负载高）
  - **KVCacheUtilThreshold** = 0.8（KV 利用率超过 80% 认为该 Pod 负载高）
  - **MetricsStalenessThreshold** = 200ms（超过则视为过期）
- **数据来源**：WaitingQueueSize、KVCacheUsagePercent 等由 EPP 从**模型服务（如 vLLM）的 Prometheus 指标**拉取并写入 Pod 的 metrics。

**3. 可选实现：Concurrency Detector（按并发数）**

- 不依赖模型服务 metrics，而是用 EPP 内部统计的**每个 endpoint 当前正在处理的请求数**（PreRequest 时 +1，ResponseComplete 时 -1）。
- **Saturation = 全池当前总 InFlight 数 / 全池总容量**，其中全池总容量 = 候选 Pod 数 × **MaxConcurrency**（每 Pod 的“满负载”并发数，默认 100）。
- 当所有 Pod 的 in-flight 都达到 MaxConcurrency 时，Saturation = 1.0，视为池饱和。

**4. 准入如何使用饱和信号**

- **LegacyAdmissionController**：仅对 **priority &lt; 0**（可丢弃请求）做饱和检查；若 `Saturation(ctx, candidatePods) >= 1.0`，则拒绝该请求，返回 **InferencePoolResourceExhausted**（如 429），文案为 "system saturated, sheddable request dropped"。
- **priority ≥ 0** 的请求**不做**饱和检查，不会被池饱和拒绝，仍可进入调度或排队。

| 项目 | 说明 |
|------|------|
| **饱和条件** | SaturationDetector.Saturation(候选 Pod) **≥ 1.0** |
| **默认实现** | Utilization Detector：队列深度 + KV 缓存利用率，每 Pod 取 max(qRatio, kvRatio)，全池求平均；metrics 来自模型服务 Prometheus。 |
| **准入策略** | 仅对 **priority &lt; 0** 检查；≥ 1.0 则拒绝（429）；priority ≥ 0 不因饱和被拒。 |

## 5. 调度层：Filter / Scorer / Picker {/* #三调度层filter--scorer--picker */}

### 5.1 角色 {/* #31-角色 */}

- **Filter**：剔除不满足条件的端点（如超过并发上限等约束）。通过过滤的端点才进入打分。**说明**：“不健康”（未 Ready）的 Pod 不会由 Filter 剔除——控制器在写入 Datastore 时仅加入 `PodReady=True` 的 Pod，未 Ready 的会被删除或从不加入，因此 PodLocator 给出的候选列表本身已排除不健康 Pod；当前项目中的 Filter 插件如 concurrency-detector 负责的是“约束”类过滤（如单 Pod 并发超限）。
- **Scorer**：对每个端点打 0~1 分；可配置多个 Scorer，每个有权重，最终每个端点的得分 = Σ(score_i × weight_i)，并限制在 [0,1]。
- **Picker**：根据各端点的**最终得分**做**加权随机**选择（本项目使用 A-Res 算法），得分越高被选中的概率越大。

代码入口：`pkg/epp/scheduling/scheduler_profile.go` 的 `Run()` 依次调用 `runFilterPlugins`、`runScorerPlugins`、`runPickerPlugin`。

### 5.2 Scorer 一览 {/* #32-scorer-一览 */}

调度层可配置多个 **Scorer**，每个对候选端点打 0~1 分并带权重，最终每个端点总得分 = Σ(score_i × weight_i)，限制在 [0,1]。当前项目**共实现 6 类 Scorer**，如下表；默认配置只启用其中 3 个（queue、kv-cache-utilization、prefix-cache），其余需在 EndpointPickerConfig 中显式启用。

| Scorer 类型（type） | 说明 | 默认启用 |
|--------------------|------|----------|
| **prefix-cache-scorer** | 根据请求 prompt 的 prefix 与各 Pod 的“近似前缀缓存”匹配长度打分，前缀命中越多分数越高。 | 是（默认权重 3） |
| **predicted-latency-scorer** | 结合延迟预测与 SLO 计算 headroom，按策略在正/负 headroom 层内选一个端点打 1、其余 0；无预测时退化为 Composite（KV+队列+前缀）。 | 否（启用延迟预测时由配置加入） | 是（默认权重 1） |
| **queue-scorer** | 按 Pod 等待队列长度打分，队列越短分数越高（越空闲越适合接新请求）。 | 是（默认权重 2） |
| **kv-cache-utilization-scorer** | 按 KV 缓存利用率打分，利用率越低分数越高（显存越空闲越好）。 | 是（默认权重 2） |
| **running-requests-size-scorer** | 按当前正在处理的请求数打分，数量越少分数越高。 | 否 |
| **lora-affinity-scorer** | 按请求所需 LoRA 与各 Pod 已加载 LoRA 的匹配程度打分，优先选已加载该 LoRA 的 Pod。 | 否 |

下文先分节介绍**每一类 Scorer 的评分方式**，再说明 **Weighted Random Picker** 如何根据各端点的总得分做最终选择。

## 6. 各类 Scorer 的评分方式 {/* #四各类-scorer-的评分方式 */}

### 6.1 Prefix Cache Scorer（前缀缓存） {/* #41-prefix-cache-scorer前缀缓存 */}

**思路**：EPP 不向模型节点查询“你缓存了哪些 prefix”，而是在本地维护**近似前缀索引**：若某请求曾被调度到某 Pod 并执行完，则认为该 Pod 上有该请求的 prefix；后续相同/相似 prefix 的请求倾向再选该 Pod，以命中 KV 缓存。

**评分方式**：

1. **对当前请求算 prefix block hash**
   从 body 取出 prompt，按固定 block 大小（字符）切块，第一块带 model（及可选 cache_salt），后续块链式 hash，得到 `hashes[]`。

2. **在本地 indexer 中查每个 block 在哪些节点“有”**
   `matchLongestPrefix(hashes)`：从第 0 块起顺序查，每个 hash 查 `indexer.Get(hash)` 得到“拥有该 block”的 server 集合；对每个 server 统计**从第 0 块起连续命中的块数** matchLen。

3. **得分**
   对每个端点：**PrefixCacheScore = matchLen / total**（total 为当前请求的 prefix 总块数），即 0~1 的连续分数。
   索引来源：请求被调度到某 endpoint 并**执行完后**，在 PreRequest 中对该 endpoint 调用 `indexer.Add(state.PrefixHashes, server)`；索引按 per-pod LRU 淘汰。

代码：`pkg/epp/framework/plugins/scheduling/scorer/prefix/`（plugin.go、indexer.go）。

### 6.2 Predicted Latency Scorer（延迟预测，核心“智能”） {/* #42-predicted-latency-scorer延迟预测核心智能 */}

本 Scorer 依赖可选的**延迟预测服务**得到「请求 × 端点」的 TTFT/TPOT 预测，再结合 SLO 算 headroom 并选点；若未启用或预测不可用，则退化为仅用 Composite 分数。下面先说明延迟预测服务（可选）的作用与实现，再说明 Scorer 的输入、headroom 与选点逻辑。

#### 6.2.1 延迟预测服务（可选） {/* #421-延迟预测服务可选 */}

**作用**：为 Predicted Latency Scorer 提供每个「请求 × 端点」的 **TTFT/TPOT 预测**，用于计算 headroom，不把请求真实发到模型服务。

- **预测对象**：对**每个候选端点单独**给出预测（同一条请求在 Pod A / Pod B 上各有一组预测），而非“某个模型整体”或“仅基于请求内容”的单一延迟。
- **预测用途**：Scorer 根据这些 `请求 × 端点` 级别预测与 SLO 算 headroom，决定当前请求更适合发到哪台机器。

**实现方式**：

- **模型类型**：支持 **Bayesian Ridge / XGBoost / LightGBM**，专门做 TTFT/TPOT 回归；通常同时维护 TTFT 与 TPOT 两组模型。`bayesian_ridge` 时训练服务用 sklearn 的 `BayesianRidge` 自动估计正则化参数；`xgboost`/`lightgbm` 支持更复杂非线性关系。
- **训练服务**：暴露 `POST /add_training_data_bulk`，接收 EPP 上报的“真实请求完成后的 (特征, actual_ttft_ms, actual_tpot_ms)”列表。数据来源：EPP 在请求真实发到模型 Pod 后观察响应流，首 token 到达时记录 `actual_ttft_ms = now - request_received_time`，后续 token 间隔作为 `actual_tpot_ms`；按 `请求 × 端点` 填充特征、构造 TrainingEntry，经 sidecar 批量上报。样本数达到 `MIN_SAMPLES_FOR_RETRAIN` 后重训并持久化；样本不足时使用默认模型。
- **预测服务**：周期性从训练服务拉取模型/系数；对每个「请求 × 端点」特征向量输出 TTFT/TPOT；EPP 对 N 个候选端点做 **bulk 预测**，一次 HTTP 得到 N 组结果。
- **输入特征（请求 × 端点）**：请求侧（`InputTokenLength`、`NumTokensGenerated`）、端点侧（`KVCachePercentage`、`NumRequestWaiting`、`NumRequestRunning`、`PodType`）、交互特征（`PrefixCacheScore`）。
- **部署形态**：训练/预测服务 CPU 即可；通过 Helm `inferenceExtension.latencyPredictor.enabled=true` 以 sidecar 与 EPP 同机部署，sidecar 负责缓冲样本、调用 `/add_training_data_bulk`、刷新模型并对外提供预测（含 bulk）接口。

**与智能负载均衡的关系**：启用后 Scorer 多一个“延迟维度”，按预测与 SLO 划分正/负 headroom 并精细选点；与前缀缓存 Scorer（刻画 KV 命中可能）、饱和检测（池级满载信号）配合，实现感知缓存、感知延迟、避免过载。**降级**：未启用或预测失败时退化为仅用 Composite 分数；请求头 `x-prediction-based-scheduling-off` 可显式关闭基于预测的调度。

#### 6.2.2 输入与数据来源 {/* #422-输入与数据来源 */}

- **请求**：body（prompt）、header 中的 SLO（`x-slo-ttft-ms`、`x-slo-tpot-ms`）等。
- **候选端点**：每个端点的 **Metrics**（KV 使用率、排队长度、运行中请求数等），来自数据层对模型服务器 metrics 的拉取。
- **延迟预测**：若启用延迟预测服务，对「当前请求 + 该端点」预测 **TTFT**、**TPOT**（不把请求真实发到模型服务，而是调用独立的预测服务做轻量 ML 推理）。
- **前缀缓存**：由 Prefix Cache 插件在 cycleState 中提供每个端点对当前请求的 **PrefixCacheScore**（0~1）。

#### 6.2.3 Headroom（余量） {/* #423-headroom余量 */}

- **TTFT Headroom** = TTFT SLO − 预测 TTFT
  - \>0 表示预计能满足首 token 延迟。
- **TPOT Headroom** = 经 buffer 后的 TPOT SLO − 预测 TPOT
  - \>0 表示预计能满足每 token 延迟。

若未配置 SLO 或预测不可用，则退化为仅用 **Composite 分数**（KV 空闲、队列、前缀）打分，不再区分 headroom。

#### 6.2.4 选点逻辑（Score 内部） {/* #424-选点逻辑score-内部 */}

1. **获取预测与 SLO 上下文**
   若无有效预测，或**预测数量与端点数量不一致**（例如对 N 个候选端点做 bulk 预测时，只拿到少于 N 条或条数不对的预测结果，无法一一对应到端点），则使用 `scoreWithoutPredictions`（仅 composite），直接返回。

2. **全局前缀亲和性门控（ε-greedy）**
   - 阈值 `AffinityGateTauGlobal`：只有 `PrefixCacheScore >= 阈值` 的端点进入“sticky”候选。
   - 以 `EpsilonExploreSticky` 概率忽略该门控，从全部候选中选，避免永远只选高前缀命中节点。

3. **按 Headroom 分层**
   - **正 headroom**：TTFT 与 TPOT headroom 均 ≥ 0。
   - **负 headroom**：任一 \< 0。
   - 策略：若正、负都有，则以约 99% 从正 headroom 中选、约 1% 从负中选（`EpsilonExploreNeg`）；若只有正或只有负，则仅在该集合内选。

4. **在正 headroom 内选谁**
   - 可配置 `HeadroomSelectionStrategy`：
     - **least**：在满足 SLO 的端点中选 headroom **最小**的（更“塞满”，提高利用率）。
     - **most**：选 headroom **最大**的（更保守）。
     - **composite-least / composite-most / composite-only**：用 KV 空闲、队列、前缀组成 composite，再按 least/most 或仅 composite 选。
   - 会再经过一次 ε-greedy 前缀亲和门控（`AffinityGateTau`）。

5. **在负 headroom 内选谁**
   - 先按“当前运行请求数”分层，再用 TTFT/TPOT **deficit** 加权（`NegHeadroomTTFTWeight` / `NegHeadroomTPOTWeight`），选“相对伤害最小”的端点。

6. **输出**
   Scorer 只给**一个**选中的端点打 **1**，其余 **0**。若配置了多个 Scorer，各 Scorer 的分数乘权重后相加，得到每个端点的**总加权分**。

**策略组合方式：前缀 + Headroom 分层 + 一种选点策略**

- **不是“三选一”**：前缀（门控）、Headroom 分层（正/负）、以及“在某一层内选谁”的规则会**一起用**，而不是在 SLO/前缀/Composite 里只挑一种。
- **固定流程（有预测时）**：
  1）先用**前缀门控**缩小/锁定候选（或 ε 探索时忽略）；
  2）再按 **Headroom** 把端点分成“正 headroom”和“负 headroom”，并按 99%/1% 决定从哪一层选；
  3）最后在选中的那一层里，用**一种**选点策略决定具体选哪个端点。
- **选点策略只配一种**：通过 **HeadroomSelectionStrategy** 配置，且**只能取一个值**（见下表）。该策略只负责上述第 3 步——“在正 headroom（或负 headroom）里按什么规则选一个端点”；前缀门控和 headroom 分层不随该配置关闭。

| 配置值 | 含义 |
|--------|------|
| **least** | 在满足 SLO 的端点中选 headroom **最小**的（更“塞满”，提高利用率）。 |
| **most** | 选 headroom **最大**的（更保守）。 |
| **composite-least** | 先按 headroom 分层，在该层内按 **Composite 分数**排序，选 composite **最小**的（更倾向负载高的节点）。 |
| **composite-most** | 同上，选 composite **最大**的。 |
| **composite-only** | **不看 headroom 分层**，直接在全部候选上按 Composite 分数选（等价于“只用 KV+队列+前缀”做选点）。 |

- **无预测时**：不进行 headroom 分层，也不使用上述“正/负 + 策略”，而是**仅用 Composite 分数**选点（逻辑上相当于强制走 composite-only）。

相关代码：`pkg/epp/framework/plugins/scheduling/scorer/predictedlatency/`（scorer.go、scorer_helpers.go、helpers.go、selection.go 等）。

#### 6.2.5 Composite 分数（无预测或 composite-only 时） {/* #425-composite-分数无预测或-composite-only-时 */}

- 三项：**KV 剩余**（1 − kv_usage）、**队列相对空闲**、**PrefixCacheScore**。
- 权重可配置：`CompositeKVWeight`、`CompositeQueueWeight`、`CompositePrefixWeight`。
- 在 `buildCompositeChoices` 中计算每个端点的 composite，再按策略做加权随机或选最大（`SelectionMode`: linear / max）。

### 6.3 Queue / KV Cache Utilization / Running Requests Size Scorer {/* #43-queue--kv-cache-utilization--running-requests-size-scorer */}

三者均为**基于 Pod metrics 的连续打分**（0~1），数据来自数据层对模型服务 Prometheus 的拉取。

- **queue-scorer**：按 **WaitingQueueSize**（等待队列长度）打分。队列越短分数越高，表示该 Pod 越“空闲”，更适合接新请求。典型做法是将队列长度映射到 [0,1]（如用阈值归一化后取 1− 或类似单调递减函数）。
- **kv-cache-utilization-scorer**：按 **KVCacheUsagePercent**（KV 缓存利用率）打分。利用率越低分数越高，表示显存越有余量，越不易发生 eviction。
- **running-requests-size-scorer**：按 **RunningRequestsSize**（当前正在处理的请求数）打分。数量越少分数越高，表示该 Pod 当前负载越轻。

以上三个 Scorer 输出均为每个端点一个 0~1 的分数，与其他 Scorer 的分数按配置权重加权求和后，再交给 Picker。

### 6.4 LoRA Affinity Scorer {/* #44-lora-affinity-scorer */}

按**请求所需 LoRA** 与**各 Pod 已加载的 LoRA** 的匹配程度打分：若某 Pod 已加载该 LoRA，则得分更高（或为 1），否则更低（或为 0）。用于多 LoRA 场景下优先把请求路由到已加载对应 adapter 的 Pod，避免动态加载开销。需模型服务暴露 LoRA 加载状态（如通过 Prometheus 或协议），EPP 从数据层获取后计算亲和分数。

## 7. Weighted Random Picker（从分数到概率） {/* #五weighted-random-picker从分数到概率 */}

- **输入**：每个端点的加权总分（可能来自 PredictedLatency + 其他 Scorer）。
- **算法**：**A-Res**。对每个端点生成 `key = U^(1/score)`（U 为 (0,1) 随机数），score≤0 的 key=0；按 key **降序**排序，取 top-k 作为选中的 endpoint(s)。
- **效果**：分数越高，被选中的概率越大；实现“按智能打分的概率负载均衡”。
- **退化**：若所有 score 均为 0，则退化为 **RandomPicker**，均匀选。

代码：`pkg/epp/framework/plugins/scheduling/picker/weighted_random_picker.go`。

## 8. 第三篇：使用与配置 {/* #第三篇使用与配置 */}

## 9. 使用方式 {/* #六使用方式 */}

### 9.1 部署（简要） {/* #61-部署简要 */}

1. 安装 **Inference Extension CRDs**。
2. 安装并配置**支持 ext-proc 与 Gateway API 的网关**（如 Istio、Kgateway、NGINX Gateway Fabric）。
3. 部署 **Gateway** 资源（如 inference-gateway）。
4. 部署**模型服务**（如 vLLM），并保证 Pod 的 label 与 InferencePool 的 selector 一致。
5. 使用 **InferencePool Helm Chart** 部署 **InferencePool + EPP**（`inferencePool.modelServers.matchLabels` 指向模型服务 Pod）。

EPP 默认即带智能负载均衡（Prefix Cache Scorer、Predicted Latency 若配置则启用、Weighted Random Picker）。无需单独“开启智能负载均衡”开关。

### 9.2 请求头（可选） {/* #62-请求头可选 */}

- **x-slo-ttft-ms**：TTFT SLO（毫秒），用于延迟预测与 headroom。
- **x-slo-tpot-ms**：TPOT SLO（毫秒）。
- **x-prediction-based-scheduling-off**：设为 true 可关闭基于预测的调度（退化为 composite 等）。
- **x-gateway-model-name**：若提供，可覆盖 body 中的 model，用于路由与改写。

### 9.3 模型名改写（报文字段替换） {/* #63-模型名改写报文字段替换 */}

通过 **InferenceModelRewrite** CRD 可对 body 中的 **model** 字段做：

- **别名**：如 `food-review` → `food-review-v1`。
- **默认回退**：未匹配的 model 改写为默认模型名。
- **按权重拆分**：如 90% → `food-review-v1`，10% → `food-review-v2`。

改写后的 model 会写回请求 body，并随 BodyMutation 发给后端。
详见：`site-src/api-types/inferencemodelrewrite.md` 及 `pkg/epp/requestcontrol/director.go` 中的 `applyWeightedModelRewrite` 与 `reqCtx.Request.Body["model"] = reqCtx.TargetModelName`。

### 9.4 启用延迟预测（可选） {/* #64-启用延迟预测可选 */}

- 在 Helm 中设置 `inferenceExtension.latencyPredictor.enabled=true`，并配置训练/预测服务镜像与必要参数。
- 部署后，Predicted Latency Scorer 会调用预测服务做 bulk 预测，用于 headroom 计算。
- 文档：`site-src/guides/latency-based-predictor.md`。

### 9.5 验证与发请求 {/* #65-验证与发请求 */}

- 确认 HttpRoute、InferencePool 为 `Accepted=True`、`ResolvedRefs=True`。
- 获取 Gateway 地址后，向 `/v1/completions` 或 `/v1/chat/completions` 发请求；可带 `x-slo-ttft-ms`、`x-slo-tpot-ms` 验证 SLO 感知路由。

## 10. 主要配置项与调优 {/* #七主要配置项与调优 */}

### 10.1 Predicted Latency Scorer（若启用） {/* #71-predicted-latency-scorer若启用 */}

- **HeadroomSelectionStrategy**：least / most / composite-least / composite-most / composite-only。
- **EpsilonExploreSticky**：前缀亲和门控的探索概率。
- **EpsilonExploreNeg**：从负 headroom 中选取的概率。
- **AffinityGateTau / AffinityGateTauGlobal**：前缀亲和阈值。
- **CompositeKVWeight / CompositeQueueWeight / CompositePrefixWeight**：composite 三项权重。
- **NegHeadroomTTFTWeight / NegHeadroomTPOTWeight**：负 headroom 时 TTFT/TPOT deficit 权重。

### 10.2 Prefix Cache Scorer {/* #72-prefix-cache-scorer */}

- **blockSize**、**maxPrefixBlocksToMatch** 等（见 prefix 插件配置）。
- **LRU 容量**：可与模型服务暴露的 `CacheNumGPUBlocks` 等对齐（若支持 auto-tune）。

### 10.3 Picker {/* #73-picker */}

- **maxNumOfEndpoints**：通常为 1；若支持多 fallback，可大于 1。

以上多通过 EPP/InferencePool 的 Helm values 或 EndpointPickerConfig 等传递，具体字段以仓库当前配置为准。

## 11. 第四篇：监控与其它 {/* #第四篇监控与其它 */}

## 12. 监控与可观测性 {/* #八监控与可观测性 */}

智能负载均衡与推理网关的**可观测性**依赖 EPP 及相关组件暴露的 **Prometheus 指标**，用于监控尾延迟、SLO 违反率、预测准确度、负载均衡效果，并与 Grafana 等集成做告警与容量规划。以下为 **EPP 暴露的指标**详解（各模型实例自身的 metrics 需单独配置 Prometheus 抓取，见前文说明）。

### 12.1 EPP 指标详解 {/* #81-epp-指标详解 */}

EPP 默认在 **9090** 端口暴露 `/metrics`，指标均带 **ALPHA** 稳定性。为得到完整的响应延迟与 token 统计，需将 body 模式设为 `Buffered` 或 `Streamed`；若使用 vLLM 流式请求并希望包含 usage，请在请求中设置 `stream_options: {"include_usage": true}`。

**（1）请求与错误（按模型维度）**

| 指标名 | 类型 | 说明 | 主要标签 |
|--------|------|------|----------|
| **inference_objective_request_total** | Counter | 经 EPP 调度的请求总数，按模型拆分 | `model_name`（请求中的模型名）、`target_model_name`（改写后的目标模型名） |
| **inference_objective_request_error_total** | Counter | 请求错误总数，按模型拆分 | `model_name`、`target_model_name` |

**（2）延迟与大小分布（Distribution / Histogram）**

| 指标名 | 类型 | 说明 | 主要标签 |
|--------|------|------|----------|
| **inference_objective_request_duration_seconds** | Distribution | 请求响应延迟分布（从进入 EPP 到响应完成） | `model_name`、`target_model_name` |
| **inference_objective_normalized_time_per_output_token_seconds** | Distribution | 每输出 token 的归一化时间分布（TPOT 相关） | `model_name`、`target_model_name` |
| **inference_objective_request_sizes** | Distribution | 请求体大小（字节）分布 | `model_name`、`target_model_name` |
| **inference_objective_response_sizes** | Distribution | 响应体大小（字节）分布 | `model_name`、`target_model_name` |
| **inference_objective_input_tokens** | Distribution | 输入 token 数分布 | `model_name`、`target_model_name` |
| **inference_objective_output_tokens** | Distribution | 输出 token 数分布 | `model_name`、`target_model_name` |

**（3）实时状态（Gauge）**

| 指标名 | 类型 | 说明 | 主要标签 |
|--------|------|------|----------|
| **inference_objective_running_requests** | Gauge | 当前每个模型正在处理的请求数 | `model_name` |

**（4）推理池（InferencePool）聚合与 per-Pod**

EPP 从各模型实例拉取 metrics 后，聚合并暴露以下池级或 per-Pod 指标，用于饱和判断、准入与调度观测。

| 指标名 | 类型 | 说明 | 主要标签 |
|--------|------|------|----------|
| **inference_pool_average_kv_cache_utilization** | Gauge | 该推理池内所有候选 Pod 的 **KV 缓存利用率平均值**（0～1） | `name`（InferencePool 名称） |
| **inference_pool_average_queue_size** | Gauge | 该推理池内模型服务 **排队请求数的平均值** | `name` |
| **inference_pool_per_pod_queue_size** | Gauge | 该推理池下 **每个模型服务 Pod** 的队列长度（排队数） | `name`、`model_server_pod`（Pod 名） |
| **inference_pool_ready_pods** | Gauge | 该推理池当前 **就绪 Pod 数量** | `name` |

**（5）构建信息**

| 指标名 | 类型 | 说明 | 主要标签 |
|--------|------|------|----------|
| **inference_extension_info** | Gauge | 当前构建信息（用于版本识别） | `commit`、`build_ref` |

### 12.2 流控指标（实验性） {/* #82-流控指标实验性 */}

启用实验性 **Flow Control** 时，EPP 会额外暴露以下指标，用于观测排队时长、队列长度与派发周期。

| 指标名 | 类型 | 说明 | 主要标签 |
|--------|------|------|----------|
| **inference_extension_flow_control_request_queue_duration_seconds** | Distribution | 请求在流控层排队的总时长分布（从进入 EnqueueAndWait 到最终结果：Dispatched / Rejected / Evicted） | `fairness_id`、`priority`、`outcome`、`inference_pool`、`model_name`、`target_model_name` |
| **inference_extension_flow_control_queue_size** | Gauge | 流控层当前正在管理的 **请求个数** | `fairness_id`、`priority`、`inference_pool`、`model_name`、`target_model_name` |
| **inference_extension_flow_control_queue_bytes** | Gauge | 流控层当前正在管理的 **请求总大小（字节）** | 同上 |
| **inference_extension_flow_control_dispatch_cycle_duration_seconds** | Histogram | 每次派发周期的耗时 | — |
| **inference_extension_flow_control_request_enqueue_duration_seconds** | Gauge | 请求入队耗时 | `fairness_id`、`priority`、`outcome` |

### 12.3 采集与访问 {/* #83-采集与访问 */}

- EPP 默认在 **9090** 端口暴露 `/metrics`；需配置 Prometheus 抓取该端点（及模型服务等端点）。
- 抓取权限：客户端需具备 `nonResourceURLs: ["/metrics"]`、`verbs: ["get"]` 的 ClusterRole。
- 更多说明（含 pprof、Grafana/Prometheus 部署、告警示例）见：**`site-src/guides/metrics-and-observability.md`**。

### 12.4 建议监控与告警 {/* #84-建议监控与告警 */}

- **SLO 与延迟**：使用 `inference_objective_request_duration_seconds`、`inference_objective_normalized_time_per_output_token_seconds` 的尾分位（如 P99），与请求头中的 `x-slo-ttft-ms` / `x-slo-tpot-ms` 对比做违反率告警。
- **错误率**：`rate(inference_objective_request_error_total)` / `rate(inference_objective_request_total)` 按 model 监控。
- **池健康与饱和**：`inference_pool_ready_pods`、`inference_pool_average_kv_cache_utilization`、`inference_pool_average_queue_size` 用于容量规划与饱和前预警（如 KV 利用率 > 0.9 或队列深度超过阈值告警）。
- **预测与调度**：若启用延迟预测，可结合预测耗时、预测与真实延迟的偏差等指标评估预测质量与 headroom 策略效果。

## 13. 仿真 LoadBalancer 的定位 {/* #九仿真-loadbalancer-的定位 */}

- **位置**：`tools/simulations/llm_ig_simulation/src/loadbalancer.py`。
- **作用**：在 **SimPy 离散事件仿真** 中，对**模拟请求**做多种策略（random、least、leastPseudo、leastlatency、smart、LoRA 等）的选点与排队/出队，用于策略对比、参数扫描、容量规划与问题复现。
- **与生产关系**：**不参与**线上请求；不向 EPP 提供数据；生产智能负载均衡由 EPP 的 Go 代码实现。仿真仅作离线研究与验证用。

## 14. 小结 {/* #十小结 */}

- **原理**：在网关与模型服务之间插入 EPP，通过 ext-proc 接收请求；在 EPP 内做路由（含 model 改写）、准入和**调度**；调度层对候选端点做 Filter → 多 Scorer 打分（含延迟预测 headroom、前缀缓存、KV/队列 composite）→ Weighted Random Picker，得到目标 endpoint；再通过 **HeaderMutation + DynamicMetadata + BodyMutation** 把 endpoint 与（可选）修改后的 body 返回给网关，由网关完成转发。
- **使用**：部署好网关 + InferencePool（含 EPP）+ 模型服务后，智能负载均衡即生效；通过请求头与 InferenceModelRewrite 控制 SLO 与模型名；可选启用延迟预测以增强 headroom 决策；配置项用于策略与权重的细粒度调优。监控与指标见**第八章**及 `site-src/guides/metrics-and-observability.md`。

## 15. 参考资料 {/* #十一参考 */}

- 架构提议：`docs/proposals/0683-epp-architecture-proposal/README.md`
- 端点与网关协议：`docs/proposals/004-endpoint-picker-protocol/README.md`
- 前缀缓存设计：`docs/proposals/0602-prefix-cache-aware-routing-proposal/README.md`
- 调度与 Scorer/Picker：`pkg/epp/scheduling/`、`pkg/epp/framework/plugins/scheduling/`
- 延迟预测与使用：`site-src/guides/latency-based-predictor.md`
- **指标与可观测性**：`site-src/guides/metrics-and-observability.md`
- 入门与部署：`site-src/guides/getting-started-latest.md`、`README.md`
