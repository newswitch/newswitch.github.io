---
title: "一次 LLM 请求从网关到 GPU 再到流式返回"
sidebar_label: "06. 一次 LLM 请求从网关到 GPU 再到流式返回"
sidebar_position: 6
description: "串联网关、Service、推理引擎、Tokenizer、调度器、KV Cache、GPU Kernel、Tensor Parallel 和流式返回的完整请求路径。"
tags: ["LLM", "vLLM", "Kubernetes", "GPU", "网关", "可观测性"]
date: 2026-08-10 12:10:00
categories: AI基础设施
---

# 一次 LLM 请求从网关到 GPU 再到流式返回

当客户端调用一个兼容 OpenAI API 的模型服务时，表面上只是一次 HTTP 请求，背后却同时经过网络入口、Kubernetes 服务发现、推理引擎调度、CPU 预处理、GPU 计算、显存状态和分布式通信。

理解这条链路后，才能回答这些问题：

- 为什么 Pod、GPU 和网卡都正常，请求仍然很慢？
- TTFT 高与 TPOT 高分别应先查哪里？
- 多卡 Tensor Parallel 为什么会让单个慢 rank 拖慢整个请求？
- 为什么 readiness 正常，业务却出现 503 或流式中断？
- 一次请求怎样关联到网关、Pod、模型实例、GPU 和内核执行？

## 1. 先看完整地图

```text
客户端
  │ DNS、TCP/QUIC、TLS
  ▼
负载均衡 / API 网关
  │ 认证、限流、配额、请求大小、超时、路由
  ▼
Kubernetes Service / EndpointSlice
  │ kube-proxy/eBPF/网络策略/Pod 网络
  ▼
推理 Pod 的 HTTP Server
  │ 参数校验、Tokenizer、请求 ID、取消信号
  ▼
推理引擎 Scheduler
  │ admission、排队、continuous batching、KV block 分配
  ├───────────── CPU / 主机内存
  ▼
Prefill
  │ 权重读取、Attention、Tensor Parallel Collective
  ▼
KV Cache 写入 GPU HBM
  ▼
Decode 循环
  │ 每步调度 → GPU Kernel → 多卡同步 → 采样 → KV 增长
  ▼
Detokenize / Server-Sent Events
  │ Pod 网络 → Service/网关 → TLS → 客户端
  ▼
完整响应、取消或超时
```

模型权重通常在请求到来前已经从对象存储或共享存储加载到主机缓存和 GPU 显存。如果请求触发了模型冷加载，延迟可能从秒级上升到分钟级，这应被视为部署/扩容路径，而不是普通请求路径。

## 2. 控制面与数据面不要混淆

### 2.1 控制面

控制面决定“请求将来能去哪里”：

- Kubernetes Scheduler 把推理 Pod 放到某个节点；
- kubelet 与 Device Plugin 为容器分配 GPU；
- Deployment 决定副本和升级；
- readiness 决定 Pod 是否进入 EndpointSlice；
- HPA 或自定义控制器决定是否扩容；
- 模型路由器决定某个模型版本由哪些副本服务。

### 2.2 数据面

数据面承担“当前请求怎样流动”：

- 客户端与网关之间的连接；
- 网关到 Pod 的包转发；
- 推理进程内的队列和批处理；
- CPU 到 GPU、GPU HBM、NVLink/NVSwitch 和 NIC；
- token 通过 HTTP 流返回客户端。

调度器不在每个 token 生成时重新选择节点，但它之前的放置决定了 GPU 型号、NUMA、NVLink、NIC 和本地缓存，因此控制面会塑造数据面的性能上限。

## 3. 阶段一：DNS、连接和 TLS

客户端首先解析域名，与入口建立连接并完成 TLS。可能影响延迟的因素包括：

- DNS 缓存未命中或解析异常；
- 跨地域、跨运营商或跨 VPC 路由；
- TCP 建连、TLS 握手与连接复用；
- MTU 不一致、丢包和重传；
- 客户端代理或 Service Mesh；
- 空闲连接被中间设备回收。

对于短请求，如果每次都新建 TCP/TLS 连接，握手占比会很明显；对于长时间流式请求，应关注中间层 idle timeout 是否短于生成时间。

可以从客户端保留分段时间：

```bash
curl -sS -o /dev/null \
  -w 'dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} first_byte=%{time_starttransfer} total=%{time_total}\n' \
  https://<gateway>/v1/models
```

这里的 `time_starttransfer` 是 HTTP 首字节时间，不一定等同于模型的首 token 时间。流式接口需要在客户端按 SSE 事件记录 token 时间戳。

## 4. 阶段二：网关认证、限流和路由

网关通常执行：

