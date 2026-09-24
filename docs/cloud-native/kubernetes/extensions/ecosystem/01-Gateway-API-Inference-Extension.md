---
title: "Gateway API Inference Extension：稳定 API、请求链路与实现边界"
sidebar_label: "01. Gateway API Inference Extension：稳定 API 与实现边界"
sidebar_position: 1
description: "从稳定的 InferencePool API 出发，解释 HTTPRoute、Inference Gateway、Endpoint Picker 与模型 Pod 的协作关系，并区分标准契约、实验能力和具体实现。"
tags: [Gateway API, InferencePool, EPP, Kubernetes, 推理网关]
date: 2026-09-24 12:00:00
categories: 云原生
---

# Gateway API Inference Extension：稳定 API、请求链路与实现边界

Gateway API Inference Extension 解决的不是“怎样把 HTTP 请求转给一个 Service”，而是：**当同一个模型池里有多个推理实例时，怎样结合队列、KV Cache、模型适配器和请求特征选择更合适的实例。**

> **版本基线（2026-09）**：`InferencePool` 自项目 v1.0.0 起进入稳定的 `inference.networking.k8s.io/v1`；`InferencePoolImport` 自 v1.1.0 起仍为 Alpha。项目正在把 API 与一致性测试迁入 Gateway API，把参考 EPP、插件与基准整合到 `llm-d-router`。部署前必须同时核对 Inference Extension、Gateway Controller 和 EPP 实现的版本说明。

## 1. 先区分三类内容

| 层次 | 当前状态 | 可以依赖什么 |
|------|----------|--------------|
| API 契约 | `InferencePool v1` 稳定 | API 组、资源类型、字段语义和状态条件 |
| 跨集群导入 | `InferencePoolImport` Alpha | 仅在确认实现支持后试用，升级时允许破坏性变化 |
| 调度策略与扩展能力 | 实现相关 | KV Cache、队列、LoRA、前缀亲和、优先级、模型改写、指标名和配置方法都要查实现文档 |

“稳定 API”不等于“整个推理网关生态的每个功能都已经稳定”。它只表示 `InferencePool v1` 的契约已经稳定，不能据此假设不同厂商的 EPP 有相同打分器、指标和 Helm 参数。

## 2. 为什么普通 Service 不够

普通 Service 通常按连接或简单负载均衡策略选择后端，它不知道：

- 哪个实例的等待队列更短；
- 哪个实例已缓存相同前缀的 KV Cache；
- 哪个实例加载了目标 LoRA Adapter；
- 哪个实例显存压力更高；
- 新请求对 TTFT、TPOT 和吞吐的影响。

推理请求之间的代价差异很大。一个 20 Token 的问题和一个 8K Prompt 的请求，不能简单视为等价连接。因此需要把“选择哪个模型实例”的决策从普通四层或七层均衡中抽出来。

## 3. 核心组件

```text
客户端
  → Gateway 数据面
    → HTTPRoute 匹配
      → InferencePool
        → Endpoint Picker（EPP，是否由用户部署取决于实现）
          → 选择一个模型 Pod 的 IP:Port
    → Gateway 把请求转发给目标模型 Pod
  ← 流式或非流式响应
```

### 3.1 Gateway 与 HTTPRoute

Gateway 是入口和真正的数据转发者；HTTPRoute 负责主机名、路径、Header 等七层匹配。和普通路由不同的是，它的 `backendRef` 指向 `InferencePool`，而不是 Service。

### 3.2 InferencePool

InferencePool 是面向推理工作负载的后端抽象，负责声明：

- 哪些同命名空间 Pod 属于模型池；
- 请求最终进入模型 Pod 的哪个端口；
- 使用哪个 Endpoint Picker；
- EPP 无法响应时采用 FailOpen 还是 FailClose。

它不是 Service 的别名，也不负责执行模型。

### 3.3 Endpoint Picker

Endpoint Picker 根据候选端点和运行状态返回目标端点。EPP **做决策但不承载最终模型流量**；真正把请求发给模型 Pod 的仍是 Gateway 数据面。

不同实现可以采用不同策略。常见输入包括队列长度、KV Cache 使用量、已加载适配器和请求特征，但这些不是 `InferencePool v1` 强制规定的具体算法。

