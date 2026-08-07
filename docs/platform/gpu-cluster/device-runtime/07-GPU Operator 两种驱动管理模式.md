---
title: GPU Operator 两种驱动管理模式
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "驱动", "学习路线"]
---

# GPU Operator 两种驱动管理模式

GPU Operator 不只部署 Device Plugin，还可管理驱动、Container Toolkit、GFD、DCGM Exporter 和验证组件。驱动方面生产上主要有两种模式：

```text
模式一：GPU Operator 管理 NVIDIA 驱动
模式二：宿主机预先安装 NVIDIA 驱动
```

默认以容器化方式部署驱动；宿主机已装驱动时须设 `driver.enabled=false`。预装驱动**不受** Operator 生命周期管理。Helm 安装见：[使用 Helm 部署 GPU Operator](./06-使用%20Helm%20部署%20GPU%20Operator.md)。

---

## 1. 学习目标

1. 理解两种驱动模式的工作方式；  
2. 判断当前集群用哪种模式；  
3. 掌握两种模式的安装参数；  
4. 理解 Toolkit 与驱动是否必须一起管理；  
5. 知道升级、回滚、故障处理上的差别；  
6. 能按生产环境选型。

---

## 2. 模式一：Operator 管理驱动

### 2.1 工作方式

默认在 GPU 节点跑 Driver DaemonSet：

```text
GPU Operator → NVIDIA Driver DaemonSet → Driver Pod 进每个 GPU 节点
→ 按内核构建/加载模块 → 驱动文件放入宿主机路径
→ Toolkit / Device Plugin / 业务 Pod 使用驱动
```

常称 **Containerized Driver（容器化驱动）**：并不表示驱动只在容器内生效。Driver Pod 仍需访问宿主机内核、加载模块、创建设备文件、挂载宿主机目录，并以较高权限运行。

升级时需停止 GPU 客户端、卸载旧模块、加载新模块并重新启用客户端——**不同于**普通无状态 DaemonSet 滚动更新。细节见：[升级、回滚与节点维护](./08-GPU%20Operator%20升级、回滚与节点维护.md)。

### 2.2 安装

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --wait --timeout 30m
```

默认相当于 `driver.enabled: true`、`toolkit.enabled: true`。

### 2.3 查看驱动 Pod

```bash
kubectl get pods -n gpu-operator -o wide | grep nvidia-driver
kubectl get daemonset -n gpu-operator | grep nvidia-driver

DRIVER_POD=$(kubectl get pods -n gpu-operator \
  -l app=nvidia-driver-daemonset \
  -o jsonpath='{.items[0].metadata.name}')
kubectl logs "$DRIVER_POD" -n gpu-operator --all-containers --tail=500
```

### 2.4 优点与风险

**优点**：版本集中配置、节点安装统一、可配合升级控制器滚动、降低人工逐节点成本、新节点可自动部署、状态可经 Kubernetes 对象观察。

**风险**：与内核强相关——头文件缺失、内核不受支持、Secure Boot、nouveau 冲突、自定义内核匹配失败、Driver Pod 启动期间业务不可用、节点 OS 差异过大。容器化驱动要求 OS/内核满足支持矩阵；某些自定义内核更适合预装宿主机驱动。

---

## 3. 模式二：宿主机预装驱动

### 3.1 工作方式

驱动由 OS 包、离线包、自动化平台或厂商镜像提前装好：

```text
运维平台/系统镜像 → 节点安装驱动 → nvidia-smi 正常
→ Operator 跳过 Driver DaemonSet
→ 继续管理 Toolkit、Device Plugin、GFD、DCGM
```

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --set driver.enabled=false \
  --wait --timeout 30m
```

### 3.2 安装前检查

每节点：

```bash
nvidia-smi
lsmod | grep nvidia
ls -l /dev/nvidia*
cat /proc/driver/nvidia/version
```

应满足：驱动已加载、`nvidia-smi` 可用、GPU 数量正确、设备文件存在、版本满足 CUDA 兼容。

### 3.3 Toolkit 是否也关

预装驱动 ≠ 预装 Container Toolkit。仅关驱动：

```yaml
driver:
  enabled: false
toolkit:
  enabled: true
```

驱动与 Toolkit 都已装，且 containerd 已配好 NVIDIA Runtime：

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --wait --timeout 30m
```

### 3.4 优点与风险

**优点**：驱动变更可独立控制；适合成熟镜像/补丁平台、内网离线、特殊内核；节点驱动问题不依赖 Operator Pod；升级可纳入主机变更流程。

**风险**：需逐节点保证版本一致；新节点须先装驱动；Operator **不能**自动升级宿主机驱动；需额外巡检漂移；回滚由 OS 层负责。升级控制器只管理容器化驱动。

---

## 4. 如何判断当前模式

```bash
kubectl get clusterpolicy cluster-policy \
  -o jsonpath='{.spec.driver.enabled}{"\n"}'
# true → Operator 管理；false → 宿主机预装

kubectl get daemonset -n gpu-operator | grep nvidia-driver
helm get values gpu-operator -n gpu-operator -a | grep -A10 '^driver:'
```

---

## 5. 对比与选型

| 对比项 | Operator 管理驱动 | 宿主机预装驱动 |
|--------|-------------------|----------------|
| 默认 | 是 | 否 |
| 部署 | Driver DaemonSet | OS / 平台 |
| 升级 | Upgrade Controller | 外部变更 |
| 新节点 | 自动化高 | 须提前安装 |
| 自定义内核 | 可能受限 | 更灵活 |
| 版本一致 | 易统一 | 需巡检 |
| 回滚 | Operator / 驱动镜像 | 系统包 / 节点镜像 |

**更适合 Operator 管理**：OS/内核统一、要自动接入新节点、可迁移 GPU 业务、希望集中管版本。

**更适合预装**：成熟补丁平台、定制内核、驱动须主机级审批、不能由 Pod 动态装驱动、内网源受限。

---

## 6. 本篇总结

核心区别不是「驱动是否跑在容器里」，而是**谁负责驱动生命周期**：

- Operator 模式：安装、升级、状态由 GPU Operator 管；  
- 预装模式：服务器运维体系管驱动，Operator 只管上层 GPU 组件。

选型重点：OS 一致性、内核兼容、变更审批、升级方式、业务迁移能力、节点自动化程度。

下一篇：[GPU Operator 升级、回滚与节点维护](./08-GPU%20Operator%20升级、回滚与节点维护.md)。

---

## 参考与致谢

- [Install NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator.html)
- [GPU Driver Upgrades](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-driver-upgrades.html)
- [GPU Operator Release Notes / Support Matrix](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/release-notes.html)

本文按官方安装与驱动升级文档整理，并按本系列做了交叉链接。
