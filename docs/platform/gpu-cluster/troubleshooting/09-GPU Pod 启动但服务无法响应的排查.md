---
title: "GPU Pod Running 但服务无响应：从进程、EndpointSlice 到模型队列的完整排查"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Service", "EndpointSlice", "vLLM", "故障排查"]
description: "沿 Pod Condition、进程监听、探针、EndpointSlice、Service、NetworkPolicy、网关和模型内部队列定位 GPU 服务无响应。"
---

# GPU Pod Running 但服务无响应：从进程、EndpointSlice 到模型队列的完整排查

Pod `Running` 只表示至少一个主容器正在运行或启动/重启，不代表：

- 模型已经加载完成；
- 业务进程正在正确端口监听；
- readiness 已通过；
- EndpointSlice 已包含该 Pod；
- Service/网关能转发；
- GPU 推理能产生 Token；
- 请求没有卡在排队、Prefill、NCCL 或存储。

一条典型请求路径是：

```text
Client
  -> LoadBalancer / Ingress / Gateway
  -> Service ClusterIP
  -> EndpointSlice
  -> Pod IP:targetPort
  -> 容器监听 Socket
  -> HTTP Server / Tokenizer / Scheduler
  -> Model Worker
  -> CUDA / NCCL / GPU
  -> Streaming Response
```

排查原则：从路径两端逐段验证，找到“最后成功的一跳”和“第一处失败的一跳”，而不是同时重启 Pod、Service 和网关。

## 1. 学习目标

完成本文后，应能够：

- 区分 Running、ContainersReady、Ready 和应用可用；
- 从容器进程与 Socket 验证服务是否真正监听；
- 使用 EndpointSlice 验证 selector、readiness、port 和地址；
- 定位 Service、kube-proxy/eBPF、DNS、NetworkPolicy 和网关问题；
- 区分网络无响应与模型加载、GPU OOM、NCCL、排队过载；
- 处理流式响应、超时、优雅退出和重试放大；
- 用分层 smoke test 证明修复。

关联阅读：

- [大模型服务 Kubernetes 探针设计](../../../ai-systems/inference/serving/04-大模型服务%20Kubernetes%20探针设计.md)
- [推理请求从 HTTP 到首个 Token](../../../ai-systems/inference/vllm/07-推理请求从HTTP到首个Token的完整生命周期.md)
- [Calico 数据路径与排查](../../kubernetes/K8s学习-PartI-网络/03-Calico.md)

## 2. 先把“无响应”写成可测现象

| 现象 | 可能层级 |
|---|---|
| DNS 解析失败 | DNS、Service 名、namespace |
| `connection refused` | 目标可达但无进程监听/端口错 |
| connect timeout | 路由、NetworkPolicy、Service 数据面、节点网络 |
| HTTP 404 | 路径或路由规则错误，网络通常已通 |
| HTTP 503 | 无健康 upstream、网关/服务过载 |
| HTTP 429 | 准入/限流生效，不是网络断开 |
| header 很快、首 Token 很慢 | 排队、Prefill、GPU/NCCL/存储 |
| 部分请求成功、长请求失败 | 超时、上下文、OOM、流式代理 |
| 只在滚动发布时失败 | readiness、EndpointSlice、preStop、termination |

每次测试记录：

```text
时间和时区
源位置（集群外/Pod/节点/同 Pod）
目标 URL、Host、端口、路径
DNS、connect、TLS、TTFB、总耗时
HTTP 状态和响应体摘要
request_id / trace_id
```

`curl 不通` 不是足够的故障描述。

## 3. 保存对象与时间线

```bash
kubectl get pod -n <namespace> <pod> -o yaml
kubectl describe pod -n <namespace> <pod>
kubectl logs -n <namespace> <pod> -c <container> --timestamps
kubectl logs -n <namespace> <pod> -c <container> --previous --timestamps
kubectl get service -n <namespace> <service> -o yaml
kubectl get endpointslice -n <namespace> \
  -l kubernetes.io/service-name=<service> -o yaml
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
```

