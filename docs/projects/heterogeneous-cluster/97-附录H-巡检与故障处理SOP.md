---
title: "附录H：双资源池故障排查矩阵与决策树"
sidebar_label: "97. 附录H · 故障排查"
sidebar_position: 97
description: "所属系列：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》 用途：值班人员拿到现象后，快速确定故障层级、保留证据并执行安全处置 边界：本附录给出排查框架，不替代目标版本的 NVIDIA、昇腾、Kubernetes、vLLM 厂商手册"
tags: [故障排查, 决策树, Runbook, NVIDIA, 昇腾, 附录]
date: 2026-08-07 97:00:00
categories: 云原生
---

# 附录H：双资源池故障排查矩阵与决策树

:::info 系列与定位
**所属系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》
**用途**：值班人员拿到现象后，快速确定故障层级、保留证据并执行安全处置
**边界**：本附录给出排查框架，**不替代**目标版本的 NVIDIA、昇腾、Kubernetes、vLLM 厂商手册
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

## 1. 先守住四条原则 {/* #一先守住四条原则 */}

1. **先止损，再定位，再修复**：先限流、切流或隔离故障实例，保证正常请求有路可走。
2. **先保留证据，再重启**：重启可能清除设备状态、内核日志、容器日志和通信错误现场。
3. **一次只改变一个变量**：不要同时改镜像、驱动、模型参数、网络和路由权重。
4. **所有操作可回退**：生产变更要有负责人、审批、停止条件、回滚路径和时间记录。

统一故障分层：

```text
L7 业务与客户端：请求格式、鉴权、模型名、上下文
L6 网关与路由：限流、负载均衡、重试、双池切换
L5 推理引擎：vLLM、vLLM-Ascend、模型和参数
L4 Kubernetes：调度、Pod、Service、探针、配额
L3 加速器软件栈：Device Plugin、Runtime、CUDA/CANN
L2 设备与互联：GPU/NPU、NVLink/HCCL、PCIe、RoCE
L1 主机与基础设施：OS、CPU、内存、磁盘、存储、网络
```

## 2. 接到故障后的前 5 分钟 {/* #二接到故障后的前-5-分钟 */}

### 2.1 明确影响 {/* #1-明确影响 */}

开始时间；受影响租户/模型/API；NVIDIA 池、昇腾池还是公共层；全部/部分/单副本；错误率、P95/P99、排队和失败请求数；最近一次成功时间；是否刚发生发布、扩缩容、驱动或路由变更。

### 2.2 确认优先级 {/* #2-确认优先级 */}

| 级别 | 示例 | 初步行动 |
|------|------|----------|
| P0 | 两池均不可用、核心业务全面失败 | 启动应急指挥，保护公共入口，按预案降级 |
| P1 | 一池不可用且备用池容量不足、核心模型大面积失败 | 限流非核心业务，切换可承载流量，立即升级 |
| P2 | 单模型、单节点或部分副本异常 | 摘除异常实例，保留证据后定位 |
| P3 | 监控缺失、容量趋势、无用户影响 | 建单跟踪，在维护窗口处理 |

### 2.3 形成时间线 {/* #3-形成时间线 */}

```text
03:10 告警首次触发
03:11 值班确认影响
03:13 最近发布/变更核对完成
03:15 执行限流或切流
03:18 错误率开始下降
```

时间线只写事实，不提前写未经验证的「根因」。

## 3. 公共层故障矩阵 {/* #三公共层故障矩阵 */}

