---
title: "Kueue 队列、GPU 配额与工作负载准入"
sidebar_position: 13
tags: [Kueue, Kubernetes, GPU, ClusterQueue, LocalQueue, ResourceFlavor, 配额]
description: "从 ResourceFlavor、ClusterQueue、LocalQueue、Workload 和 AdmissionCheck 理解 Kueue 如何为 GPU 训练、批推理和服务工作负载进行排队与准入。"
---

# Kueue 队列、GPU 配额与工作负载准入

Kubernetes Scheduler 解决“当前 Pod 放到哪台节点”，Kueue 解决“哪些 Workload 现在允许开始消耗配额”。

```text
用户提交 Job
→ Kueue 创建/观察 Workload并保持 Job suspend
→ LocalQueue 指向 ClusterQueue
→ 检查 ResourceFlavor 配额、优先级、借用/抢占、拓扑
→ QuotaReservation
→ AdmissionChecks
→ Admitted
→ 恢复 Job
→ kube-scheduler 放置 Pods
```

Kueue 不是另一个 Pod 调度器，也不负责训练进程本身的重试和 Checkpoint。

> Kueue API 持续演进。本文示例按 2026 年官方主线文档中的 `kueue.x-k8s.io/v1beta2` 表达概念；部署时必须固定 Kueue 版本并使用该版本文档，旧集群可能仍使用 `v1beta1` 字段。

## 1. 为什么 ResourceQuota 不够

Kubernetes ResourceQuota 可以限制命名空间总请求，但不能完整表达：

- 无 GPU 时让 Job 安全排队；
- H100 与 L40 等不同 GPU flavor 配额；
- 团队间借用空闲配额；
- 队列级优先级和抢占；
- 多 Pod 作业整组准入；
- 云节点 Provisioning AdmissionCheck；
- rack/block 拓扑准入；
- 多集群 Job 分发。

ResourceQuota 可作为命名空间防护，Kueue 作为批/工作负载准入主账本；避免两套配额互相矛盾。

## 2. 核心对象

### ResourceFlavor

描述一类可互换资源及对应节点特征，例如 GPU 型号、按需/Spot、网络池。

### ClusterQueue

集群级配额池，定义：

- 可接收哪些 namespace；
- resourceGroups/flavors/resources；
- nominal quota、借用/出借限制；
- queueing strategy；
- preemption；
- AdmissionChecks；
- fair sharing 等。

### LocalQueue

命名空间内用户入口，指向一个 ClusterQueue。用户只需选择 LocalQueue，不直接修改平台配额。

### Workload

Kueue 的准入单位，包含一个或多个 PodSet 的资源请求。通常由 Job/JobSet/Kubeflow Job 等集成自动创建，不建议用户手工修改其 status。

### Cohort

一组 ClusterQueue 共享空闲 nominal quota，用于借用与回收。

### AdmissionCheck

配额预留后由外部/内置控制器进行额外检查，例如节点供给、MultiKueue 或自定义策略。所有要求的检查 Ready 后才最终 admit。

## 3. ResourceFlavor 设计

示例：

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: ResourceFlavor
metadata:
  name: h100-rdma
spec:
  nodeLabels:
    accelerator.example.com/model: h100
    network.example.com/fabric: rdma-a
  nodeTaints:
    - key: accelerator.example.com/pool
      value: training
      effect: NoSchedule
  tolerations:
    - key: accelerator.example.com/pool
      operator: Equal
      value: training
      effect: NoSchedule
```

字段以目标版本 API 为准。示例中的 matching toleration 使 Kueue 可以在准入后把容忍注入底层 Pod template；若只配置 flavor taint 而没有匹配 toleration，则 Workload 自身必须已声明容忍。Flavor 的标签/taint 必须对应真实节点事实。不要把：

- GPU 型号 H100 与显存容量不同的卡；
- 有/无 RDMA；
- 不同故障域或成本；
- MIG 与整卡；

放在同一可互换 flavor，除非业务真的接受。

## 4. ClusterQueue GPU 配额

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: ClusterQueue
metadata:
  name: research-gpu
spec:
  namespaceSelector:
    matchLabels:
      ai.example.com/tenant: research
  queueingStrategy: BestEffortFIFO
  resourceGroups:
    - coveredResources:
        - cpu
        - memory
        - nvidia.com/gpu
      flavors:
        - name: h100-rdma
          resources:
            - name: cpu
              nominalQuota: "256"
            - name: memory
              nominalQuota: 2Ti
            - name: nvidia.com/gpu
              nominalQuota: "32"
```

CPU、memory、GPU 在同一 resourceGroup 表示它们应来自同一 flavor 选择。GPU quota 的 Quantity 是资源数量，不是显存 GiB。

配额不应大于物理池可用能力，也要扣除系统、维护、故障和在线服务保留。

## 5. LocalQueue

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: LocalQueue
metadata:
  name: training
  namespace: team-a
