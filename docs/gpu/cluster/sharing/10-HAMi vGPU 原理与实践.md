---
title: "HAMi vGPU 原理与实践"
sidebar_label: "10. HAMi vGPU 原理与实践"
sidebar_position: 10
description: "本文介绍开源 GPU 虚拟化方案 HAMi：安装、配置与使用。相对 Time-Slicing 这类「只共享、不隔离」的方案，HAMi 还能对 GPU core / memory 做限制，让共享同一张卡的多个 Pod 更容易拿到稳定配额。"
tags: ["Kubernetes", "GPU", "HAMi", "vGPU", "GPU共享", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# HAMi vGPU 原理与实践

![封面：HAMi vGPU](/images/k8s-gpu/22-HAMi/vgpu-hami.png)

本文介绍开源 GPU 虚拟化方案 **HAMi**：安装、配置与使用。相对 [Time-Slicing](./08-Kubernetes%20GPU%20Time-Slicing%20配置实践.md) 这类「只共享、不隔离」的方案，HAMi 还能对 **GPU core / memory** 做限制，让共享同一张卡的多个 Pod 更容易拿到稳定配额。

> NVIDIA 也有商业 vGPU，通常需要 license；HAMi 是开源路线。

## 1. 为什么需要 GPU 共享、切分？

先问一个问题：裸机上多个进程本来就能共享一张 GPU，为什么到了 Kubernetes 就「不好共享」了？

结合前面几篇就比较清楚：

- [驱动 / CUDA / 容器运行时](../../driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)
- [GPU Operator](../device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)
- [Device Plugin 机制](../device-management/01-Kubernetes%20如何识别和管理%20GPU.md)
- [Pod 如何使用上 GPU](../device-management/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)

### 1.1 资源感知

Kubernetes 里资源跟节点绑定。GPU 由 Device Plugin 感知并上报后，Node 上会出现扩展资源，例如：

```bash
kubectl describe node gpu01 | grep Capacity -A7
Capacity:
  cpu:                128
  ephemeral-storage:  879000896Ki
  hugepages-1Gi:      0
  hugepages-2Mi:      0
  memory:             1056457696Ki
  nvidia.com/gpu:     8
  pods:               110
```

`nvidia.com/gpu: 8` 表示该节点有 8 张（可调度的）GPU。

### 1.2 资源申请

创建 Pod 时按扩展资源申请：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  containers:
    - name: gpu-container
      image: nvidia/cuda:11.0-base
      resources:
        limits:
          nvidia.com/gpu: 1
      command: ["nvidia-smi"]
  restartPolicy: OnFailure
```

调度器会把它放到有足够 `nvidia.com/gpu` 的节点；申请到的份额会记为已占用，**不会再分给别的 Pod**。

### 1.3 结论

默认路径下：

1. Device Plugin 按物理卡数量上报
2. Scheduler 按 Pod 的 request/limit **扣减**扩展资源

结果是：**一张物理 GPU 被一个 Pod 占住后，在 Kubernetes 账本里就没了**，其它 Pod 即使算力上还能挤，也会因「资源不足」调度失败。

所以才需要共享 / 切分方案。Time-Slicing 能让多 Pod 共享一张卡，但通常**没有显存与算力隔离**，容易互相挤占。HAMi 的目标是：共享之外，再补上更细的 core / memory 限制。

## 2. 什么是 HAMi？

**HAMi**（Heterogeneous AI Computing Virtualization Middleware）定位是异构算力虚拟化中间件。前身是第四范式的 `k8s-vgpu-scheduler`，改名 HAMi 后把核心 vCUDA 库 `libvgpu.so` 也开源了。

目前对 **NVIDIA GPU** 的 vGPU 能力相对成熟，实践中可先把它当成一套开源 vGPU 方案。

整体架构示意：

![HAMi 架构](/images/k8s-gpu/22-HAMi/hami-arch.png)

*图：涉及 Webhook、Scheduler、Device Plugin、HAMi-Core 等组件*

本文偏重**使用**；架构与原理只点到设计思路。

### 2.1 Feature：细粒度隔离

可对 core、memory 做到约 **1% 粒度** 的申请与限制，例如：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  containers:
    - name: ubuntu-container
      image: ubuntu:18.04
      command: ["bash", "-c", "sleep 86400"]
      resources:
        limits:
          nvidia.com/gpu: 1        # 请求 1 个 vGPU
          nvidia.com/gpumem: 3000  # 每个 vGPU 申请 3000 MiB 显存（可选）
          nvidia.com/gpucores: 30  # 每个 vGPU 使用约 30% 算力（可选）
```

| 资源名 | 含义 |
|--------|------|
| `nvidia.com/gpu` | vGPU 个数 |
| `nvidia.com/gpumem` | 显存配额（MiB） |
| `nvidia.com/gpucores` | 算力百分比（相对整卡） |

相对 Time-Slicing，HAMi 补上了 **显存 / 算力隔离**，在开源方案里属于较完整的一类。

### 2.2 Design：vCUDA 拦截

隔离主要靠 **vCUDA**：用自研 CUDA 相关库替换 / 拦截原生路径，对 API 做限制。

![HAMi-Core 设计](/images/k8s-gpu/22-HAMi/hami-core-design.png)

*图：通过拦截 CUDA / NVML 相关 API 实现配额与可见性隔离*

举例：

- 原生 CUDA：物理显存真用尽才 OOM
- HAMi：用量超过 Pod Resource 里申请的显存，即可返回 OOM

执行 `nvidia-smi` 时，也尽量只展示该 Pod 申请到的配额（例如显存总量显示为 3000MiB），而不是整张物理卡。

> 需要对 CUDA、NVML 的部分 API 做拦截；兼容性会随 CUDA / 驱动 / 框架版本变化，生产前建议做回归。

## 3. 部署

HAMi 提供 Helm Chart，流程不复杂。

### 3.1 先部署 GPU Operator

HAMi 依赖 NVIDIA 那一套（驱动、Toolkit、基础 Device Plugin 生态等），建议先装 [GPU Operator](../device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)，再装 HAMi。

### 3.2 安装 HAMi

```bash
helm repo add hami-charts https://project-hami.github.io/HAMi/
helm repo update

# 查看集群版本，安装时指定调度器镜像 tag（示例为 v1.27.4）
kubectl version

helm install hami hami-charts/hami \
  --set scheduler.kubeScheduler.imageTag=v1.27.4 \
  -n kube-system
```

看到类似组件 Running 即可（名称可能随版本变化）：

```bash
kubectl get pods -n kube-system | grep hami
# hami-device-plugin-xxx   2/2  Running
# hami-scheduler-xxx       2/2  Running
```

### 3.3 常用自定义参数

官方配置说明可参考 [HAMi 配置文档](https://github.com/Project-HAMi/HAMi/blob/master/docs/config_cn.md)（路径以仓库为准）。安装时可用 `--set` 覆盖，例如：

```bash
helm install hami hami-charts/hami \
  --set devicePlugin.deviceMemoryScaling=5 \
  ...
```

| 参数 | 说明 |
|------|------|
| `devicePlugin.deviceSplitCount` | 整数，默认约 10。每张 GPU 最多同时承载的任务数上限 |
| `devicePlugin.deviceMemoryScaling` | 浮点，默认 1。显存缩放；可大于 1（虚拟显存，实验向） |
| `devicePlugin.migStrategy` | `none` / `mixed`；是否以及如何对接 MIG |
| `devicePlugin.disablecorelimit` | `true`/`false`，是否关闭算力限制 |
| `scheduler.defaultMem` | 未配显存时的默认显存（MB），常见默认 5000 |
| `scheduler.defaultCores` | 0–100；默认算力预留。0 表示可落到任意满足显存的卡；100 近似独享 |
| `scheduler.defaultGPUNum` | 未写 `nvidia.com/gpu` 但写了显存/算力相关 key 时，Webhook 可自动补的 GPU 个数 |
| `resourceName` / `resourceMem` / `resourceCores` 等 | 可自定义资源名；默认常见为 `nvidia.com/gpu`、`nvidia.com/gpumem`、`nvidia.com/gpucores` 等 |

容器内还可配：

| 环境变量 | 含义 |
|----------|------|
| `GPU_CORE_UTILIZATION_POLICY` | `default` / `force` / `disable`：算力限制策略 |
| `ACTIVE_OOM_KILLER` | `true`/`false`：超用显存是否终止进程 |

简单 Demo 可先默认参数安装。

## 4. 验证

### 4.1 查看 Node 上的 GPU 数量

类似 Time-Slicing「扩副本」，HAMi 默认常把一张物理卡扩成多份可调度资源。例如物理 1 卡、`deviceSplitCount=10` 时，Capacity 可能变成：

```yaml
capacity:
  nvidia.com/gpu: "10"
```

```bash
kubectl get node <node> -o yaml | grep capacity -A7
```

### 4.2 验证显存与算力限制

常用资源：

| 资源 | 示例 | 含义 |
|------|------|------|
| `nvidia.com/gpu` | `1` | vGPU 个数 |
| `nvidia.com/gpumem` | `3000` | 显存 MiB |
| `nvidia.com/gpumem-percentage` | `50` | 显存按百分比 |
| `nvidia.com/priority` | `0` 高 / `1` 低（默认常为 1） | 任务优先级 |

优先级行为（概念上）：

- **高优先级**：与其它高优先级共享时，算力可不严格按 `gpucores` 卡死；若节点上几乎只有高优任务，可能吃满可用资源
- **低优先级**：若它是该 GPU 上唯一任务，也可能不受 `gpucores` 严格限制；有争用时才更体现配额

测试 Pod：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  containers:
    - name: ubuntu-container
      image: ubuntu:18.04
      command: ["bash", "-c", "sleep 86400"]
      resources:
        limits:
          nvidia.com/gpu: 1
          nvidia.com/gpumem: 3000
          nvidia.com/gpucores: 30
```

```bash
kubectl apply -f gpu-test.yaml
kubectl get po
# gpu-pod   1/1  Running
```

进入容器看 `nvidia-smi`，显存总量应接近申请值（如 `3000MiB`），而不是整卡 15GiB：

```bash
kubectl exec -it gpu-pod -- nvidia-smi
```

输出中常能看到 HAMi-core 日志，例如：

```text
[HAMI-core Msg(...:libvgpu.c:836)]: Initializing.....
...
|   0  Tesla T4  ... |  0MiB / 3000MiB | ...
...
[HAMI-core Msg(...:multiprocess_memory_limit.c:434)]: Calling exit handler ...
```

说明容器侧已挂上 HAMi 的拦截库，并按配额展示 / 限制资源。

## 5. 小结

| 问题 | 答案 |
|------|------|
| 为什么要共享 / 切分？ | 默认 Device Plugin 下，物理 GPU 与 `nvidia.com/gpu` 近似 1:1 扣减，利用率上不去 |
| Time-Slicing 缺什么？ | 多 Pod 可共享，但通常缺显存 / 算力硬隔离 |
| HAMi 补什么？ | vGPU +（可选）`gpumem` / `gpucores` 等细粒度限制 |
| 实现思路？ | vCUDA（如 `libvgpu.so`）拦截 CUDA/NVML，超额则 OOM / 限制可见性 |

选型时可与 [整卡 / Time-Slicing / MPS / MIG 对比](./07-GPU%20整卡独占、Time-Slicing、MPS%20与%20MIG%20对比.md) 一起看：需要**软件级细配额、且卡型未必支持 MIG** 时，HAMi 往往更合适；要**硬件级隔离**则优先 MIG（A100/H100 等）。

装完后建议继续做隔离实测：[HAMi Core 与 Memory 隔离测试](./11-HAMi-Core与Memory隔离测试.md)。

## 6. 参考与致谢 {/* #参考与致谢 */}

- [Project-HAMi/HAMi](https://github.com/Project-HAMi/HAMi)
- [HAMi Helm 仓库](https://project-hami.github.io/HAMi/)

本文内容整理自 [意琦行 / KubeExplorer - 开源 vGPU 方案：HAMi,实现细粒度 GPU 切分](https://www.cnblogs.com/KubeExplorer/p/18913850)，并按本系列学习路线做了结构调整与补充。
