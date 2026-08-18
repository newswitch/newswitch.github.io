---
title: "HAMi Core 与 Memory 隔离测试"
sidebar_label: "11. HAMi Core 与 Memory 隔离测试"
sidebar_position: 11
description: "上一篇 HAMi vGPU 原理与实践 介绍了安装与基本用法。本文对 GPU Core / Memory 隔离做实测验证。"
tags: ["Kubernetes", "GPU", "HAMi", "vGPU", "隔离测试", "学习路线"]
date: 2026-07-22 16:30:00
categories: 云原生
---

# HAMi Core 与 Memory 隔离测试

![封面：HAMi 隔离测试](/images/k8s-gpu/22-HAMi/hami-isolation-test.jpg)

上一篇 [HAMi vGPU 原理与实践](./10-HAMi%20vGPU%20原理与实践.md) 介绍了安装与基本用法。本文对 **GPU Core / Memory 隔离**做实测验证。

**省流：**

| 能力 | 结论 |
|------|------|
| Core 隔离 | 利用率会围绕设定值波动，一段时间平均后大致等于申请的 `gpucores` |
| Memory 隔离 | 超过 `gpumem` 配额时会直接 CUDA OOM |

## 1. 环境准备

测试环境示例：

| 项 | 版本 / 规格 |
|----|-------------|
| GPU | A40 × 2 |
| Kubernetes | v1.23.17 |
| HAMi | v2.3.13 |

### 1.1 前置

1. 用 [GPU Operator](../device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md) 装好驱动 / Toolkit 等
2. 按 [HAMi 原理与实践](./10-HAMi%20vGPU%20原理与实践.md) 安装 HAMi

### 1.2 测试镜像与脚本

```bash
docker pull pytorch/pytorch:2.4.1-cuda11.8-cudnn9-runtime
```

算力压测可用 PyTorch Examples 的 ImageNet 训练 Demo（会打印每步耗时；算力越低，单步越慢）：

```bash
git clone https://github.com/pytorch/examples.git
cd examples/imagenet
python main.py -a resnet18 --dummy
```

### 1.3 关键配置：强制算力限制

需要在 Pod 中设置：

```yaml
env:
  - name: GPU_CORE_UTILIZATION_POLICY
    value: "force"
```

默认策略下，**该 GPU 上只有一个 Pod 时往往不做算力限制**（闲置算力尽量吃满，提高利用率）。要验证隔离，必须 `force`。

### 1.4 完整测试 YAML（30% 算力示例）

用 hostPath 挂载 `imagenet` 代码目录，command 直接跑训练：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hami-30
  namespace: default
spec:
  restartPolicy: Never
  containers:
    - name: simple-container
      image: pytorch/pytorch:2.4.1-cuda11.8-cudnn9-runtime
      command:
        - python
        - /mnt/imagenet/main.py
        - -a
        - resnet18
        - --dummy
      resources:
        requests:
          cpu: "4"
          memory: "32Gi"
          nvidia.com/gpu: "1"
          nvidia.com/gpucores: "30"
          nvidia.com/gpumem: "20000"
        limits:
          cpu: "4"
          memory: "32Gi"
          nvidia.com/gpu: "1"
          nvidia.com/gpucores: "30"   # 30% 算力
          nvidia.com/gpumem: "20000"  # 20GiB 显存（单位 MB）
      env:
        - name: GPU_CORE_UTILIZATION_POLICY
          value: "force"
      volumeMounts:
        - name: imagenet-volume
          mountPath: /mnt/imagenet
        - name: shm-volume
          mountPath: /dev/shm
  volumes:
    - name: imagenet-volume
      hostPath:
        path: /root/lixd/hami/examples/imagenet  # 按实际路径修改
        type: Directory
    - name: shm-volume
      emptyDir:
        medium: Memory