若经过 Ingress/Gateway，还要保存对应对象、controller 日志和配置快照。变更中的系统必须记录发布版本、ReplicaSet、Pod UID 和 endpoint 变化。

## 4. 第一层：Pod Condition 与容器状态

```bash
kubectl get pod -n <namespace> <pod> \
  -o jsonpath='{range .status.conditions[*]}{.type}{"="}{.status}{" reason="}{.reason}{" message="}{.message}{"\n"}{end}'
kubectl get pod -n <namespace> <pod> \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{" ready="}{.ready}{" restarts="}{.restartCount}{" state="}{.state}{" last="}{.lastState}{"\n"}{end}'
```

关键 Condition：

| Condition | 含义 |
|---|---|
| `PodScheduled` | 已完成调度 |
| `PodReadyToStartContainers` | sandbox/网络/卷/动态资源等已就绪，具体可见性依版本 |
| `Initialized` | init container 完成 |
| `ContainersReady` | 所有容器 ready |
| `Ready` | Pod 应进入匹配 Service 的负载均衡池 |

Pod phase 为 Running，但 `Ready=False`，是完全合法的状态。常见于模型加载、readiness 失败或自定义 readinessGate 未满足。

### 4.1 检查重启与退出原因

```bash
kubectl describe pod -n <namespace> <pod>
kubectl logs -n <namespace> <pod> -c <container> --previous
```

查：`OOMKilled`、exit code、liveness/startup failure、CUDA/NCCL、模型文件和权限错误。

## 5. 第二层：进程是否存在、监听在哪里

进入目标业务容器：

```bash
kubectl exec -n <namespace> <pod> -c <container> -- ps -ef
kubectl exec -n <namespace> <pod> -c <container> -- ss -lntp
```

验证：

- 业务进程是否仍在；
- 监听的是 `0.0.0.0`/Pod IP，还是只有 `127.0.0.1`；
- 实际端口是否等于 Service `targetPort`；
- IPv4/IPv6 是否匹配；
- sidecar 是否占用了同一端口；
- entrypoint 是否只是 `sleep` 或父进程仍在、worker 已退出。

`containerPort` 主要是声明和元数据，不会自动让应用监听，也不会替代 Service `targetPort`。

### 5.1 在容器内访问 loopback

```bash
kubectl exec -n <namespace> <pod> -c <container> -- \
  curl -sS -v --max-time 5 http://127.0.0.1:<port>/health
```

结果分流：

```text
loopback 失败
  -> 应用进程、监听、模型初始化、探针路径

loopback 成功，Pod IP 失败
  -> 监听地址、Pod 网络、NetworkPolicy
```

若业务镜像无调试工具，可以使用经过审批的 ephemeral debug container 或独立诊断 Pod，不要临时在线安装未知软件。

## 6. 第三层：应用启动到哪一步

大模型服务启动不是一个瞬间：

```text
进程启动
 -> 配置/Tokenizer
 -> 读取模型索引
 -> 存储下载/挂载读取
 -> CPU 内存加载和反序列化
 -> GPU 权重分配
 -> TP/NCCL 初始化
 -> KV Cache/CUDA Graph
 -> API Server Ready
```

日志按时间搜索：

```bash
kubectl logs -n <namespace> <pod> -c <container> --timestamps | \
  grep -iE 'error|exception|oom|cuda|nccl|timeout|listen|ready|model|cache|worker'
```

保留完整日志上下文。常见“进程还在但不能服务”：

- 模型仍从 NFS/Ceph/S3 下载；
- 文件权限或 checksum 失败后重试；
- CPU memory limit 导致加载被杀；
- GPU 权重或 KV Cache OOM；
- TP rank/NCCL 初始化等待；
- CUDA Graph warm-up；
- tokenizer/模型配置不匹配；
- worker 退出但前端进程未退出；
- 队列已过载，健康端点仍返回成功。

## 7. 第四层：探针是否表达了正确语义

