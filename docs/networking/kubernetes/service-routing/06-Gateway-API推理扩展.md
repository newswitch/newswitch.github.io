---
title: "Gateway API 推理扩展：HTTPRoute、InferencePool 与 EPP"
sidebar_label: "06. Gateway API 推理扩展"
sidebar_position: 6
description: "从网络转发视角解释 Gateway API Inference Extension 的稳定 API、请求路径、端点选择、故障语义和排障方法。"
tags: [Kubernetes, Gateway API, InferencePool, EPP, LLM, 推理路由]
---

# Gateway API 推理扩展：HTTPRoute、InferencePool 与 EPP

普通 Service 能根据 Ready Endpoint 转发请求，却不知道某个 vLLM Pod 正在排队、KV Cache 接近满载、已经缓存了相同前缀，或者加载了目标 LoRA。推理扩展在 Gateway API 的路由模型中加入 `InferencePool`，让网关在真正转发前取得面向推理负载的端点选择结果。

## 1. 先确认当前版本边界

截至 2026 年 9 月，阅读资料时应区分三个层次：

| 层次 | 状态 | 含义 |
| --- | --- | --- |
| `InferencePool` API | 自 v1.0.0 起进入 `v1`，GA | API Schema 具有稳定性承诺 |
| `InferencePoolImport` | Alpha | 用于多集群导入，仍可能破坏性变化 |
| EPP、BBR、延迟预测实现 | 实现快速演进 | 参考 EPP 已向 llm-d-router 汇聚，具体网关也可实现自己的扩展 |

这意味着“`InferencePool` 已稳定”不等于所有调度插件、Helm 参数和网关实现都已稳定。部署时必须锁定 Gateway Controller、扩展 Chart、CRD 和模型服务协议版本。

旧资料中的 `InferenceRoute` 不是当前核心请求链。标准路由使用 `HTTPRoute`，其 `backendRef` 指向 `InferencePool`。

## 2. 核心请求路径

```text
Client
  → Gateway listener
    → HTTPRoute 匹配 host/path/header
      → backendRef: InferencePool
        → Gateway 调用 Endpoint Picker Extension
          → Filter 不合格 Pod
          → Scorer 根据队列、KV、前缀、LoRA 等打分
          → Picker 选择 endpoint
        → Gateway 把原请求转发到模型 Pod
          → 流式响应经 Gateway 返回 Client
```

EPP 是决策点，不必成为实际请求数据面的串行代理。典型实现使用 Envoy `ext-proc` 让 Gateway 把请求信息交给 EPP，EPP 返回目标端点和必要的元数据，真正承载请求与流式响应的仍是 Gateway。

## 3. 为什么 Service 负载均衡不够

| 维度 | Service/L4 负载均衡 | 推理感知选择 |
| --- | --- | --- |
| Endpoint 可用性 | Ready/NotReady | Ready 加模型服务运行状态 |
| 当前压力 | 通常不感知 | running、waiting queue、KV 使用率 |
| 请求内容 | 不读取 body 中的 model/prompt | 可结合模型、前缀和目标 SLO |
| 缓存 | 不知道 KV/Prefix Cache | 可优先命中已有前缀的实例 |
| LoRA | 不知道 Adapter | 可选择已加载目标 LoRA 的实例 |
| 目标 | 连接或报文分散 | TTFT、TPOT、吞吐和缓存命中综合优化 |

它不能创造算力。所有 Pod 都饱和时，智能路由最多选择相对较好的端点，还需要准入、排队、限流、扩容和容量规划。

## 4. 资源关系

```text
GatewayClass
  └─ Gateway
      └─ HTTPRoute
          └─ backendRef: InferencePool
              ├─ selector → model server Pods
              ├─ targetPorts → 模型服务端口
              └─ endpointPickerRef → EPP Service（典型实现）
```

### 4.1 HTTPRoute

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: qwen-route
  namespace: ai-serving
spec:
  parentRefs:
  - name: inference-gateway
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /v1
    backendRefs:
    - group: inference.networking.k8s.io
      kind: InferencePool
      name: qwen-pool
