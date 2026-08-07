---
title: GPU 集群拓扑感知调度
date: 2026-07-22 18:10:00
categories: 云原生
tags: ["Kubernetes", "GPU", "拓扑", "NUMA", "NVLink", "NCCL", "学习路线"]
---

# GPU 集群拓扑感知调度

同样 8 张卡，**同 NVLink 域内** 的 AllReduce 与 **跨 PCIe / 跨 NUMA / 跨交换机** 可以差一个数量级。拓扑感知调度的目标：让需要密通信的进程，尽量落在「高速互连」的 GPU 集合上。本文结合 `nvidia-smi topo`、NCCL [GPU troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html) 与 Kubernetes 调度实践。前置：[第 33](../../../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)、[第 02 篇：GPU 服务器硬件拓扑与 NUMA](../../../foundations/compute/gpu/03-GPU%20服务器硬件拓扑与%20NUMA.md)。

---

## 1. 为什么调度要懂拓扑

| 放置 | 通信路径 | 结果 |
|------|----------|------|
| 同机、NVLink 全连接 | NVLink P2P | 机内 DDP/TP 友好 |
| 同机、仅 PCIe，跨 socket | 经 CPU root complex | 带宽下降、延迟上升 |
| ACS 开启干扰 P2P | 点对点被拐到 CPU | 更慢甚至 hang |
| 跨机、无 RDMA | Socket | 多机训练易饿 GPU |
| 跨机、IB/RoCE + GDR | RDMA | 可扩展，但仍慢于机内 NVLink |

训练作业：优先 **整节点占满** 或 **按 NVLink 岛装箱**；推理多副本则另论。

---

## 2. 读懂 `nvidia-smi topo -m`

```bash
nvidia-smi topo -m
```

矩阵字母含义（以当前驱动帮助为准，常见包括）：

| 符号（示例） | 含义直觉 |
|--------------|----------|
| NV# | NVLink，数字表示链路数/代际相关信息 |
| PIX / PXB | 经 PCIe，同 switch 或跨 bridge |
| PHB | 经 PCIe Host Bridge |
| NODE / SYS | 跨 NUMA / 跨 socket |
| X | 自身 |

同时看 GPU 与 **NIC** 的相对位置：GDR 最好 GPU 与训练网卡在同一 PCIe 域/近距离。

P2P 能力：

```bash
nvidia-smi topo -p2p p   # PCIe
nvidia-smi topo -p2p n   # NVLink
```

期望训练用到的 GPU 对之间为 `OK`。测带宽推荐 [nvbandwidth](https://github.com/NVIDIA/nvbandwidth)；功能验证可用 CUDA `simpleP2P`（最终应 `Test passed`）。

对比实验：

```bash
NCCL_P2P_DISABLE=1   # 或调整 NCCL_P2P_LEVEL
```

若关闭 P2P 后「问题消失但变慢」→ 指向 P2P/ACS/驱动路径；若关闭后依旧挂 → 更可能是网络或应用逻辑。

---

## 3. ACS：拓扑看起来 OK，NCCL 仍惨

官方要点：IO 虚拟化（VT-d / IOMMU）下 **PCI ACS** 可能把点对点流量拐到 CPU，导致性能暴跌或 hang。

```bash
sudo lspci -vvv | grep ACSCtl
# 若见 SrcValid+，结合完整 lspci 判断桥片是否启用 ACS
```

裸机：可在 BIOS 关 VT-d，或对 PLX 桥等用 `setpci` 清 ACS（重启可能恢复，需脚本固化）。官方示例：

```bash
sudo setpci -s 03:00.0 ECAP_ACS+0x6.w=0000
```

**虚拟机**：ACS 通常不能关（VM 依赖）；要高性能需在网卡侧启用 **ATS** 等，按云厂商文档操作。

---

## 4. 容器与 `/sys` 拓扑

NCCL 通过 **`/sys`** 发现 GPU 与网卡的 PCI 拓扑。容器中若 `/sys` 不完整或呈虚拟拓扑，会选次优算法。

实践：

- GPU Operator / device plugin 场景确认拓扑相关挂载  
- 对比「宿主机 `nvidia-smi topo -m`」与「容器内同命令」是否一致  
- 可疑时在 Privileged/调试 Pod 中复现  

---

## 5. Kubernetes 上怎么「感知拓扑」

### 5.1 简单而有效的策略

| 策略 | 做法 |
|------|------|
| 整节点训练 | 一 Job 占满节点所有 GPU（`nvidia.com/gpu: N` = 节点卡数） |
| 节点池隔离 | 标签 `gpu-topology=nvlink-8` / `pcie-only`；Job nodeSelector |
| 反亲和 | 多机 Job 的 Pod 打散到不同节点；单机多卡则同节点硬亲和 |
| Volcano / binpack | 减少碎片，避免「每节点 1 卡」拼世界（跨机通信爆炸） |

### 5.2 拓扑标签从哪来

- [GFD](../device-runtime/02-NVIDIA-Device-Plugin部署与配置.md) / Node Feature Discovery：暴露型号、驱动、部分 PCIe 信息  
- 人工或 DaemonSet 脚本：解析 `nvidia-smi topo -m`，打 `nvlink.domain` 等自定义标签  
- 进阶：调度器扩展 / DRA / 厂商拓扑感知插件（视集群版本）  

### 5.3 和 Gang 一起用

跨机 DDP：`minAvailable = worker 数`，且每个 worker 申请的卡落在「同构节点池」。否则 Gang 凑齐了，但拓扑天差地别，作业能跑却极慢——监控上像「GPU 利用率低、NCCL 时间占比高」。

---

## 6. 单机多卡 vs 跨机：调度决策树

```text
模型通信以机内为主（DDP 单机 / TP）
  → 尽量 1 Pod 多卡，绑 NVLink 节点
  → 检查 P2P OK、ACS 关闭

必须多机（卡数不够 / ZeRO 大）
  → 节点池：同型号 + 同 RDMA 网
  → Gang 整组 + IB/RoCE 基线（第 34 篇）
  → 避免「很多节点各 1 卡」除非网络极强且必要

推理副本
  → 拓扑次要；优先显存与延迟隔离
```

---

## 7. 小结

| 工具 | 用途 |
|------|------|
| `nvidia-smi topo -m` | 看 NVLink / PCIe / NUMA / NIC |
| `topo -p2p` | 验证 P2P |
| ACS / peermem | GPU Direct 能否真正直通 |
| K8s 标签 + 整节点/装箱 | 把作业放进高速岛 |
| NCCL GRAPH 日志 | 确认运行时拓扑认知 |

网络侧基线见 [34](../../../foundations/networking/ai-cluster/01-InfiniBand、RoCE%20与%20GPU%20集群网络.md)；超时复盘见 [48](../troubleshooting/07-NCCL%20Timeout%20排查流程.md)。

---

## 参考与致谢

- [GPU troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)  
- [NCCL Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)  
- [nvbandwidth](https://github.com/NVIDIA/nvbandwidth)  

本文把官方 GPU/拓扑排障要点落到 Kubernetes 调度选择上。
