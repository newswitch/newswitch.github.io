---
title: 使用 Helm 部署 GPU Operator
sidebar_label: "06. 使用 Helm 部署 GPU Operator"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "Helm", "学习路线"]
---

# 使用 Helm 部署 GPU Operator

GPU Operator 用 Operator 模式管理 GPU 节点软件：驱动、Container Toolkit、Device Plugin、节点发现与监控等。NVIDIA 推荐用 **Helm** 安装；安装前确认 Kubernetes、容器运行时、GPU 节点 OS、Pod Security Admission、NFD 等条件。

组件原理见：[NVIDIA GPU Operator 架构与组件说明](./05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。驱动预装 vs Operator 安装见：[两种驱动管理模式](./07-GPU%20Operator%20两种驱动管理模式.md)。

---

## 1. 学习目标

1. 理解 GPU Operator 的作用；  
2. 完成安装前环境检查；  
3. 按驱动是否预装选择安装模式；  
4. 用 Helm 安装并验证 ClusterPolicy / 各组件；  
5. 创建 GPU 测试 Pod；  
6. 排查常见安装问题；完成升级、回滚与卸载。

---

## 2. 主要组件与关系

```text
GPU Operator → ClusterPolicy → 管理各类 DaemonSet
  ├── Driver
  ├── Toolkit
  ├── Device Plugin
  ├── GFD
  ├── DCGM Exporter
  └── Validator
```

另含 NFD、MIG Manager 等（视 values 而定）。

---

## 3. 安装前检查

```bash
kubectl version
kubectl get nodes -o wide
kubectl get pods -A
helm version

# GPU 节点
nvidia-smi   # 若准备由 Operator 装驱动，宿主机可不预装；已预装则必须关 driver

kubectl get nodes \
  -o custom-columns='节点:.metadata.name,运行时:.status.nodeInfo.containerRuntimeVersion'
# 官方常见支持：containerd、CRI-O

kubectl get nodes \
  -o custom-columns='节点:.metadata.name,OS:.status.nodeInfo.osImage,内核:.status.nodeInfo.kernelVersion'
```

用驱动容器管驱动时，Worker 需满足支持矩阵，且同一 GPU Worker 组 OS 版本宜一致；宿主机预装驱动可降低约束。

**NFD**：

```bash
kubectl get pods -A | grep -i node-feature-discovery
```

集群已有 NFD 时设 `nfd.enabled=false`，避免重复部署。

---

## 4. 命名空间与 PSA

```bash
kubectl create namespace gpu-operator

# 启用 PSA 时需允许特权 Pod（驱动 / Toolkit 需访问宿主机）
kubectl label --overwrite namespace gpu-operator \
  pod-security.kubernetes.io/enforce=privileged
```

---

## 5. 添加 Helm 仓库

```bash
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update
helm search repo nvidia/gpu-operator
helm search repo nvidia/gpu-operator --versions | head -20
```

生产应固定已验证的 Chart 版本。

---

## 6. 选择安装模式

### 6.1 Operator 管理全部组件

适合：宿主机未装驱动 / Toolkit，希望统一管理。

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <经过验证的Chart版本> \
  --wait --timeout 20m
```

### 6.2 宿主机已预装驱动

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <经过验证的Chart版本> \
  --set driver.enabled=false \
  --wait --timeout 20m
```

### 6.3 已预装驱动 + Container Toolkit

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <经过验证的Chart版本> \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --wait --timeout 20m
```

须确认 containerd / CRI-O 已正确配置 NVIDIA Runtime。

### 6.4 集群已有 NFD

```bash
# 可与上面参数组合
--set nfd.enabled=false
```

---

## 7. 使用 values.yaml

```bash
helm show values nvidia/gpu-operator --version <Chart版本> \
  > gpu-operator-values.yaml

helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <Chart版本> \
  -f gpu-operator-values.yaml \
  --wait --timeout 20m
```

配置纳入 Git；勿把私有仓库密码写进仓库。

---

## 8. 检查安装结果

```bash
helm list -n gpu-operator
helm status gpu-operator -n gpu-operator

kubectl get pods -n gpu-operator -o wide
kubectl get pods -n gpu-operator -w

kubectl get clusterpolicy
POLICY=$(kubectl get clusterpolicy -o jsonpath='{.items[0].metadata.name}')
kubectl describe clusterpolicy "$POLICY"

kubectl get daemonset -n gpu-operator
```

默认常按 `feature.node.kubernetes.io/pci-10de.present=true` 识别 NVIDIA GPU Worker：

```bash
kubectl get nodes -L feature.node.kubernetes.io/pci-10de.present
kubectl get nodes -L nvidia.com/gpu.present,nvidia.com/gpu.product

kubectl get nodes \
  -o custom-columns='节点:.metadata.name,GPU容量:.status.capacity.nvidia\.com/gpu,GPU可分配:.status.allocatable.nvidia\.com/gpu'
```

---

## 9. 创建 GPU 测试 Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-test
spec:
  restartPolicy: Never
  containers:
    - name: cuda
      image: <与当前驱动兼容的NVIDIA CUDA镜像>
      command: ["bash", "-c", "nvidia-smi"]
      resources:
        limits:
          nvidia.com/gpu: 1
```

```bash
kubectl apply -f gpu-test.yaml
kubectl get pod gpu-test -o wide
kubectl logs gpu-test
kubectl delete pod gpu-test
```

预期日志可见型号、驱动、显存、CUDA 兼容版本。Pending 排查：[GPU Pod 一直 Pending](../troubleshooting/01-GPU%20Pod%20一直%20Pending%20的排查流程.md)。

---

## 10. 安装问题排查顺序

| 对象 | 检查 |
|------|------|
| Operator | `kubectl logs -n gpu-operator deployment/gpu-operator --tail=300`（先 `get deployment` 确认名称） |
| ClusterPolicy | `kubectl describe clusterpolicy "$POLICY"` |
| Validator | `get pods \| grep validator` → logs `--all-containers` |
| Driver | 内核头文件、版本、Secure Boot、nouveau、宿主机驱动冲突 |
| Toolkit | Pod 日志；节点 `containerd config dump \| grep -A20 -i nvidia` |
| Device Plugin | Pod 日志；最终 `describe node` 的 Capacity/Allocatable |

---

## 11. 升级与回滚

```bash
helm history gpu-operator -n gpu-operator

helm upgrade gpu-operator nvidia/gpu-operator \
  -n gpu-operator --version <新版本> \
  -f gpu-operator-values.yaml --wait --timeout 20m

helm rollback gpu-operator <Revision> \
  -n gpu-operator --wait --timeout 20m
```

升级前：查兼容矩阵、单节点灰度、确认业务可迁移、备份 values、记录 Revision、准备回滚。

---

## 12. 卸载

```bash
helm uninstall gpu-operator -n gpu-operator

kubectl get pods -n gpu-operator
kubectl get clusterpolicy
kubectl get crd | grep nvidia
```

未确认依赖前，不要随意删全部 NVIDIA CRD。

---

## 13. 本篇总结

```text
检查节点与运行时 → 确认驱动模式 → 检查 NFD
→ 特权命名空间 → 添加仓库 → 固定 Chart 版本
→ Helm 安装 → ClusterPolicy / 组件 → nvidia.com/gpu → 测试 Pod
```

成功标准不是「所有 Pod Running」，而是：

```text
节点正确暴露 nvidia.com/gpu
测试 Pod 能调度
容器内 nvidia-smi 正常
业务能实际跑 CUDA
```

下一篇：[GPU Operator 两种驱动管理模式](./07-GPU%20Operator%20两种驱动管理模式.md)。

---

## 参考与致谢

- [Install NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator.html)
- [Getting Started — NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)

本文按官方 Helm 安装文档整理，并按本系列做了交叉链接。