```bash
kubectl get pod -n <namespace> <pod> \
  -o jsonpath='{range .spec.containers[*]}{.name}{" startup="}{.startupProbe}{" readiness="}{.readinessProbe}{" liveness="}{.livenessProbe}{"\n"}{end}'
kubectl describe pod -n <namespace> <pod> | sed -n '/Events:/,$p'
```

三类探针：

- startup：允许模型完成长启动，成功前不会执行 liveness/readiness；
- readiness：决定是否接收 Service 流量，失败不应直接重启；
- liveness：确认无法自愈的死锁等情况，失败会重启容器。

反模式：

- startup 时间小于最大模型加载时间；
- liveness 执行真实大模型推理，过载时引发重启风暴；
- readiness 只检查端口，不检查 worker 是否可接请求；
- 三种探针共用一个会访问慢存储/外部依赖的重端点；
- `timeoutSeconds: 1` 对冷启动或高负载环境不合理；
- readiness 永远成功，未加载完成的 Pod 提前进入 EndpointSlice。

## 8. 第五层：EndpointSlice 是关键证据

Service selector 由控制器转成 EndpointSlice：

```bash
kubectl get service -n <namespace> <service> -o yaml
kubectl get endpointslice -n <namespace> \
  -l kubernetes.io/service-name=<service> -o wide
kubectl get endpointslice -n <namespace> \
  -l kubernetes.io/service-name=<service> -o yaml
```

检查每个 endpoint：

- address 是否是当前 Pod IP；
- `targetRef.uid` 是否对应当前 Pod，而非旧 Pod；
- `conditions.ready/serving/terminating`；
- port/name/protocol；
- zone/node；
- endpoint 数量是否等于预期 ready 副本。

### 8.1 EndpointSlice 为空

按顺序检查：

1. Service selector；
2. Pod labels；
3. Pod Ready condition；
4. Service 是否没有 selector、由外部控制器管理 endpoint；
5. namespace 是否一致；
6. EndpointSlice controller/自定义控制器状态。

```bash
kubectl get service -n <namespace> <service> -o jsonpath='{.spec.selector}{"\n"}'
kubectl get pod -n <namespace> --show-labels
```

### 8.2 Endpoint 存在但端口错误

Service `port` 是客户端访问 Service 的端口，`targetPort` 是后端 Pod 实际端口；命名 targetPort 必须匹配 Pod port 名称。

```text
Client -> Service:port -> PodIP:targetPort
```

连接 refused 常由 targetPort 与实际监听端口不一致造成。

## 9. 第六层：从诊断 Pod 逐跳测试

准备一个固定、经过审批的网络诊断镜像：

```bash
kubectl run -n <namespace> net-debug --rm -it --restart=Never \
  --image=<approved-debug-image> -- sh
```

从同 namespace 依次测试：

```bash
# 1. DNS
getent hosts <service>
getent hosts <service>.<namespace>.svc

# 2. Pod IP（绕过 Service）
curl -sS -v --max-time 5 http://<pod-ip>:<target-port>/health

# 3. Service ClusterIP / DNS
curl -sS -v --max-time 5 http://<service>:<service-port>/health
```

解释：

```text
Pod IP 失败 -> Pod 监听、Pod 网络、NetworkPolicy
Pod IP 成功，Service 失败 -> EndpointSlice、targetPort、Service 数据面
Service 成功，外部失败 -> Ingress/Gateway/LB/DNS/TLS/边界策略
```

## 10. 第七层：Service 数据面

根据集群实现检查 kube-proxy 的 iptables/IPVS 或 CNI eBPF Service 数据面：

```bash
kubectl -n kube-system get pod -o wide
kubectl -n kube-system logs <kube-proxy-or-cni-agent-pod> --since=30m
```

节点侧命令依实现选择，例如 iptables-save、IPVS、Cilium/Calico CLI 与 eBPF map。先确认集群使用什么数据面，
不要在 eBPF 模式下只查 iptables，也不要直接刷新规则。

检查：

- ClusterIP 和端口是否已编程；
- EndpointSlice 更新是否传播；
- 后端节点是否有数据面 agent；
- conntrack 是否异常；
- 节点间 Pod 路由/隧道/BGP；
- MTU 和分片；
- host firewall。

