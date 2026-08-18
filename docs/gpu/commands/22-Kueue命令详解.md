---
title: "Kueue kubectl 插件与 kueuectl 命令详解"
sidebar_label: "22. Kueue kubectl 插件与 kueuectl 命令详解"
sidebar_position: 22
description: "掌握Kueue Workload、LocalQueue、ClusterQueue、ResourceFlavor的查询、创建、停止、恢复和GPU准入排障。"
tags: [Kueue, kueuectl, Kubernetes, GPU调度, 配额]
---

# Kueue kubectl 插件与 kueuectl 命令详解

Kueue在工作负载创建与Pod真正调度之间增加准入层：它根据LocalQueue、ClusterQueue、ResourceFlavor、配额、借用和抢占决定Workload何时admit。CLI可能以 `kubectl kueue` 插件或 `kueuectl` 二进制提供。

## 1. 版本与发现 `[R]`

```bash
kubectl kueue --help
kueuectl --help
kubectl api-resources | grep -i kueue
kubectl get crd | grep kueue.x-k8s.io
kubectl -n kueue-system get deploy -o wide
```

CLI与服务端API版本要匹配；文档中的v1beta1/v1beta2对象不可无条件混用。

## 2. 只读查询 `[R]`

```bash
kubectl get workloads -A
kubectl get localqueues -A
kubectl get clusterqueues
kubectl get resourceflavors
kubectl describe workload <name> -n <ns>
kubectl describe clusterqueue <name>
kubectl kueue --help
```

插件支持版本中可列出Workload、LocalQueue、ClusterQueue和ResourceFlavor，并提供更友好的队列视图。自动化仍应保存原始对象JSON/YAML和conditions。

## 3. 创建队列对象 `[W]`

```bash
kueuectl create resourceflavor --help
kueuectl create clusterqueue --help
kueuectl create localqueue --help
```

生产推荐GitOps管理声明文件；CLI用于生成草案或受控应急。创建前核对namespace、cohort、resourceGroups、coveredResources、flavors和nominalQuota，GPU资源名以集群实际暴露为准。

## 4. Workload停止与恢复 `[W]`

```bash
kueuectl stop workload <name> -n <ns> --help
kueuectl resume workload <name> -n <ns> --help
```

停止可能触发deactivation/eviction，底层Job/Pod行为依赖集成。执行前确认checkpoint、重试语义、队列位置和外部副作用。恢复只是重新允许准入，不保证立即获得配额。

## 5. GPU未准入排障

```text
Job是否由Kueue管理
→ Workload是否创建
→ LocalQueue是否存在且Active
→ 指向哪个ClusterQueue
→ ClusterQueue是否Active
→ ResourceFlavor是否匹配节点标签/污点
→ nominalQuota、borrowingLimit、cohort是否有量
→ admission/eviction/deactivation conditions
→ 准入后Pod是否被Kubernetes调度
```

```bash
kubectl get workload <wl> -n <ns> -o json | jq '.status.conditions,.status.admission'
kubectl get clusterqueue <cq> -o json | jq '.status,.spec'
kubectl get resourceflavor <flavor> -o yaml
kubectl get nodes -L <topology-labels>
```

## 6. 控制器证据

```bash
kubectl -n kueue-system logs deploy/kueue-controller-manager --since=30m
kubectl get events -A --sort-by=.lastTimestamp | grep -i kueue
```

按Workload UID、namespace、queue和时间窗过滤。Metrics用于观察pending/admitted、准入等待、配额和抢占，但对象status是单次事件的主要证据。

## 7. 常见故障

| 现象 | 首要检查 |
|---|---|
| Job存在但无Workload | 集成/label、管理namespace、admission webhook和控制器日志 |
| LocalQueue Inactive | ClusterQueue不存在或Inactive |
| Workload Pending | quota、flavor、cohort借用、优先级和准入检查 |
| Admitted但Pod Pending | Kueue已完成，继续查scheduler、节点与设备插件 |
| 反复Evicted/Requeued | 抢占、admission check、节点故障、外部控制器 |
| GPU配额看似足够仍不匹配 | resource name、flavor标签/污点、拓扑和整卡碎片 |

## 8. 掌握标准 {/* #掌握标准 */}

能从Workload追到LocalQueue、ClusterQueue和Flavor；能区分“未准入”和“已准入但未调度”；能在stop/resume前评估checkpoint；能解释nominal quota、借用和抢占对租户的影响。

## 9. 官方资料 {/* #官方资料 */}

- [Kueue reference](https://kueue.sigs.k8s.io/docs/reference/)
- [Kueue concepts](https://kueue.sigs.k8s.io/docs/concepts/)
