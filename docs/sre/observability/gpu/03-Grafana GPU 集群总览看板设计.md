---
title: Grafana GPU 集群总览看板设计
sidebar_label: "03. Grafana GPU 集群总览看板设计"
date: 2026-07-22 18:40:00
categories: 云原生
tags: ["Grafana", "DCGM", "Prometheus", "看板", "学习路线"]
---

# Grafana GPU 集群总览看板设计

指标进了 Prometheus 之后，值班需要的是 **分层看板**，而不是一张塞满几百条曲线的图。本文按四套看板组织：集群总览 → 节点/卡 → Namespace·Pod·模型 → 推理业务。部署与导入方式见 [中文博客](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/) 与 [Setting up Prometheus](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)；指标字典见 [第 38 篇](./01-DCGM%20Exporter%20GPU%20监控指标详解.md)。

---

## 1. 接入 Grafana

1. 安装 `kube-prometheus-stack`（含 Grafana）  
2. 安装 / 确认 `dcgm-exporter`，Prometheus 能查到 `DCGM_*`  
3. 导入 NVIDIA 官方 GPU dashboard JSON（博客「数一数仪表板」/ Telemetry 文档入口）  
4. 再按下面四层 **复制出专用看板**，避免改坏上游 JSON  

访问：NodePort、或 `kubectl port-forward svc/...-grafana 3000:80`。

---

## 2. 四套看板怎么分

| 看板 | 受众 | 回答的问题 |
|------|------|------------|
| A. 集群总览 | 值班 / 老板 | 还有多少卡？热不热？有没有 Xid？ |
| B. 节点与单卡 | SRE / 机房 | 哪台机器、哪张卡异常？ |
| C. Namespace·Pod·模型 | 平台 / 租户 | 谁占用？哪个训练/推理 Job？ |
| D. 推理业务 | 业务 / 算法 | TTFT/排队是否恶化？和 GPU 是否对齐？ |

---

## 3. 看板 A：集群总览

**顶部 Stat（当下）**

- GPU 总数：`count(DCGM_FI_DEV_GPU_UTIL)`  
- 平均利用率：`avg(DCGM_FI_DEV_GPU_UTIL)`  
- 平均显存使用率：`avg(DCGM_FI_DEV_FB_USED / (DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE))`  
- Xid 非零卡数：`count(DCGM_FI_DEV_XID_ERRORS > 0)`  
- 高温卡数（如 >85℃）  

**趋势**

- 集群平均 / P95 利用率（`quantile`）  
- 总功耗：`sum(DCGM_FI_DEV_POWER_USAGE)`  
- 可用卡估算：利用率 &lt; 5% 且显存接近空闲的卡数（自定义）  

**告警列表面板**：接 Alertmanager，只显示 `severity=critical|warning` 的 GPU 规则。

---

## 4. 看板 B：节点与单卡

变量：`Hostname`、`gpu` / `UUID`。

| 行 | 面板 |
|----|------|
| 利用率 | `DCGM_FI_DEV_GPU_UTIL`、`DCGM_FI_PROF_GR_ENGINE_ACTIVE`、`PIPE_TENSOR_ACTIVE` |
| 显存 | FB_USED / FB_FREE 堆叠或百分比 |
| 热力 | GPU_TEMP、MEMORY_TEMP、POWER_USAGE、SM/MEM CLOCK |
| 链路 | PCIE_REPLAY、PCIE_TX/RX、NVLINK_BANDWIDTH |

单卡下钻时与 `nvidia-smi` / `topo -m` 对照（[第 35 篇](../../../gpu/cluster/scheduling/12-GPU%20集群拓扑感知调度.md)）。

---

## 5. 看板 C：Namespace · Pod · 模型

依赖 exporter **Kubernetes 映射**（`-k`）。

变量：`namespace`、`pod`。

建议面板：

- 按 namespace 的 GPU 利用率热力 / TopN  
- 按 pod 的显存占用排行  
- 训练 Job：可关联 Volcano Job label（若有）  
- 空闲占卡：低 util + 高 FB_USED 的 pod 列表（链到第 41 篇）  

没有 Pod 标签时，本层只能用 Hostname+gpu，并在文档中标明限制。

---

## 6. 看板 D：推理业务

数据源仍是 Prometheus，但指标来自 **vLLM `/metrics`**（[第 28 篇](../../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)）与 DCGM **同屏**：

| 左：业务 | 右：GPU |
|----------|---------|
| `num_requests_waiting` | 对应节点 `GPU_UTIL` |
| TTFT / E2E P95 | `FB_USED`、`kv_cache_usage`（业务侧） |
| `generation_tokens` 速率 | `PIPE_TENSOR_ACTIVE` |

关联方法展开见 [第 42 篇](./05-大模型业务指标与%20GPU%20指标关联分析.md)。

Production Stack 自带看板时，可把 DCGM 面板嵌进同一文件夹，统一变量 `cluster` / `model`。

---

## 7. 设计要点

1. **默认时间 1h / 6h**，总览另提供 24h 容量视角  
2. **单位统一**：温度 ℃、功耗 W、显存 GiB、利用率 % 或 0～1 标注清楚  
3. **少花哨**：Stat + Time series + Table TopN 足够  
4. **链接 runbook**：面板描述里挂 39/41/47/48 篇  
5. **用 dcgmproftester 验收**：打满 Tensor 负载后，A/B 看板应明显跳动（博客同款实验）  

---

## 8. 小结

| 看板 | 核心指标 |
|------|----------|
| 集群 | 卡数、均利用率、Xid、功耗 |
| 节点卡 | util / 显存 / 温功耗 / PCIe·NVLink |
| 租户 | namespace/pod 占用与浪费 |
| 推理 | 排队·TTFT ↔ GPU·KV |

下一篇：[GPU 利用率低但显存占满怎么分析](./04-GPU%20利用率低但显存占满怎么分析.md)。

---

## 参考与致谢

- [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)  
- [About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)  
- [Setting up Prometheus](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)  

本文在官方 dashboard 之上给出四层信息架构，便于二次定制。
