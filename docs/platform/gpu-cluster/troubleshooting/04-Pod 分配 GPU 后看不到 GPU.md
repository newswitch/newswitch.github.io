---
title: Pod 分配 GPU 后看不到 GPU
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Device Plugin", "排障", "学习路线"]
---

# Pod 分配 GPU 后看不到 GPU

> 现象：Pod Running、在 GPU 节点、节点有 `nvidia.com/gpu`，但容器内无设备 / NVML 失败 / `torch.cuda.is_available()=False`。先分清：**没有 GPU**，还是**只是没有 `nvidia-smi` 命令**。

前置：[六层模型](./02-GPU%20集群六层排障模型.md)、[Pod 如何用上 GPU](../device-runtime/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。

---

## 1. 排查顺序

### 1）确认真的申请了 GPU

`limits` 中资源名须与节点一致：`nvidia.com/gpu`，或 MIG / `.shared` / HAMi 等实际名。

### 2）确认节点与宿主机

取 `spec.nodeName`，看 Capacity/Allocatable。节点上 `nvidia-smi` 与 `/dev/nvidia*`：**宿主机失败 → 先修驱动/硬件，不是业务 YAML 主因**。

### 3）容器内设备与环境变量

```bash
kubectl exec ... -- sh -c 'ls -l /dev/nvidia* 2>&1'
kubectl exec ... -- env | grep -E 'NVIDIA|CUDA'
```

`CUDA_VISIBLE_DEVICES` 空/未设不一定故障（可用 DeviceSpec/CDI）。

### 4）区分「无命令」与「无设备」

无 `nvidia-smi` 时用 PyTorch/`torch.cuda` 验证。命令不存在但 `is_available()=True` → 镜像缺管理工具，GPU 可用。

### 5）最小测试镜像

`nvidia/cuda:<兼容>-base` + `nvidia.com/gpu: 1`。测试 Pod 正常、业务异常 → 镜像/依赖；测试也失败 → 注入链路。

### 6）Device Plugin / Toolkit / containerd

对应节点 Plugin 日志搜 `allocate|error|xid|unhealthy`；`crictl info`、`containerd config dump`、Toolkit Pod；`crictl inspect` 查 nvidia/cdi/device。改 Runtime 前先 `cordon`。

### 7）运行后突然丢失

启动正常、数日后 `NVML Unknown Error`、重建恢复 → 查 `daemon-reload`、限流变更、旧 Hook/cgroup；长期走 CDI 与组件升级。

### 8）MIG

节点发 `nvidia.com/mig-*`，Pod 却要 `nvidia.com/gpu` → 调度失败或设备不符。资源名必须完全一致。

---

## 2. 本篇总结

```text
资源请求 → 目标节点 → 宿主机 GPU → 容器设备文件
→ 区分无命令/无设备 → 最小测试 Pod
→ Device Plugin → Toolkit → containerd/CDI → 业务框架
```

下一篇：[CUDA OOM 排查与优化](./05-CUDA%20OOM%20排查与优化.md)。

---

## 参考与致谢

- [Device Plugins | Kubernetes](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [crictl](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [Container Toolkit Troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/troubleshooting.html)

本文按 Device Plugin / Runtime 排障路径整理，并按本系列交叉链接。
