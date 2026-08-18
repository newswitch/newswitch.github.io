---
title: "生产 GPU 集群节点池规划"
sidebar_label: "01. 生产 GPU 集群节点池规划"
sidebar_position: 1
description: "生产集群很少「所有 GPU 节点一个池」。按 型号、用途、网络拓扑 切开，才能控 SLA、成本和嘈杂邻居。本文给出节点池模型，并用 Kueue ResourceFlavor / 拓扑感知调度 表达「哪种卡、哪一层拓扑」。前置：污点、拓扑。"
tags: ["Kubernetes", "GPU", "节点池", "ResourceFlavor", "Kueue", "学习路线"]
date: 2026-07-22 19:05:00
categories: 云原生
---

# 生产 GPU 集群节点池规划

生产集群很少「所有 GPU 节点一个池」。按 **型号、用途、网络拓扑** 切开，才能控 SLA、成本和嘈杂邻居。本文给出节点池模型，并用 [Kueue ResourceFlavor](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/resource_flavor/) / [拓扑感知调度](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/topology_aware_scheduling/) 表达「哪种卡、哪一层拓扑」。前置：[污点](../scheduling/02-GPU%20节点%20Taint%20与%20Toleration%20实践.md)、[拓扑](../scheduling/12-GPU%20集群拓扑感知调度.md)。

## 1. 为什么要分池

| 混在一起的问题 | 分池后 |
|----------------|--------|
| 开发占满 A100，推理 Pending | 推理池污点 + 配额 |
| T4 与 H100 都叫 `nvidia.com/gpu` | Flavor / 标签区分型号 |
| 训练跨机架，NCCL 极慢 | TAS / 同 rack 标签 |
| 成本算不清 | 按池做利用率与账单 |

## 2. 推荐池类型

| 池 | 标签示例 | 污点 | 谁进来 |
|----|----------|------|--------|
| **推理独占** | `pool=inference`, `gpu=a100-80g` | `sku=inference:NoSchedule` | 在线服务 + 高 PriorityClass |
| **训练** | `pool=training`, `gpu=h100`, `net=ib` | `sku=training:NoSchedule` | Volcano/Kueue 训练 Job |
| **共享/开发** | `pool=shared`, `gpu=t4` | `sku=shared:NoSchedule` | 低优、可抢占、可 Time-Slicing/MIG |
| **测试** | `pool=test` | 强污点 | 仅 CI / 灰度 |
| **异构备用** | `gpu=l40s` 等 | 按需 | 特定模型 |

同一型号也可再按 **NVLink 域 / 机架** 打拓扑标签（见 §5）。

节点示例：

```yaml
# 节点标签（示意）
metadata:
  labels:
    pool: training
    gpu.nvidia.com/model: H100-80GB
    cloud.provider.com/topology-block: block-1
    cloud.provider.com/topology-rack: rack-3
    net: ib
spec:
  taints:
    - key: sku
      value: training
      effect: NoSchedule
```

## 3. Kueue ResourceFlavor：把池变成「规格」

[ResourceFlavor](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/resource_flavor/) 描述资源差异（竞价/按需、架构、**GPU 型号**），通过 `nodeLabels` / `tolerations` / `nodeTaints` 绑到节点。

### 3.1 自动调度型（Kueue 注入 nodeSelector + toleration）

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: ResourceFlavor
metadata:
  name: h100-training
spec:
  nodeLabels:
    gpu.nvidia.com/model: H100-80GB
    pool: training
  tolerations:
    - key: sku
      operator: Equal
      value: training
      effect: NoSchedule
```

准入后 Kueue 把 flavor 标签写入 Job 的 `nodeSelector`，并追加 tolerations，保证落到对应池。

### 3.2 用户显式容忍型（flavor 带 taint）

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: ResourceFlavor
metadata:
  name: spot-a100
spec:
  nodeLabels:
    instance-type: spot
  nodeTaints:
    - key: spot
      value: "true"
      effect: NoSchedule
```

