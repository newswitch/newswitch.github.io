---
title: NVIDIA GPU Operator 架构与组件说明
sidebar_label: "05. NVIDIA GPU Operator 架构与组件说明"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "NFD", "GFD", "Device Plugin", "学习路线"]
---

# NVIDIA GPU Operator 架构与组件说明

![封面：GPU Operator](/images/k8s-gpu/09-GPU-Operator/gpu-operator.jpg)

上一篇 [NVIDIA 驱动、CUDA 与容器运行时的关系](../../driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md) 讲了裸机 / Docker / Kubernetes 手动用 GPU 的路径。流程不复杂，但节点上要装驱动、Container Toolkit、Device Plugin 等，集群一大就很麻烦。

**GPU Operator** 的目标，就是在 Kubernetes 里把这些步骤自动化：驱动安装、Container Toolkit、Device Plugin、监控等一并管起来。

> 目前主要面向 **NVIDIA GPU**；其他厂商多数仍需手动安装相关组件。

---

## 1. 组件一览

| 组件 | 作用 |
|------|------|
| **NFD**（Node Feature Discovery） | 给节点打标签（CPU、内核、OS、是否 GPU 节点等） |
| **GFD**（GPU Feature Discovery） | 收集 GPU 属性（驱动版本、型号等）并以节点标签透出 |
| **NVIDIA Driver Installer** | 以容器方式在节点上安装 GPU 驱动 |
| **NVIDIA Container Toolkit Installer** | 让容器能使用 GPU |
| **NVIDIA Device Plugin** | 把 GPU 以 Kubernetes 扩展资源暴露给用户 |
| **DCGM Exporter** | 采集 GPU 状态并暴露 Prometheus Metrics |

要点：

- NFD / GFD：发现节点与 GPU 信息，写成 Label
- 关注标签：`nvidia.com/gpu.present=true` → 该节点视为 GPU 节点，后续 DaemonSet 才会上调度
- Driver / Toolkit Installer：自动装驱动与 Container Toolkit
- Device Plugin：让 Kubernetes 感知 `nvidia.com/gpu` 便于调度
- DCGM Exporter：GPU 监控指标

> 较新版本中，GFD 能力已整合进 [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)。

GPU Operator 大致按依赖顺序部署；前一关键组件失败时，后续往往停止继续部署：

```text
NVIDIA Driver Installer
  → NVIDIA Container Toolkit Installer
  → NVIDIA Device Plugin
  → DCGM Exporter
  → GFD
```

各组件多以 DaemonSet 部署，且通常只有节点存在 `nvidia.com/gpu.present=true` 时才会在该节点运行。

驱动是否由 Operator 安装，常见标签：

- `nvidia.com/gpu.deploy.driver=true`：需要 Operator 安装驱动
- `nvidia.com/gpu.deploy.driver=pre-installed`：节点已预装驱动，Driver DaemonSet 不在该节点跑安装逻辑

---

## 2. NFD 与 GFD

根据名称即可理解：发现节点 / GPU 信息，并以 Label 写到 Node 上。

**NFD** 标签多以 `feature.node.kubernetes.io` 为前缀：

```text
feature.node.kubernetes.io/cpu-cpuid.ADX=true
feature.node.kubernetes.io/system-os_release.ID=ubuntu
feature.node.kubernetes.io/system-os_release.VERSION_ID.major=22
feature.node.kubernetes.io/system-os_release.VERSION_ID.minor=04
feature.node.kubernetes.io/system-os_release.VERSION_ID=22.04
```

**GFD** 主要记录 GPU 信息，例如：

```text
nvidia.com/cuda.runtime.major=12
nvidia.com/cuda.runtime.minor=2
nvidia.com/cuda.driver.major=535
nvidia.com/cuda.driver.minor=161
nvidia.com/gpu.product=Tesla-T4
nvidia.com/gpu.memory=15360
```

---

## 3. Driver Installer（概念）

NVIDIA 提供基于容器安装驱动的方式，GPU Operator 也采用这种方式。容器化安装后架构大致如下：

![容器化驱动架构](/images/k8s-gpu/09-GPU-Operator/gpu-operator-driver-container.png)

