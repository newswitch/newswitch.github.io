---
title: GPU 节点巡检体系设计
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "巡检", "DCGM", "运维", "学习路线"]
---

# GPU 节点巡检体系设计

> 节点名、路径、指标阈值请换成真实环境。巡检 ≠ 只跑 `nvidia-smi`。深度 DCGM 诊断会占 GPU，**勿在承载业务的卡上直接跑**。监控指标见 [第 38 篇](../../../engineering/observability/gpu/01-DCGM%20Exporter%20GPU%20监控指标详解.md)。

目标：早发现故障与版本漂移、资源/性能异常、监控缺失；形成趋势，服务升级与容量规划。

---

## 1. 频率

| 频率 | 内容 |
|------|------|
| 实时 | Prometheus 告警 |
| 每日 | 节点、GPU、Pod、错误 |
| 每周 | 版本、容量、利用率、日志趋势 |
| 每月 | 深度诊断、容量与变更审计 |
| 变更前后 | 专项完整巡检 |

---

## 2. 分层检查清单

1. **硬件**：`lspci` GPU 数、Xid/AER、IPMI SEL/温度。  
2. **OS**：uptime、内存、磁盘/inode、vmstat、kubelet/containerd 状态、内核与运行时版本、OOM。  
3. **K8s 节点**：Ready / Pressure、污点、异常 phase Pod。  
4. **驱动**：`nvidia-smi`、`-q`、`-L`、`topo`、compute-apps。  
5. **Operator**：gpu-operator Pod、ClusterPolicy、Capacity/Allocatable、GFD 标签。  
6. **健康指标**：利用率、显存、温度、功耗、Xid、ECC、PCIe Replay、NVLink、降频；PromQL 如 `DCGM_FI_DEV_XID_ERRORS != 0`。  
7. **网络/存储**：网卡/RDMA、模型盘 `df`/`du`、受控 `dd` 读测（避开高峰）。  
8. **业务**：`/health`、`/v1/models`、`/metrics`；错误率、等待、KV、TTFT/TPOT。

---

## 3. 自动巡检脚本原则

只读采集：日期、uptime、内存磁盘、`nvidia-smi` 与 CSV 状态、topo、最近 Xid。**不做**：GPU Reset、重启服务、删 Pod、Drain、卸驱动。输出带时间戳的报告路径。

报告模板分节：节点 / 硬件 / 驱动 Toolkit / Operator / 利用率 / 温功耗 / Xid ECC / 网络存储 / 模型服务 / 告警 / 风险 / 计划。分级：严重（掉卡、Xid 79、NotReady）→ 高（ECC DBE、驱动异常）→ 中（高温、显存长期 >95%）→ 低/提示（利用率低、版本漂移、待升级）。

---

## 4. 本篇总结

```text
实时监控 + 每日轻量 + 每周趋势 + 每月深度 + 变更前后专项
```

下一篇：[生产级架构设计](../../../projects/gpu-cluster/01-生产级%20Kubernetes%20GPU%20集群架构设计.md)。

---

## 参考与致谢

- [DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/dcgm-diagnostics.html)
- [DCGM-Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)

本文按 DCGM 与运维实践整理，并按本系列交叉链接。