1. TLS 终止；
2. API Key、JWT 或 mTLS 身份验证；
3. 租户配额、并发限制和速率限制；
4. 请求体大小、字段和模型名校验；
5. 模型版本、地域或灰度路由；
6. 超时、重试、熔断和访问日志；
7. 将请求 ID/Trace 上下文传给后端。

常见故障：

- 网关超时小于模型合理生成时间，后端仍计算但客户端已断开；
- 对非幂等生成请求自动重试，造成重复计算或重复计费；
- 限流只按 QPS，不考虑 prompt 长度和 `max_tokens`；
- 灰度路由把请求发到尚未预热的模型；
- 缓冲代理没有及时转发 SSE，看起来像模型很久不返回 token。

LLM 的单个请求成本差异很大。更合理的准入信号可组合请求数、输入 token、最大输出 token、活跃序列、KV Cache 和预计计算量。

## 5. 阶段三：Service、EndpointSlice 与 Pod 网络

网关通常访问 Kubernetes Service，Service 根据 EndpointSlice 中的 Ready 地址选择后端。关键链路是：

```text
Deployment/Pod label
  → Service selector
  → EndpointSlice controller
  → ready endpoint
  → kube-proxy 或 eBPF 数据面
  → CNI 路由与 NetworkPolicy
  → Pod IP:port
```

排查时分别检查：

```bash
kubectl -n <ns> get deploy,pod,svc -o wide
kubectl -n <ns> get endpointslice -l kubernetes.io/service-name=<service> -o yaml
kubectl -n <ns> describe pod <pod>
kubectl -n <ns> get networkpolicy
```

几种容易混淆的状态：

| 现象 | 可能状态 |
|---|---|
| Pod Running，Service 503 | readiness 失败或 EndpointSlice 为空 |
| Pod Ready，连接超时 | 网络策略、路由、端口或进程监听地址错误 |
| 只有部分请求失败 | 个别 Endpoint、节点网络或版本异常 |
| 升级时短暂无后端 | `maxUnavailable`、启动时间和旧副本退出顺序错误 |

## 6. 阶段四：HTTP Server 接收和校验请求

请求进入推理进程后，Server 层通常完成：

- 解析 JSON 和鉴权上下文；
- 校验模型、采样参数、上下文长度和输出上限；
- 创建 request ID；
- Tokenizer 编码输入；
- 把请求提交给推理引擎；
- 监听客户端取消；
- 将生成结果序列化为普通 JSON 或 SSE。

Tokenizer 通常运行在 CPU。长 prompt、高并发、复杂聊天模板或 CPU 配额过低时，GPU 可能在等待 CPU。要观察进程 CPU、线程池队列、事件循环延迟和 tokenizer 时间，而不是只看 GPU 利用率。

请求在此阶段可能被立即拒绝，例如模型名错误、上下文超过限制、参数非法、队列满或租户配额不足。4xx、429、503 的含义应清楚区分。

## 7. 阶段五：推理引擎准入和排队

推理引擎不能把所有请求立刻放进 GPU。它要根据以下资源决定准入：

- 活跃序列数；
- 输入 token 和待生成 token；
- 可用 KV Cache block；
- 最大 batched tokens；
- 调度策略与优先级；
- Tensor Parallel/Pipeline Parallel 实例状态；
- 请求是否可被抢占、重计算或换出。

连续批处理会在每个调度步把新请求加入正在运行的批次，提高吞吐，但会引入请求之间的资源竞争。吞吐最优参数不一定让 P99 最低。

从排队论看，接近饱和时等待会非线性增长。可用 Little 定律建立直觉：

```text
系统内平均请求数 L = 到达率 λ × 平均停留时间 W
```

如果并发持续增长但完成速率不变，队列与延迟一定会增长；自动扩容若只看 GPU 利用率，可能在 GPU 已饱和、队列恶化后才响应。

## 8. 阶段六：KV Cache 分配

Decoder-only LLM 为每个序列保存历史 token 的 Key/Value。粗略关系是：

```text
KV 容量 ∝ 层数 × KV Head 数 × Head Dimension
        × 已缓存 token 数 × 每元素字节数 × 2(K 和 V)
```

具体布局与 GQA/MQA、数据类型、分页方式、并行策略和引擎实现有关。

KV Cache 决定可以同时容纳多少请求。以下情况会快速消耗它：

- prompt 很长；
- 输出上限很大；
- 并发序列多；
- 模型层数和 hidden size 大；
- KV 使用较高精度；
- 碎片或保留块降低有效容量。

显存不是只放权重：

```text
HBM = 模型权重 + KV Cache + CUDA Graph/工作区
    + 临时激活 + 通信缓冲 + 框架与 allocator 开销 + 安全余量
```