| 现象 | 优先层级 | 证据 | 安全动作 | 不要立即做 |
|------|----------|------|----------|------------|
| Node NotReady | L1/L4 | Node 条件、Events、kubelet、运行时、主机负载 | 停止向该节点调度；评估 PDB 后按 SOP 迁移 | 不保留日志就重启整机 |
| Pod Pending | L4 | describe、Events、配额、Taint/Toleration、PVC | 对照资源申请、标签和配额逐项修正 | 盲目删除所有 Pending Pod |
| ImagePullBackOff | L4/L1 | Events、镜像地址、Secret、Registry 连通 | 校验 Digest、凭据和代理 | 临时改用 `latest` |
| CrashLoopBackOff | L5/L4 | 当前与 previous 日志、退出码、探针 | 保留日志，区分启动失败和探针杀死 | 反复重启导致日志覆盖 |
| Readiness 失败 | L5/L4 | 探针响应、启动日志、加载时长 | 探针对齐真实启动阶段 | 用删除探针掩盖未就绪 |
| OOMKilled | L1/L4 | limit、Working Set、退出原因、节点内存 | 限流/降并发，修正 limit 和参数 | 只增内存不查泄漏和流量 |
| Service 无 Endpoint | L4 | selector、EndpointSlice、Pod Ready | 修正 Selector 或就绪问题 | 重启 kube-proxy 当通用解法 |
| DNS 解析失败 | L1/L4 | Pod 内解析、CoreDNS、Service 名 | 判断单 Pod/节点/集群性 | 镜像内永久写死 IP |
| PVC Pending | L1/L4 | PVC/PV/SC/CSI Events | 检查拓扑、配额、Provisioner | 删除已有数据卷重建 |
| 模型读取慢 | L1/L5 | 存储延迟、吞吐、页缓存、加载时间 | 暂停集中冷启动，分批预热 | 同时重启全部副本 |
| 网卡丢包/重传 | L1/L2 | 接口计数、交换机、RDMA、节点日志 | 降载、隔离问题链路 | 未核实就改全网 MTU/PFC |
| 时钟漂移 | L1 | NTP、时间差、证书/Token 错误 | 修复时间同步并验证鉴权 | 手工大幅跳时后不观察 |
| 证书过期 | L6/L1 | 有效期、网关日志、客户端错误 | 按轮换 SOP 更新并验证 | 在生产关闭 TLS 校验 |

```bash
kubectl get nodes -o wide
kubectl describe node <node>
kubectl -n <namespace> get pod -o wide
kubectl -n <namespace> describe pod <pod>
kubectl -n <namespace> logs <pod> -c <container> --timestamps
kubectl -n <namespace> logs <pod> -c <container> --previous --timestamps
kubectl -n <namespace> get events --sort-by=.lastTimestamp
kubectl -n <namespace> get svc,endpointslice,pvc
```

## 4. Pod Pending 决策树 {/* #四pod-pending-决策树 */}

```text
Pod Pending
  ├─ Insufficient nvidia.com/gpu？
  │    └─ 查GPU可分配量、已分配、配额、节点健康
  ├─ Insufficient huawei.com/Ascend...？
  │    └─ 确认实际资源名、NPU可分配、Plugin、故障设备
  ├─ untolerated taint？
  │    └─ accelerator=nvidia|ascend:NoSchedule
  ├─ node affinity/selector不匹配？
  │    └─ accelerator.vendor 与 resource-pool
  ├─ PVC未绑定？ → 转存储排查
  ├─ ResourceQuota/LimitRange拒绝？ → 查命名空间配额
  └─ 调度器/准入控制报错？ → 调度器与Webhook日志
```

固定节点约束：NVIDIA 用 `accelerator.vendor=nvidia`、`resource-pool=nvidia-pool`；昇腾用 `ascend` / `ascend-pool`。绝不能为了「先跑起来」删除所有 Label、Taint 和 Affinity。

## 5. NVIDIA 资源池故障矩阵 {/* #五nvidia-资源池故障矩阵 */}

| 现象 | 可能原因 | 核心证据 | 安全处置 |
|------|----------|----------|----------|
| 节点不暴露 GPU | 驱动、Toolkit、Device Plugin | `nvidia-smi`、Capacity、Plugin 日志 | 先主机识别，再 Runtime/Plugin |
| 容器内无 GPU | RuntimeClass、设备注入失败 | Pod spec、容器环境、Runtime 日志 | 与已知可用测试 Pod 对照 |
| CUDA 初始化失败 | 驱动/用户态不兼容、权限 | 引擎日志、`nvidia-smi`、兼容矩阵 | 回退已验证镜像/驱动 |
| CUDA OOM | 权重、KV、并发、上下文、碎片 | 启动参数、显存曲线、请求分布 | 降并发/上下文，或增加 TP/设备 |
| 利用率低且队列高 | CPU/存储瓶颈、批处理、通信等待 | CPU、I/O、TTFT、Prefill/Decode | 分离加载期与稳态 |
| 单卡明显偏低 | 降频、温度、功耗、PCIe/NVLink | 时钟/功耗/温度、拓扑、基准 | 摘除异常副本并比对基线 |
| Xid | 应用/驱动/硬件/PCIe | Xid 编号、内核日志、DCGM | 先记时间与 UUID，按手册分级 |
| ECC 异常 | 显存错误或硬件退化 | 可纠正/不可纠正、DCGM | 隔离，按硬件流程判断 |
| NVLink 异常 | 链路、拓扑、设备状态 | 拓扑、链路状态、带宽基准 | 停多卡流量并验证拓扑 |
| NCCL 初始化超时 | 网卡、地址、端口、MTU、RDMA | NCCL 日志、接口、路由、环境 | 隔离环境最小通信测试 |
| 多机吞吐差 | 拥塞、NUMA、亲和、分片 | RDMA、NUMA、NCCL、Profile | 先与单机基线对比 |

