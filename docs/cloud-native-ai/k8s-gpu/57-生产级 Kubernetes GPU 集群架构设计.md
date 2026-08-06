---
title: 生产级 Kubernetes GPU 集群架构设计
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "架构", "高可用", "学习路线"]
---

# 生产级 Kubernetes GPU 集群架构设计

> 规模与节点池划分仅为**学习示例**，请按真实容量替换。生产还需：控制面 HA、节点池、调度队列、模型存储、RDMA、监控、多租户、升级、容量成本与故障恢复——不只是「K8s + GPU + Device Plugin」。

设计目标：高可用、可扩展、可观测、可调度、可隔离、可维护、可恢复、可审计。节点池与配额见 [51](./51-生产%20GPU%20集群节点池规划.md)、[52](./52-GPU%20多租户与资源配额设计.md)。

---

## 1. 示例规模与总体架构

示例：3 控制面 + 3 基建 CPU + 4 推理 GPU + 4 训练 GPU + 2 共享开发；硬件可分 T4/A10 推理、A100/H100 大模型、MIG、共享测试、训练池。

```text
用户 → AI Gateway/Ingress（鉴权限流路由）
  → 在线推理池（Deployment/vLLM） | 训练池（VolcanoJob/DDP）
  → GPU Operator（Driver/Toolkit/Plugin/DCGM） + Volcano Queue/Gang
  → Prometheus/Grafana/Alert + 日志追踪
模型：对象存储 → 共享存储 → 节点 NVMe → vLLM
```

控制面：≥3 节点、API LB、奇数 etcd、定期备份、与 GPU Worker 分离。

---

## 2. 节点池、标签与软件栈

| 池 | 要点 |
|----|------|
| 在线推理 | 稳定驱动、固定模型、独占、高优、PDB、跨节点副本 |
| 训练 | 多卡/多机、RDMA、NVLink、Gang、Checkpoint |
| 开发共享 | Time-Slicing/HAMi、低优可抢占、严配额 |
| MIG | 固定 Profile、多租户、单独维护窗 |

`gpu.example.com/pool|usage|network` + 对应 Taint/Toleration。软件栈：Driver、Toolkit、Operator、Plugin、GFD、DCGM、MIG Manager；特殊内核可用宿主机预装驱动。

---

## 3. 调度、存储、网络

在线：Deployment + PriorityClass + Affinity/Anti-Affinity + TopologySpread + PDB。训练：Volcano Queue/PodGroup/Job、Gang、DRF/Binpack/抢占。

存储分层：对象仓 → 共享 RWX → 本地 NVMe 缓存 → PVC；固定 Revision，勿依赖 `latest`（[36](./36-大模型文件在%20Kubernetes%20中的存储方案.md)）。训练关注 NUMA/RDMA/NCCL；在线关注网关超时、流式、LB。

---

## 4. 可观测、安全、HA、容量

指标：node_exporter、kube-state-metrics、DCGM、vLLM `/metrics`、组件与模型日志。告警分基础设施 / GPU（Xid、ECC、掉卡、温度、Plugin）/ 模型（错误率、TTFT/TPOT、排队、KV、探针）。

多租户：Namespace、RBAC、Quota、Queue、NetworkPolicy、Secret、PSA、审计。HA：≥2 模型副本跨节点、网关/控制面/CoreDNS/存储/监控多副本；**预留滚动升级 GPU**。容量表：物理/可分配/已申请、利用率、副本与单模型 GPU、训练峰值、故障/升级/突发冗余（[53](./53-GPU%20集群容量规划方法.md)、[54](./54-GPU%20集群成本与利用率分析.md)）。

---

## 5. 本篇总结

```text
HA K8s + 分层节点池 + Operator + 队列/Gang
+ 分层存储 + GPU/业务监控 + 多租户 + 灰度升级 + 故障恢复
```

下一篇先进入端到端串联：[一个 GPU Pod 从提交到开始计算经历了什么](./57b-一个GPU-Pod从提交到开始计算经历了什么.md)。完成 57b～57f 后，再做[完整部署实录（示例）](./58-GPU%20集群完整部署实录.md)。

---

## 参考与致谢

- [Production environment | Kubernetes](https://kubernetes.io/docs/setup/production-environment/)
- [Creating HA Clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)
- [GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)
- [Volcano Gang / Scheduler Overview](https://volcano.sh/docs/scheduler/plugins/gang/)

本文按官方生产与调度文档整理，并按本系列交叉链接。
