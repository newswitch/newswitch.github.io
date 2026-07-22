---
title: GPU Pod 一直 Pending 的排查流程
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "排障", "Pending", "学习路线"]
---

# GPU Pod 一直 Pending 的排查流程

Pod 处于 `Pending`，表示已被 API 接受，但一个或多个容器尚未创建并启动。可能是调度失败，也可能是镜像拉取、存储挂载、Sandbox 创建等后续阶段问题。**先判断是否已分配到节点**。

GPU Pod 常见原因：GPU 不足、Device Plugin 异常、节点未暴露 `nvidia.com/gpu`、资源名写错、标签/污点不匹配、CPU/内存不足、Volcano 队列或 PodGroup 限制、镜像或 Runtime 异常。

前置：[GPU Pod 配置详解](./07-Kubernetes%20GPU%20Pod%20配置详解.md)、[Device Plugin](./05-Kubernetes%20如何识别和管理%20GPU.md)。

---

## 1. 总体流程

```text
Pod Pending
  ↓
查看 nodeName
  ├─ 为空 → 调度阶段：GPU / CPU / 内存 / 标签 / 污点 / 队列 / 亲和性
  └─ 已有 → 节点启动阶段：镜像 / Runtime / Device Plugin / 挂载 / Sandbox
```

---

## 2. 查看 Pod 状态

```bash
NS=<命名空间>
POD=<Pod名称>

kubectl get pod "$POD" -n "$NS" -o wide
kubectl get pod "$POD" -n "$NS" \
  -o jsonpath='{.spec.nodeName}{"\n"}'
```

`nodeName` 空 → 尚未调度；有值 → 已调度但容器未起来。

---

## 3. 查看 Events

```bash
kubectl describe pod "$POD" -n "$NS"

kubectl events -n "$NS" --for pod/"$POD" --types=Warning,Normal
```

常见：`FailedScheduling`、`Insufficient nvidia.com/gpu`、`Insufficient cpu/memory`、亲和/污点不匹配、`unbound immediate PersistentVolumeClaims`、`FailedCreatePodSandBox`、`ErrImagePull` / `ImagePullBackOff`。

---

## 4. 检查 GPU 资源声明

```bash
kubectl get pod "$POD" -n "$NS" -o yaml
```

正确写法（扩展设备应在 `limits`；仅设 `limits` 时会作为请求量；若同时设 `requests` 与 `limits` 则必须相等）：

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

错误示例：只写 `requests` 不写 `limits`。资源名以集群实际暴露为准，也可能是 `nvidia.com/gpu.shared`、`hami.io/gpu`、`volcano.sh/vgpu-number` 等。

---

## 5. 检查节点是否暴露 GPU

```bash
kubectl get nodes \
  -o custom-columns='节点:.metadata.name,GPU容量:.status.capacity.nvidia\.com/gpu,GPU可分配:.status.allocatable.nvidia\.com/gpu'

NODE=<GPU节点>
kubectl describe node "$NODE"
```

关注 Capacity / Allocatable / Allocated resources。物理有卡但无 `nvidia.com/gpu` 时，查：驱动、Container Toolkit、Device Plugin、GPU Operator、kubelet。

---

## 6. 确认 GPU 是否已分完

```bash
kubectl describe node "$NODE"

kubectl get pods -A -o json | jq -r '
.items[]
| select(
    [.spec.containers[].resources.limits["nvidia.com/gpu"] // 0]
    | add > 0
  )
| [
    .metadata.namespace,
    .metadata.name,
    .spec.nodeName,
    ([.spec.containers[].resources.limits["nvidia.com/gpu"] // 0] | add)
  ]
| @tsv
'

# 无 jq 时
kubectl describe node "$NODE" | sed -n '/Allocated resources:/,/Events:/p'
```

事件 `Insufficient nvidia.com/gpu` 表示可分配不足，**不一定是** Device Plugin 故障。

---

## 7. 检查 Device Plugin

```bash
kubectl get pods -A -o wide | grep -Ei 'nvidia-device-plugin|gpu-operator'
kubectl logs -n <命名空间> <device-plugin-pod> --tail=300
kubectl get daemonset -A | grep -i nvidia
```

