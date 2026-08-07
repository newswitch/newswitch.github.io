---
title: NVIDIA 驱动、CUDA 与容器运行时的关系
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "CUDA", "驱动", "Container Toolkit", "Device Plugin", "学习路线"]
---

# NVIDIA 驱动、CUDA 与容器运行时的关系

![封面：GPU 环境搭建](/images/k8s-gpu/04-驱动与CUDA/how-to-use-gpu.png)

本文梳理在物理机、Docker、Kubernetes 中使用 NVIDIA GPU 时，各组件分别做什么、怎么串起来。

## 1. 概述

仅以比较常见的 NVIDIA GPU 举例，系统为 Linux；其他厂家 GPU 设备，流程理论上类似。

**省流：**

- **物理机**：安装 GPU Driver 以及 CUDA Toolkit
- **Docker**：额外安装 `nvidia-container-toolkit`，并配置 Docker 使用 nvidia runtime
- **Kubernetes**：额外安装 Device Plugin，使 kubelet 能感知节点 GPU，从而由 Kubernetes 管理 GPU

> 说明：生产里在 Kubernetes 中使用，通常直接用 **GPU Operator**。本文为了搞清各组件作用，采用手动安装。下一篇见：[NVIDIA GPU Operator 架构与组件说明](../../../platform/gpu-cluster/device-runtime/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。

---

## 2. 物理机环境

物理机要使用 GPU，通常需要：

- `GPU Driver`
- `CUDA Toolkit`

二者关系如下图：

![CUDA 组件关系](/images/k8s-gpu/04-驱动与CUDA/components-of-cuda.png)

*图：GPU Driver 包含 GPU 驱动与 CUDA 驱动；CUDA Toolkit 包含 CUDA Runtime*

GPU 作为 PCIe 设备，可先用 `lspci` 确认是否有卡：

```bash
root@test:~# lspci | grep NVIDIA
3b:00.0 3D controller: NVIDIA Corporation TU104GL [Tesla T4] (rev a1)
86:00.0 3D controller: NVIDIA Corporation TU104GL [Tesla T4] (rev a1)
```

上例表示机器有两张 Tesla T4。

### 2.1 安装驱动

到 [NVIDIA 驱动下载](https://www.nvidia.com/Download/index.aspx) 下载对应显卡驱动：

![搜索并下载 GPU 驱动](/images/k8s-gpu/04-驱动与CUDA/search-gpu-driver.png)

得到类似 `NVIDIA-Linux-x86_64-550.54.14.run` 的安装包后执行：

```bash
sh NVIDIA-Linux-x86_64-550.54.14.run
```

进入图形化界面后，一般一路 yes / ok 即可。

检查是否安装成功：

```bash
nvidia-smi
```

正常输出类似：

```text
root@test:~ nvidia-smi
Wed Jul 10 05:41:52 2024
+---------------------------------------------------------------------------------------+
| NVIDIA-SMI 535.161.08             Driver Version: 535.161.08   CUDA Version: 12.2     |
|-----------------------------------------+----------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |         Memory-Usage | GPU-Util  Compute M. |
|                                         |                      |               MIG M. |
|=========================================+======================+======================|
|   0  Tesla T4                       On  | 00000000:3B:00.0 Off |                    0 |
| N/A   51C    P0              29W /  70W |  12233MiB / 15360MiB |      0%      Default |
|                                         |                      |                  N/A |
+-----------------------------------------+----------------------+----------------------+
|   1  Tesla T4                       On  | 00000000:86:00.0 Off |                    0 |
| N/A   49C    P0              30W /  70W |   6017MiB / 15360MiB |      0%      Default |
|                                         |                      |                  N/A |
+-----------------------------------------+----------------------+----------------------+
```

至此驱动已装好，系统能识别 GPU。右上角 **CUDA Version** 表示当前驱动**最高支持**的 CUDA 版本，不等于本机一定已安装该版本 Toolkit。

### 2.2 安装 CUDA Toolkit

深度学习程序通常依赖 CUDA，因此物理机上往往还要装 CUDA Toolkit。

到 [CUDA Toolkit 下载页](https://developer.nvidia.com/cuda-downloads) 选择操作系统和安装方式：

![下载 CUDA Toolkit](/images/k8s-gpu/04-驱动与CUDA/download-cuda-toolkit.png)

以 `.run` 为例：

```bash
# 下载安装文件
wget https://developer.download.nvidia.com/compute/cuda/12.2.0/local_installers/cuda_12.2.0_535.54.03_linux.run

# 开始安装
sudo sh cuda_12.2.0_535.54.03_linux.run
```

> 注意：前面已装过驱动，这里就**不要再装驱动**，只装 CUDA Toolkit 相关组件。

安装完成摘要类似：

```text
===========
= Summary =
===========
Driver:   Installed
Toolkit:  Installed in /usr/local/cuda-12.2/

Please make sure that
 -   PATH includes /usr/local/cuda-12.2/bin
 -   LD_LIBRARY_PATH includes /usr/local/cuda-12.2/lib64, or, add /usr/local/cuda-12.2/lib64 to /etc/ld.so.conf and run ldconfig as root
```

按提示配置环境变量：

```bash
export PATH=/usr/local/cuda-12.2/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda-12.2/lib64:$LD_LIBRARY_PATH
```

确认 `nvcc`：

```bash
nvcc -V
# nvcc: NVIDIA (R) Cuda compiler driver
# Cuda compilation tools, release 12.2, V12.2.91
```

### 2.3 测试

用简单的 PyTorch 程序检测 GPU / CUDA。调用链大致如下：

![物理机 CUDA 调用链](/images/k8s-gpu/04-驱动与CUDA/cuda-call-flow.png)

*图：应用 → CUDA Runtime / Driver → GPU*

`check_cuda_pytorch.py`：

```python
import torch

def check_cuda_with_pytorch():
    """检查 PyTorch CUDA 环境是否正常工作"""
    try:
        print("检查 PyTorch CUDA 环境:")
        if torch.cuda.is_available():
            print(f"CUDA 设备可用，当前 CUDA 版本是: {torch.version.cuda}")
            print(f"PyTorch 版本是: {torch.__version__}")
            print(f"检测到 {torch.cuda.device_count()} 个 CUDA 设备。")
            for i in range(torch.cuda.device_count()):
                print(f"设备 {i}: {torch.cuda.get_device_name(i)}")
                print(
                    f"设备 {i} 的显存总量: "
                    f"{torch.cuda.get_device_properties(i).total_memory / (1024 ** 3):.2f} GB"
                )
                print(
                    f"设备 {i} 的显存当前使用量: "
                    f"{torch.cuda.memory_allocated(i) / (1024 ** 3):.2f} GB"
                )
                print(
                    f"设备 {i} 的显存最大使用量: "
                    f"{torch.cuda.memory_reserved(i) / (1024 ** 3):.2f} GB"
                )
        else:
            print("CUDA 设备不可用。")
    except Exception as e:
        print(f"检查 PyTorch CUDA 环境时出现错误: {e}")

if __name__ == "__main__":
    check_cuda_with_pytorch()
```

```bash
pip install torch
python3 check_cuda_pytorch.py
```

正常输出类似：

```text
检查 PyTorch CUDA 环境:
CUDA 设备可用，当前 CUDA 版本是: 12.1
PyTorch 版本是: 2.3.0+cu121
检测到 1 个 CUDA 设备。
设备 0: Tesla T4
设备 0 的显存总量: 14.75 GB
设备 0 的显存当前使用量: 0.00 GB
设备 0 的显存最大使用量: 0.00 GB
```

---

## 3. Docker 环境

宿主机已有驱动（以及可选的 Toolkit）后，要让 Docker 容器也能用 GPU，大致三步：

1. 安装 `nvidia-container-toolkit`
2. 配置 Docker 使用 `nvidia` runtime
3. 启动容器时加 `--gpus` 参数

### 3.1 安装 nvidia-container-toolkit

**NVIDIA Container Toolkit** 的主要作用是把 NVIDIA GPU 设备挂进容器，并兼容 Docker、containerd、CRI-O 等运行时。

官方文档：[Container Toolkit Install Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

Ubuntu 示例：

```bash
# 1. Configure the production repository
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
  && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

# 2. Update & install
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

### 3.2 配置 nvidia runtime

旧版可手动改 `/etc/docker/daemon.json`：

```json
{
  "runtimes": {
    "nvidia": {
      "args": [],
      "path": "nvidia-container-runtime"
    }
  }
}
```

新版可用 `nvidia-ctk` 一键配置：

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 3.3 原理与测试

安装 toolkit 后，调用链变为：

![nvidia-container-runtime 调用链](/images/k8s-gpu/04-驱动与CUDA/nv-container-runtime-call-flow.png)

*图：containerd → nvidia-container-runtime → runC*

`nvidia-container-runtime` 拦截容器 spec，注入 GPU 相关配置后再交给 runC。

容器内 CUDA 调用关系大致如下：

![容器中的 CUDA 调用](/images/k8s-gpu/04-驱动与CUDA/cuda-call-in-container.png)

*图：CUDA Toolkit 可放在容器镜像里；宿主机侧关键是驱动 + Container Toolkit*

因此：**宿主机不一定非要再装一套 CUDA Toolkit**，用带 CUDA 的镜像即可。

`--gpus` 常用写法：

- `--gpus all`：所有 GPU
- `--gpus "device=<id>[,<id>...]"`：按 ID 指定，例如 `--gpus "device=0"`
- GPU 编号用宿主机 `nvidia-smi` 查看

测试：

```bash
docker run --rm --gpus all \
  nvidia/cuda:12.0.1-runtime-ubuntu22.04 \
  nvidia-smi
```

正常应能在容器内打印 GPU 信息。

---

## 4. Kubernetes 环境

在 Kubernetes 里使用 GPU，通常还需要：

- **Device Plugin**：以 DaemonSet 跑在各节点，感知 GPU，让集群能调度、分配
- **GPU Exporter（如 DCGM Exporter）**：监控 GPU

手动安装与 GPU Operator 对比：

![手动安装 vs GPU Operator](/images/k8s-gpu/04-驱动与CUDA/k8s-gpu-manual-install-vs-gpu-operator.png)

*图：左为手动安装 Device Plugin + 监控；右为 GPU Operator 统一管理。本篇先看左侧。*

### 4.1 工作流程

1. 各节点 kubelet 维护本节点 GPU 状态并上报；调度器知道每节点可用 GPU 数
2. 调度器为 Pod 选择符合条件的节点
3. Pod 落到节点后，kubelet 分配 GPU 设备 ID，交给 NVIDIA Device Plugin
4. Device Plugin 把 GPU ID 写入环境变量 `NVIDIA_VISIBLE_DEVICES`，返回给 kubelet
5. kubelet 启动容器
6. NVIDIA Container Toolkit 发现 `NVIDIA_VISIBLE_DEVICES`，按值把对应 GPU 挂进容器

对比：Docker 用 `--gpus` **手动指定**；Kubernetes 由 Device Plugin **自动分配**。

### 4.2 安装 Device Plugin

以 [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin) 为例：

```bash
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.15.0/deployments/static/nvidia-device-plugin.yml
```

```bash
kubectl get po -l app=nvidia-device-plugin-daemonset
NAME                                   READY   STATUS    RESTARTS   AGE
nvidia-device-plugin-daemonset-7nkjw   1/1     Running   0          10m
```

Device Plugin 会把 GPU 上报给 kubelet，最终出现在 Node 资源中：

```bash
kubectl describe node test | grep Capacity -A7
Capacity:
  cpu:                48
  ephemeral-storage:  460364840Ki
  hugepages-1Gi:      0
  hugepages-2Mi:      0
  memory:             98260824Ki
  nvidia.com/gpu:     2
  pods:               110
```

`nvidia.com/gpu: 2` 表示该节点有 2 张 GPU。

### 4.3 安装 GPU 监控

可用 DCGM Exporter 对接 Prometheus：

```bash
helm repo add gpu-helm-charts \
  https://nvidia.github.io/dcgm-exporter/helm-charts
helm repo update

helm install \
  --generate-name \
  gpu-helm-charts/dcgm-exporter
```

查看 metrics：

```bash
curl -sL http://127.0.0.1:8080/metrics
```

示例：

```text
# HELP DCGM_FI_DEV_SM_CLOCK SM clock frequency (in MHz).
# TYPE DCGM_FI_DEV_SM_CLOCK gauge
DCGM_FI_DEV_SM_CLOCK{gpu="0",UUID="GPU-604ac76c-d9cf-fef3-62e9-d92044ab6e52",container="",namespace="",pod=""} 139
DCGM_FI_DEV_MEM_CLOCK{gpu="0",UUID="GPU-604ac76c-d9cf-fef3-62e9-d92044ab6e52",container="",namespace="",pod=""} 405
```

### 4.4 测试

在 `resources.limits` 中申请 GPU：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  restartPolicy: Never
  containers:
    - name: cuda-container
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda10.2
      resources:
        limits:
          nvidia.com/gpu: 1
```

```bash
kubectl apply -f gpu-pod.yaml
kubectl logs gpu-pod
```

正常日志：

```text
[Vector addition of 50000 elements]
Copy input data from the host memory to the CUDA device
CUDA kernel launch with 196 blocks of 256 threads
Copy output data from the CUDA device to the host memory
Test PASSED
Done
```

---

## 5. 小结

| 环境 | 关键组件 | 作用 |
|------|----------|------|
| 物理机 | GPU Driver + CUDA Toolkit | 识别设备、提供 CUDA 能力 |
| Docker | + nvidia-container-toolkit / nvidia runtime | 把 GPU 挂进容器；镜像可自带 CUDA Runtime |
| Kubernetes | + Device Plugin（及可选 DCGM Exporter） | 让 kubelet / 调度器感知并分配 `nvidia.com/gpu` |

集群规模一大，手动装驱动、Toolkit、Plugin 会很繁琐。下一篇用 **GPU Operator** 把这些自动化：[NVIDIA GPU Operator 架构与组件说明](../../../platform/gpu-cluster/device-runtime/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。

---

## 参考与致谢

本文内容整理自 [意琦行 - GPU 环境搭建指南：如何在物理机、Docker、K8s 等环境中使用 GPU](https://www.lixueduan.com/posts/ai/01-how-to-use-gpu/)，并按本系列学习路线做了结构调整与补充。原文采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。