*图：基于容器安装 NVIDIA 驱动后的架构示意*

对应 DaemonSet 名称类似：

```text
nvidia-driver-daemonset-5.15.0-105-generic-ubuntu22.04
```

镜像示例：

```bash
kubectl get ds nvidia-driver-daemonset-5.15.0-105-generic-ubuntu22.04 -o yaml | grep image
# image: nvcr.io/nvidia/driver:535-5.15.0-105-generic-ubuntu22.04
```

名称 / 镜像通常由几部分组成：

| 部分 | 含义 | 如何查看 |
|------|------|----------|
| `nvidia-driver-daemonset` | 前缀 | — |
| `5.15.0-105-generic` | 内核版本 | `uname -r` |
| `ubuntu22.04` | 操作系统 | `cat /etc/os-release` |
| `535` | Driver 版本 | 部署时可指定 |

因为是 DaemonSet，各节点跑同一类 Pod，**若由 Operator 统一装驱动，通常要求 GPU 节点 OS / 内核一致**。

> 若节点已手动预装驱动，Operator 检测到后一般不再在该节点启动 Installer Pod，这类节点可不强制与其他节点 OS/内核完全一致。

不是每种「OS + 内核」都有现成镜像，可提前在 [NVIDIA driver tags](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/driver/tags) 查看。

---

## 4. Container Toolkit Installer（概念）

手动安装通常两步：

1. 安装 NVIDIA Container Toolkit  
2. 修改 Runtime，使用 `nvidia` runtime  

调用链中会插入 `nvidia-container-runtime`：

![nvidia-container-runtime 调用链](/images/k8s-gpu/09-GPU-Operator/nv-container-runtime-call-flow.png)

Installer 自动化的大致动作：

1. 把 Toolkit 相关命令行与库放到如 `/usr/local/nvidia/toolkit`
2. 生成 `nvidia-container-runtime` 的 `config.toml`，并设置 `nvidia-container-cli.root`（常见为 `/run/nvidia/driver`）

---

## 5. 部署

参考官方：[GPU Operator Getting Started](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)。

### 5.1 准备工作

1. **GPU 节点操作系统尽量一致**  
   - 预装驱动的节点可使用不同 OS  
   - CPU 节点无此要求  

2. **GPU 节点使用相同容器引擎**（都是 containerd 或都是 Docker）

3. **若启用 PSA**，给 `gpu-operator` 命名空间放开特权：

```bash
kubectl create ns gpu-operator
kubectl label --overwrite ns gpu-operator \
  pod-security.kubernetes.io/enforce=privileged
```

4. **集群中不要重复装 NFD**；若已有 NFD，安装时禁用 Operator 自带 NFD。

检查是否已有 NFD 相关标签：

```bash
kubectl get nodes -o json \
  | jq '.items[].metadata.labels | keys | any(startswith("feature.node.kubernetes.io"))'
```

返回 `true` 通常说明已有 NFD。

### 5.2 Helm 安装

```bash
# 添加仓库
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia \
  && helm repo update

# 默认配置安装（由 Operator 管理驱动）
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator

# 若节点已手动安装驱动，关闭 Operator 内驱动安装
helm install --wait --generate-name \
  -n gpu-operator --create-namespace \
  nvidia/gpu-operator \
  --set driver.enabled=false
```

若已有 NFD，可同时：

```bash
--set nfd.enabled=false
```

驱动相关标签：

- 未装驱动：`nvidia.com/gpu.deploy.driver=true`
- 已预装：`nvidia.com/gpu.deploy.driver=pre-installed`（Driver DaemonSet 不在该节点跑安装）

### 5.3 验证

查看 `gpu-operator` 命名空间 Pod，除个别 `Completed`（如 validator）外，其余多为 `Running`：

```bash
kubectl -n gpu-operator get po
```

示例：