## 11. 第八层：NetworkPolicy

```bash
kubectl get networkpolicy -A
kubectl describe networkpolicy -n <namespace> <policy>
```

NetworkPolicy 是 additive 规则，连接通常需要源 egress 与目标 ingress 都允许。检查：

- policy 是否选中了目标 Pod；
- 源 namespace/pod labels；
- 协议和 targetPort；
- DNS egress；
- 网关/探针源地址是否在允许范围；
- CNI 是否支持并实际执行这些规则。

不要通过删除全部 NetworkPolicy 验证。可在测试 namespace 复制最小场景，或按变更流程添加范围最小、可回滚的临时规则。

## 12. 第九层：Ingress、Gateway 与 Load Balancer

若 ClusterIP 内部正常而外部失败：

```bash
kubectl get ingress -A
kubectl get gateway,httproute -A
kubectl get service -n <gateway-namespace> -o wide
```

检查：

- Host/path/header 路由；
- TLS 证书、SNI 和 secret；
- backend Service/port；
- controller 是否接受配置；
- LB health check；
- connect/read/idle timeout；
- 最大请求体；
- HTTP/2、SSE/chunked streaming；
- upstream keepalive；
- 客户端取消是否向后端传播。

大模型流式请求可能持续数分钟。网关默认 read/idle timeout、缓冲和重试策略如果按普通短 HTTP 设计，会表现为“生成一半断开”或“首 Token 后超时”。

## 13. 第十层：模型服务内部队列与 GPU

网络完全正常，服务仍可能因为内部过载无响应：

```text
请求到达 HTTP Server
  -> 准入/排队
  -> tokenizer
  -> scheduler
  -> Prefill
  -> Decode
  -> streaming
```

同时检查：

- request rate、waiting/running requests；
- queue time、TTFT、TPOT、端到端延迟；
- 输入/输出 Token 分布；
- batch/token budget；
- KV Cache 使用与抢占；
- GPU SM、显存、功耗；
- CPU tokenizer、event loop 和线程池；
- TP rank/NCCL；
- 外部存储和模型 cache；
- 请求取消和 zombie request。

### 13.1 健康端点正常但生成接口超时

这通常说明基础进程和网络通，但业务路径有问题。使用一个短、确定、低成本请求验证，并记录请求 ID；再逐步增加输入长度和并发。

### 13.2 GPU Util 低不代表网络问题

可能卡在排队、CPU tokenization、存储、NCCL、锁或同步。用 Nsight Systems、PyTorch Profiler、应用指标和网络/存储指标建立统一时间线。

### 13.3 过载时不要让 liveness 重启

排队或 GPU 满载应该通过 readiness、准入、限流、扩容和降级处理。若 liveness 因业务请求变慢而失败，会减少副本并把压力转移给剩余 Pod，形成级联故障。

## 14. 常见症状矩阵

| 测试结果 | 大概率层级 | 下一证据 |
|---|---|---|
| 容器 loopback 失败 | 进程/模型/监听 | ps、ss、应用日志、GPU |
| loopback 成功，Pod IP 失败 | 绑定地址/Pod 网络/policy | ss、route、policy、抓包 |
| Pod IP 成功，Service 失败 | EndpointSlice/port/数据面 | slice、targetPort、proxy/eBPF |
| Service 成功，外部失败 | 网关/LB/TLS/DNS | route、controller、LB 日志 |
| `/health` 成功，`/ready` 失败 | 模型/worker 尚未可用 | 初始化日志、GPU/NCCL/存储 |
| 短请求成功，长请求失败 | timeout/OOM/context | 网关 timeout、显存、长度 |
| 低并发成功，高并发超时 | 排队/容量/过载 | waiting、TTFT、KV、GPU |
| 单 Pod 正常，多副本部分失败 | 坏 endpoint/版本漂移 | Pod UID、版本、逐 endpoint 测试 |
| 发布期间 502/503 | readiness/termination | EndpointSlice、preStop、网关 |

