---
title: "Kubeflow Trainer 的 Kueue、Volcano、Gang 调度、可观测性与故障排查"
sidebar_label: "03. 调度、监控与故障排查"
sidebar_position: 3
description: "掌握训练任务从配额准入、Gang 调度到 Rank 运行的状态机，并建立 Trainer V2 分层观测和故障定位方法。"
tags: [Kubeflow Trainer, Kueue, Volcano, Gang Scheduling, 可观测性, 故障排查]
---

# Kubeflow Trainer 的 Kueue、Volcano、Gang 调度、可观测性与故障排查

一个 TrainJob 创建后迟迟没有训练，不一定是 Controller 或 GPU 故障。生产集群通常同时存在配额准入、Gang 调度、Kubernetes 调度、镜像与存储准备、分布式 Rendezvous 和 Collective 初始化六个阶段。

```text
TrainJob已接受
→ Runtime已解析
→ Workload已准入
→ Pod组满足Gang条件
→ Pod已绑定节点
→ 容器已启动
→ 全部Rank完成Rendezvous
→ 首个训练Step完成
```

## 1. Kueue 与 Volcano 解决的问题不同

### 1.1 Kueue：先决定工作负载能否使用配额

Kueue 把批任务转换为 Workload，依据 LocalQueue、ClusterQueue、ResourceFlavor、优先级和配额进行准入。未准入的训练任务即使已经提交，也应保持挂起，避免部分 Pod 抢占 GPU 后长期等待其他 Rank。

核心对象关系：

```text
TrainJob / JobSet
→ Workload
→ LocalQueue
→ ClusterQueue
→ ResourceFlavor / Cohort / Quota
```

### 1.2 Volcano：让一组 Pod 满足最小成员后共同运行

Volcano 使用 Queue、PodGroup 和调度策略处理 Gang Scheduling、优先级、抢占与拓扑。对需要所有 Rank 共同初始化的训练，`minMember` 或等价最小可用数量必须与真实启动语义匹配。

### 1.3 是否必须二选一

不同版本和集成方案可能由 Kueue 负责准入、再由默认调度器或其他调度器完成放置，也可能由 Volcano 直接管理队列和 Gang。不要在同一任务上叠加职责不清的多个控制器。先画出谁创建 Workload/PodGroup、谁控制 Suspend、谁执行 Bind。

## 2. Pending 的四种含义

| 状态 | 证据 | 可能原因 |
| --- | --- | --- |
| 未准入 | Workload 无 Admitted Condition | 配额不足、队列停用、Flavor 不匹配 |
| 等待 Gang | PodGroup 未满足最小成员 | 集群没有足够的同时可用资源 |
| 调度失败 | Pod Event 出现 FailedScheduling | GPU、CPU、内存、污点、亲和性、Volume 或端口约束 |
| 已调度未启动 | Pod 已有 nodeName，但 ContainerCreating | 镜像、CSI、CNI、Device Runtime 问题 |

“Pending”只是现象，必须根据 Owner、Condition 和 Event 确认它卡在哪个状态机。

## 3. 资源请求与并行世界必须一致

假设训练配置期望 4 个节点、每节点 8 卡，但集群只创建了 3 个 Worker，常见结果不是降级到 24 卡，而是所有已启动 Rank 阻塞等待缺失成员。

验算至少包含：

```text
Pod副本数 × 每Pod进程数 = WORLD_SIZE
每Pod进程数 ≤ 每Pod请求的GPU/NPU数
Gang minMember = 启动训练所需的最小Pod数
Queue配额 ≥ 整个工作负载的资源请求
```

还要把 Sidecar、Launcher 和数据初始化 Pod 的 CPU/内存算入配额，不能只计算 GPU Worker。

## 4. 可观测性的对象层级

### 4.1 控制面

- Trainer Controller：Reconcile 次数、错误、耗时和队列深度；
- Webhook：请求错误、证书有效期、准入延迟；
- JobSet Controller：子 Job 创建、失败和状态汇总；
- Kueue/Volcano：等待任务、准入延迟、配额使用、抢占和调度失败。

### 4.2 Kubernetes 对象

- TrainJob 的 Generation、ObservedGeneration、Conditions；
- JobSet、Job 的 Active/Succeeded/Failed；
- Pod Phase、Container State、Reason、ExitCode、RestartCount；
- Event 中的 FailedScheduling、FailedMount、FailedCreatePodSandBox、ImagePull；
- 节点 Allocatable、Pressure、设备资源与网络状态。

### 4.3 训练运行时

- 每个 Rank 的启动时间、首个 Step 时间和退出码；
- Step Time 及 Data/Forward/Backward/Optimizer/Checkpoint 分段；
- GPU/NPU 利用率、显存/HBM、功耗和错误；
- NCCL/HCCL Collective 时延、网卡吞吐、丢包与拥塞；
- DataLoader 吞吐、存储时延和 Checkpoint 耗时。

