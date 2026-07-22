---
title: Kubernetes GPU 节点标签与调度策略
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "调度", "GFD", "nodeSelector", "学习路线"]
---

# Kubernetes GPU 节点标签与调度策略

Kubernetes 知道节点有多少 `nvidia.com/gpu`，但不会自动表达业务意图，例如：必须用 T4、训练要 A100 80GB、生产只进独占池、测试只进共享池、TP 优先 NVLink 节点。这些靠标签、`nodeSelector`、Node Affinity、Pod Anti-Affinity 等实现。

[GFD](https://github.com/NVIDIA/k8s-device-plugin/blob/main/docs/gpu-feature-discovery/README.md) 会按节点 NVIDIA GPU 自动打标签。污点隔离见：[Taint 与 Toleration](./14-GPU%20节点%20Taint%20与%20Toleration%20实践.md)。

---

## 1. 学习目标

查看自动标签；设计自定义节点池标签；使用 `nodeSelector` / Node Affinity / Pod Anti-Affinity；实现独占与共享池；避免过度依赖易变的自动标签。

---

## 2. 查看 GPU 标签

```bash
kubectl get nodes --show-labels | tr ',' '\n' | grep 'nvidia.com/'

kubectl get nodes \
  -L nvidia.com/gpu.present,nvidia.com/gpu.product,nvidia.com/gpu.count,nvidia.com/gpu.memory,nvidia.com/mig.capable

kubectl get node <GPU节点> -o json |
jq '.metadata.labels | with_entries(select(.key | startswith("nvidia.com/")))'
```

常见：`gpu.present` / `product` / `count` / `memory`、`cuda.driver.major|minor`、`mig.capable` / `mig.strategy`。具体随 Operator、GFD、Device Plugin 版本变化，以当前节点为准。

---

## 3. 自定义节点池标签

自动标签描述硬件；自定义标签描述管理策略。建议：

```text
gpu.example.com/pool
gpu.example.com/usage
gpu.example.com/environment
gpu.example.com/network
gpu.example.com/storage
```

```bash
kubectl label node gpu-node-01 \
  gpu.example.com/pool=t4-inference \
  gpu.example.com/usage=exclusive \
  gpu.example.com/environment=production \
  gpu.example.com/network=ethernet

kubectl label node gpu-node-02 \
  gpu.example.com/pool=a100-training \
  gpu.example.com/usage=exclusive \
  gpu.example.com/network=rdma

kubectl get nodes \
  -L gpu.example.com/pool,gpu.example.com/usage,gpu.example.com/environment,gpu.example.com/network
```

---

## 4. nodeSelector

最简单的节点选择。须同时满足所有标签；调度器仍会检查资源、污点、亲和等。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-node-selector-test
spec:
  restartPolicy: Never
  nodeSelector:
    gpu.example.com/pool: t4-inference
  containers:
    - name: cuda
      image: <CUDA镜像>
      command: ["bash", "-c", "nvidia-smi && sleep 3600"]
      resources:
        limits:
          nvidia.com/gpu: 1
```

按型号示例：`nvidia.com/gpu.product: Tesla-T4`（以节点实际值为准）。

---

## 5. Node Affinity

### 5.1 硬性要求（必须 T4 或 A10）

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: nvidia.com/gpu.product
              operator: In
              values: ["Tesla-T4", "NVIDIA-A10"]
```

### 5.2 软性偏好（优先 RDMA）

```yaml
affinity:
  nodeAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        preference:
          matchExpressions:
            - key: gpu.example.com/network
              operator: In
              values: ["rdma"]
```

可与硬性条件组合：必须生产+独占，并优先 `a100-inference` 池。

---

## 6. 多副本分散（Pod Anti-Affinity）

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: qwen-inference
          topologyKey: kubernetes.io/hostname
```

软反亲和只是偏好；强制分散用 `requiredDuringSchedulingIgnoredDuringExecution`，节点不够时会 Pending。

---

## 7. 节点池设计示例

```text
t4-shared / t4-exclusive / a100-inference / a100-training / mig-production
```

```bash
kubectl label node gpu-t4-01 gpu.example.com/pool=t4-shared gpu.example.com/usage=shared
kubectl label node gpu-t4-02 gpu.example.com/pool=t4-exclusive gpu.example.com/usage=exclusive
kubectl label node gpu-a100-01 \
  gpu.example.com/pool=a100-training gpu.example.com/usage=exclusive gpu.example.com/network=rdma
```

---

## 8. 调度排查

```bash
kubectl get pod <POD> -n <NS> -o yaml |
grep -A80 -E 'nodeSelector:|affinity:|tolerations:'
kubectl describe pod <POD> -n <NS> | sed -n '/Events:/,$p'
kubectl get nodes -l gpu.example.com/pool=a100-training
```

常见：`didn't match Pod's node affinity`、`untolerated taint`、`Insufficient nvidia.com/gpu`。系统化流程见：[Pending 排查](./08-GPU%20Pod%20一直%20Pending%20的排查流程.md)。

---

## 9. 本篇总结

三层：

```text
硬件标签：型号、显存、MIG
管理标签：生产/测试、共享/独占、训练/推理
Pod 约束：nodeSelector、Affinity、Anti-Affinity、Toleration
```

不要只靠 `nvidia.com/gpu: 1`——它只表示要一张卡，不表达型号、节点池与隔离策略。

下一篇：[GPU 节点 Taint 与 Toleration](./14-GPU%20节点%20Taint%20与%20Toleration%20实践.md)。

---

## 参考与致谢

- [GPU Feature Discovery](https://github.com/NVIDIA/k8s-device-plugin/blob/main/docs/gpu-feature-discovery/README.md)
- [Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)

本文按官方调度与 GFD 说明整理，并按本系列做了交叉链接。