### 3.4 模型服务器协议

模型 Pod 需要提供实现所要求的模型服务器协议或指标，使 EPP 能理解端点状态。不能因为 vLLM、SGLang 或其他服务都提供 OpenAI 兼容 API，就假设它们向 EPP 暴露的状态接口也完全一致。

## 4. 一个请求经历了什么

### 4.1 路由到模型池

Gateway 收到请求后先按 HTTPRoute 匹配规则选择 InferencePool。这个阶段回答的是“请求属于哪个模型池”，不是“池内选择哪个 Pod”。

### 4.2 构造候选端点

Gateway Controller 或相关组件根据 `InferencePool.spec.selector` 找到同命名空间内匹配的 Pod，再把 Pod IP 与 `targetPorts` 组合成候选端点。

### 4.3 请求 EPP 做决策

当当前 Gateway 实现需要外部 EPP 时，它把请求上下文和候选端点信息交给 EPP。EPP 可以结合异步采集的端点状态做过滤、打分或其他决策。

### 4.4 Gateway 完成转发

EPP 返回目标后，Gateway 把原请求发给模型 Pod。模型产生的普通响应或流式 Token 再通过 Gateway 返回客户端。

因此，排障时应分别观察：

```text
Route 是否匹配
  → InferencePool 引用是否解析
    → 候选 Pod 是否正确
      → EPP 是否可达、是否成功选点
        → Gateway 到目标 Pod 是否可达
          → 模型自身是否健康
```

## 5. 当前稳定的 InferencePool 写法

```yaml
apiVersion: inference.networking.k8s.io/v1
kind: InferencePool
metadata:
  name: qwen-pool
  namespace: ai-serving
spec:
  selector:
    matchLabels:
      app: qwen-server
  targetPorts:
    - number: 8000
  endpointPickerRef:
    name: qwen-pool-epp
    port:
      number: 9002
    failureMode: FailOpen
```

字段含义：

| 字段 | 含义 | 常见错误 |
|------|------|----------|
| `selector.matchLabels` | 选择同命名空间内的模型 Pod | 标签拼写不一致，候选集为空 |
| `targetPorts` | 模型 Pod 的目标端口；最多可声明 8 个 | 写成 EPP 端口或 Service 端口 |
| `appProtocol` | 默认 HTTP/1.1；也可声明 `kubernetes.io/h2c` | gRPC/h2c 与实际协议不一致 |
| `endpointPickerRef.name` | EPP 引用名称 | Service 不存在或名称错误 |
| `endpointPickerRef.port` | 引用 Service 时填写 Service Port | 误填容器 `targetPort` |
| `failureMode` | EPP 失败时关闭还是继续 | 不理解可用性与调度质量的取舍 |

### 5.1 endpointPickerRef 为什么可能省略

在 v1.5.0 以前，`endpointPickerRef` 是必填字段；当前 API 层已经允许省略，目的是支持由 Gateway 实现内置或托管 Endpoint Picker 的模式。

这不代表所有现有 Controller 都能省略。若实现仍要求外部 EPP，省略后 `Accepted` 应为 `False`，并可能出现 `EndpointPickerRefMissing`。应以所选 Gateway 实现的兼容矩阵为准。

### 5.2 FailOpen 与 FailClose

| 模式 | EPP 不可用时 | 适用倾向 | 风险 |
|------|---------------|----------|------|
| `FailOpen` | Gateway 可自行选择一个候选端点继续转发 | 可用性优先 | 失去智能调度，尾延迟和负载可能恶化 |
| `FailClose` | 拒绝或终止本次选点 | 策略正确性优先 | EPP 故障会直接影响请求可用性 |

默认行为和实现细节仍应查当前 API 参考及 Gateway 文档。不能只看到 `FailOpen` 就认为故障期间性能不受影响。

## 6. HTTPRoute 如何引用 InferencePool

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
            value: /
      backendRefs:
        - group: inference.networking.k8s.io
          kind: InferencePool
          name: qwen-pool