## 15. 抓包时怎么选位置

当对象和日志不足以解释时，从失败边界两侧抓包：

```text
客户端/诊断 Pod
Pod veth/节点
Service 数据面前后
目标 Pod namespace
网关 upstream
```

需要回答：SYN 是否发出、SYN-ACK 是否回来、TLS 在哪失败、HTTP request 是否到达、response 是否被重传/重置。
抓包可能包含 Token、Authorization、Prompt 和响应内容，必须限定过滤条件、时长、权限并脱敏。

## 16. 恢复策略

按根因选择最小动作：

| 根因 | 处理 |
|---|---|
| 进程未监听 | 修配置/入口，重建单个 Pod |
| targetPort 错 | 修改 Service 并验证 EndpointSlice |
| readiness 过早/过严 | 重设启动和就绪语义 |
| NetworkPolicy | 添加最小允许规则 |
| 网关 timeout | 按流式请求调整并压测 |
| 模型加载慢 | 缓存、存储、startup/readiness 设计 |
| OOM | 容量、上下文、并发和显存优化 |
| 排队过载 | 准入、限流、扩容、降级 |
| TP/NCCL | rank、拓扑、网络和整组恢复 |
| 单坏 endpoint | 摘流、保留证据、修复后再加入 |

避免客户端、网关和服务多层同时无限重试。重试必须有预算、退避、抖动、幂等和总 deadline，否则会放大过载。

## 17. 修复验收

- [ ] Pod Condition、容器状态和 restart count 正常；
- [ ] 进程监听地址和端口正确；
- [ ] loopback、Pod IP、Service DNS/ClusterIP、网关逐层通过；
- [ ] EndpointSlice 地址、port、ready/serving/terminating 正确；
- [ ] startup/readiness/liveness 表达不同语义；
- [ ] NetworkPolicy 和 Service 数据面符合设计；
- [ ] 模型 worker、GPU、TP/NCCL 正常；
- [ ] 短/长请求和流式响应通过；
- [ ] 目标并发下 TTFT、TPOT、错误率和 queue time 满足 SLO；
- [ ] 滚动发布和 Pod 终止期间无明显 5xx；
- [ ] 日志、指标和 Trace 能按 request ID 关联。

## 18. 可复现实验

### 实验一：错误 targetPort

在测试 namespace 创建一个正确 Service 和一个错误 targetPort 的 Service，对比 EndpointSlice、Pod IP 与 ClusterIP 测试。

### 实验二：readiness 失败

让测试应用 readiness 返回失败，观察 Pod Running、Ready=False、EndpointSlice ready 状态和 Service 流量。

### 实验三：只监听 loopback

让测试服务监听 `127.0.0.1`，证明容器内 loopback 成功但 Pod IP 失败，再改为合适监听地址复验。

### 实验四：流式超时

在测试网关使用可控慢流服务，逐步调整 idle/read timeout，观察普通健康请求和 streaming 行为。

### 实验五：过载而非死锁

用受控压测提高并发，观察 waiting、TTFT、readiness 和 liveness，证明过载应由准入/扩容处理而不是重启风暴。

## 19. 掌握标准

### 入门

- 能区分 Running 与 Ready；
- 能验证进程、监听端口和容器 loopback；
- 能读取 Service 与 EndpointSlice。

### 进阶

- 能从 Pod IP、ClusterIP 到网关逐跳定位；
- 能排查 selector、targetPort、NetworkPolicy 和探针；
- 能区分网络超时与模型加载/OOM/排队。

### 生产级

- 能处理流式响应、滚动发布、优雅退出和重试放大；
- 能关联 request、Pod、GPU、NCCL、NIC 和存储时间线；
- 能使用目标负载与 SLO 证明服务恢复，而不是只看 `/health` 返回 200。

## 参考资料

- [Kubernetes Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/)
- [Kubernetes EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)

至此，本模块形成：Pod Pending → GPU 不可见 → CUDA OOM → Xid → NCCL Timeout → Node NotReady → 服务无响应的完整排障链。