```

测 60% 时，把 `name` 改成 `hami-60`，并把 `nvidia.com/gpucores` 改为 `"60"` 即可。

## 2. Core 隔离测试

### 2.1 gpucores = 30%

稳定后单步耗时大约在 **0.6s** 量级（节选）：

```text
[HAMI-core Msg(...)]: Initializing.....
=> creating model 'resnet18'
=> Dummy data is used!
Epoch: [0][  11/5005]  Time  0.605 ( 0.806)  ...
Epoch: [0][  51/5005]  Time  0.611 ( 0.645)  ...
Epoch: [0][ 101/5005]  Time  0.616 ( 0.626)  ...
Epoch: [0][ 151/5005]  Time  0.608 ( 0.617)  ...
```

Grafana / 监控上的 GPU 利用率：

![30% 算力隔离](/images/k8s-gpu/22-HAMi/hami-isolation-test1.png)

*图：利用率围绕 30% 波动，一段时间平均大致落在设定值附近*

### 2.2 gpucores = 60%

稳定后单步耗时大约在 **0.3s** 量级：

```text
Epoch: [0][  11/5005]  Time  0.227 ( 0.597)  ...
Epoch: [0][  51/5005]  Time  0.627 ( 0.327)  ...
Epoch: [0][ 101/5005]  Time  0.365 ( 0.280)  ...
Epoch: [0][ 151/5005]  Time  0.367 ( 0.289)  ...
```

对比：

| gpucores | 单步耗时（约） | 相对关系 |
|----------|----------------|----------|
| 30% | ~0.6s | 基准 |
| 60% | ~0.3s | 约快一倍，与算力翻倍相符 |

利用率曲线：

![60% 算力隔离](/images/k8s-gpu/22-HAMi/hami-isolation-test2.png)

*图：利用率围绕 60% 波动，平均与设定基本一致*

## 3. Memory 隔离测试

将 `nvidia.com/gpumem` 设为 **20000**（MB）。容器内 `nvidia-smi` 应显示总量约为 20000MiB，而不是整卡容量：

```text
|   0  NVIDIA A40  ... |  0MiB / 20000MiB | ...
```

> 原文个别 YAML 片段曾写成 `200000`，与实测 `20000MiB` 不一致；以配额 **20000**、以及下面 OOM 测试为准。

### 3.1 压测脚本

```python
import torch
import sys

def allocate_memory(memory_size_mb):
    num_elements = memory_size_mb * 1024 * 1024 // 4  # float32 = 4 bytes
    try:
        print(f"Attempting to allocate {memory_size_mb} MB on GPU...")
        x = torch.empty(num_elements, dtype=torch.float32, device="cuda")
        print(f"Successfully allocated {memory_size_mb} MB on GPU.")
    except RuntimeError as e:
        print(f"Failed to allocate {memory_size_mb} MB on GPU: OOM.")
        print(e)

if __name__ == "__main__":
    memory_size_mb = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
    allocate_memory(memory_size_mb)
```

### 3.2 结果

申请 **20000 MB**（顶满配额）：

```text
Attempting to allocate 20000 MB on GPU...
[HAMI-core ERROR (... allocator.c:49)]: Device 0 OOM 21244149760 / 20971520000
Failed to allocate 20000 MB on GPU: OOM.
```

申请 **19500 MB**：

```text
Attempting to allocate 19500 MB on GPU...
Successfully allocated 19500 MB on GPU.
```

说明 Memory 隔离生效：顶满或略超配额会 OOM，略留余量可成功分配。

## 4. 小结

| 测试项 | 现象 | 结论 |
|--------|------|------|
| Core 30% | 单步 ~0.6s，利用率在 30% 附近波动 | 平均算力受控 |
| Core 60% | 单步 ~0.3s，利用率在 60% 附近波动 | 与 30% 对比符合预期 |
| Memory 20000 | `nvidia-smi` 显示 20000MiB；alloc 20000 OOM、19500 成功 | 超额直接 OOM |

整体上，HAMi 的 Core / Memory 隔离**基本符合预期**：

- **Core**：瞬时会抖，但一段时间平均贴近 `gpucores`
- **Memory**：超过 `gpumem` 会走 CUDA OOM，而不是一直抢到物理卡打满

生产验证时注意：

1. 单租户场景记得设 `GPU_CORE_UTILIZATION_POLICY=force`，否则可能测不出算力限制
2. 显存测试留一点余量（元数据 / 对齐 / 其它开销），不要卡死在配额整数上
3. 结合 DCGM / Grafana 看一段窗口的平均值，比看单个瞬时点更有意义

## 5. 参考与致谢 {/* #参考与致谢 */}

本文内容整理自 [意琦行 / KubeExplorer - 开源 vGPU 方案 HAMi: core&memory 隔离测试](https://www.cnblogs.com/KubeExplorer/p/18964975)，并按本系列学习路线做了结构调整与补充。前置阅读：[HAMi vGPU 原理与实践](./10-HAMi%20vGPU%20原理与实践.md)。
