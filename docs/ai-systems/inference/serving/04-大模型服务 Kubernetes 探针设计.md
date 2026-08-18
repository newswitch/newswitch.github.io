---
title: "大模型服务 Kubernetes 探针：启动、存活、就绪与过载语义"
sidebar_label: "04. 大模型服务 Kubernetes 探针：启动、存活、就绪与过载语义"
sidebar_position: 4
description: "为长时间加载、GPU 推理和流式请求设计 startup、liveness、readiness，避免探针误杀、过早接流量和过载重启风暴。"
tags: ["Kubernetes", "Probe", "vLLM", "Readiness", "Liveness", "SRE"]
date: 2026-07-22 15:30:00
categories: 云原生
---

# 大模型服务 Kubernetes 探针：启动、存活、就绪与过载语义

大模型 Pod 从进程启动到能够稳定接收请求，可能经历数分钟：

```text
容器启动
 -> 挂载/下载模型
 -> 校验与反序列化
 -> CPU 内存加载
 -> GPU 权重分配
 -> TP/NCCL 初始化
 -> KV Cache / CUDA Graph
 -> warm-up
 -> Ready
```

普通 Web 服务常用的“启动后 10 秒探测端口”不适合直接照搬。探针过严会在模型即将加载完成时反复重启；
探针过松会把未加载完成、GPU 已故障或队列过载的 Pod 留在流量池中。

## 1. 学习目标

完成本文后，应能够：

- 区分 startup、liveness、readiness 的动作与语义；
- 设计大模型服务状态机和独立健康端点；
- 用真实启动分布计算探针窗口；
- 避免 liveness 把高负载当死锁；
- 让 readiness 与 EndpointSlice、准入和优雅退出协作；
- 定位探针连接失败、超时、错误码和重启风暴；
- 使用冷启动、过载、GPU 故障和发布演练验收。

## 2. 三种探针不是三个相同 URL

| 探针 | 回答的问题 | 失败动作 | 不应该检查 |
|---|---|---|---|
| startup | 应用是否在允许时间内完成启动 | kubelet 重启容器 | 不能要求冷启动立刻完成 |
| liveness | 进程是否陷入无法自行恢复状态 | kubelet 重启容器 | 不应依赖流量、外部存储、一次真实大推理 |
| readiness | 当前是否愿意接收新请求 | 从正常 Service 流量池摘除 | 不应把暂时过载直接变成重启 |

Kubernetes 行为：

- 配置 startup 后，它成功前 liveness/readiness 不执行；
- liveness/startup 连续失败达到阈值会终止并按 restartPolicy 重启容器；
- readiness 失败不会重启容器，但 Pod `Ready=False`，匹配 Service 的 EndpointSlice 不再把它作为普通 ready endpoint；
- readiness 会贯穿整个容器生命周期。

## 3. 先设计服务状态机

```text
BOOTING
  -> LOADING_MODEL
  -> INITIALIZING_GPU
  -> WARMING_UP
  -> READY
  -> OVERLOADED / DRAINING
  -> READY 或 TERMINATING

任意阶段 -> FATAL
```

映射：

| 状态 | startup | liveness | readiness |
|---|---|---|---|
| BOOTING/LOADING | 未成功 | 尚不执行 | 尚不执行 |
| INITIALIZING/WARMING | 未成功 | 尚不执行 | 尚不执行 |
| READY | 成功 | 成功 | 成功 |
| OVERLOADED | 已成功 | 成功 | 可按策略失败/限流 |
| DRAINING | 已成功 | 成功 | 失败 |
| FATAL | 失败或已超窗口 | 失败 | 失败 |

一个简单端口通常不能表达这些状态，建议由服务或轻量 supervisor 暴露明确端点。

## 4. 什么叫“启动完成”

startup 成功应至少代表：

- 模型制品完整且可读取；
- 目标 GPU worker/rank 全部启动；
- 权重和关键运行时内存已分配；
- TP/NCCL communicator 建立；
- API server 能与 worker 通信；
- 必要 warm-up 完成；
- 不存在不可恢复启动错误。