```

`HTTPRoute` 决定请求属于哪个后端池，不直接决定最终 Pod。

### 4.2 InferencePool

```yaml
apiVersion: inference.networking.k8s.io/v1
kind: InferencePool
metadata:
  name: qwen-pool
  namespace: ai-serving
spec:
  selector:
    matchLabels:
      app: qwen-vllm
  targetPorts:
  - number: 8000
  endpointPickerRef:
    name: qwen-epp
    kind: Service
    port:
      number: 9002
```

应以实际安装 CRD 的 OpenAPI Schema 为准：

```bash
kubectl explain inferencepool
kubectl explain inferencepool.spec
kubectl get crd inferencepools.inference.networking.k8s.io -o yaml
```

不同发布版中 `endpointPickerRef` 的必填性和扩展集成方式可能不同，不能只复制网上 YAML。

## 5. EPP 如何选择端点

一个典型调度框架包含三步：

```text
候选 Pods
  → Filter
  → Scorer(s)
  → Picker
  → endpoint
```

### 5.1 Filter

过滤不应接收本次请求的端点，例如：

- Pod 未 Ready 或模型尚未就绪；
- 端口/协议不匹配；
- 没有目标模型或 Adapter；
- 达到实现定义的硬性容量边界；
- 指标过期且策略要求 fail closed。

### 5.2 Scorer

常见信号包括：

| 信号 | 倾向 | 局限 |
| --- | --- | --- |
| Waiting Queue | 避开排队较长实例 | 不知道每个请求 Token 规模 |
| KV Cache Usage | 避开接近耗尽实例 | 低使用率不等于计算空闲 |
| Prefix Affinity | 命中已有前缀缓存 | 索引可能近似或过期 |
| LoRA Affinity | 选择已加载 Adapter 的实例 | 要求模型服务暴露可靠状态 |
| Predicted Latency | 预测 TTFT/TPOT | 模型漂移和特征质量影响结果 |
| Running Requests | 平衡正在执行的请求 | 长短请求成本差异很大 |

多个分数如何归一化、加权和处理缺失值，是具体实现的职责，不属于 `InferencePool` API 的稳定语义。

### 5.3 Picker

直接选择最高分可能让所有新请求瞬间涌向同一 Pod，形成振荡。实现可使用加权随机、带滞回的选择或其他算法。验证时要观察请求分布随时间的变化，而不只是单次选择结果。

## 6. 指标新鲜度比指标存在更重要

```text
模型服务指标
→ 抓取/上报
→ EPP 数据存储
→ 调度求值
```

任一步延迟都会让 EPP 用旧状态选择。至少监控：

- 每个 endpoint 指标年龄；
- EPP 调用延迟、错误和超时；
- 候选、过滤后、最终选择的端点数；
- 各 Pod 实际请求数、队列和 KV 使用率；
- Gateway 到模型 Pod 的连接/请求失败；
- 调度结果与真实 TTFT/TPOT 的偏差。

“Prometheus 能查到指标”不能证明 EPP 本次决策使用的是新鲜样本。

## 7. FailOpen 与 FailClose

EPP 不可用时需要明确故障语义：

| 模式 | 行为 | 适合场景 | 风险 |
| --- | --- | --- | --- |
| FailOpen | Gateway 使用普通选择或实现兜底继续转发 | 可用性优先 | 可能过载、缓存命中下降、SLO 恶化 |
| FailClose | 请求失败，不绕过 EPP | 严格准入或安全边界 | EPP 成为可用性依赖 |

FailOpen 不是“没有影响”。应为降级路径单独设置告警，并证明兜底负载均衡不会把全部流量压到少数 Pod。

## 8. 一次完整验收

### 8.1 CRD 和 Controller

```bash
kubectl get crd | grep inference.networking
kubectl api-resources | grep -i inference
kubectl get gatewayclass
```

### 8.2 Gateway 与路由

```bash
kubectl get gateway,httproute -n ai-serving
kubectl describe gateway inference-gateway -n ai-serving
kubectl describe httproute qwen-route -n ai-serving
```

检查 `Accepted`、`Programmed` 和 `ResolvedRefs` 等 Condition；具体 Condition 以资源版本和实现为准。

### 8.3 InferencePool

```bash
kubectl get inferencepool -n ai-serving
kubectl describe inferencepool qwen-pool -n ai-serving
kubectl get pod -n ai-serving -l app=qwen-vllm -o wide
kubectl get endpointslice -n ai-serving
```

核对 selector、Pod label、端口、EPP 引用和状态。

### 8.4 端到端请求

```bash
curl -N -sS \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen","messages":[{"role":"user","content":"hello"}],"stream":true}' \
  'http://<gateway-address>/v1/chat/completions'