因此 `nvidia-smi` 还有少量空闲，不代表能安全接收一个长上下文请求。

## 9. 阶段七：Prefill

Prefill 对整个 prompt 做前向计算，产生第一个输出 token 所需状态并写入 KV Cache。它通常：

- 计算量大；
- 能较好利用矩阵乘法吞吐；
- 对输入长度非常敏感；
- 直接影响 TTFT；
- 可能与正在 decode 的请求争用 GPU。

TTFT 可以近似拆成：

```text
TTFT ≈ 网络入口 + 网关/路由 + Server/Tokenizer
     + 请求排队 + KV 分配 + Prefill 计算
     + 首 token 序列化与返回
```

长 prompt 的 TTFT 高可能是预期计算成本；短 prompt 的 TTFT 突然变高，优先检查排队、CPU、批处理、GPU 降频、通信或版本变化。

## 10. 多卡 Tensor Parallel 在做什么

当模型权重无法放入一张 GPU，或希望多卡共同计算时，可以使用 Tensor Parallel。线性层权重按维度分片，各 rank 分别计算局部结果，再通过 AllReduce、AllGather 或 ReduceScatter 组合。

```text
同一个请求
  ├─ rank 0: GPU 0 执行局部 Kernel ─┐
  ├─ rank 1: GPU 1 执行局部 Kernel ─┼─ Collective 同步
  ├─ rank 2: GPU 2 执行局部 Kernel ─┤
  └─ rank 3: GPU 3 执行局部 Kernel ─┘
```

其性能取决于：

- GPU 之间是 NVLink/NVSwitch 还是跨 PCIe；
- rank 到物理 GPU 的映射；
- NCCL 拓扑发现、Channel、算法和协议；
- 各 rank 的计算时长是否均衡；
- 是否跨 NUMA 或经过慢 PCIe 路径；
- 通信频率相对于单步计算量的比例。

Collective 是同步点，一个 GPU 降频、ECC 重试或被其他进程干扰，其他 rank 也会等待。因此多卡服务必须按实例观察每张 GPU，而不能只看平均利用率。

## 11. 阶段八：Decode 循环

Prefill 以后进入逐 token Decode：

```text
选择本轮可运行序列
→ 读取权重与 KV Cache
→ 执行 GPU Kernel
→ 多卡 Collective
→ 采样下一个 token
→ 写入新的 KV
→ 判断停止条件
→ 将 token 返回 Server
→ 下一轮
```

Decode 的单步矩阵规模通常小于 Prefill，更容易受内存带宽、Kernel launch、批大小和同步影响。每输出 token 时间 TPOT 近似决定单请求生成速度：

```text
生成阶段耗时 ≈ 输出 token 数 × 平均 TPOT
```

TPOT 恶化而 TTFT 基本正常时，重点检查：

- Decode 批大小与调度；
- KV Cache 压力、抢占或重计算；
- HBM 带宽、GPU 时钟、功耗与温度；
- Tensor Parallel 通信；
- 单个慢 rank；
- 流式序列化和网络反压。

## 12. GPU 内部发生了什么

从软件到硬件可以继续展开：

```text
推理引擎 / PyTorch
→ CUDA Runtime/Driver
→ CUDA Stream 与 Kernel launch
→ GPU Scheduler 分配 Thread Block
→ SM 执行 Warp
→ Tensor Core/CUDA Core 计算
→ 寄存器、Shared Memory、L2、HBM 供数
→ Kernel 完成或与其他 Stream 同步
```

性能瓶颈可能是：

- 计算受限：Tensor Core 已接近目标吞吐；
- HBM 带宽受限：算力未满但内存吞吐已高；
- Kernel 太碎：launch 和同步开销占比高；
- occupancy 低：寄存器、Shared Memory 或形状限制并发；
- 通信受限：GPU 等待 NVLink/NIC；
- CPU 供给受限：调度、Tokenizer 或数据拷贝不及时。

仅凭 GPU Utilization 一个数字无法区分这些情况，需要结合 profiler 和分层指标。

## 13. 阶段九：Detokenize 与流式返回

GPU 产生 token ID 后，Server 将其转为文本，序列化为 SSE chunk，通过 Pod 网络、网关和 TLS 返回客户端。流式响应容易遇到：

- 代理缓冲，多个 token 攒在一起才发送；
- 客户端读取慢，形成 socket 反压；
- 网关 idle timeout；
- 客户端取消没有传递给推理引擎，GPU 继续浪费计算；
- Unicode/增量解码处理错误；
- 中途断开后错误地自动重试非幂等请求。

客户端取消应沿链路传播：