是否要求第一次推理完成取决于产品。若 warm-up 对避免首请求超时至关重要，可以纳入 startup；但请求必须短、确定、
不依赖外部系统，并避免每次探测都执行昂贵推理。

## 5. 什么叫“活着”

liveness 只检测无法自行恢复的状态，例如：

- event loop/主控制线程永久停止响应；
- worker 进程永久退出，前端进程仍在；
- 内部 watchdog 证明关键组件死锁；
- GPU context 已永久失效且服务无法自愈。

不适合 liveness：

- 当前队列很长；
- TTFT 超过 SLO；
- 外部 NFS/S3 短时慢；
- 下游认证服务失败；
- 真实大模型推理偶尔超时；
- GPU Util=100%；
- readiness 暂时失败。

如果过载导致 liveness 失败，kubelet重启部分副本，剩余副本压力更大，容易形成级联重启。

## 6. 什么叫“就绪”

readiness 应代表“现在可以接收新请求”。通常同时要求：

- startup 已完成；
- API server 与 worker 全部连通；
- 没有进入 draining；
- 关键 GPU/rank 可用；
- 队列/显存没有超过保护水位，或者准入层仍可明确返回 429；
- 模型版本与路由期望一致。

过载有两种设计：

### 6.1 保持 Ready，由应用返回 429 {/* #保持-ready由应用返回-429 */}

适合网关有 token-aware 准入、重试预算和多副本负载均衡。优点是状态稳定，缺点是客户端必须正确处理 429。

### 6.2 Readiness 暂时失败 {/* #readiness-暂时失败 */}

适合确实需要把副本从新流量池摘除的场景。必须加入 hysteresis（恢复阈值/连续成功），避免队列在阈值附近导致 endpoint 抖动。

不要只用一个瞬时 GPU 利用率阈值控制 readiness。

## 7. 探针类型

### 7.1 HTTP

优点：能表达状态和错误码，最适合服务。端点应快速、无副作用、无需鉴权或仅限本地/kubelet访问。

### 7.2 TCP

只证明端口 accept，不能证明模型 worker、GPU 或服务逻辑正常。适合非常薄的存活检查，不适合作为唯一 readiness。

### 7.3 exec

可以检查本地状态，但每次 probe 会在容器中创建进程；高 Pod 密度/高频率会带来额外 CPU 开销。命令缺失、shell 差异也会造成误判。

### 7.4 gRPC

适合实现标准 gRPC health protocol 的服务，需核对 Kubernetes 与服务实现的能力和端口。

## 8. 端点设计示例

```text
/startupz
  200: model + all workers + warm-up complete
  503: still loading

/livez
  200: control loop responsive, workers not fatally dead
  500: unrecoverable internal state

/readyz
  200: accepting new work
  503: loading, draining, worker unavailable or protective overload
```

响应可以包含简短 reason，但不要返回模型路径凭据、Prompt、Token、内部网络和堆栈。

```json
{
  "status": "not_ready",
  "reason": "draining",
  "model_revision": "example"
}
```

## 9. Kubernetes 配置示例

```yaml
containers:
  - name: model-server
    image: <pinned-image-by-digest>
    ports:
      - name: http
        containerPort: 8000
    startupProbe:
      httpGet:
        path: /startupz
        port: http
      periodSeconds: 10
      timeoutSeconds: 3
      failureThreshold: 90
    livenessProbe:
      httpGet:
        path: /livez
        port: http
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /readyz
        port: http
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 3
      successThreshold: 2
```

这是结构示例。端点、窗口和阈值必须用目标模型与存储的测量结果替换。

## 10. 如何计算启动窗口

近似最大失败窗口：

```text
startup failure window ≈ periodSeconds × failureThreshold
```

还要考虑 timeout、调度抖动和第一次探测时机。应测量：

```text
T_mount
T_download_or_read
T_deserialize
T_gpu_load
T_distributed_init
T_kv_graph_warmup
T_ready
```