```bash
nvidia-smi; nvidia-smi -q; nvidia-smi topo -m
kubectl describe node <node>
kubectl -n <namespace> logs <nvidia-device-plugin-pod> --timestamps
kubectl -n <namespace> logs <model-pod> --timestamps
```

Xid/ECC 的严重程度和恢复动作必须查询当前 GPU 型号与驱动的官方说明。

### 5.1 NVIDIA OOM 决策树 {/* #nvidia-oom-决策树 */}

```text
CUDA OOM
  ├─ 启动加载就OOM
  │    ├─ 权重无法容纳 → 精度/量化或增加TP
  │    ├─ TP与可见设备不一致 → 修正启动配置
  │    └─ 图/工作区过大 → 核对参数和版本
  └─ 运行一段时间后OOM
       ├─ 长上下文/高并发 → Token分布与KV Cache
       ├─ 突发流量 → 入口限流与最大Token
       ├─ 碎片/版本问题 → 固定请求复现并比版本
       └─ 其他进程占卡 → 确认独占与异常进程
```

## 6. 昇腾资源池故障矩阵 {/* #六昇腾资源池故障矩阵 */}

| 现象 | 可能原因 | 核心证据 | 安全处置 |
|------|----------|----------|----------|
| 节点不暴露 NPU | 驱动/固件/CANN/Plugin | `npu-smi info`、Capacity、Plugin 日志 | 先主机识别，再 Plugin/Runtime |
| 容器内无 NPU | 资源名、Runtime、注入/权限 | Pod spec、资源限制、Plugin 日志 | 对照已验证模板与实际资源名 |
| CANN 初始化失败 | 全栈不兼容或环境缺失 | 版本矩阵、引擎日志、环境变量 | 回退已验证全栈组合 |
| HBM OOM | 权重、KV、上下文、并发、工作区 | HBM 曲线、启动参数、Token 分布 | 降并发/上下文，或调整并行 |
| NPU 健康异常 | 设备、驱动、链路、任务 | `npu-smi`、系统日志、Exporter、故障码 | 先隔离并保留证据 |
| 故障设备仍影响调度 | Plugin 上报、ConfigMap、恢复流程 | Node 资源、Plugin 日志、故障记录 | 核对当前 MindCluster 故障机制 |
| HCCL 初始化失败 | Rank、IP、端口、TLS、RoCE | HCCL 日志、路由、证书、时间 | 隔离环境最小通信测试 |
| 多机建立通信很慢 | DNS/ARP、路由、RoCE、时钟 | 时间线、网络指标、HCCL 日志 | 从两节点最小规模复现 |
| 利用率低且队列高 | CPU、存储、算子、编译、通信 | CPU/I/O、算子、Prefill/Decode | 区分编译、加载与稳态 |
| 同模型结果差异 | 适配、精度、算子、Tokenizer | 固定输入、版本矩阵、输出对比 | 先离线一致性，不直接全量切 |

```bash
npu-smi info
kubectl describe node <node>
kubectl -n <namespace> logs <ascend-device-plugin-pod> --timestamps
kubectl -n <namespace> logs <model-pod> --timestamps
```

资源名以当前 Node 的 capacity/allocatable 和已冻结模板为准。故障码、恢复方式、ConfigMap 字段与是否允许热复位，以当前硬件/驱动/CANN/MindCluster 官方文档为准。

### 6.1 HCCL 故障决策树 {/* #hccl-故障决策树 */}

```text
HCCL初始化或通信失败
  ├─ 单机也失败？
  │    └─ 是：设备健康、Rank映射、可见设备、版本
  ├─ 各节点接口、IP和路由一致？
  ├─ MTU、RoCE、PFC/ECN与网络设计一致？
  ├─ 端口和安全策略允许双向通信？
  ├─ TLS证书、主机名和系统时间有效？
  ├─ Rank数量、Rank ID和设备映射唯一完整？
  └─ 两节点最小通信测试确定首次失败位置
```

## 7. vLLM 与 API 故障矩阵 {/* #七vllm-与-api-故障矩阵 */}

