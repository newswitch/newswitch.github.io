---
title: "多集群 GPU 算力调度：配额、数据位置与故障域"
sidebar_position: 15
tags: [多集群, GPU, MultiKueue, Karmada, 调度, 数据本地性, 容灾]
description: "从集群能力、GPU 配额、模型与数据位置、网络成本和故障域出发设计多集群训练与推理放置，并分析 MultiKueue 的职责边界。"
---

# 多集群 GPU 算力调度：配额、数据位置与故障域

单集群内 Scheduler 决定节点，多集群还要先决定“去哪一个集群”。这不是简单比较空闲 GPU 数：

```text
可运行 = GPU/驱动/框架兼容
       ∩ 配额与优先级允许
       ∩ 模型/数据可达且传输可接受
       ∩ 网络拓扑满足多机通信
       ∩ 故障域和合规允许
       ∩ 目标集群控制面/存储/监控健康
```

## 1. 为什么拆成多个集群

- 地域/机房故障隔离；
- 不同 GPU 型号和网络代际；
- 训练与在线推理隔离；
- 多云/本地资源；
- 数据合规和租户边界；
- Kubernetes/驱动升级灰度；
- 超大单集群控制面风险；
- 成本与 Spot 容量。

代价：资源碎片、配额复杂、制品/数据复制、状态聚合、身份、网络和排障难度增加。

## 2. 多集群控制面与执行面

```text
Global/Management Plane
  ├─ cluster inventory & health
  ├─ global queue/quota/policy
  ├─ workload placement
  ├─ model/data catalog
  ├─ identity/secrets policy
  └─ status/observability
          ↓ dispatch
Worker Cluster A/B/C
  ├─ local Kueue/queue
  ├─ kube-scheduler
  ├─ GPU nodes/runtime
  ├─ network/storage/cache
  └─ workload controller
```

全局放置决定集群，本地准入/调度决定何时启动和具体节点。职责不清会产生双重配额或两个控制器争夺对象。

## 3. 集群能力目录

每个集群发布机器可读 inventory：

```yaml
cluster: <id>
region: <region>
failureDomain: <site-or-zone>
gpu:
  - model: <sku>
    total: <count>
    allocatable: <count>
    memory: <bytes>
    migProfiles: [<profiles>]
network:
  fabric: <ethernet|roce|ib>
  speed: <value>
  topologyDomains: [<rack-or-block>]
storage:
  modelRepositories: [<reachable-repos>]
  datasetReplicas: [<dataset-ids>]
software:
  driver: <version>
  cudaCompatibility: <range>
  kubernetes: <version>
health:
  admission: <open|degraded|closed>
```

`allocatable` 不能只等于 Kubernetes node Allocatable 之和，还要扣除已准入、故障、维护、发布 surge 和保护容量。

## 4. 硬约束与软评分

### 硬约束

- GPU SKU/显存/数量；
- 驱动/CUDA/镜像架构；
- RDMA/IB；
- 数据 residency；
- 租户/合规；
- 最小完整拓扑域；
- 存储接口；
- 目标集群健康；
- 最大允许跨区传输。

不满足即过滤。

### 软评分

- 本地已有模型缓存；
- 数据集副本距离；
- queue wait 预测；
- 可用连续 GPU/rack；
- 价格/碳/Spot 风险；
- 故障域分散；
- 网络/存储余量；
- 版本灰度偏好。

软偏好不能变成隐藏硬约束，否则缓存状态过期会让作业永远等。

## 5. 训练与推理放置不同

### 训练

- Job 可排队；
- 多 Pod/Gang；
- 数据集位置关键；
- NCCL/RDMA 拓扑关键；
- Checkpoint 允许故障恢复；
- 可考虑 Spot/成本；
- 通常整个作业只在一个集群运行。

### 在线推理

- 持续服务与 SLO；
- 模型热副本/缓存关键；
- 多集群同时提供容量；
- 全局网关按用户地域、健康、版本路由；
- 会话/SSE/取消和错误预算；
- 集群故障需要流量切换，不只是重新 dispatch Job。

MultiKueue 等批调度不能替代全球流量管理。

## 6. 数据位置是一级调度资源

假设训练数据 1 PiB、模型 100 GiB：把计算移到数据附近通常比跨区搬数据更合理。需要 catalog：

- dataset revision 在哪些集群/区域；
- 一致性和复制延迟；
- model revision/Tokenizer；
- Checkpoint 权威位置；
- 节点缓存命中；
- 带宽、出口费用和完成时间；
- 法规允许范围。

放置成本：

```text
total completion ≈ queue wait
                 + node provisioning
                 + image/model/data staging
                 + execution
                 + checkpoint/result replication
```