```text
NAME                                                           READY   STATUS      RESTARTS   AGE
gpu-feature-discovery-jdqpb                                    1/1     Running     0          35d
gpu-operator-67f8b59c9b-k989m                                  1/1     Running     6          35d
nfd-node-feature-discovery-worker-sqb7x                        1/1     Running     6          35d
nvidia-container-toolkit-daemonset-rqgtv                       1/1     Running     0          35d
nvidia-cuda-validator-9kqnf                                    0/1     Completed   0          35d
nvidia-dcgm-exporter-8mb6v                                     1/1     Running     0          35d
nvidia-device-plugin-daemonset-7nkjw                           1/1     Running     0          35d
nvidia-driver-daemonset-5.15.0-105-generic-ubuntu22.04-g5dgx   1/1     Running     5          35d
nvidia-operator-validator-6mqlm                                1/1     Running     0          35d
```

进入 Driver DaemonSet Pod 执行 `nvidia-smi`：

```bash
kubectl -n gpu-operator exec -it \
  nvidia-driver-daemonset-5.15.0-105-generic-ubuntu22.04-g5dgx \
  -- nvidia-smi
```

确认 Node Capacity / Allocatable 含 GPU：

```bash
kubectl get node <gpu-node> -o yaml | grep -A20 'capacity:'
```

应能看到类似：

```yaml
capacity:
  nvidia.com/gpu: "1"
allocatable:
  nvidia.com/gpu: "1"
```

测试 Pod：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: cuda-vectoradd
spec:
  restartPolicy: OnFailure
  containers:
    - name: cuda-vectoradd
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda11.7.1-ubuntu20.04
      resources:
        limits:
          nvidia.com/gpu: 1
```

```bash
kubectl logs pod/cuda-vectoradd
# Test PASSED
```

---

## 6. 原理：Driver Installer

### 6.1 安装过程

Pod 日志可见：先装驱动内核模块，再 `modprobe` 加载，最后挂载 driver rootfs。示意：

```text
========== NVIDIA Software Installer ==========
Starting installation of NVIDIA driver branch 535 for Linux kernel version 5.15.0-105-generic
...
Installing NVIDIA driver kernel modules...
...
Loading NVIDIA driver kernel modules...
+ modprobe nvidia
+ modprobe nvidia-uvm
+ modprobe nvidia-modeset
Starting NVIDIA persistence daemon...
Mounting NVIDIA driver rootfs...
Done, now waiting for signal
```

为在容器里装驱动，Pod 通过 **hostPath** 挂载宿主机相关目录，例如：

```yaml
volumes:
  - name: run-nvidia
    hostPath:
      path: /run/nvidia
      type: DirectoryOrCreate
  - name: host-os-release
    hostPath:
      path: /etc/os-release
  - name: run-nvidia-validations
    hostPath:
      path: /run/nvidia/validations
      type: DirectoryOrCreate
  - name: sys
    hostPath:
      path: /sys
      type: Directory
```

### 6.2 镜像构建思路

可参考官方 Dockerfile，例如 CentOS8：

[https://gitlab.com/nvidia/container-images/driver/-/blob/master/centos8/Dockerfile](https://gitlab.com/nvidia/container-images/driver/-/blob/master/centos8/Dockerfile)

构建阶段关键点：下载驱动 `.run`，并用 `--no-kernel-module` **只装 userspace**，把内核相关文件放到 `/usr/src/nvidia-$DRIVER_VERSION`，入口为 `nvidia-driver init`。

运行时脚本 `init()` 大致流程：

1. `_unload_driver` / `_unmount_rootfs`
2. 如需要则编译 / 准备内核包
3. `_install_driver`（`--kernel-module-only`，只装内核模块）
4. `_load_driver`
5. `_mount_rootfs`
6. `sleep infinity` 等待信号

`_install_driver` 示意：

```bash
_install_driver() {
    echo "Installing NVIDIA driver kernel modules..."
    cd /usr/src/nvidia-${DRIVER_VERSION}
    nvidia-installer --kernel-module-only --no-drm --ui=none --no-nouveau-check ...
}
```

> 容器方式装驱动相对快，是因为 userspace 在**构建镜像时**已经装好，运行时主要处理内核模块。

`_load_driver`：

```bash
_load_driver() {
    modprobe -a i2c_core ipmi_msghandler ipmi_devintf
    modprobe -a nvidia nvidia-uvm nvidia-modeset
    nvidia-persistenced --persistence-mode
}
```

`_mount_rootfs`：把驱动 rootfs 挂到 run 目录，供 Toolkit 使用：

```bash
_mount_rootfs() {
    mount --make-runbindable /sys
    mount --make-private /sys
    mkdir -p ${RUN_DIR}/driver
    mount --rbind / ${RUN_DIR}/driver
}
```

卸载则大致是相反操作。

---

## 7. 原理：Container Toolkit Installer

### 7.1 安装过程

对应 DaemonSet：`nvidia-container-toolkit-daemonset`。

启动命令类似：

```yaml
containers:
  - command: ["/bin/bash", "-c"]
    args: ["/bin/entrypoint.sh"]