控制面只能说明“工作负载是否被正确编排”，不能替代训练进程和设备指标。

## 5. 分层排障命令

### 5.1 找到 Owner 链和时间线

```bash
kubectl describe trainjob <name> -n <namespace>
kubectl get trainjob <name> -n <namespace> -o yaml
kubectl get jobset,job,pod -n <namespace> --show-labels
kubectl get events -n <namespace> --sort-by=.metadata.creationTimestamp
```

记录对象 UID、CreationTimestamp、Condition TransitionTime 和 Generation，避免把旧任务事件与本次故障混在一起。

### 5.2 检查准入和 Gang

```bash
kubectl get workloads.kueue.x-k8s.io -A
kubectl describe workload <name> -n <namespace>
kubectl get localqueue,clusterqueue -A

kubectl get podgroup -A
kubectl describe podgroup <name> -n <namespace>
kubectl get queue -A
```

集群不一定同时安装 Kueue 和 Volcano；命令应按实际 API 调整。

### 5.3 检查 Pod 与 Rank

```bash
kubectl get pod -n <namespace> -o wide
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --all-containers --timestamps
kubectl logs <pod> -n <namespace> --previous --all-containers --timestamps
```

不要只看 Rank 0。应按时间排序所有 Rank 日志，寻找第一个出现 OOM、I/O、网络、设备或 Python 异常的进程。其他 Rank 的 Collective Timeout 往往只是后果。

## 6. 常见故障树

### 6.1 TrainJob 没有生成 JobSet

检查顺序：

1. CRD 字段是否通过校验；
2. Runtime 引用是否存在且作用域正确；
3. Controller 是否有 Watch/Create 权限；
4. Webhook 证书和 Service 是否正常；
5. Controller 日志中是否存在模板合并或策略错误。

### 6.2 Workload 长期未准入

检查 Queue 是否 Active、ClusterQueue 是否有对应 Flavor 配额、Namespace 是否绑定正确 LocalQueue、优先级是否被更高任务占用，以及工作负载总请求是否大于任何可用配额组合。

### 6.3 Pod 无法同时调度

检查 Gang 最小成员、节点碎片、GPU 型号标签、污点、NodeAffinity、TopologySpread、PVC 可用区和 HostPort。总 GPU 数够不代表能满足“同一故障域内同时获得 N 张同型号卡”。

### 6.4 Pod Running 但卡在初始化

先确认所有 Rank 是否到齐以及 Master 端口可达，再检查 World Size、Rank 唯一性、NetworkPolicy、DNS、MTU、NCCL/HCCL 网卡选择。单个 Rank 在加载数据或编译 Kernel，也会让其他 Rank 看起来像通信挂死。

### 6.5 训练中途失败

从最早退出 Rank 的 `reason`、`exitCode`、设备错误和应用栈开始，再判断是否为：

- 显存/HBM OOM；
- 节点 OOM、Eviction 或重启；
- 数据文件损坏或存储超时；
- NCCL/HCCL 异步错误；
- Checkpoint 写满或元数据不一致；
- 抢占、配额回收或节点维护。

## 7. SLI 与容量指标

| 指标 | 含义 |
| --- | --- |
| Queue Wait | 从提交到资源准入的时间 |
| Schedule Latency | 从准入到全部必要 Pod 绑定的时间 |
| Startup Latency | 从绑定到全部 Rank 加入的时间 |
| Time to First Step | 从提交到第一个有效 Step 的时间 |
| Step Time P50/P95 | 训练稳态性能和抖动 |
| Restart/Retry Count | 运行环境稳定性 |
| Checkpoint Duration/Failure | 可恢复能力 |
| GPU/NPU Effective Utilization | 排除等待后的有效计算利用率 |

把 Queue Wait 与 Step Time 混成一个“任务耗时”，无法区分容量不足和训练效率低下。

## 8. 可靠性技术原则

- 训练任务使用不可变镜像、代码 Revision、数据版本和 Runtime 版本；
- Checkpoint 应具备完成标志、校验和与原子发布语义；
- 重试前判断任务是否幂等，避免重复写入同一输出目录；
- 为大规模任务设置合理 Active Deadline、Backoff 和清理策略；
- 控制器、调度器和训练日志统一时间同步，并保留 Rank、Pod UID、Job UID；
- 先验证单机基线，再扩大节点数和并行维度。

参考：[Kubeflow Trainer Scheduling](https://trainer.kubeflow.org/en/latest/operator-guides/job-scheduling/)、[Kueue Documentation](https://kueue.sigs.k8s.io/docs/)、[Volcano Documentation](https://volcano.sh/en/docs/)。
