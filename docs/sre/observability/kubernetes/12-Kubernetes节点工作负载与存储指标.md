---
title: "Kubernetes 节点、工作负载与存储指标"
sidebar_label: "12. 节点、工作负载与存储指标"
sidebar_position: 12
description: "以 Node Ready、Pod 状态、Deployment 副本、容器 CPU/内存、重启、HPA 与 PVC 指标建立工作负载监控和异常判断。"
tags: [Kubernetes, kube-state-metrics, cAdvisor, PVC, 监控]
---

# Kubernetes 节点、工作负载与存储指标

工作负载监控需要把三种信息放在一起：API 中声明了什么、控制器观察到什么、节点实际消耗了什么。仅有容器 CPU/内存图，回答不了“应该运行的副本为什么没运行”；仅有 KSM，也回答不了容器是否正在被 CPU 配额节流。

版本与标签约定沿用[接入清单](./10-Kubernetes监控指标分层与接入清单.md)：Kubernetes v1.34、KSM v2.17.0；kubelet/cAdvisor 的具体暴露集还取决于运行时、cgroup 和内核。本文查询假设每个对象/容器仅有一个逻辑采集贡献者。

## 1. 节点：Ready、Pressure 和资源余量

| 指标 | 来源/类型 | 关键口径 |
| --- | --- | --- |
| `kube_node_status_condition` | KSM，Gauge | `node,condition,status`；Ready、MemoryPressure、DiskPressure、PIDPressure |
| `kube_node_spec_unschedulable` | KSM，Gauge | 主动 cordon 与故障不是一回事 |
| `kube_node_status_allocatable` | KSM，Gauge | `node,resource,unit`；Pod 可分配预算，不是当前空闲量 |
| CPU/PSI/磁盘/文件系统 | Node Exporter | 主机实际资源与压力 |
| kubelet 抓取状态 | Prometheus | Ready 不是采集健康，抓取失败也不等于 Node 已 NotReady |

```promql
kube_node_status_condition{job="kube-state-metrics",condition="Ready",status="true"} == 0
```

