---
title: "Volcano vcctl 命令详解"
sidebar_position: 1
description: "掌握 vcctl Job与Queue查询、暂停、恢复、运行和删除，并结合kubectl定位PodGroup与Gang调度。"
tags: [Volcano, vcctl, GPU调度, Queue, Gang Scheduling]
---

# Volcano vcctl 命令详解

`vcctl` 是Volcano资源管理CLI，可查看和操作Volcano Job、Queue等对象。版本能力变化较快，先对齐Volcano服务端与CLI版本：

```bash
vcctl version
vcctl --help
vcctl job --help
vcctl queue --help
kubectl -n volcano-system get deploy -o wide
```

## 1. 只读查询 `[R]`

```bash
vcctl job list
vcctl job list --namespace <ns>
vcctl job view --name <job> --namespace <ns>
vcctl queue list
vcctl queue view --name <queue>
```

子命令名在不同版本可能使用 `view/get` 等形式，以当前帮助为准。配合原生对象：

```bash
kubectl get vcjob -A
kubectl get queue
kubectl get podgroup -A
kubectl describe vcjob <job> -n <ns>
kubectl describe podgroup <name> -n <ns>
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

## 2. Job生命周期 `[W/D]`

```bash
vcctl job suspend --name <job> --namespace <ns>
vcctl job resume  --name <job> --namespace <ns>
vcctl job run     --name <job> --namespace <ns>
vcctl delete job --name <job> --namespace <ns>
```

- suspend是否保留Pod/资源、resume如何重建，取决于Job策略与版本。
- 删除前确认checkpoint完成、外部写入幂等、清理策略和PVC所有权。
- 恢复前确认Queue开放、配额、镜像/数据仍可用，避免立即再次失败。
- GitOps管理的Job可能被控制器重新创建，操作前明确desired state所有者。

## 3. Queue治理 `[W]`

Volcano版本可能支持queue开启、关闭、更新、删除。任何操作前先保存：

```bash
kubectl get queue <queue> -o yaml > queue-before.yaml
kubectl get vcjob -A -o wide
kubectl get podgroup -A -o wide
```

关闭Queue会阻止后续入队，但已运行作业的行为需按版本确认。修改weight、capability、guarantee、reclaimable或deserved等字段会改变多个租户公平性，必须通过容量模拟和变更窗口。

## 4. Pending定位

```text
vcjob phase
→ podgroup phase / minMember或minResources
→ queue state与容量
→ scheduler event
→ Pod event
→ node GPU资源和拓扑
```

| 现象 | 判断 |
|---|---|
| PodGroup Pending | Gang最小资源尚不满足或未入队 |
| Queue Closed | 队列管理状态阻止新作业 |
| Inqueue但Pod Pending | 已过队列关，继续查节点资源/亲和/污点 |
| 部分Pod Running其余Pending | minAvailable、抢占、资源碎片或调度策略 |
| Queue有空闲但作业不进 | capability/deserved、namespace/queue名、plugin和优先级 |

## 5. 日志与指标

```bash
kubectl -n volcano-system logs deploy/volcano-scheduler --since=30m
kubectl -n volcano-system logs deploy/volcano-controllers --since=30m
kubectl -n volcano-system logs deploy/volcano-admission --since=30m
```

大集群避免无过滤抓取全量日志；按job UID、PodGroup、namespace和时间窗检索。将调度周期、队列、action/plugin决策与Kubernetes event对齐。

## 掌握标准

能使用vcctl完成只读巡检；能解释Job、PodGroup、Queue的关系；能在暂停/删除前确认checkpoint和desired state；能把Volcano等待与原生Pod调度失败区分。

## 官方资料

- [Volcano CLI](https://volcano.sh/zh-hans/docs/cli/commandline/)
- [Volcano Job](https://volcano.sh/zh-hans/docs/concepts/volcanojob/)
