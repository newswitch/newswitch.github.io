---
title: "Argo Workflows 资源、调度、GPU 与并行容量"
sidebar_label: "07. 资源、GPU 与容量"
sidebar_position: 7
description: "从 Pod 资源请求、Kubernetes 调度、GPU 拓扑、并行度和下游配额规划工作流容量。"
tags: [Argo Workflows, GPU, Kubernetes Scheduler, 容量规划, 并行]
---

# Argo Workflows 资源、调度、GPU 与并行容量

Argo 决定“依赖满足后是否创建 Pod”，Kubernetes Scheduler 决定“Pod 放到哪个 Node”。GPU 不足、亲和冲突或 PVC 拓扑不匹配属于调度层，不是 DAG 没解锁。

## 1. 资源链

```text
Workflow Parallelism
→ Controller 创建 Pod 的速率
→ Scheduler 根据 Request/约束放置
→ Device Plugin 分配 GPU
→ kubelet/运行时启动
→ 任务使用显存、网络和存储
```

## 2. GPU 任务 Spec

```yaml
resources:
  requests:
    cpu: "8"
    memory: 32Gi
    nvidia.com/gpu: "1"
  limits:
    nvidia.com/gpu: "1"
```

实际资源名取决于设备插件，例如 NVIDIA 或昇腾插件。还需配置 Node Label/Affinity、Taint/Toleration、Runtime、驱动/固件兼容和必要的共享内存。

## 3. GPU 利用率低不一定缺少并行

可能瓶颈位于：

- 数据下载、解压、预处理或 CPU；
- 单请求 Batch 太小、动态批处理等待不合理；
- Host 到 Device 拷贝、NUMA/PCIe 拓扑；
- 多卡通信、RoCE/InfiniBand/NVLink；
- 输出写存储或同步屏障；
- 显存碎片、OOM 重试或 Kernel 空隙。

同时看 GPU Busy、显存、功耗、PCIe/互联、CPU、磁盘、网络和任务时间线。

## 4. 三层并行控制

- Workflow `parallelism`：单次运行上限；
- Namespace/Controller：全局公平和保护控制面；
- Template Semaphore：数据库、模型服务或许可证等下游配额。

并行度不是越高越快。以吞吐、P95、失败率、队列等待和单位任务成本找到拐点，并保留故障余量。

## 5. Gang 与分布式训练

多节点训练需要所有角色同时就绪时，普通独立 Pod 调度可能造成资源占住但任务无法开始。可结合相应训练 Operator、队列/Gang Scheduler，由 Argo 编排其 CR；不要用无界重试模拟 Gang。

## 6. Pending 排障

查看 Pod Event：Insufficient GPU/CPU/Memory、未容忍 Taint、Affinity 冲突、PVC Node Affinity、配额、设备插件或镜像拉取。再检查队列策略和节点健康，不要盲目扩容 Controller。