按模型版本、热/冷缓存、存储、节点型号分别记录 P50/P95/P99/max。startup 窗口至少覆盖经过批准的最差正常场景，
同时设置 Deployment `progressDeadlineSeconds` 和外部发布超时，避免无限等待真正失败的 Pod。

## 11. 冷缓存与热缓存必须分开

同一 Pod：

```text
热缓存启动：模型已在节点页缓存/NVMe
冷缓存启动：需要从 NFS/Ceph/S3 读取
```

两者可能相差数倍。只根据开发环境热缓存设置 startup，会使首次上线、节点迁移或缓存淘汰后重启循环。

## 12. 多卡/多进程探针聚合

TP=8 的 Pod 不能因为 HTTP 主进程活着就 Ready。聚合状态至少确认：

- 8 个预期 worker 存在；
- 每个 rank 心跳更新；
- communicator/worker group ready；
- 没有 rank OOM/Xid/退出；
- API server 能向 worker 发轻量控制请求。

一个 rank 失败通常使整个 TP 副本不可用，应让 Pod readiness 失败并由控制器整组恢复，而不是继续向剩余 rank 发送请求。

## 13. GPU 健康与探针的边界

不要在每 5 秒 HTTP probe 内运行：

- `dcgmi diag`；
- GPU 压力测试；
- NCCL 大消息 benchmark；
- 大模型真实生成；
- 全量 `nvidia-smi -q`。

硬件健康应由 DCGM、node agent、device plugin 和告警负责。应用探针只消费轻量健康状态，避免探针本身争抢 GPU。

## 14. 探针与 EndpointSlice

readiness 失败后，Pod Ready=False，EndpointSlice 对应 endpoint 的 ready/serving 状态发生变化，Service proxy 通常不再发送普通流量。

```bash
kubectl get pod -n <namespace> <pod> -o json | jq '.status.conditions'
kubectl get endpointslice -n <namespace> \
  -l kubernetes.io/service-name=<service> -o yaml
```

排障时同时看 Pod condition 和 EndpointSlice，不要只看 `kubectl get pods` 的 READY 列。

## 15. 探针与优雅退出

收到终止后，推荐：

```text
设置 DRAINING
 -> readiness 失败
 -> 停止接收新请求
 -> 完成/取消在途请求
 -> 关闭 worker/communicator
 -> 进程退出
```

Kubernetes 在 Pod 删除时会标记 EndpointSlice endpoint 为 terminating，ready 通常为 false。应用仍需正确处理 SIGTERM 和在途请求，
不能只依赖“等待几秒”的 preStop。

## 16. 探针与自动扩缩容

readiness 不是扩缩容指标。模型服务扩容应关注：

- waiting requests/tokens；
- queue time；
- TTFT/TPOT；
- KV Cache；
- admission rejects；
- 冷启动时间；
- 最小 Ready 副本。

如果所有过载副本都同时 readiness 失败，Service 会失去全部普通 endpoint。准入、负载均衡、readiness 和 autoscaler 必须联合设计。

## 17. 常见失败模式

### 17.1 `connection refused`

探针目标端口无监听、应用只绑定 localhost、端口名/数字错误，或探针开始时 server 尚未启动。

```bash
kubectl exec -n <namespace> <pod> -- ss -lntp
```

### 17.2 `context deadline exceeded`

端点响应超过 `timeoutSeconds`。检查 endpoint 是否做了阻塞 GPU/存储操作、event loop 是否被业务占满、CPU 是否饱和。

### 17.3 HTTP 404

路径不存在或 base path 改变。说明 TCP/HTTP 可能已通，不要排查 CNI 起步。

### 17.4 HTTP 503

端点主动表示未 ready。读取 response reason、服务状态、模型加载、worker 和队列，而不是只增加 timeout。

### 17.5 `Startup probe failed` 后 `KeyboardInterrupt/terminated`

可能是 kubelet在窗口耗尽后终止仍在加载的进程。比较真实冷启动分布、失败时日志和 probe events，区分窗口过短与真正启动失败。