spec:
  clusterQueue: research-gpu
```

平台可给 team-a/team-b 分别创建 LocalQueue，同时指向一个共享或不同 ClusterQueue。RBAC 应允许团队查看自己的队列/Workload，而只有 batch admin 修改 ClusterQueue/Flavor。

## 6. 提交 Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: cuda-job
  namespace: team-a
  labels:
    kueue.x-k8s.io/queue-name: training
spec:
  suspend: true
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: <immutable-image>
          resources:
            requests:
              cpu: "8"
              memory: 64Gi
              nvidia.com/gpu: "1"
            limits:
              nvidia.com/gpu: "1"
```

安装/策略可配置管理带 queue label 的 Job。官方集成、是否要求初始 `suspend`、标签位置随 workload 类型和版本，使用对应任务文档。

## 7. 准入不是物理节点预绑定

Kueue 配额满足后恢复 Job，Pod 仍由 kube-scheduler 放置。可能出现：

```text
Kueue Admitted
但 Pod Pending
```

原因：

- ClusterQueue quota 与实际节点资源漂移；
- GPU 健康隔离；
- affinity/taint/volume；
- 拓扑碎片；
- 其他非 Kueue Pod 消耗节点；
- kube-scheduler 插件或 runtime 问题。

启用 Topology-Aware Scheduling/AdmissionChecks 可以减少逻辑配额与物理可用之间差距，但仍需监控。

## 8. BestEffortFIFO 与 StrictFIFO

两者通常先按优先级和时间排序：

- **StrictFIFO：**队首大作业放不下时阻塞后续小作业，顺序严格但可能降低利用率；
- **BestEffortFIFO：**队首不适配时可让能放下的后续作业先运行，提高 backfill，默认常用。

选择取决于公平定义。BestEffortFIFO 可能让超大作业长期等，需配合 aging、预约、单独队列或容量策略。

## 9. Nominal、Borrowing 与 Lending

假设同 cohort：

```text
Team A nominal = 16 GPU
Team B nominal = 16 GPU
```

B 空闲时，A 可按规则借用；B 有需求时需要回收/抢占或等待。需要设置：

- borrowingLimit：A 最多借多少；
- lendingLimit：B 至少保留多少不外借；
- preemption：何时回收借用资源；
- workload priority；
- Checkpoint/终止成本。

借用提高利用率，但使运行资源不是永久保证。长训练必须支持 Checkpoint，或禁止被高频回收。

## 10. WorkloadPriority 与 Pod Priority

- WorkloadPriority：Kueue 排队、准入和 Kueue 抢占；
- Pod PriorityClass：kube-scheduler Pod 排序/抢占。

两层不一致会产生反直觉：高 Workload priority 已准入，但 Pod priority 低，物理节点上仍排队；反之也可能绕开队列公平。平台应定义映射表，而不是用户随意选择最高等级。

## 11. Preemption 设计

Kueue 抢占发生在配额准入层，可能包括回收 cohort 中借用资源、队列内低优先任务等。生产要定义：

- 哪类负载可被抢占；
- 最小运行时间/避免抖动；
- Checkpoint 信号、grace period 和完成确认；
- Spot 中断与队列抢占叠加；
- 被抢占后的重入队；
- 数据/临时文件清理；
- 指标与计费。

抢占释放 quota 不等于 GPU 立即可用，Pod 终止、Checkpoint 和 device cleanup 需要时间。

## 12. 多 Pod/Gang 作业

PyTorchJob、JobSet、MPIJob 等可以由集成转成包含多个 PodSet 的 Workload。Kueue先为完整资源做 quota reservation，再启动，减少一半 Worker 占卡等待。

但还需作业控制器负责：

- replica role；
- rendezvous；
- Worker 失败传播；
- restart policy；
- Checkpoint 恢复；
- completion status。

Kueue all-or-nothing admission 与 Volcano PodGroup/Gang 的具体组合要避免双重控制和不一致。

## 13. Topology-Aware Scheduling

Kueue 可通过 Topology 定义 block/rack/hostname 等层级，并让 ResourceFlavor 关联拓扑，准入时考虑 PodSet 的 required/preferred 拓扑。

价值：

- 多机训练尽量同 rack/block；
- 避免跨 oversubscribed link；
- 保证 PodSet 有完整物理域；
- 表达 pack/spread。

代价：拓扑约束越硬，碎片和等待越多；节点标签必须准确；特性成熟度和 API 需按版本确认。

## 14. AdmissionCheck

两阶段：

```text
QuotaReservation
→ AdmissionChecks concurrently
→ all Ready
→ Admitted
```

可用于：

- 云节点 ProvisioningRequest；
- MultiKueue；
- 许可证/外部审批；
- 镜像/模型预热；
- 安全/成本策略。

自定义模型预热 AdmissionCheck 时必须处理超时、失败、取消、quota 保留时长和幂等；否则大量 Workload 占住配额等待下载。

