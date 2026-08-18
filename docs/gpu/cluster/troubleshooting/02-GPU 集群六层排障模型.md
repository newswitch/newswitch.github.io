---
title: "GPU 集群六层排障模型"
sidebar_label: "02. GPU 集群六层排障模型"
sidebar_position: 2
description: "说明：下文「六层」是为运维定位归纳的方法，不是 Kubernetes 或 NVIDIA 官方固定标准。示例以 NVIDIA GPU、GPU Operator、containerd、PyTorch/vLLM 与 Kubernetes 为主。"
tags: ["Kubernetes", "GPU", "排障", "运维", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# GPU 集群六层排障模型

> **说明**：下文「六层」是为运维定位归纳的方法，**不是** Kubernetes 或 NVIDIA 官方固定标准。示例以 NVIDIA GPU、GPU Operator、containerd、PyTorch/vLLM 与 Kubernetes 为主。

常见现象（Pending、容器看不到 GPU、`nvidia-smi` 失败、CUDA OOM、掉卡、服务起不来、NotReady）可能来自完全不同的层级。例如容器内 `nvidia-smi` 失败，可能是硬件掉卡、驱动、NVML、Toolkit、Device Plugin、未申请 GPU，或镜像根本没有该命令。没有固定顺序时，容易在 YAML、驱动和应用参数间反复跳转。

从物理 GPU 到应用，确实存在硬件 → 驱动 → 运行时 → 设备插件 → 调度 → 应用的链路（Device Plugin 发布扩展资源，Pod 再请求 `nvidia.com/gpu` 等）。本篇把排查压成六层，**从下向上验证**。

## 1. 学习目标

建立稳定排查顺序；判断属硬件/驱动还是 K8s；用最小测试逐层验证；避免底层异常时反复改业务 YAML；建立证据模板；区分临时恢复与永久修复。

## 2. 六层结构

```text
第六层：CUDA 应用与 AI 框架（PyTorch / vLLM / NCCL / 模型参数）
第五层：Kubernetes 调度（Pod、资源、标签、污点、队列）
第四层：GPU 管理组件（GPU Operator、Device Plugin）
第三层：容器运行时（containerd、Toolkit、CDI）
第二层：驱动与 NVML（内核模块、设备文件、动态库）
第一层：服务器与 GPU 硬件（PCIe、电源、温度、ECC、Xid）
```

原则：**先证明底层正常，再排上层**；不要从应用参数直接跳到硬件结论。

## 3. 各层要点

### 3.1 第一层：硬件与服务器 {/* #第一层硬件与服务器 */}

`lspci` 是否还能看到全部 GPU？温度/功耗/ECC/PCIe 是否正常？

```bash
lspci -nn | grep -i nvidia
dmesg -T | grep -Ei 'NVRM|Xid|PCIe|AER|nvidia'
nvidia-smi -q -d TEMPERATURE,POWER,ECC,PCI
# 空闲节点：dcgmi diag -r 1（深度诊断先停业务）
```

原 8 卡现只见 7 张 → 问题在硬件/PCIe/BIOS/供电，**再重启 Device Plugin 无意义**。Xid 是排查入口，不能单凭编号定唯一根因。

### 3.2 第二层：驱动与 NVML {/* #第二层驱动与-nvml */}

```bash
nvidia-smi; echo $?
lsmod | grep '^nvidia'
ls -l /dev/nvidia*
cat /proc/driver/nvidia/version
```

`lspci` 有卡、`nvidia-smi` 失败 → 驱动/NVML；`lspci` 无卡 → 硬件优先；`nvidia-smi` 正常 → 宿主机链路大体 OK。退出码可辅助（如 9 驱动未加载、12 NVML 库、15 掉总线）——见 [第 44 篇](./03-nvidia-smi%20失败排查.md)。

### 3.3 第三层：容器运行时与 Toolkit {/* #第三层容器运行时与-toolkit */}

宿主机 GPU 能否注入容器？Runtime/CDI 是否配置？

```bash
crictl info
containerd config dump | grep -A30 -i nvidia
# Docker：docker run --rm --gpus all nvidia/cuda:<兼容>-base ... nvidia-smi
# K8s：用最小 GPU Pod，勿只测业务镜像
```

常见：Runtime/Toolkit 缺失、配置丢失、CDI 过期、cgroup/`daemon-reload` 导致容器丢 GPU 权限（重建可暂恢复，CDI 为推荐方向之一）。

### 3.4 第四层：Operator 与 Device Plugin {/* #第四层operator-与-device-plugin */}

```bash
kubectl get pods -n gpu-operator -o wide
kubectl logs -n gpu-operator <device-plugin-pod> -c nvidia-device-plugin --tail=500
kubectl get node <NODE> \
  -o custom-columns='CAPACITY:.status.capacity.nvidia\.com/gpu,ALLOCATABLE:.status.allocatable.nvidia\.com/gpu'
```

物理 8 卡、Allocatable 7 → 查 unhealthy / Xid。详见 [第 47 篇](./06-NVIDIA%20Xid%20错误排查.md)。

### 3.5 第五层：调度与资源 {/* #第五层调度与资源 */}

```bash
# limits 中 nvidia.com/gpu（或 MIG/shared 实际资源名）
kubectl describe pod <POD> -n <NS> | sed -n '/Events:/,$p'
kubectl describe node <NODE> | sed -n '/Allocated resources:/,/Events:/p'
```

Pending 系统排查见 [第 08 篇](./01-GPU%20Pod%20一直%20Pending%20的排查流程.md)。

### 3.6 第六层：CUDA 应用 {/* #第六层cuda-应用 */}

容器已有设备后仍失败：`nvidia-smi` vs `torch.cuda.is_available()`、镜像是否 CUDA 版、兼容性、OOM、NCCL、TP 数量等。见 [第 45](./04-Pod%20分配%20GPU%20后看不到%20GPU.md)、[46](./05-CUDA%20OOM%20排查与优化.md)、[48](./07-NCCL%20Timeout%20排查流程.md)。

## 4. 标准顺序与证据模板

```text
1 lspci 全卡 → 2 nvidia-smi → 3 宿主机 Xid
→ 4 Runtime 能注入 → 5 Device Plugin → 6 节点发布资源
→ 7 Pod 申请并获得 → 8 容器设备/库 → 9 框架识别 CUDA → 10 应用参数
```

采集：`NODE`/`NS`/`POD` → 节点与 Condition、GPU Capacity/Allocatable、Pod Events、gpu-operator Pod、宿主机 `nvidia-smi`、`journalctl -k | grep NVRM: Xid`。

## 5. 本篇总结

```text
硬件 → 驱动 → 运行时 → GPU 组件 → 调度 → 应用
```

下一篇：[nvidia-smi 失败排查](./03-nvidia-smi%20失败排查.md)。

## 6. 参考与致谢 {/* #参考与致谢 */}

- [Schedule GPUs | Kubernetes](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [XID Errors — Introduction](https://docs.nvidia.com/deploy/xid-errors/introduction.html)
- [DCGM Feature Overview](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html)
- [crictl | Kubernetes](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [Container Toolkit Troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/troubleshooting.html)
- [GPU Operator Troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/troubleshooting.html)

本文按官方链路与运维实践归纳「六层」方法，并按本系列交叉链接。
