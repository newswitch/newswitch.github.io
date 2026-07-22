---
title: GPU 节点 Taint 与 Toleration 实践
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Taint", "Toleration", "学习路线"]
---

# GPU 节点 Taint 与 Toleration 实践

GPU 节点成本高。不隔离时，Nginx、日志、Java、批处理也可能占掉 CPU/内存，影响模型业务。Taint 让节点排斥不符合条件的 Pod；Toleration 表示 Pod **可以**容忍某污点。

> Toleration 只允许进入，不保证一定会进该节点。

专用节点应同时用 **Taint + 标签/Affinity**：既挡普通 Pod，又让专用负载只进指定池。标签见：[节点标签与调度策略](./13-Kubernetes%20GPU%20节点标签与调度策略.md)。

---

## 1. 学习目标

理解 Taint/Toleration；区分三种 Effect；隔离 GPU 节点；配置 GPU Pod 容忍；与标签结合；排查未容忍污点导致的 Pending。

---

## 2. Taint 结构

```text
key=value:effect
# 例：nvidia.com/gpu=true:NoSchedule
```

| Effect | 含义 |
|--------|------|
| `NoSchedule` | 不能容忍则不会调度上去 |
| `PreferNoSchedule` | 尽量不调度，非强制 |
| `NoExecute` | 挡新 Pod，并驱逐不能容忍的已有 Pod |

---

## 3. 给 GPU 节点加污点

```bash
NODE=gpu-node-01
kubectl taint node "$NODE" nvidia.com/gpu=true:NoSchedule
kubectl get node "$NODE" -o jsonpath='{.spec.taints}{"\n"}'
kubectl describe node "$NODE" | grep -A5 Taints

# 所有 GPU 节点
kubectl get nodes -l nvidia.com/gpu.present=true -o name |
while read node; do
  kubectl taint "$node" nvidia.com/gpu=true:NoSchedule --overwrite
done
```

---

## 4. 普通 Pod 验证

无 Toleration 的 Pod 应落到 CPU 节点；若只剩 GPU 节点，事件可能为：

```text
node(s) had untolerated taint {nvidia.com/gpu: true}
```

---

## 5. GPU Pod 配置 Toleration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  tolerations:
    - key: nvidia.com/gpu
      operator: Equal
      value: "true"
      effect: NoSchedule
  containers:
    - name: cuda
      image: <CUDA镜像>
      command: ["bash", "-c", "nvidia-smi && sleep 3600"]
      resources:
        limits:
          nvidia.com/gpu: 1
```

---

## 6. 仅有 Toleration 不够

有 Toleration 只表示「可以进 GPU 节点」；若不申请 GPU、也无节点选择，仍可能进普通 CPU 节点。专用负载应同时：

```yaml
nodeSelector:
  gpu.example.com/pool: a100-inference
tolerations:
  - key: nvidia.com/gpu
    operator: Equal
    value: "true"
    effect: NoSchedule
```

```text
Taint：普通 Pod 进不了 GPU 节点
Toleration：GPU Pod 允许进入
nodeSelector/Affinity：必须进指定池
```

---

## 7. 共享 / 独占分别污点

```bash
kubectl taint node gpu-exclusive-01 gpu.example.com/mode=exclusive:NoSchedule
kubectl taint node gpu-shared-01 gpu.example.com/mode=shared:NoSchedule
```

独占 / 共享业务分别配对应 `nodeSelector` + Toleration（`value: exclusive` / `shared`）。

---

## 8. NoExecute 与维护

```bash
kubectl taint node gpu-node-01 gpu.example.com/maintenance=true:NoExecute
```

可用 `tolerationSeconds: 300` 延迟驱逐。日常维护更推荐 `cordon` + `drain`（见 [第 12 篇](./12-GPU%20Operator%20升级、回滚与节点维护.md)），勿随意加 `NoExecute`。

---

## 9. 删除污点

```bash
kubectl taint node gpu-node-01 nvidia.com/gpu=true:NoSchedule-
kubectl taint node gpu-node-01 nvidia.com/gpu:NoSchedule-
```

---

## 10. 排查

```bash
kubectl describe pod <POD> -n <NS> | sed -n '/Events:/,$p'
kubectl get node <NODE> -o jsonpath='{.spec.taints}{"\n"}'
kubectl get pod <POD> -n <NS> -o jsonpath='{.spec.tolerations}{"\n"}'
```

常见：key/value/effect 不一致、operator 错误、只有 Toleration 无 Affinity、模板更新后旧 Pod 未重建。

---

## 11. 本篇总结

```text
GPU 节点：Label + Taint
GPU Pod：GPU Resource + Node Affinity + Toleration
```

下一篇可接共享模式对比：[整卡 / Time-Slicing / MPS / MIG](./19-GPU%20整卡独占、Time-Slicing、MPS%20与%20MIG%20对比.md)；配置细节见 [07 Pod 配置](./07-Kubernetes%20GPU%20Pod%20配置详解.md)。

---

## 参考与致谢

- [Taints and Tolerations | Kubernetes](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)

本文按官方污点文档整理，并按本系列做了交叉链接。