关注：NVML 初始化失败、驱动未加载、找不到 `libnvidia-ml.so`、设备发现失败、Runtime 配置错误。部署细节：[Device Plugin 部署与配置](./05b-NVIDIA-Device-Plugin部署与配置.md)。

---

## 8. 检查节点驱动

```bash
ssh root@"$NODE"
nvidia-smi
ls -l /dev/nvidia*
lsmod | grep nvidia
dmesg -T | grep -Ei 'nvidia|nvrm|xid' | tail -100
```

宿主机 `nvidia-smi` 都失败时，先修驱动，不要继续纠结调度器。

---

## 9. 检查标签与亲和性

```bash
kubectl get pod "$POD" -n "$NS" -o yaml | grep -A30 -E 'nodeSelector:|affinity:'
kubectl get nodes --show-labels
kubectl get nodes -L nvidia.com/gpu.product,nvidia.com/gpu.present
```

常见错误：`nodeSelector` 写 `Tesla-T4`，实际标签是 `NVIDIA-T4`。

---

## 10. 检查 Taint / Toleration

```bash
kubectl describe node "$NODE" | grep -A5 Taints
kubectl get node "$NODE" -o jsonpath='{.spec.taints}{"\n"}'
```

Pod 需匹配容忍，例如：

```yaml
tolerations:
  - key: nvidia.com/gpu
    operator: Equal
    value: "true"
    effect: NoSchedule
```

未容忍的 `NoSchedule` 污点会挡住默认调度器。

---

## 11. 检查 CPU、内存与 PVC

GPU 空闲 ≠ 节点一定可调度。看 Pod 的 CPU/内存请求与节点剩余；常见事件：`Insufficient cpu/memory`、`Too many pods`。

```bash
kubectl get pvc -n "$NS"
kubectl describe pvc <PVC名称> -n "$NS"
```

`unbound immediate PersistentVolumeClaims` → 先修 PVC。

---

## 12. 检查 Volcano 等调度器

```bash
kubectl get pod "$POD" -n "$NS" \
  -o jsonpath='{.spec.schedulerName}{"\n"}'
```

若为 `volcano`：

```bash
kubectl get podgroup -A
kubectl get queue
kubectl describe podgroup <名称> -n "$NS"
kubectl describe queue <队列名称>
```

关注：队列资源、`minMember` / Gang、队列是否关闭、优先级与抢占。见：[Volcano GPU 调度器入门](./16-Volcano%20GPU%20调度器入门.md)。

---

## 13. 已分配节点仍 Pending

```bash
kubectl describe pod "$POD" -n "$NS"
journalctl -u kubelet -n 300 --no-pager
journalctl -u containerd -n 300 --no-pager
```

常见：镜像拉取失败、NVIDIA Runtime 未配置、`FailedCreatePodSandBox`、CNI / PVC / 设备挂载失败。链路：[Pod 如何使用上 GPU](./06-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。

---

## 14. 一键采集

```bash
NS=<命名空间>
POD=<Pod名称>

echo "=== POD ==="
kubectl get pod "$POD" -n "$NS" -o wide

echo "=== NODE ==="
kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.nodeName}{"\n"}'

echo "=== EVENTS ==="
kubectl describe pod "$POD" -n "$NS" | sed -n '/Events:/,$p'

echo "=== GPU NODES ==="
kubectl get nodes \
  -o custom-columns='节点:.metadata.name,GPU:.status.allocatable.nvidia\.com/gpu'

echo "=== DEVICE PLUGIN ==="
kubectl get pods -A -o wide | grep -Ei 'nvidia-device-plugin|gpu-operator'
```

---

## 15. 本篇总结

推荐顺序：

```text
nodeName → Events → GPU 声明 → Allocatable → 已分配
→ Device Plugin → 驱动 → 标签/亲和 → 污点
→ CPU/内存/PVC → Volcano → kubelet/Runtime
```

下一篇：[NVIDIA GPU Operator 架构与组件说明](./09-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。

---

## 参考与致谢

- [Debug Pods | Kubernetes](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)
- [Schedule GPUs | Kubernetes](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Assigning Pods to Nodes | Kubernetes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [污点和容忍度 | Kubernetes](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/taint-and-toleration/)

本文按官方排障与 GPU 调度文档整理，并按本系列做了交叉链接。