只选 queue 最短的集群，可能在数据传输上花更久。

## 7. 模型制品分发

使用不可变 revision、manifest、checksum 和分批预热：

```text
global model catalog
→ regional object replica/cache
→ cluster distribution layer
→ node NVMe cache
→ HBM
```

多集群发布需要跟踪每个集群：

- revision 可达；
- checksum；
- canary 加载与推理；
- 热副本数；
- 回滚版本；
- 源端/跨区带宽。

## 8. 全局配额模型

三层：

```text
organization global budget
→ tenant/project quota across clusters
→ per-cluster ClusterQueue/ResourceQuota
→ local physical resources
```

挑战：同一份 32 GPU 配额不能在 A/B 集群各自都按 32 同时使用，除非它本来就是每集群配额。需要全局账本或分片：

- 静态：A 16 + B 16，简单但碎片；
- 动态租约：全局预留后发给目标集群；
- quota tree/cohort；
- 调度器先占全局再参与本地准入。

失败时要原子释放，避免 ghost reservation。

## 9. MultiKueue 的模型

官方 MultiKueue 由 manager cluster 和 worker clusters 组成，作为 AdmissionCheck 参与准入：

```text
Job submitted to manager
→ manager Workload quota reservation
→ MultiKueue nominates worker clusters
→ creates remote Workload candidates
→ one worker admits
→ manager selects it, creates/copies Job
→ remote execution/status sync
→ cleanup non-selected candidates
```

当前官方文档将 MultiKueue 标为 Beta，并支持多种 Job/服务工作负载集成；具体 feature gates、dispatch algorithms 和 API 以固定 Kueue 版本为准。

## 10. MultiKueue 配置对象

概念对象：

- `MultiKueueCluster`：worker 连接/凭证来源；
- `MultiKueueConfig`：候选 clusters 与分发策略；
- `AdmissionCheck`：controllerName 指向 MultiKueue；
- manager ClusterQueue：引用该 check；
- worker LocalQueue/ClusterQueue/namespace：需要匹配；
- supported Job integration。

生产凭证使用 Secret 或 ClusterProfile 等官方推荐来源，不把 kubeconfig 路径硬塞入镜像；RBAC 只允许所需 namespace/types。

## 11. AllAtOnce 与 Incremental

### AllAtOnce

向多个 worker 创建候选，让它们竞争准入：

- 选择快；
- 对所有集群 API/控制器和 quota 产生候选压力；
- 需及时清理未选。

### Incremental

按优先顺序分批 nomination：

- 可先本地/低成本，后溢出云；
- 减少候选对象；
- 每轮等待增加最终启动时间；
- 顺序和步长需按版本配置。

不要仅按集群名字排序承载业务策略；使用明确 inventory、成本和数据位置控制。

## 12. MultiKueue 的配额边界

manager quota 控制有多少 Job 有资格分发，worker quota 控制实际能否运行。若 manager quota：

- 远小于 worker 总能力：资源闲置；
- 远大于 worker 能力：大量候选等待，用户看到“已预留但不执行”。

还要避免多候选在多个 worker 都长期占 reservation。以目标版本的等待 admitted/cleanup 语义设计指标。

## 13. 跨集群失败状态机

需要区分：

```text
manager unavailable
worker API unreachable
remote Workload pending
remote Job running
status sync delayed
worker cluster failed
network partition
cleanup failed
```

对于正在运行训练，不能简单在另一集群复制启动，否则产生双写和重复成本。应有唯一 execution lease/fencing，确认旧执行停止或采用幂等输出路径，再从完整 Checkpoint 恢复。

## 14. Checkpoint 与跨集群恢复

```text
worker A training
→ checkpoint to authoritative object storage
→ manifest/complete/version
→ global controller observes durable point
→ A failed and fenced
→ select worker B with data/revision
→ pre-stage checkpoint/model
→ resume and validate global step
```

若 Checkpoint 只在 A 的 NFS/Local PV，B 无法恢复。跨集群 RTO = 故障检测 + 确认/fencing + 重新放置 + 数据复制 + 排队 + 恢复。

## 15. 在线推理多集群

架构：

```text
Global DNS/Anycast/Gateway
→ cluster gateway A/B
→ model router/InferencePool
→ local vLLM Pods
```

全局路由考虑：

- 用户地域/延迟；
- 模型 revision 和 API 兼容；
- Ready capacity、queue/TTFT；
- 集群错误预算；
- 数据合规；
- SSE 长连接；
- 故障时备用容量。

切流不能只看 Pod Ready。备用集群必须有模型、GPU、KV/并发容量和网关配额。

## 16. 故障域与容量