```

`entrypoint.sh` 通常来自 ConfigMap `nvidia-container-toolkit-entrypoint`，核心是设置驱动根路径后执行 `nvidia-toolkit`：

```bash
#!/bin/bash
set -e
driver_root=/run/nvidia/driver
driver_root_ctr_path=$driver_root
if [[ -f /run/nvidia/validations/host-driver-ready ]]; then
  driver_root=/
  driver_root_ctr_path=/host
fi
export NVIDIA_DRIVER_ROOT=$driver_root
export DRIVER_ROOT_CTR_PATH=$driver_root_ctr_path
sleep 5   # 规避部分 containerd 版本的重启竞态
exec nvidia-toolkit
```

同样通过 hostPath 改宿主机内容，常见挂载包括：

```yaml
volumes:
  - name: nvidia-run-path
    hostPath:
      path: /run/nvidia
      type: DirectoryOrCreate
  - name: toolkit-install-dir
    hostPath:
      path: /usr/local/nvidia
  - name: docker-config
    hostPath:
      path: /etc/docker
      type: DirectoryOrCreate
  - name: docker-socket
    hostPath:
      path: /var/run
```

Pod 日志可见两步：**安装 toolkit** → **Setup runtime**。装完后 `/etc/docker/daemon.json` 可能变为：

```json
{
  "default-runtime": "nvidia",
  "runtimes": {
    "nvidia": {
      "args": [],
      "path": "/usr/local/nvidia/toolkit/nvidia-container-runtime"
    }
  }
}
```

`config.toml` 中常见：

```toml
[nvidia-container-cli]
  root = "/run/nvidia/driver"
  path = "/usr/local/nvidia/toolkit/nvidia-container-cli"
```

### 7.2 代码与镜像

Installer 实现已合并到 [nvidia-container-toolkit](https://github.com/NVIDIA/nvidia-container-toolkit) 的 tools 目录，按 Runtime 区分（如 containerd 的 `containerd.go`）：

- **Setup**：写入 nvidia runtime 并 reload / restart
- **Cleanup**：撤销 nvidia runtime 配置

镜像侧主要是编译 `nvidia-toolkit` 二进制，并安装 `libnvidia-container` / `nvidia-container-toolkit` 等 RPM 依赖，入口为 `/work/nvidia-toolkit`。

---

## 8. 小结

GPU Operator 把 Driver、Container Toolkit、Device Plugin、Exporter 等自动化，能快速在 Kubernetes 里用上 GPU；理解 Driver Installer 与 Toolkit Installer 的原理，有助于排障与选型。

但也有约束：

1. **Driver Installer** 镜像由「驱动 + 内核 + OS」拼接，由 Operator 统一装驱动时，通常要求 GPU 节点 OS/内核一致  
2. **Toolkit Installer** 需对接具体 Runtime，GPU 节点一般也要使用相同容器运行时  

预装驱动（`pre-installed`）可在 OS/内核一致性上更灵活，这也是生产里常见的两种驱动管理模式之一。

---

## 参考与致谢

- [NVIDIA GPU Operator Getting Started](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)
- [About the NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/index.html)
- [nvidia-container-toolkit](https://github.com/NVIDIA/nvidia-container-toolkit)

本文内容整理自 [意琦行 - GPU 环境搭建指南：使用 GPU Operator 加速 Kubernetes GPU 环境搭建](https://www.lixueduan.com/posts/ai/02-gpu-operator/)，并按本系列学习路线做了结构调整与补充。原文采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。