| 状态/现象 | 常见含义 | 先查什么 | 处置方向 |
|-----------|----------|----------|----------|
| 400 | 参数/上下文不合法 | 响应体、请求样例 | 修正客户端；勿无条件重试 |
| 401 | 未认证 / Token 失效 | Authorization、鉴权日志、时钟 | 更新凭据或鉴权配置 |
| 403 | 无权限 / 策略拒绝 | 租户权限、网关策略 | 修正授权，不绕过鉴权 |
| 404 | 路径或模型名不存在 | `/v1`、模型映射、路由 | 修正路由或 served-model-name |
| 408/499 | 客户端取消或超时 | 客户端、网关、SSE 时长 | 区分用户取消与后端慢 |
| 429 | 限流或过载 | 限流、队列、KV、配额 | 退避、限流、扩容或降级 |
| 500 | 引擎内部异常 | Pod 日志、请求特征、版本 | 摘除异常副本，固定复现 |
| 502 | 连不上后端或断连 | Endpoint、连接错误、重启 | Service、Readiness、后端日志 |
| 503 | 无可用后端 / 过载 / 维护 | Endpoint、Ready、熔断 | 恢复副本或按预案切池 |
| 504 | 上游超时 | TTFT、排队、存储/通信、超时 | 先找慢在哪层，谨慎加超时 |
| SSE 中途断流 | 超时、Pod 退出、网络 | request_id 全链路 | 修连接生命周期；勿盲目整请求重试 |
| 输出乱码 | Tokenizer/模板/精度 | 模板、Tokenizer、固定输入 | 版本与两池一致性对比 |
| 首次请求特别慢 | 冷启动、编译、缺页 | 预热日志、首请求各阶段 | 发布前预热；区分冷态/稳态 SLO |

### 7.1 决策树 {/* #504-决策树 */}

```text
HTTP 504
  ├─ 后端是否收到该request_id？
  │    └─ 否：网关路由、DNS、Service、连接建立
  ├─ 是否进入vLLM等待队列？
  │    └─ 是：容量、并发、KV Cache、限流
  ├─ Prefill是否异常慢？ → 超长输入、CPU、存储、设备、算子
  ├─ Decode是否异常慢或中断？ → 设备、通信、输出长度、SSE
  └─ 后端已成功但网关未返回？ → 网关超时、连接池、缓冲、客户端
```

不要看到 504 就只增加网关超时——可能让更多请求长期占用连接并加重排队。

## 8. 双资源池路由与容灾故障矩阵 {/* #八双资源池路由与容灾故障矩阵 */}

| 现象 | 可能原因 | 关键验证 | 安全动作 |
|------|----------|----------|----------|
| 权重 50/50 实际偏差大 | 样本小、粘性、重试、后端不健康 | 足够时间窗与 request_id 统计 | 先确认路由算法和健康剔除 |
| 一池故障后未切换 | 健康检查不覆盖推理、条件未满足 | 后端健康、路由状态、探针 | 手动按审批切到可承载比例 |
| 切换后备用池也过载 | 容量不足、未分级、冷启动 | 备用队列、TTFT、KV、429 | 优先核心租户，限流并启预留 |
| 两池结果差异大 | 模型/Tokenizer/模板/精度/版本 | 固定样本对比、兼容矩阵 | 停止扩大灰度，回退已验收池 |
| fallback 循环 | 两侧互相回退或重试叠加 | 请求链路、重试次数、路由日志 | 保证单向、有限次、可观测回退 |
| 失败请求被重复生成 | 非幂等流式被自动重试 | request_id、客户端/网关重试 | 禁止对已输出 Token 的 SSE 透明重试 |
| 恢复后全量回切又失败 | 未观察稳定或缓存未热 | 健康窗口、预热、错误预算 | 分级回切并设停止条件 |
| 模型只存在一池 | 镜像/权重未同步、版本漂移 | 模型清单、Digest、校验 | 标记不可容灾，先补齐再开放切换 |

必须明确：双池容灾是**服务级路由切换**，不是把一个分布式实例跨两池混跑；镜像/驱动/运行时/启动参数分开维护；备用池只承接已完成一致性与容量验收的流量；故障切换优先核心业务。

## 9. 性能下降排查矩阵 {/* #九性能下降排查矩阵 */}

| 观察组合 | 更可能的瓶颈 | 下一步 |
|----------|--------------|--------|
| 队列高、设备利用率高 | 计算容量不足 | 限流、加副本或优化批处理 |
| 队列高、利用率低、CPU 高 | Tokenizer/调度/CPU | 查 CPU 配额、NUMA、线程 |
| 队列高、利用率低、存储慢 | 权重加载或读 I/O | 冷启动、缓存、存储延迟 |
| Prefill 慢、Decode 正常 | 长输入 / Prefill | 按输入长度分桶压测 |
| Prefill 正常、Decode 慢 | 通信/设备/输出长度 | 每 Token 延迟与多卡通信 |
| 单机正常、多机慢 | NCCL/HCCL、RoCE、拓扑 | 通信基准与亲和性 |
| 只有一个副本慢 | 单节点/设备/进程 | 摘除并与同规格基线比较 |
| 两池之一慢 | 版本、参数或硬件差异 | 对照兼容矩阵和基准报告 |
| P50 正常、P99 很差 | 突发、长尾、抖动、排队 | 按 Token 长度、租户、副本拆分 |

