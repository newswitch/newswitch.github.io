---
title: GPU 集群完整部署实录
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "vLLM", "部署", "学习路线"]
---

# GPU 集群完整部署实录

> **示例实验环境**：下文是一套**学习用部署记录模板**，**不代表**已在你的集群中实际执行。所有 `<占位符>`、节点名、版本与结果须换成真实数据。架构见 [第 57 篇](./01-生产级%20Kubernetes%20GPU%20集群架构设计.md)。

示例栈：固定版 Kubernetes + containerd + GPU Operator + Volcano + Prometheus/Grafana/DCGM + vLLM。

---

## 1. 环境清单（示例）

| 角色 | 数量 | 说明 |
|------|------|------|
| Control Plane | 3 | CPU |
| CPU Worker | 2 | 基建 |
| GPU Inference | 2 | 每节点 4 GPU |
| GPU Training | 2 | 每节点 8 GPU |
| 对象存储 / 共享存储 | 各 1 | 源仓 / RWX |

记录：`kubectl version`、`containerd --version`、`helm version`、`nvidia-smi`。

---

## 2. 分阶段清单

1. **基础系统**：主机名、时间、DNS、源、内核参数、防火墙、盘挂载；记 OS/内核/IP/容器盘/模型盘。  
2. **Kubernetes**：多控制面、API LB、etcd HA、独立 Worker；`get nodes/pods`、`cluster-info`。勿把单节点学习集群当长期生产。  
3. **containerd**：`config dump`、`crictl info`；SystemdCgroup、CRI、仓库；无生产业务时再重启。  
4. **GPU 节点**：`lspci`、`nvidia-smi`/`-L`/`topo`；记型号、数量、显存、驱动、NUMA、NVLink。  
5. **GPU Operator**：固定 Chart 版安装；预装驱动则 `driver.enabled=false`；验 Pod、ClusterPolicy、Allocatable。  
6. **节点池**：label `pool=inference|training` 等 + GPU Taint。  
7. **CUDA 测试 Pod**：兼容镜像 + Toleration + `nvidia.com/gpu: 1`。  
8. **Volcano**：安装验 pods/queue；production/training Queue 配额示例。  
9. **模型存储**：RWX PVC；对象存储 → Job → 校验 → 固定 Revision → `.complete`（[36](../../foundations/storage/ai-workloads/06-大模型文件在%20Kubernetes%20中的存储方案.md)）。  
10. **监控**：DCGM Exporter Pod；port-forward 看 `/metrics`。  
11. **vLLM Deployment**：2 副本、节点池 + Toleration、固定镜像、`--host 0.0.0.0`、utilization/max-model-len、Startup/Ready/Live、PVC 只读挂载（探针细节 [26](../../ai-systems/inference/serving/04-大模型服务%20Kubernetes%20探针设计.md)）。  
12. **Service**：selector 对齐；`curl .../v1/models`。

---

## 3. 验收与结果记录

基础设施：节点 Ready、系统/Operator 正常、GPU 数正确、无新 Xid。  
模型：加载成功、双副本 Ready、普通/流式/健康 OK。  
性能：利用率、显存、TTFT/TPOT、QPS、P95、KV。  
HA：删一副本仍可服务、可重调度、可重载。

记录：部署日期与各组件版本、模型/GPU/存储/调度器、CUDA/模型/监控/故障切换结果。

下一篇：[故障演练记录（示例）](./03-GPU%20集群故障演练记录.md)。

---

## 参考与致谢

- [Production environment](https://kubernetes.io/docs/setup/production-environment/)
- [Install GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator.html)
- [DCGM-Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)
- [Volcano Scheduler Overview](https://volcano.sh/docs/scheduler/overview/)

本文为**示例部署模板**，按官方安装路径整理，并按本系列交叉链接。