## 15. 在线推理是否进入 Kueue

长期在线 Deployment 与训练 Job 的语义不同。可选：

- 在线推理使用专用节点池、ResourceQuota、Priority/PDB/HPA，不进批队列；
- 批推理和临时评测进入 Kueue；
- Kueue 支持的 serving workload 集成用于需要配额准入的 Deployment/StatefulSet/LWS，但要验证副本伸缩、逐 Pod Workload、发布和版本行为。

不要因为 Kueue 支持 Deployment，就把所有在线副本与短 Job 使用同一抢占策略。

## 16. 监控指标

至少观察：

- pending/admitted Workload 数；
- queue wait P50/P95/P99；
- ClusterQueue nominal/used/borrowed/lent；
- flavor 使用和碎片；
- admission attempts/failures；
- preemption/eviction；
- AdmissionCheck 时间与失败；
- Admitted→Pod Running/Ready 时间；
- GPU 物理利用与队列需求；
- 大作业 starvation。

逻辑 quota 使用高但 GPU 利用低，可能是启动/数据/通信问题；quota 空闲但队列 pending，可能是 flavor/topology/AdmissionCheck。

## 17. 排障流程

```bash
kubectl -n <ns> get localqueue
kubectl get clusterqueue
kubectl get resourceflavor
kubectl -n <ns> get workloads
kubectl -n <ns> describe workload <workload>
kubectl -n <ns> describe job <job>
kubectl -n kueue-system get pods
```

分类：

1. Job 未被管理：label/integration/namespace policy；
2. LocalQueue 不存在/Inactive；
3. ClusterQueue Inactive：Flavor/AdmissionCheck/配置错误；
4. quota 不足：资源、flavor、cohort/borrow；
5. Workload pending：优先级/FIFO/拓扑/check；
6. Admitted 但 Pod Pending：进入 kube-scheduler 事件；
7. 被 Evicted：preemption、AdmissionCheck 或 stop policy；
8. finished quota 未释放：Job/Workload 状态同步。

## 18. 最小实验

1. 建两个 LocalQueue 和一个 ClusterQueue；
2. nominal GPU 配额设为实验池能力；
3. 提交一个可运行 Job，观察 Workload 从 pending 到 admitted；
4. 提交超配 Job，观察 queue；
5. 添加第二 flavor，验证节点标签注入/选择；
6. 建 cohort，让团队借用；
7. 提交高优 Workload，演练回收（测试作业支持 Checkpoint）；
8. 制造 Admitted 但 Pod Pending，区分两层；
9. 测 Kueue controller 重启后的状态恢复；
10. 对比 queue wait、GPU 利用和业务完成时间。

## 19. 生产治理

- 固定 Kueue/CRD/sidecar 版本；
- ClusterQueue/Flavor 使用 GitOps 与评审；
- namespaceSelector 和 RBAC 最小权限；
- quota 以物理可用减故障/系统保留计算；
- flavor 标签由自动发现/资产系统维护；
- AdmissionCheck 设置 SLO 和失败释放；
- 升级先验证 CRD conversion、现有 Workload、controller rollback；
- 业务有排队可见性和预计等待；
- 与 ResourceQuota、Pod Priority、Volcano 分工清楚。

## 20. 常见误区

1. **Kueue 会直接绑定节点。**它准入 Workload，Pod 仍由 scheduler 放置。
2. **quota 等于物理空闲 GPU。**节点故障/碎片/非队列负载会漂移。
3. **ResourceFlavor 自动发现硬件。**标签/taint 必须准确维护。
4. **借用没有代价。**回收会中断训练。
5. **高 WorkloadPriority 等于高 PodPriority。**两个层级。
6. **Admitted 就开始计算。**还要 Pod 调度、镜像、存储、GPU runtime。
7. **在线推理和批训练同一队列策略。**SLO 和生命周期不同。
8. **升级 CRD 只换镜像。**API/转换/字段演进需按版本流程。

## 21. 掌握标准

应能设计 Flavor—ClusterQueue—LocalQueue—Workload，计算 GPU nominal/borrow/lend，解释准入与 Pod 调度边界，配置优先级/抢占/拓扑/AdmissionCheck，定位 pending/admitted/physical Pending，并用 queue wait 与 GPU 利用率验证治理效果。

下一篇：[队列感知的大模型推理自动扩缩容](./14-队列感知的大模型推理自动扩缩容.md)。

## 参考资料

- [Kueue concepts](https://kueue.sigs.k8s.io/docs/concepts/)
- [Kueue ClusterQueue](https://kueue.sigs.k8s.io/docs/concepts/cluster_queue/)
- [Kueue admission](https://kueue.sigs.k8s.io/docs/concepts/admission/)
- [Kueue AdmissionCheck](https://kueue.sigs.k8s.io/docs/concepts/admission_check/)
- [Kueue tasks](https://kueue.sigs.k8s.io/docs/tasks/)
