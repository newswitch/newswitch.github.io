---
title: GPU 集群故障演练记录
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "故障演练", "PDB", "演练", "学习路线"]
---

# GPU 集群故障演练记录

> **示例实验环境**：下文场景与「结论示例」用于学习跟练，**不代表**已在你的集群中实际执行。占位符与结果请换成真实演练数据。只在测试环境或已隔离节点操作；准备恢复命令与停止条件。

目标：验证监控告警、排查流程、业务冗余、恢复时间与协作。

**勿人为制造**：真实 Xid 79、强制掉卡、过热、驱动崩溃、破坏性 ECC——改用告警测试、日志回放、历史复盘、节点隔离模拟。

---

## 1. 记录模板

演练编号/名称/时间/环境/范围/人员；目标、前置、注入、预期、告警、排查、恢复、MTTR、是否达标、遗留与改进。指标：MTTD / MTTA / MTTR，以及错误请求、断流、降级时间、冷启动、人工操作次数。

---

## 2. 场景摘要（示例）

| 场景 | 注入 | 预期验证 |
|------|------|----------|
| 删 vLLM Pod | `delete pod` | Deployment 重建、摘 Endpoint、剩余副本可服务；记冷启动与 Ready |
| 重建 Device Plugin | 删对应节点 Plugin Pod | 自动恢复；已有 GPU Pod 影响；Allocatable |
| 节点维护 | cordon + drain | PDB 是否阻塞、迁移、GPU 余量、容量下降；uncordon |
| Service Selector 错 | **仅测试 NS** patch 错误 selector | Endpoint 空、请求失败、Pod 仍正常；apply 备份恢复 |
| Readiness 失败 | 探针指不存在路径 | Running、READY=0/1、不进后端、**不因 Ready 重启** |
| CUDA OOM | 专用测试卡受控加压 | 日志/告警/重启/显存释放；有上限与删除预案 |
| DCGM Exporter 不可用 | 删 Exporter Pod | 自动恢复、Target 短暂 Down、**与 GPU 故障分开告警** |
| GPU Pod Pending | GPU 已满再申请 | Pending + Insufficient；资源不足告警 |

PDB **不能**防崩溃/宕机，主要限制主动驱逐并发不可用；`drain` 会遵守 PDB。

---

## 3. 结论示例（学习用）

部分通过：删 Pod 可重建、Service 可摘流、剩余副本可服务。问题：冷启动 12 分钟、Startup 上限仅 10 分钟、共享存储读慢。改进：加长 Startup、建 NVMe 缓存、加冷启动监控、下次验本地缓存。

下一篇：[学习总结](./04-Kubernetes%20GPU%20集群学习总结.md)。

---

## 参考与致谢

- [Disruptions / PDB](https://kubernetes.io/zh-cn/docs/concepts/workloads/pods/disruptions/)
- [Configure Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [DCGM-Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)

本文为**示例演练模板**，按官方 Disruption/探针文档整理，并按本系列交叉链接。
