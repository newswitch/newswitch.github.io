---
title: "GPU 调度命令参考库"
sidebar_position: 0
description: "使用 vcctl、kubectl kueue/kueuectl 与 kubectl 建立GPU作业队列、配额、准入、Gang和设备分配的运维证据链。"
tags: [GPU调度, Volcano, Kueue, Kubernetes, AI Infra]
---

# GPU 调度命令参考库

GPU作业Pending不一定是GPU不足，还可能是Queue关闭、配额未借用、Workload未准入、PodGroup不满足minAvailable、ResourceFlavor不匹配、拓扑约束或设备插件资源异常。

## 学习顺序

1. [Volcano vcctl](./01-Volcano-vcctl命令详解.md)：Job、Queue、PodGroup和Gang调度。
2. [Kueue CLI](./02-Kueue命令详解.md)：Workload准入、LocalQueue、ClusterQueue与ResourceFlavor。

GPU Operator、HAMi、MIG与DRA目前仍以 `kubectl`、`helm`、`nvidia-smi`、`dcgmi` 为主要入口，不人为创造不存在的CLI。相关证据应按以下顺序检查：

```text
业务Job/Deployment
→ Queue / Workload / PodGroup
→ Scheduler事件与准入状态
→ Pod调度与资源名
→ Node Capacity/Allocatable
→ Device Plugin/DRA ResourceSlice
→ 容器设备与驱动
```

## 安全边界

暂停、恢复、删除作业或修改队列会改变公平性、资源占用和业务进度。先获取当前对象YAML、resourceVersion、checkpoint状态和受影响租户；调度器CLI与GitOps不得同时争夺同一字段。

## 验收

能区分Kubernetes scheduler Pending、Volcano Gang等待和Kueue未准入；能从队列追到Pod和物理GPU；能在操作前评估checkpoint、抢占和配额影响。