```

这里最关键的是 `group` 和 `kind`。如果仍按普通 Service 的默认规则解析，Controller 找不到正确后端。

同一个 HTTPRoute 可以引用多个 InferencePool，但多池权重、请求体路由和模型名路由是否受支持，取决于 Gateway 与扩展实现，不能从标准 InferencePool API 自动推导。

## 7. 状态比 Running 更重要

Pod 为 `Running` 只说明容器进程存在，不代表整条推理路由已经建立。至少检查：

```bash
kubectl get gateway,httproute -n ai-serving
kubectl get inferencepool -n ai-serving
kubectl get inferencepool qwen-pool -n ai-serving -o yaml
kubectl get pod -n ai-serving -l app=qwen-server -o wide
kubectl get service,endpointslice -n ai-serving
```

重点观察 HTTPRoute 和 InferencePool 的状态条件：

- `Accepted=True`：对应 Controller 接受了配置；
- `ResolvedRefs=True`：引用的 Gateway、InferencePool、EPP 等可以解析；
- 状态中的 `observedGeneration` 与当前 `metadata.generation` 一致：状态不是旧结果。

不同 Controller 写入的状态相互独立。同一个 InferencePool 可能被多个 Gateway 使用，因此不要假设只有一个控制器会更新它。

## 8. 调度策略哪些可以通用理解

尽管具体插件会变化，策略目标可以稳定地分成四类：

| 目标 | 可观测信号 | 作用 | 代价或风险 |
|------|------------|------|------------|
| 避免排队 | Waiting/Running Requests | 减少拥塞与 TTFT | 指标可能滞后 |
| 控制 KV 压力 | KV Cache 使用量、驱逐率 | 降低 Block 不足和重计算 | 不同引擎指标语义不同 |
| 提高缓存命中 | Prompt Prefix、会话或缓存亲和 | 减少 Prefill 工作量 | 可能造成热点倾斜 |
| 适配器亲和 | 已加载 LoRA 列表 | 避免重复加载 | 状态变化时需要及时失效 |

不能把“多个分数相加”当成所有实现的固定算法。有的实现使用过滤加权，有的使用预测模型，有的把调度器集成在 Gateway 内部。应先确定选用的实现，再阅读其算法、配置和指标。

## 9. 历史资料为什么容易过期

早期资料可能出现以下内容：

- `InferenceObjective` 或模型改写 CRD；
- 固定的 `Filter → Scorer → Picker` 插件目录；
- Prefix、Queue、KV、LoRA、Predicted Latency 等具体 Scorer 名称；
- `pkg/epp/*` 源码路径；
- 固定的 EPP Prometheus 指标名；
- 仓库内部的仿真器和 Helm values。

这些内容有助于理解一种参考实现如何设计，但不属于 `InferencePool v1` 的稳定承诺。参考 EPP、插件和基准已经向 `llm-d-router` 整合，Body-Based Routing 与 Latency Predictor 也在向独立项目拆分。

阅读旧文章时应按下面顺序验证：

1. 先查看资源的 `apiVersion` 与 CRD 是否仍存在；
2. 再查看所选 Gateway Controller 的支持列表和版本；
3. 查看 EPP/Router 实现仓库的 Release 与配置参考；
4. 在测试集群运行 `kubectl explain` 和服务端 Dry Run；
5. 最后再把清单纳入 GitOps。

```bash
kubectl api-resources | grep -i inference
kubectl explain inferencepool.spec
kubectl apply --server-side --dry-run=server -f inference-pool.yaml
```

## 10. 生产排障方法

### 10.1 HTTPRoute 未被接受

检查 GatewayClass、parentRefs、命名空间和 Controller 是否支持 InferencePool Backend：

```bash
kubectl describe httproute qwen-route -n ai-serving
kubectl get gatewayclass,gateway -A
```

### 10.2 ResolvedRefs=False

重点检查：

- `backendRefs.group/kind/name`；
- InferencePool 与 Route 的命名空间关系；
- 跨命名空间引用是否具有 ReferenceGrant；
- EPP Service 和端口是否存在；
- Controller 是否认识安装的 InferencePool API 版本。

### 10.3 候选端点为空

```bash
kubectl get pod -n ai-serving -l app=qwen-server --show-labels
kubectl get inferencepool qwen-pool -n ai-serving -o jsonpath='{.spec.selector}'
```

检查 Pod 是否 Ready、是否有 Pod IP、标签是否完全匹配、目标端口是否监听。InferencePool 的 selector 不跨命名空间选择 Pod。

### 10.4 EPP 不可达

```bash
kubectl get service,endpointslice -n ai-serving | grep epp
kubectl logs -n ai-serving deploy/qwen-pool-epp --tail=200
```

还要确认 NetworkPolicy、mTLS、Service Port 与 TargetPort。若使用 FailOpen，请同时观察请求是否仍可达，以及尾延迟、错误率和实例倾斜是否恶化。

### 10.5 已选端点但请求失败

此时问题通常已经越过 EPP，应继续检查 Gateway 到模型 Pod 的网络、协议和模型进程：

```bash
kubectl exec -n ai-serving deploy/<debug-client> -- \
  curl -sv http://<pod-ip>:8000/health
kubectl logs -n ai-serving pod/<model-pod> --tail=200
```

不要只重启 EPP。选点成功并不代表目标模型完成了推理。

## 11. 监控应按层建设

不要绑定一组可能随实现改变的固定指标名。先定义要回答的问题，再映射到所选实现实际暴露的指标：

| 层 | 关键问题 |
|----|----------|
| Gateway | 请求量、状态码、连接、路由失败和整体延迟怎样 |
| EPP/Router | 选点耗时、失败、回退、端点分布和指标新鲜度怎样 |
| 模型服务 | TTFT、TPOT、排队、Running Requests、KV Cache 和吞吐怎样 |
| Kubernetes | Pod Ready、重启、端点变化、CPU/内存/GPU/NPU 资源怎样 |

告警应能区分：路由配置错误、EPP 故障、模型池容量不足和单个模型实例异常。只看平均延迟会掩盖端点倾斜与 P99 问题。

## 12. 版本升级检查表

- [ ] `InferencePool` CRD 的 API 版本与 Controller 支持范围一致；
- [ ] Gateway API CRD、Gateway Controller、Inference Extension 和 EPP 版本经过组合验证；
- [ ] 所有 Alpha 资源单独列出，不与稳定 API 混淆；
- [ ] `endpointPickerRef` 省略行为已在目标实现验证；
- [ ] `FailOpen` 与 `FailClose` 做过故障演练；
- [ ] 指标名、标签和 Dashboard 来自当前实现版本；
- [ ] 升级前后对 Accepted、ResolvedRefs、选点分布、TTFT 和错误率做回归；
- [ ] 旧 API 或插件被移除前已有回滚方案。

## 13. 课后练习与答案

**问题 1：EPP 选出 Pod 后，模型请求是否经过 EPP 转发？**

通常不经过。EPP 返回选择结果，Gateway 数据面再把请求发给模型 Pod。EPP 位于决策路径，不是模型流量的数据代理。

**问题 2：InferencePool 已是 v1，为什么仍不能复制任意旧教程的全部 YAML？**

因为稳定的是 InferencePool API 契约；旧教程里的实验 CRD、EPP 插件、指标和 Helm 参数可能属于特定版本或已经迁移。

**问题 3：FailOpen 是否意味着 EPP 故障没有影响？**

不是。FailOpen 提高请求可达性，但 Gateway 可能退化为普通选点，导致缓存命中率下降、负载倾斜和尾延迟升高。

**问题 4：HTTPRoute 为 Accepted=True，但请求仍失败，下一步看哪里？**

继续检查 `ResolvedRefs`、InferencePool 候选 Pod、EPP 可达性和选点日志，再验证 Gateway 到目标 Pod 的网络、端口、协议与模型健康状态。

## 14. 参考资料

- [Gateway API Inference Extension Introduction](https://gateway-api-inference-extension.sigs.k8s.io/)
- [InferencePool](https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepool/)
- [InferencePool v1 API Reference](https://gateway-api-inference-extension.sigs.k8s.io/reference/spec/)
- [InferencePoolImport](https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepoolimport/)
- [Implementer Guide](https://gateway-api-inference-extension.sigs.k8s.io/guides/implementers/)
- [Project FAQ and Migration](https://gateway-api-inference-extension.sigs.k8s.io/faq/)
- [llm-d-router](https://github.com/llm-d/llm-d-router)
