---
title: DCGM Exporter GPU 监控指标详解
date: 2026-07-22 18:30:00
categories: 云原生
tags: ["DCGM", "dcgm-exporter", "Prometheus", "GPU", "监控", "学习路线"]
---

# DCGM Exporter GPU 监控指标详解

GPU 集群没有指标，就无法做容量、排障和租户对账。推荐栈：**DCGM → dcgm-exporter → Prometheus → Grafana**。本文整理自 [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)、[About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)、[DCGM Exporter](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/dcgm-exporter.html)。前置：[GPU Operator](../../../gpu/cluster/device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)（默认可带上 dcgm-exporter）。

---

## 1. 监控栈长什么样

```text
GPU 节点
  └─ DCGM (nv-hostengine，可嵌入 exporter)
       └─ dcgm-exporter :9400/metrics
            └─ Prometheus scrape (+ ServiceMonitor)
                 ├─ Grafana 看板
                 └─ Alertmanager 告警
```

要点：

- **DCGM**：数据中心 GPU 管理与遥测（健康、诊断、功耗/时钟策略等）  
- **dcgm-exporter**：用 Go 绑定拉 DCGM 字段，以 Prometheus 格式暴露  
- **Kubelet Pod Resources API**（`/var/lib/kubelet/pod-resources`）：把 GPU 指标打上 **Pod / Namespace** 标签，才能做「谁在用哪张卡」  

GPU Operator 默认会部署 dcgm-exporter；也可单独 Helm 安装。

---

## 2. 部署方式

### 2.1 已有 GPU Operator

确认 DaemonSet / Pod 在跑：

```bash
kubectl get pods -A | grep -i dcgm
kubectl get svc -A | grep dcgm
```

指标端口常见为 **9400**。

### 2.2 单独 Helm（官方 Telemetry 文档路径）

先备 Prometheus（[Setting up Prometheus](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)）：

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus-community/kube-prometheus-stack \
  --create-namespace --namespace prometheus \
  --generate-name \
  --set prometheus.service.type=NodePort \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false
```

再装 dcgm-exporter（仓库名以当前文档为准，常见为 NVIDIA dcgm-exporter charts）：

```bash
helm repo add gpu-helm-charts https://nvidia.github.io/dcgm-exporter/helm-charts
helm repo update
helm install --generate-name gpu-helm-charts/dcgm-exporter
```

中文博客早期示例用过 `gpu-monitoring-tools` 仓库；**以当前 [GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html) / GitHub 为准**。

### 2.3 Docker 快速验证

```bash
DCGM_EXPORTER_VERSION=3.3.5-3.4.0   # 换成你环境可用标签
docker run -d --rm \
  --gpus all --net host --cap-add SYS_ADMIN \
  nvcr.io/nvidia/k8s/dcgm-exporter:${DCGM_EXPORTER_VERSION}-ubuntu22.04 \
  -f /etc/dcgm-exporter/dcp-metrics-included.csv