## 10. 证据包模板 {/* #十证据包模板 */}

```markdown
## 基本信息
故障编号 / 开始·发现·恢复时间 / 集群与环境
资源池：nvidia-pool / ascend-pool / common
模型与版本 / 镜像Digest / 受影响request_id
最近变更 / 当前影响

## Kubernetes证据
Node和Pod清单、describe与Events、当前及previous日志
Deployment/Service/EndpointSlice、资源与配额PDB、Label/Taint

## 设备与主机证据
型号、UUID、健康；驱动/固件/CUDA或CANN
nvidia-smi或npu-smi；内核日志时间窗
温度、功耗、显存/HBM、ECC/故障；拓扑与指标

## 业务与监控证据
脱敏请求样例与request_id；状态码、网关日志
QPS、Token/s、TTFT、排队、KV Cache；错误率与fallback
Grafana快照；变更前后对比
```

证据中不得包含明文 Token、密码、Cookie、个人数据或完整敏感 Prompt。

## 11. 安全操作与禁止操作 {/* #十一安全操作与禁止操作 */}

**可优先执行的可逆动作**：暂停发布；摘除异常副本；降低非核心流量；按已验收权重切池；冻结自动扩缩容；隔离异常节点；导出日志/指标/Events/版本；回退最近一项已知变更。

**未经审批不要做**：同时重启所有模型副本或两池 Device Plugin/加速器节点；强制删除仍承载请求的 Pod；忽略 PDB 与本地临时数据直接 drain；临时关闭 TLS/鉴权/网络策略；未经验证升/降驱动固件或 CANN/CUDA；设备复位、总线重扫或整机重启；清空 PVC/模型缓存/Ceph 数据；无限重试非幂等或已开始流式输出的请求；把 NVIDIA 镜像调度到昇腾节点（或反过来）。

## 12. 何时必须升级处理 {/* #十二何时必须升级处理 */}

满足任一条件立即升级到平台负责人、硬件/网络/存储团队或厂商：

- 两个资源池或公共网关同时异常；备用池不能承接核心流量
- 不可纠正 ECC、反复掉卡、总线或硬件健康异常
- HCCL/NCCL 多节点问题且最小通信测试仍失败
- 数据损坏、权重校验不一致或存储健康恶化
- 需要设备复位、驱动/固件变更、节点重启或网络全局改动
- 超过 RTO、影响扩大或止损无效；安全/凭据/证书/数据泄露
- 无法解释两池结果差异且可能影响业务正确性

升级时一次性提交完整证据包、时间线、已执行动作和当前业务影响。

## 13. 故障关闭标准 {/* #十三故障关闭标准 */}

- [ ] 用户侧成功率和时延恢复至 SLO
- [ ] 队列、KV Cache 和设备指标回到正常基线
- [ ] 故障副本/节点已恢复或保持隔离
- [ ] 双池路由处于明确、受控状态
- [ ] 告警已恢复且没有被永久静默
- [ ] 已验证至少一个真实或合成请求
- [ ] 临时限流、扩容、路由和手工配置已登记
- [ ] 证据包和时间线已归档
- [ ] 根因与促成因素分开记录
- [ ] 整改项有负责人、优先级和截止时间

「告警消失」不是故障关闭。只有业务、资源、路由和监控都恢复到可解释状态，故障才真正结束。

## 14. 相关链接 {/* #相关链接 */}

- [专栏目录](./00-专栏目录.md)
- [附录 G：PromQL 与 Grafana 看板](./96-附录G-PromQL告警规则与Grafana看板清单.md)
- [第 29 篇：NVIDIA 池专项运维](./29-NVIDIA资源池日常运维与故障排查.md)
- [第 30 篇：昇腾池专项运维](./30-昇腾资源池日常运维与故障排查.md)
- [附录 I：发布、变更、维护、容灾与复盘 SOP](./98-附录I-发布变更维护容灾与复盘SOP模板.md)
- [附录 J：验收与毕业清单](./99-附录J-部署验收性能基准容灾演练与毕业清单.md)

← [附录 G](./96-附录G-PromQL告警规则与Grafana看板清单.md) · → [附录 I：发布变更 SOP](./98-附录I-发布变更维护容灾与复盘SOP模板.md)