定义：节点、PCIe/NVSwitch、ToR/rack、network block、存储集群、Kubernetes cluster、site/region。

关键容量公式：

```text
usable capacity = healthy physical
                - system reserve
                - maintenance reserve
                - largest protected failure domain
                - rollout surge
```

如果目标是“单集群故障仍保护 P0 推理”，其他集群必须在故障时有足够实际热/可快速启动容量，并预留网关和存储带宽。

## 17. 跨集群网络

训练一般不跨 Kubernetes 集群让 rank 直接组成一个作业，除非网络、时钟、身份、服务发现和故障语义经过专门设计。跨 WAN Collective 延迟/带宽通常不适合紧耦合训练。

多集群网络需求多为：

- manager→worker API；
- 制品/Checkpoint；
- 全局观测；
- 用户流量；
- 服务发现。

每条链路有独立身份、TLS、带宽、RTO 和 egress 成本。

## 18. 身份与 Secret

- worker 凭证最小权限、可轮换；
- manager 被攻破不应获得集群管理员；
- workload identity 在目标集群重新绑定，不复制长期云密钥；
- Secret/ConfigMap 同步有 allowlist；
- 镜像/模型签名在每个集群验证；
- audit 记录谁把哪个 Job 分发到哪里；
- kubeconfig 不写日志/Git。

## 19. 可观测性

全局维度：

- pending demand by tenant/GPU flavor；
- nomination/selection duration；
- manager reservation vs worker admission；
- cluster queue wait；
- staging/model/checkpoint transfer；
- dispatch errors/status sync lag；
- duplicate/orphan remote objects；
- egress bytes/cost；
- cluster health/capacity staleness。

作业 identity：

```text
global workload UID
→ manager Workload
→ selected cluster
→ remote Workload/Job UID
→ Pods/Nodes/GPU UUID
→ checkpoint/output revision
```

## 20. 放置决策示例

需求：16×H100、多机 RDMA、dataset D42、4 小时 deadline。

| Cluster | GPU | 网络 | 数据 | Queue | 结论 |
|---|---|---|---|---|---|
| A | 16 连续 | IB | 本地 | 2h | 可行 |
| B | 32 | TCP | 本地 | 0 | 硬约束失败 |
| C | 16 | RoCE | 需复制 500TiB | 0 | 传输超 deadline |
| D | 8 | IB | 本地 | 0 | 数量不足 |

不能被“B 有 32 张空闲卡”误导。

## 21. 故障演练

1. worker API 暂不可达，manager 不重复启动；
2. worker quota 满，候选转向下一集群；
3. status sync 延迟，UI 显示 staleness；
4. 非选中候选 cleanup 失败，后台回收；
5. 运行中 worker 故障，从完整 Checkpoint 恢复；
6. 模型 revision 在目标集群缺失，AdmissionCheck 拒绝/预热；
7. 数据复制超过 deadline，调度重新评分；
8. 单集群推理切流，P0 SLO/容量验证；
9. manager 升级/恢复，remote 作业不被误删；
10. 凭证轮换，连接恢复且最小权限。

## 22. 常见误区

1. **多集群等于高可用。**没有数据、容量和流量切换仍不可用。
2. **空闲 GPU 最多就是最佳集群。**忽略拓扑、数据和排队。
3. **manager quota 可以随便等于总 GPU。**与 worker 实际准入需校准。
4. **网络分区时在第二集群重启最安全。**可能双执行/双写。
5. **Checkpoint 文件存在就可跨集群恢复。**需要完整提交、可达和版本兼容。
6. **MultiKueue 负责在线流量切换。**仍需网关/DNS/router。
7. **复制 kubeconfig 最方便。**扩大凭证与审计风险。
8. **跨集群紧耦合训练可直接走 WAN。**延迟、带宽和故障复杂。

## 23. 掌握标准

应能建设集群能力目录，把 GPU/网络/数据/合规分为硬约束与软评分；设计全局与本地配额；解释 MultiKueue manager/worker/AdmissionCheck；处理候选、唯一执行、状态同步与清理；设计训练 Checkpoint 恢复和推理切流；按故障域预留真实容量。

## 参考资料

- [Kueue MultiKueue concepts](https://kueue.sigs.k8s.io/docs/concepts/multikueue/)
- [Set up MultiKueue](https://kueue.sigs.k8s.io/docs/tasks/manage/setup_multikueue/)
- [Kueue multi-cluster workload tasks](https://kueue.sigs.k8s.io/docs/tasks/run/multikueue/)
- [Kubernetes Multi-Cluster Services API](https://multicluster.sigs.k8s.io/concepts/multicluster-services-api/)
- [Karmada scheduling](https://karmada.io/docs/userguide/scheduling/)
