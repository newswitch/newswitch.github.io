---
title: GPU 整卡独占、Time-Slicing、MPS 与 MIG 对比
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Time-Slicing", "MPS", "MIG", "学习路线"]
---

# GPU 整卡独占、Time-Slicing、MPS 与 MIG 对比

原生 Device Plugin 典型行为：Pod 申请一张 GPU → 获得整张物理卡的访问权。生产还有：大模型要整卡/多卡、小模型显存很少、开发多人共享、多租户要隔离、批处理要提高利用率。常见四种模式：

```text
整卡独占 · Time-Slicing · CUDA MPS · MIG
```

配置实践：[Time-Slicing](./20-Kubernetes%20GPU%20Time-Slicing%20配置实践.md)、[MIG](./21-MIG%20原理与%20Kubernetes%20配置.md)、[HAMi](./22-HAMi%20vGPU%20原理与实践.md)。

---

## 1. 学习目标

理解四种原理；比较显存/计算/故障隔离；按业务选型；理解 K8s 中的资源呈现；知晓共享模式风险。

---

## 2. 整卡独占

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

特点：模型简单、边界清晰、性能可预测最好；适合大模型推理/训练、延迟敏感生产；利用率不足时易浪费。注意：是**设备分配独占**，Pod 内仍可多进程。

适合：vLLM、分布式训练、稳定吞吐的生产服务。

---

## 3. Time-Slicing

将一张物理 GPU 在 K8s 中暴露为多个逻辑副本（如 `replicas=4` → 看到 4 个资源）。多 Pod 共享同一物理卡，CUDA 进程交替获得执行时间。

**不提供显存隔离，也不提供故障隔离**；共享同一物理 GPU 的工作负载是同一故障域。

特点：配置简单、多数 CUDA GPU 可用、提高小任务密度；无显存硬限制、无算力配额保证；一任务可耗尽显存，错误可能影响他人。

申请 `nvidia.com/gpu: 2` **≠** 两倍共享算力。官方建议 `failRequestsGreaterThanOne: true`，把每个共享资源理解为「一次共享访问权」。

---

## 4. CUDA MPS

Multi-Process Service：由 MPS 控制进程协调多客户端共用一张 GPU。相对 Time-Slicing，可对客户端显存/计算做更明确限制；Device Plugin 中常按 replicas 均分显存与计算配额。

注意：Device Plugin 中 MPS 仍可能标为实验性；与 Time-Slicing **不能同时启用**；当前 MPS 共享不支持 MIG 设备；同节点所有 GPU 同一共享模式，不能按单卡分别配。

适合：多个稳定 CUDA 任务、需要比 Time-Slicing 更强配额、能接受实验性风险；生产前须做稳定性验证。

---

## 5. MIG

Multi-Instance GPU：将支持的物理 GPU 切成硬件隔离实例，各有独立计算、显存与故障隔离。自部分 Ampere（如 A100、A30）起，Hopper / 部分 Blackwell 等亦支持——**并非所有 NVIDIA GPU 都支持**。

示例：A100 40GB → 多个 `1g.5gb` 等 Profile；K8s 可能暴露 `nvidia.com/mig-1g.5gb` 等。

优势：硬件级显存/计算隔离、故障隔离强、可预测性优于 Time-Slicing、适合生产多租户。

限制：仅部分 GPU；规格预定义；切换布局影响业务，可能需重置/重启；跨实例通信有限。Operator 的 MIG Manager 监听 `nvidia.com/mig.config` 等标签，停客户端后应用新几何。

---

## 6. 对比表

| 模式 | 显存隔离 | 计算隔离 | 故障隔离 | 可预测性 | 硬件要求 |
|------|----------|----------|----------|----------|----------|
| 整卡独占 | 整卡 | 整卡 | 强 | 高 | 普通 NVIDIA GPU |
| Time-Slicing | 无 | 无硬配额 | 无 | 低 | 大多数 GPU |
| MPS | 有一定配额 | 有一定配额 | 弱于 MIG | 中 | 支持 CUDA MPS |
| MIG | 硬件 | 硬件 | 强 | 高 | 支持 MIG 的 GPU |

---

## 7. 场景选择

| 场景 | 建议 |
|------|------|
| 开发测试 | 优先 Time-Slicing |
| 小模型推理 | 一般 Time-Slicing；要配额用 MPS；生产多租户用 MIG |
| 大模型生产 / 分布式训练 | 整卡（或多卡）独占 |
| 多租户生产平台 | 支持 MIG 优先 MIG；否则 HAMi 或经验证的 MPS |

---

## 8. 常见误区

1. **replicas 等于显存切分**：Time-Slicing 中错误，不保证每 Pod 25% 显存。  
2. **Time-Slicing 能防 OOM 互影响**：不能。  
3. **MIG 与 Time-Slicing 完全互斥**：不完全——mixed MIG 资源上还可再 Time-Slicing，但更复杂，先掌握单独 MIG。  
4. **所有 A 系列都支持 MIG**：须查官方列表与 `nvidia-smi -q`。

---

## 9. 本篇总结

```text
稳定与性能 → 整卡独占
低成本开发共享 → Time-Slicing
一定计算/显存配额 → MPS
生产级硬件隔离 → MIG
```

下一篇：[Time-Slicing 配置实践](./20-Kubernetes%20GPU%20Time-Slicing%20配置实践.md)。

---

## 参考与致谢

- [NVIDIA k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [MIG Supported GPUs](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/supported-gpus.html)
- [GPU Operator MIG](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-mig.html)

本文按 Device Plugin / MIG / Operator 文档整理，并按本系列做了交叉链接。
