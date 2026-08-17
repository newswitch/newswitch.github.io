---
title: Kubernetes GPU 集群学习总结
sidebar_label: "04. Kubernetes GPU 集群学习总结"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "学习路线", "总结"]
---

# Kubernetes GPU 集群学习总结

> 实验记录、版本与验收结果请填入自己的真实数据。总路线见 [00](../../gpu/cluster/00-Kubernetes-GPU集群学习路线.md)；进阶 DRA 见 [61](../../gpu/cluster/dra/01-Kubernetes%20DRA%20概念与核心%20API（v1.35+）.md)、[62](../../gpu/cluster/dra/02-DRA%20集群安装与设备分配实践（v1.34+）.md)。

目标：从「会在 K8s 跑 GPU Pod」提升到「能规划、建设、调度、监控、优化和排障生产级 GPU 集群」。

---

## 1. 阶段回顾

| 阶段 | 核心 | 成果感 |
|------|------|--------|
| GPU 基础 | SM/Core/显存/NUMA/NVLink；`nvidia-smi`/`topo` | 读懂指标与拓扑 |
| K8s 接入 | Device Plugin、`nvidia.com/gpu`、Toolkit | 暴露资源、Pending/看不到 GPU 排查 |
| Operator | Driver/Toolkit/Plugin/GFD/DCGM/MIG、ClusterPolicy | 安装、驱动模式、升级回滚 |
| 调度 | Label/Taint、Priority、Volcano Queue/Gang | 节点池与队列、避免半调度 |
| 共享 | 整卡 / Time-Slicing / MPS / MIG / HAMi | 按隔离需求选型 |
| 推理 | vLLM、TP、KV、探针、滚动与优雅退出 | 单多卡部署与升级策略 |
| 存储/冷启动 | PVC、Local PV、Revision、预拉/预热 | 存储链路与阶段耗时 |
| 监控/排障 | DCGM、Xid、OOM、NotReady、六层模型 | 看板告警与系统定位 |
| 治理 | 变更、巡检、架构、部署/演练模板 | 生产闭环 |

知识体系：硬件 → 系统（驱动/Toolkit）→ 平台（K8s/Operator）→ 调度与共享 → 应用（vLLM/NCCL/存储）→ 保障（监控/演练/升级）。

---

## 2. 建议实验清单与交付物

裸机/容器 GPU → K8s GPU Pod → Operator → 标签污点 → Time-Slicing/MIG → vLLM 单卡与 TP → DCGM/告警 → 故障排查 → Drain → 冷启动优化 → 故障演练。

文档资产：架构图、Operator 部署、标签规范、告警策略、巡检脚本、排障手册、变更流程、模型模板、演练与容量表。

仍可深入：多机 TP/PP、DDP/FSDP/DeepSpeed、IB/RoCE/GPUDirect、NCCL 调优、Kueue、DRA、AMD/Ascend。

---

## 3. 自我验收（应能独立回答）

为什么 Pending / 容器看不到 GPU / `nvidia-smi` 失败？显存满但不忙？TP=4 不一定更快？升级为何要额外 GPU？Readiness 失败为何不重启？Time-Slicing 为何无显存隔离？Xid 为何≠硬件损坏？NotReady 为何不一定是 GPU？

---

## 4. 下一阶段计划（示例）

- **第一个月**：补实验记录、巡检脚本、告警、vLLM 基线。  
- **第二个月**：DDP、Gang、NCCL Tests、RDMA。  
- **第三个月**：生产 Demo、演练、升级回滚、容量与成本报告。

---

## 5. 总结

能力应从「能装 GPU 环境」升为：设计集群、部署大模型、管资源、建监控、排障、升级、容量规划。定位：

> **能够负责 Kubernetes GPU 集群、大模型推理平台、资源调度、监控告警和生产稳定性的 AI 基础设施运维工程师。**

---

## 参考与致谢

本总结对应本专栏 [学习路线](../../gpu/cluster/00-Kubernetes-GPU集群学习路线.md) 各阶段正文与官方 NVIDIA / Kubernetes / vLLM / Volcano 文档实践路径。