```text
client disconnect
→ gateway detects close
→ backend connection canceled
→ server marks request aborted
→ engine removes sequence
→ KV block released
```

每一层都需要验证，否则“用户已经关掉页面，GPU 仍在生成”。

## 14. 把延迟拆成可测量预算

不要只记录总耗时。建议至少拆分：

| 指标 | 起点 → 终点 | 主要责任域 |
|---|---|---|
| DNS/TLS | 客户端开始 → TLS 完成 | 客户端、网络、网关 |
| Gateway time | 网关接收 → 发往后端 | 鉴权、限流、路由 |
| Queue time | 引擎接收 → 请求被调度 | 准入、容量、批处理 |
| Tokenize time | 文本 → token IDs | CPU、Tokenizer |
| Prefill time | 开始计算 → 首 token 就绪 | GPU、TP 通信 |
| TTFT | 客户端发出 → 收到首 token | 全链路 |
| TPOT | 相邻输出 token 的时间 | Decode、通信、流式 |
| E2E latency | 请求发出 → 最后一个 token | 全链路 |

用同一时钟域或 Trace 上下文比较分段；客户端与服务器时钟不一致时，不要直接相减时间戳。

## 15. 建立请求到 GPU 的关联标识

一次排障最好能沿以下键查询：

```text
tenant_id / request_id / trace_id
  → model_name / model_revision
  → gateway_route / backend_service
  → namespace / pod / pod_uid / node
  → engine_instance / tp_rank
  → GPU UUID / MIG UUID
```

建议：

- 网关生成或透传 `traceparent` 和 request ID；
- 应用日志记录模型 revision、Pod、请求 token 数和结束原因；
- 指标标签控制基数，不把 request ID 直接做 Prometheus label；
- Trace 保存关键阶段 span，但避免记录敏感 prompt；
- GPU 指标以 UUID 为稳定身份，再映射到 Pod 和节点；
- 发布时记录镜像摘要、引擎参数和模型 revision。

没有这些关联信息时，只能看到“12:03 GPU 低利用率”和“12:03 请求变慢”，难以证明因果关系。

## 16. 五种典型故障怎样沿链路定位

### 16.1 立即返回 401/403/429

请求很可能尚未到 GPU。先查认证、租户配额、限流和网关日志。

### 16.2 返回 503，所有 Pod 看起来健康

检查 Service selector、EndpointSlice、readiness、端口、NetworkPolicy 和滚动升级容量。

### 16.3 TTFT 高，TPOT 正常

检查入口握手、Tokenizer、引擎排队、长 prompt、Prefill、模型冷启动和首包缓冲。

### 16.4 TTFT 正常，TPOT 高

检查 Decode 批处理、KV 压力、GPU 时钟/HBM、Tensor Parallel、慢 rank 和网络反压。

### 16.5 流式请求中途停止

检查网关/客户端 timeout、连接关闭、Pod 终止、模型进程错误、NCCL/Xid、取消传播和网关缓冲。

## 17. 一个不依赖大规模环境的学习实验

可以在单机单卡或小型 Kubernetes 环境完成：

1. 固定模型、引擎版本和参数；
2. 分别发送短 prompt、长 prompt；
3. 记录请求 token、输出 token、TTFT、TPOT 和总时长；
4. 从并发 1 逐步增加，观察队列和延迟拐点；
5. 打开流式响应，记录每个 chunk 时间；
6. 在客户端中途取消，确认引擎释放请求和 KV；
7. 删除一个 canary Pod，观察 Endpoint 与请求；
8. 如有多卡，比较 TP=1 和 TP>1 的显存、吞吐与通信。

每轮只修改一个参数，并保存版本、输入、并发、服务端指标和原始结果。这样才能从现象得到可复验结论。

## 18. 掌握标准

完成本文后，应能在白板上不看资料地解释：

1. 请求从域名到 Pod 的 Kubernetes 网络路径；
2. Tokenizer、引擎 Scheduler、Prefill、KV Cache 和 Decode 的关系；
3. Tensor Parallel 为什么需要 NVLink/NCCL；
4. TTFT 和 TPOT 分别由哪些阶段组成；
5. 客户端取消如何释放 GPU 资源；
6. 怎样用 request ID、Pod UID 和 GPU UUID 串起证据；
7. 为什么调度发生在请求之前，却决定请求性能上限。

下一篇使用这张地图处理[AI 服务性能下降的 GPU、网络、存储与调度联合排查](./07-AI服务性能下降的联合排查.md)。

## 19. 参考资料 {/* #参考资料 */}

- [vLLM documentation](https://docs.vllm.ai/en/latest/)
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Kubernetes EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [Kubernetes Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [NVIDIA NCCL documentation](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/)