### 17.6 liveness 重启风暴

```text
负载升高 -> probe timeout -> 容器重启
 -> 可用副本减少 -> 剩余负载更高 -> 更多重启
```

立即保护流量并区分过载与死锁；不要只把 failureThreshold 调大后忽略容量问题。

### 17.7 readiness 抖动

检查阈值是否无滞回、指标窗口太短、探针是否与业务争锁、worker heartbeat 是否抖动。使用连续失败/成功与不同进入/退出阈值。

## 18. 排查顺序

```text
Pod phase/condition/restart
 -> kubelet probe Event
 -> 进程和监听
 -> 容器内直接 curl endpoint
 -> 服务内部状态
 -> worker/GPU/NCCL
 -> EndpointSlice
 -> Service/网关
```

命令：

```bash
kubectl describe pod -n <namespace> <pod>
kubectl logs -n <namespace> <pod> --timestamps
kubectl logs -n <namespace> <pod> --previous --timestamps
kubectl exec -n <namespace> <pod> -- curl -v --max-time 5 http://127.0.0.1:8000/readyz
```

## 19. 安全实验

### 19.1 实验一：模拟慢启动 {/* #实验一模拟慢启动 */}

测试服务启动前 sleep 不同时间，验证 startup 成功前 liveness/readiness 不执行，并观察窗口耗尽后的重启。

### 19.2 实验二：readiness 失败 {/* #实验二readiness-失败 */}

让 `/readyz` 返回 503，观察 Pod Running、Ready=False 和 EndpointSlice conditions，同时确认容器不重启。

### 19.3 实验三：liveness 失败 {/* #实验三liveness-失败 */}

只在测试环境让 `/livez` 持续失败，观察 terminationGrace、previous logs 和 restart count。

### 19.4 实验四：过载 {/* #实验四过载 */}

使用受控压测提高队列，验证 readiness/429、autoscaler 和 liveness 不形成级联重启。

### 19.5 实验五：TP worker 失败 {/* #实验五tp-worker-失败 */}

在测试副本终止一个 worker，验证聚合 readiness 失败且整个副本不再接流量。

### 19.6 实验六：冷启动发布 {/* #实验六冷启动发布 */}

清理测试节点模型缓存或使用新节点，记录完整冷启动 P99，并验证 Deployment progress deadline 足够且不过长。

## 20. 生产验收

- [ ] startup/liveness/readiness 使用不同语义；
- [ ] startup 覆盖冷缓存、最大正常模型加载与分布式初始化；
- [ ] liveness 不依赖外部服务或真实重推理；
- [ ] readiness 能表达 worker、GPU 和 draining；
- [ ] 过载由准入、限流和扩缩容处理，不触发重启风暴；
- [ ] 多 rank 状态被聚合；
- [ ] EndpointSlice 与 Pod readiness 一致；
- [ ] SIGTERM 后先摘流量再排空；
- [ ] 探针 latency/error/restart 有监控；
- [ ] 冷启动、过载、worker 失败和滚动升级演练通过。

## 21. 掌握标准

### 21.1 入门 {/* #入门 */}

- 能解释三种探针失败动作；
- 能使用 startup 保护长时间模型加载；
- 能从 Event 定位 probe failure。

### 21.2 进阶 {/* #进阶 */}

- 能设计独立 `/startupz`、`/livez`、`/readyz`；
- 能聚合多 GPU worker 状态；
- 能处理过载、readiness 和 EndpointSlice。

### 21.3 生产级 {/* #生产级 */}

- 能用启动分布和 SLO计算窗口；
- 能避免探针造成级联故障；
- 能把探针、准入、扩缩容、发布和优雅退出设计成同一状态机。

## 22. 参考资料 {/* #参考资料 */}

- [Kubernetes Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Configure Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [vLLM on Kubernetes](https://docs.vllm.ai/en/latest/deployment/k8s/)

下一篇：[大模型推理服务滚动升级与优雅退出](./05-大模型推理服务滚动升级与优雅退出.md)。