只有 PodSpec **自带** 匹配 toleration 的工作负载才能消耗该 flavor 配额（Kueue 不会自动加）。

### 3.3 空 Flavor

资源同构时可只建 `default-flavor`，无额外标签——适合小实验集群。

### 3.4 多型号配额（ClusterQueue 片段）

```yaml
resourceGroups:
  - coveredResources: ["cpu", "memory", "nvidia.com/gpu"]
    flavors:
      - name: h100-training
        resources:
          - name: nvidia.com/gpu
            nominalQuota: 64
      - name: a100-inference
        resources:
          - name: nvidia.com/gpu
            nominalQuota: 32
```

`cpu`/`memory`/`nvidia.com/gpu` 放同一 resourceGroup，保证绑到同一节点规格时一起分配。

## 4. 与「只打标签 + kube-scheduler」对比

| 方式 | 优点 | 局限 |
|------|------|------|
| nodeSelector / affinity | 简单 | 无跨租户配额账本 |
| ResourceQuota 按 ns | 控上限 | 不区分 H100/T4 除非扩展资源名不同 |
| Kueue Flavor + ClusterQueue | 型号配额、借用、抢占 | 多一层控制面 |
| Volcano Queue | 与 Gang 训练结合紧 | 拓扑 TAS 用 Kueue 文档更完整 |

GPU 集群常见组合：**节点池污点 +（Volcano 或 Kueue）队列**；推理 Deployment 可只靠污点与 PriorityClass。

## 5. 拓扑感知（TAS）与节点池

Kueue [拓扑感知调度](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/topology_aware_scheduling/)（alpha）：用节点标签表示 block → rack → hostname 层次，让通信密集的 PodSet 尽量同域。

管理员：

1. 开 `TopologyAwareScheduling`
2. 创建 `Topology`，levels 指向节点标签
3. ResourceFlavor 设 `topologyName`

```yaml
apiVersion: kueue.x-k8s.io/v1beta2
kind: Topology
metadata:
  name: default
spec:
  levels:
    - nodeLabel: cloud.provider.com/topology-block
    - nodeLabel: cloud.provider.com/topology-rack
    - nodeLabel: kubernetes.io/hostname
```

用户注解（示意）：

- `kueue.x-k8s.io/podset-preferred-topology`：尽量同 block，不够再上浮
- `kueue.x-k8s.io/podset-required-topology`：必须同指定层级
- `podset-unconstrained-topology`：填碎片

与本系列 [第 35 篇](../scheduling/12-GPU%20集群拓扑感知调度.md) 的 `nvidia-smi topo` 互补：一个管 **机内 NVLink**，一个管 **机架/区块** 放置。

代价：Kueue 跟踪更多 Pod/节点，内存与调度耗时上升。

## 6. 规划检查表

- [ ] 每池：型号、驱动、网络（IB/以太）、污点、谁可容忍
- [ ] 推理与训练是否物理或污点隔离
- [ ] Flavor 名称与 ClusterQueue `nominalQuota` 是否对账
- [ ] 拓扑标签是否由云厂商/运维自动打齐
- [ ] 扩容（CA/Karpenter）是否复制相同标签与污点

## 7. 小结

| 概念 | 作用 |
|------|------|
| 节点池 | 用途与硬件边界 |
| ResourceFlavor | 配额账本里的「哪种节点」 |
| Topology | 跨节点放置优化 |
| 污点 | 强制只有对的人进池 |

下一篇：[多租户与资源配额](./02-GPU%20多租户与资源配额设计.md)。

## 8. 参考与致谢 {/* #参考与致谢 */}

- [ResourceFlavor](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/resource_flavor/)
- [拓扑感知调度](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/topology_aware_scheduling/)
- [ClusterQueue](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)
- [Kubernetes 多租户](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/)

本文把节点池设计与 Kueue Flavor/TAS 对齐到 GPU 生产场景。