```

同时采集 Gateway access log、EPP decision log/metrics、模型服务请求日志和 TTFT/TPOT，使用 request ID 串联。

## 9. 故障排查

### 9.1 HTTPRoute 不生效

```text
Gateway listener
→ parentRefs
→ namespace/ReferenceGrant
→ backendRef group/kind/name
→ InferencePool Condition
```

不要去查不存在的 `InferenceRoute`。

### 9.2 没有候选端点

核对：

- InferencePool selector 与 Pod label；
- Pod readiness 与模型 readiness；
- `targetPorts` 和容器监听端口；
- EPP RBAC/List-Watch；
- 模型服务协议和指标端点。

### 9.3 流量仍不均衡

“副本请求数相等”不一定是正确目标。先比较每个 Pod 的 Token 数、运行/等待请求、KV、TTFT/TPOT 和硬件拓扑。若确实异常，再检查指标时效、Scorer 权重、Picker 随机性和重试是否改变分布。

### 9.4 EPP 正常但请求 5xx

EPP 只负责选择；还需检查 Gateway 到 endpoint 的网络、端口、协议、TLS、NetworkPolicy 和模型服务自身错误。选择成功不等于转发成功。

## 10. 不要混淆的概念

- `InferencePool` 不是模型 Deployment；它选择并描述一组服务实例。
- EPP 不是 Kubernetes Scheduler；它为请求选模型端点，不为 Pod 选择 Node。
- 推理网关不替代 vLLM/SGLang 的内部连续批处理调度。
- Prefix affinity 不能保证 KV 一定命中，缓存可能被逐出或索引过期。
- 低 GPU Util 不代表某个 Pod 应继续接流量，瓶颈可能在队列、CPU、显存容量、通信或 TTFT SLO。

## 11. 练习与答案

**问题 1：HTTPRoute 为什么不直接指向模型 Service？**

指向 Service 时，网关只能使用普通后端选择；指向 InferencePool 才能进入推理感知端点选择流程。

**问题 2：EPP 选择了 Pod A，请求数据一定经过 EPP 转发吗？**

不一定。典型 ext-proc 架构中 EPP 返回决策，实际请求由 Gateway 直接转发给 Pod A。

**问题 3：InferencePool v1 已 GA，为什么部署仍需锁版本？**

GA 约束的是 API Schema。Gateway Controller、EPP、调度插件、Chart、模型服务协议及实验 API 仍可能演进。

**问题 4：EPP 超时时采用 FailOpen，系统就算健康吗？**

不是。请求可能继续成功，但退化为普通负载均衡，导致缓存命中下降、过载和延迟恶化。必须监控降级状态。

## 12. 延伸阅读

- [Gateway API Inference Extension：智能负载均衡原理与使用](../../../cloud-native/kubernetes/extensions/ecosystem/01-Gateway-API-Inference-Extension.md)
- [Gateway API Inference Extension API Overview](https://gateway-api-inference-extension.sigs.k8s.io/concepts/api-overview/)
- [InferencePool](https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepool/)
- [InferencePoolImport](https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepoolimport/)
- [项目 FAQ 与迁移计划](https://gateway-api-inference-extension.sigs.k8s.io/faq/)