若 Ready=true 的值为 0，需继续分辨 Ready=false 还是 unknown。加合适的 `for`，区分短暂波动与持续不可用；节点不存在或 KSM 漏采时，这条查询可能没有值，覆盖检查需独立实现。[Node 指标定义](https://github.com/kubernetes/kube-state-metrics/blob/v2.17.0/docs/metrics/cluster/node-metrics.md)列出了标签。

## 2. Pod：phase 不等于用户可用性

核心对象指标来自[Pod 指标文档](https://github.com/kubernetes/kube-state-metrics/blob/v2.17.0/docs/metrics/workload/pod-metrics.md)：

| 指标 | 类型 | 解释 |
| --- | --- | --- |
| `kube_pod_status_phase` | Gauge | `phase` one-hot 状态；Running 不保证 Ready |
| `kube_pod_status_ready` | Gauge | `condition`；就绪仍不等于端到端业务成功 |
| `kube_pod_container_status_waiting_reason` | Gauge | `reason` 如 CrashLoopBackOff、ImagePullBackOff |
| `kube_pod_container_status_restarts_total` | Counter | `namespace,pod,uid,container`；重启次数，不是 OOM 次数 |
| `kube_pod_container_status_last_terminated_reason` | Gauge，Experimental | 最近终止原因，可能长期保留，不是事件计数 |

### 2.1 指标卡：持续 Pending

```yaml
groups:
  - name: kubernetes-workload-example
    rules:
      - alert: PodPendingTooLong
        expr: kube_pod_status_phase{job="kube-state-metrics",phase="Pending"} == 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Pod 持续处于 Pending"
          action: "查看调度事件、Pod nodeName、镜像拉取和 PVC 绑定"
```

`max_over_time(...[10m]) == 1` 只说明窗口内至少一次 Pending，不代表持续 Pending。`for` 让条件在规则评估中持续成立；它也不是逐秒事件审计，仍需确保抓取覆盖与新鲜度。

Pending 可能尚未调度，也可能已调度但等待镜像/卷/容器创建。先查 `nodeName` 和事件，再决定去 scheduler、registry 还是 CSI 排查。等待人工批准或刻意 gated 的对象应进入对应策略，不一定需要呼叫值班。

### 2.2 指标卡：重启与 OOM 线索

```promql
sum by (cluster, namespace, pod, uid, container) (
  increase(kube_pod_container_status_restarts_total{job="kube-state-metrics"}[15m])
) > 3
```

15 分钟超过 3 次是教学筛选，不是通用严重等级。保留 `uid` 避免同名新 Pod 与旧 Pod 混在一起；被删除的对象可能无法继续提供事件，日志和事件系统要承担历史留存。

`last_terminated_reason{reason="OOMKilled"} == 1` 只能说明最近一次终止原因，不能直接对它求 `increase` 得到 OOM 次数。应关联近期 restart/终止时间、容器事件和内核日志；近期有重启且最近原因是 OOM 仍不证明窗口内每次重启都是 OOM。

## 3. Deployment：期望、Ready、Available 与发布

```promql
kube_deployment_spec_replicas{job="kube-state-metrics"}
- on (cluster, namespace, deployment)
kube_deployment_status_replicas_available{job="kube-state-metrics"}
```

结果是期望与 available 副本的差值。Available 包含就绪持续时间要求，不能与 Ready 完全等同。滚动发布、暂停、扩缩容和 minReadySeconds 都可能造成短暂差值；应结合持续时间、发布预算和业务错误率。

对照 `kube_deployment_metadata_generation` 与 `kube_deployment_status_observed_generation`，判断控制器是否已观察新配置；观察到了也不代表发布成功。再看 updated、unavailable、Progressing 条件和事件。字段定义见[Deployment 指标](https://github.com/kubernetes/kube-state-metrics/blob/v2.17.0/docs/metrics/workload/deployment-metrics.md)。StatefulSet/DaemonSet 有自己的期望与可用语义，不要硬套 Deployment 查询。

## 4. 容器 CPU：使用、request、limit 和节流

### 4.1 实际使用的核数

```promql
sum by (cluster, namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{job="kubelet-cadvisor",container!="",container!="POD"}[5m])
)
```

输出 core；0.5 表示窗口平均半个 CPU 核，不是 0.5%。若画相对 request 的比率，分母来自 KSM 的 `kube_pod_container_resource_requests{resource="cpu",unit="core"}`；分母为 0/缺失时显示“不适用”，不要把无 request 当作无限容量。

request 是调度/资源权重基准，limit 是运行时上限，节点核数又是第三种分母。HPA 的资源利用率通常以 request 为基准，不是 limit。汇总整 Pod 的调度预算时还需考虑 init container、sidecar、Pod overhead 等，不能把普通容器 requests 简单相加当精确可调度预算；可用时参考 scheduler 的 Pod 资源指标。

### 4.2 CFS 节流周期比例

```promql
(
  sum by (cluster, namespace, pod, container) (
    rate(container_cpu_cfs_throttled_periods_total{job="kubelet-cadvisor",container!="",container!="POD"}[5m])
  )
  /
  sum by (cluster, namespace, pod, container) (
    rate(container_cpu_cfs_periods_total{job="kubelet-cadvisor",container!="",container!="POD"}[5m])
  )
)
and on (cluster, namespace, pod, container)
(
  sum by (cluster, namespace, pod, container) (
    rate(container_cpu_cfs_periods_total{job="kubelet-cadvisor",container!="",container!="POD"}[5m])
  ) > 0
)
```

这是发生节流的周期数占比，**不是损失 CPU 时间比例**；即使每周期只被节流很短也可能接近 100%。是否要处理，应结合耗时、排队、throttled seconds 与 quota。未暴露 CFS 指标时检查 cgroup/运行时能力，不能填零宣称没有节流。字段来源参考[cAdvisor Prometheus 指标](https://github.com/google/cadvisor/blob/v0.52.0/docs/storage/prometheus.md)。

## 5. 内存：Working Set 不等于离 OOM 还差多少

实际用量看 `container_memory_working_set_bytes`，配额看 `kube_pod_container_resource_limits{resource="memory",unit="byte"}`；分别按容器键聚合后再关联。没有设置 limit 的容器，不应显示“用了 0%”。

Working Set 是运行时/内核统计推导值，不完全等于不可回收 RSS，也不等于下一次分配的可用余量。共享页、文件缓存、cgroup v1/v2 和内核回收会影响解释。应同时观察：

1. Working Set、RSS/缓存的趋势；
2. limit、内存压力与 OOM 事件；
3. 节点 MemAvailable/PSI 与 eviction；
4. 应用堆、堆外内存和并发工作集。

主机内存空闲但容器 OOM，优先查 cgroup limit；没有 limit 的容器也可能导致节点压力和其他 Pod 被驱逐。Evicted 与 OOMKilled 是不同证据链。

## 6. HPA、Job 与声明资源

HPA 条件 `AbleToScale`、`ScalingActive`、`ScalingLimited` 来自 `kube_horizontalpodautoscaler_status_condition`；同时看 current、desired 与 spec max replicas。[HPA 指标](https://github.com/kubernetes/kube-state-metrics/blob/v2.17.0/docs/metrics/workload/horizontalpodautoscaler-metrics.md)用于解释对象状态，指标管道本身仍需单独检查。

desired 已达到 max 且用户延迟持续恶化，说明需要分析容量或瓶颈；达到 max 本身不一定是事故。current 小于 desired 还可能是节点/配额不足，而不是 HPA 算错。Job/CronJob 则围绕业务截止时间和最近成功监控，不能用 Deployment 可用副本取代。

## 7. PVC：绑定、容量、I/O 与业务读写分开

| 信号 | 指标/来源 | 解释边界 |
| --- | --- | --- |
| 声明与绑定 | `kube_persistentvolumeclaim_status_phase`、`kube_persistentvolumeclaim_resource_requests_storage_bytes`，KSM Gauge | Pending/Bound 和申请容量，不是实际剩余空间 |
| 卷空间 | `kubelet_volume_stats_available_bytes`、`kubelet_volume_stats_capacity_bytes`，Gauge | 由支持统计的卷插件/CSI 提供，单位字节 |
| inode | `kubelet_volume_stats_inodes_free`、`kubelet_volume_stats_inodes`，Gauge | 文件系统适用；原始块设备不一定支持 |
| I/O 与故障 | CSI/存储后端指标、事件、应用读写探测 | 不能由 Bound 或空间余量推出延迟和可写性 |

PVC 状态与容量定义见[KSM PVC 指标](https://github.com/kubernetes/kube-state-metrics/blob/v2.17.0/docs/metrics/storage/persistentvolumeclaim-metrics.md)。

### 7.1 卷可用比例

```promql
min by (cluster, namespace, persistentvolumeclaim) (
  (
    kubelet_volume_stats_available_bytes{job="kubelet"}
    / kubelet_volume_stats_capacity_bytes{job="kubelet"}
  )
  and (kubelet_volume_stats_capacity_bytes{job="kubelet"} > 0)
)
```

先在同一报告序列上求比例，再对共享 PVC 的多个报告取最小值作为保守视图；不要把多个节点报告的同一卷空间相加。最小值也可能受到采样不同步影响，应保留节点下钻图。

缺失卷统计可能是 CSI 不支持、卷类型不适用、未挂载或采集出错；不能认为 0% 使用。Bound 仅说明控制面绑定完成，无法证明后端 I/O 正常、挂载成功或数据库数据一致。

## 8. 告警与故障关联

| 应呼叫/预警的现象 | 必要上下文 | 第一层检查 |
| --- | --- | --- |
| Node 持续 NotReady/unknown | 故障域、受影响业务、维护状态 | kubelet/网络/主机，结合 API 与采集覆盖 |
| Deployment 持续不可用 | 发布、暂停、最小可用预算 | Pod Ready、waiting reason、事件 |
| 重启增加且业务错误增加 | UID、终止原因、变更时间 | 应用日志、探针、内存与依赖 |
| CPU 节流且延迟恶化 | quota、request、突发与并发 | 容器限额与应用串行瓶颈 |
| PVC 即将满或读写失败 | 扩容能力、存储类、剩余字节 | 增长来源、后端/CSI，不直接删除数据 |

维护和发布应按具体对象静默，不把整集群所有告警关闭。根因节点故障可抑制同故障域的重复 Pod 告警，但业务 SLO 告警通常仍需保留。

## 9. 验收题

**问：Running、Ready 和 Available 是否同义？** 不是。phase、Pod 就绪和工作负载可用预算/持续时间是不同层次，最终仍需业务结果验证。

**问：CFS 节流比例 80%，是不是损失了 80% 性能？** 不是。它统计有节流发生的周期比例，不能直接换算 CPU 时间或吞吐损失。

**问：PVC 是 Bound，为什么数据库还报 I/O 错？** 控制面绑定不代表后端可达、挂载成功或介质/网络正常，应结合 CSI、后端和应用证据。