curl localhost:9400/metrics | head
```

若主机已有 `nv-hostengine`（如部分 DGX），用 `-r localhost:5555` 连已有 agent，避免双开冲突；**exporter 内嵌 DCGM 版本 ≥ 主机 DCGM**。

### 2.4 常用参数

| 环境变量 / 参数 | 含义 |
|-----------------|------|
| `-f` / `DCGM_EXPORTER_COLLECTORS` | 采集字段 CSV（默认 counters 文件） |
| `-a` / `DCGM_EXPORTER_LISTEN` | 监听地址，默认 `:9400` |
| `-c` / `DCGM_EXPORTER_INTERVAL` | 采集间隔 ms，默认 30000 |
| `-k` / `DCGM_EXPORTER_KUBERNETES` | 映射到 K8s Pod（生产建议开） |
| `-r` / `DCGM_REMOTE_HOSTENGINE_INFO` | 连接远程 hostengine |
| `-d` | 监控哪些 GPU / MIG instance |

K8s 中需挂载 kubelet pod-resources socket，Helm chart 一般已配好。

---

## 3. 核心指标怎么读

指标名随 DCGM / CSV 配置略有增减；下列为训练/推理值班最常用的一类。单位与标签以 `/metrics` HELP 行为准。

### 3.1 利用率与 Profiling

| 指标（示例） | 含义 |
|--------------|------|
| `DCGM_FI_DEV_GPU_UTIL` | 传统 GPU 利用率（%） |
| `DCGM_FI_PROF_GR_ENGINE_ACTIVE` | Graphics/Compute Engine 活跃比例（0～1） |
| `DCGM_FI_PROF_PIPE_TENSOR_ACTIVE` | **Tensor Core** 活跃比例 |
| `DCGM_FI_PROF_DRAM_ACTIVE` | 显存带宽活跃比例 |

博客用 `dcgmproftester` 打 FP16 Tensor 负载时，可见 GrActive 接近满载、Tensor 利用率升高——适合验收看板。

### 3.2 显存

| 指标 | 含义 |
|------|------|
| `DCGM_FI_DEV_FB_USED` | Framebuffer 已用（MiB 量级，以 HELP 为准） |
| `DCGM_FI_DEV_FB_FREE` | 空闲显存 |

推理「显存打满、利用率很低」的分析见 [第 41 篇](./04-GPU%20利用率低但显存占满怎么分析.md)。

### 3.3 温度 / 功耗 / 时钟

| 指标 | 含义 |
|------|------|
| `DCGM_FI_DEV_GPU_TEMP` | GPU 温度 ℃ |
| `DCGM_FI_DEV_MEMORY_TEMP` | 显存温度 |
| `DCGM_FI_DEV_POWER_USAGE` | 瞬时功耗 W |
| `DCGM_FI_DEV_TOTAL_ENERGY_CONSUMPTION` | 累计能量 |
| `DCGM_FI_DEV_SM_CLOCK` / `MEM_CLOCK` | SM / 显存时钟 MHz |

高温 + 降频（时钟掉下去）会直接拖慢训练步速。

### 3.4 健康：Xid / ECC

| 指标 | 含义 |
|------|------|
| `DCGM_FI_DEV_XID_ERRORS` | 最近 Xid（非 0 需重视） |
| ECC 相关字段（视 CSV） | 可纠正/不可纠正错误计数 |

Xid 专项见第 47 篇；告警规则见 [第 39 篇](./02-Prometheus%20GPU%20告警策略设计.md)。

### 3.5 PCIe / NVLink

| 指标 | 含义 |
|------|------|
| `DCGM_FI_DEV_PCIE_REPLAY_COUNTER` | PCIe replay，持续涨可能链路不稳 |
| `DCGM_FI_PROF_PCIE_TX_BYTES` / `RX_BYTES` | PCIe 吞吐（profiling） |
| `DCGM_FI_DEV_NVLINK_BANDWIDTH_TOTAL` | NVLink 带宽相关合计 |

多机训练结合 NCCL 网络篇：[NCCL 通信原理](../../../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)、[AI 网络可观测性](../../../networking/ai-fabric/production/05-AI网络可观测性指标体系.md)。

### 3.6 MIG

开启 MIG 后，exporter 可同时暴露 **整卡** 与 **GPU Instance** 指标（标签含 `GPU_I_PROFILE`、`GPU_I_ID` 等）。MIG 模式下调度按 instance 记账，看板需按标签区分。

---

## 4. 标签与「每 Pod」视角

开启 Kubernetes 映射后，指标可带 `pod`、`namespace`、`container` 等（具体 label 名以你版本为准）。这样就能：

```promql
# 某命名空间 GPU 平均利用率（示意）
avg by (namespace) (DCGM_FI_DEV_GPU_UTIL{namespace!=""})
```

没有 Pod 映射时，只能按 `gpu` / `UUID` / `Hostname` 看节点卡，难以做租户账单。

---

## 5. 验收清单

```bash
# 1. exporter 有数据
curl -s http://<node>:9400/metrics | grep DCGM_FI_DEV_GPU_UTIL

# 2. Prometheus 能搜到
# 在 Prometheus UI 查：DCGM_FI_DEV_GPU_UTIL

# 3. 打负载看曲线
# kubectl run / Job 跑 CUDA 或 dcgmproftester（需 SYS_ADMIN 等，见博客）
```

导入 NVIDIA 提供的 Grafana JSON（博客与 Telemetry 文档有入口），确认利用率、功耗、显存面板有数。

---

## 6. 小结

| 主题 | 要点 |
|------|------|
| 部署 | Operator 自带，或 Helm + kube-prometheus-stack |
| 端点 | `:9400/metrics` |
| 必看 | 利用率 / Tensor / 显存 / 温度功耗 / Xid / PCIe·NVLink |
| 增值 | `-k` 关联 Pod/Namespace |

下一篇：[Prometheus GPU 告警策略设计](./02-Prometheus%20GPU%20告警策略设计.md)。

---

## 参考与致谢

- [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)  
- [About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)  
- [DCGM Exporter](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/dcgm-exporter.html)  
- [Setting up Prometheus](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)  

本文基于上述 NVIDIA 博客与官方 Telemetry 文档整理。
