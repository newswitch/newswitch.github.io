---
title: Kubernetes GPU Time-Slicing 配置实践
sidebar_label: "08. Kubernetes GPU Time-Slicing 配置实践"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Time-Slicing", "Device Plugin", "学习路线"]
---

# Kubernetes GPU Time-Slicing 配置实践

Time-Slicing 通过 Device Plugin 共享配置，把一张物理 GPU 注册成多个可调度资源。例如物理 2 卡、`replicas=4` → Allocatable 为 8——表示最多 8 次共享访问，**不是**真有 8 张卡。**不提供显存与故障隔离**。

概念对比见：[整卡 / Time-Slicing / MPS / MIG](./07-GPU%20整卡独占、Time-Slicing、MPS%20与%20MIG%20对比.md)。节点池隔离见：[标签](../scheduling/01-Kubernetes%20GPU%20节点标签与调度策略.md)、[污点](../scheduling/02-GPU%20节点%20Taint%20与%20Toleration%20实践.md)。

---

## 1. 学习目标

创建 ConfigMap；配置全局/节点级策略；使用 `.shared` 资源名；验证 Capacity；多 Pod 共享验证；恢复整卡；识别风险。

---

## 2. 前置检查

```bash
helm list -n gpu-operator
kubectl get pods -n gpu-operator | grep device-plugin
kubectl get nodes -L nvidia.com/gpu.product,nvidia.com/gpu.count
kubectl get nodes \
  -o custom-columns='NODE:.metadata.name,GPU:.status.allocatable.nvidia\.com/gpu'
```

记录：节点名、物理 GPU 数、型号、当前 `nvidia.com/gpu`。

---

## 3. 集群统一 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: time-slicing-config
  namespace: gpu-operator
data:
  any: |-
    version: v1
    flags:
      migStrategy: none
    sharing:
      timeSlicing:
        renameByDefault: true
        failRequestsGreaterThanOne: true
        resources:
          - name: nvidia.com/gpu
            replicas: 4
```

```bash
kubectl apply -f time-slicing-config.yaml
```

| 参数 | 含义 |
|------|------|
| `renameByDefault=true` | 共享资源名为 `nvidia.com/gpu.shared` |
| `failRequestsGreaterThanOne=true` | 禁止单 Pod 申请多个共享副本 |
| `replicas=4` | 每张物理卡注册 4 个共享访问资源 |

---

## 4. 关联 ClusterPolicy

```bash
kubectl patch clusterpolicy cluster-policy --type merge -p '{
  "spec": {
    "devicePlugin": {
      "config": {
        "name": "time-slicing-config",
        "default": "any"
      }
    }
  }
}'

kubectl get clusterpolicy cluster-policy \
  -o jsonpath='{.spec.devicePlugin.config}{"\n"}'
kubectl get pods -n gpu-operator -w
```

ConfigMap 须与 Operator 同命名空间，经 `spec.devicePlugin.config` 引用。

---

## 5. 验证节点资源

两张物理卡、`replicas=4`、`renameByDefault=true` 时，预期大致：

```text
nvidia.com/gpu: 0
nvidia.com/gpu.shared: 8
```

```bash
kubectl describe node <GPU节点> | grep -A20 -E 'Capacity:|Allocatable:'
kubectl get node <GPU节点> \
  -L nvidia.com/gpu.count,nvidia.com/gpu.product,nvidia.com/gpu.replicas
```

`gpu.count` 仍为物理卡数；`gpu.replicas` 为每卡副本数。

---

## 6. 创建共享 GPU Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-shared-test-1
spec:
  restartPolicy: Never
  containers:
    - name: cuda
      image: <CUDA镜像>
      command:
        - bash
        - -c
        - |
          echo "NVIDIA_VISIBLE_DEVICES=$NVIDIA_VISIBLE_DEVICES"
          nvidia-smi
          sleep 3600
      resources:
        limits:
          nvidia.com/gpu.shared: 1
```

```bash
for i in 1 2 3 4; do
  sed "s/gpu-shared-test-1/gpu-shared-test-$i/" gpu-shared-test.yaml | kubectl apply -f -
done
kubectl get pods -o wide | grep gpu-shared-test
kubectl exec gpu-shared-test-1 -- nvidia-smi
```

多 Pod 可能看到相同物理 UUID → 共享同一设备。

---

## 7. 验证显存不隔离

在一个 Pod 内做受控显存占用，观察其他 Pod 与宿主机 `watch -n 1 nvidia-smi`。目标：确认同卡共享、一 Pod 占用减少他人可用显存、`replicas` ≠ 显存配额。**限制规模，避免真实 OOM**。

---

## 8. 节点级差异化配置

ConfigMap 可含多段（如 `t4-shared` replicas=4、`a10-shared` replicas=2）。ClusterPolicy 只引用 ConfigMap **不设 default**，再按节点打标：

```bash
kubectl label node gpu-t4-01 nvidia.com/device-plugin.config=t4-shared --overwrite
kubectl label node gpu-a10-01 nvidia.com/device-plugin.config=a10-shared --overwrite
```

---

## 9. 结合节点池隔离

```bash
kubectl label node gpu-t4-01 gpu.example.com/usage=shared
kubectl taint node gpu-t4-01 gpu.example.com/mode=shared:NoSchedule
```

共享业务：`nodeSelector` + 对应 Toleration + `nvidia.com/gpu.shared: 1`，避免独占模型误入。

---

## 10. 恢复整卡模式

```bash
kubectl label node gpu-t4-01 nvidia.com/device-plugin.config-

kubectl patch clusterpolicy cluster-policy --type json -p='[
  {"op":"remove","path":"/spec/devicePlugin/config"}
]'

kubectl get pods -n gpu-operator -w
kubectl describe node gpu-t4-01 | grep -A15 -E 'Capacity:|Allocatable:'
# 预期：nvidia.com/gpu 恢复为物理数量

kubectl delete configmap time-slicing-config -n gpu-operator
```

---

## 11. 生产注意事项

限制 Pod 数 / Namespace 配额 / 并发；监控整卡显存与 Xid；区分共享与独占资源名；避免大模型进共享池；压测相互影响；制定 OOM 恢复流程。

`nvidia.com/gpu.shared: 1` ≠ 固定 25% 显存或算力，只表示一次共享调度访问权。

---

## 12. 本篇总结

```text
ConfigMap → ClusterPolicy 引用 → Device Plugin 重启
→ Capacity 增加 → Pod 申请共享资源 → 验证同卡共享
```

适合：开发测试、短时 CUDA、低并发小模型、利用率实验。不适合：强隔离多租户、延迟敏感生产、不可超用显存、大型训练。

下一篇：[MIG 原理与 Kubernetes 配置](./09-MIG%20原理与%20Kubernetes%20配置.md)。

---

## 参考与致谢

- [GPU Sharing — NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-sharing.html)
- [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)

本文按官方 GPU Sharing 文档整理，并按本系列做了交叉链接。
