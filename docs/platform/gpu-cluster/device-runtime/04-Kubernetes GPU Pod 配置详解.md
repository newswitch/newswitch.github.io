---
title: Kubernetes GPU Pod 配置详解
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Pod", "调度", "NFD", "学习路线"]
---

# Kubernetes GPU Pod 配置详解

本文说明如何在 Kubernetes 中把 GPU 配成可调度资源，以及 Pod 申请 GPU 时的规则与限制。内容整理自官方文档 [调度 GPU](https://kubernetes.io/zh-cn/docs/tasks/manage-gpus/scheduling-gpus/)，并结合本系列前文做了实践补充。

**特性状态：** Kubernetes v1.26 [stable]

Kubernetes 可通过设备插件（Device Plugin），在集群节点上管理 AMD、NVIDIA 等 GPU，该能力目前处于稳定状态。

---

## 1. 使用设备插件

Kubernetes 通过 [Device Plugin](./01-Kubernetes%20如何识别和管理%20GPU.md)，让 Pod 访问 GPU 这类特殊硬件。

作为集群管理员，通常需要：

1. 在节点上安装对应硬件厂商的 **GPU 驱动**
2. 运行厂商提供的 **设备插件**

常见厂商文档入口（按字母序，属第三方项目）：

- [AMD](https://github.com/ROCm/k8s-device-plugin)
- [Intel](https://github.com/intel/intel-device-plugins-for-kubernetes)
- [NVIDIA](https://github.com/NVIDIA/k8s-device-plugin)

安装插件后，集群会暴露可调度的扩展资源，例如：

```text
amd.com/gpu
nvidia.com/gpu
```

容器里申请这些资源的方式，与申请 `cpu`、`memory` 类似，但对**自定义设备资源**有额外限制（见下一节）。

本系列里，NVIDIA 场景常见路径是：

- 手动：[驱动 / Toolkit](../../../foundations/compute/gpu/07-NVIDIA%20驱动、CUDA%20与容器运行时的关系.md) + Device Plugin
- 自动化：[GPU Operator](./05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)
- 分配链路：[Pod 如何使用上 GPU](./03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)

---

## 2. 申请规则：GPU 只能写在 limits

官方明确：**GPU 只能在 `limits` 中指定**。含义是：

| 写法 | 是否允许 |
|------|----------|
| 只写 `limits`，不写 `requests` | 允许；Kubernetes 会把 limit 值当作 request |
| 同时写 `limits` 和 `requests`，且**两者相等** | 允许 |
| 只写 `requests`，不写 `limits` | **不允许** |
| `requests` ≠ `limits` | **不允许** |

官方示例（资源名用厂商自定义示例）：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: example-vector-add
spec:
  restartPolicy: OnFailure
  containers:
    - name: example-vector-add
      image: "registry.example/example-vector-add:v42"
      resources:
        limits:
          gpu-vendor.example/example-gpu: 1 # 请求 1 个 GPU
```

NVIDIA 实践中更常见：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  restartPolicy: OnFailure
  containers:
    - name: cuda-container
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda11.7.1-ubuntu20.04
      resources:
        limits:
          nvidia.com/gpu: 1
```

也可以显式写相等的 requests/limits（效果等价于只写 limits）：

```yaml
resources:
  requests:
    nvidia.com/gpu: 1
  limits:
    nvidia.com/gpu: 1
```

---

## 3. 管理配有不同类型 GPU 的集群

若不同节点上的 GPU 型号不同（例如有的是 T4，有的是 A100），可用**节点标签 + 节点选择 / 亲和性**，把 Pod 调度到合适节点。

手动打标签示例：

```bash
# 标签键 accelerator 只是示例，可自定
kubectl label nodes node1 accelerator=example-gpu-x100
kubectl label nodes node2 accelerator=other-gpu-k915
```

Pod 用 `nodeSelector`：

```yaml
spec:
  nodeSelector:
    accelerator: example-gpu-x100
  containers:
    - name: cuda
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda11.7.1-ubuntu20.04
      resources:
        limits:
          nvidia.com/gpu: 1
```

NVIDIA + GPU Operator / GFD 场景下，也常见用厂商标签，例如：

```yaml
nodeSelector:
  nvidia.com/gpu.product: Tesla-T4
```

（具体标签名以节点上实际 `kubectl get node --show-labels` 为准。）

---

## 4. 自动节点标签（NFD）

管理员可部署 [Node Feature Discovery (NFD)](https://github.com/kubernetes-sigs/node-feature-discovery)，自动发现节点硬件特性并打标签。NFD 通常以节点标签暴露能力，也可配合扩展资源、注解、污点等。

默认会为检测到的特性创建特性标签（如 `feature.node.kubernetes.io/...`）。也可对特定能力节点加污点，让只有能容忍的 Pod 才能上去。

除通用 NFD 外，常还需要能打出「业务可用」标签的插件（通用或厂商特定）。NVIDIA 侧可参考 GPU Operator 自带的 NFD / GFD 能力，详见 [GPU Operator 一文](./05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。

官方用节点亲和性选 GPU 节点的示例：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: example-vector-add
spec:
  restartPolicy: OnFailure
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: "gpu.gpu-vendor.example/installed-memory"
                operator: Gt # 大于
                values: ["40535"]
              - key: "feature.node.kubernetes.io/pci-10.present" # NFD 特性标签
                operator: In
                values: ["true"]
  containers:
    - name: example-vector-add
      image: "registry.example/example-vector-add:v42"
      resources:
        limits:
          gpu-vendor.example/example-gpu: 1
```

---

## 5. 生产配置清单（建议）

写 GPU Pod 时建议自检：

1. **扩展资源是否已出现在 Node**  
   `kubectl describe node <name> | grep nvidia.com/gpu`（或对应厂商资源名）
2. **只在 limits 申请 GPU**（或 requests=limits）  
3. **异构卡池用标签 / 亲和性选型号**，避免 T4 任务落到不合适的卡上  
4. **GPU 节点建议配合 Taint**，防止普通业务误调度（见后续 [Taint 与 Toleration 实践](../scheduling-sharing/02-GPU%20节点%20Taint%20与%20Toleration%20实践.md)）  
5. 需要细粒度共享时，再看 [Time-Slicing](../scheduling-sharing/08-Kubernetes%20GPU%20Time-Slicing%20配置实践.md) / [HAMi](../scheduling-sharing/10-HAMi%20vGPU%20原理与实践.md) / MIG，而不是只改 `nvidia.com/gpu: 1` 的语义

完整一点的 NVIDIA 示例：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: cuda-on-t4
spec:
  restartPolicy: OnFailure
  nodeSelector:
    nvidia.com/gpu.product: Tesla-T4
  tolerations:
    - key: nvidia.com/gpu
      operator: Exists
      effect: NoSchedule
  containers:
    - name: cuda
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda11.7.1-ubuntu20.04
      resources:
        limits:
          nvidia.com/gpu: 1
```

---

## 6. 小结

| 主题 | 要点 |
|------|------|
| 暴露 GPU | 装驱动 + 厂商 Device Plugin，出现 `nvidia.com/gpu` 等扩展资源 |
| 申请方式 | 类似 cpu/memory，但 **GPU 必须写在 limits**（或 requests=limits） |
| 异构集群 | 节点标签 + nodeSelector / nodeAffinity |
| 自动发现 | NFD（及厂商 GFD 等）给节点打硬件特性标签 |

官方说明见：[Kubernetes 文档 · 调度 GPU](https://kubernetes.io/zh-cn/docs/tasks/manage-gpus/scheduling-gpus/)。

---

## 参考与致谢

- [调度 GPU \| Kubernetes](https://kubernetes.io/zh-cn/docs/tasks/manage-gpus/scheduling-gpus/)（英文：[Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)）
- [Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [Node Feature Discovery](https://github.com/kubernetes-sigs/node-feature-discovery)

本文基于上述 Kubernetes 官方文档整理，并按本系列学习路线补充了 NVIDIA 实践示例与交叉链接。官方文档遵循项目许可；第三方设备插件链接按 CNCF 网站指南以字母序列出，Kubernetes 项目作者不对这些第三方项目负责。
