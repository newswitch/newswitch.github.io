---
title: GPU 服务器硬件拓扑与 NUMA
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "NUMA", "PCIe", "NVLink", "学习路线"]
---

# GPU 服务器硬件拓扑与 NUMA

单卡场景里，通常只要关心显存和 GPU 利用率。进入多卡推理、分布式训练、RDMA 和 NCCL 后，PCIe 插槽、CPU Socket、NUMA、网卡位置以及 GPU 互联方式都会影响传输效率。

同一台机器上的 GPU，访问路径未必相同，例如：

```text
GPU0 → CPU0 → 内存0
GPU1 → CPU0 → 内存0
GPU2 → CPU1 → 内存1
GPU3 → CPU1 → 内存1
```

GPU0 访问由 CPU1 管理的远端内存时，可能跨 NUMA。Linux 把访问延迟/带宽不同的 CPU、内存划分为不同 NUMA Node，可用 CPU 亲和与内存策略改善局部性。前置概念见：[GPU 基础知识](./01-GPU%20基础知识：从计算核心到显存.md)。

---

## 1. 学习目标

1. 理解 CPU Socket、Core、NUMA Node 的关系；  
2. 理解 GPU 如何通过 PCIe 连接 CPU；  
3. 看懂 `nvidia-smi topo -m`；  
4. 判断 GPU 与 CPU、内存、网卡的亲和关系；  
5. 判断多卡任务是否跨 NUMA、PCIe Host Bridge 或 NVLink；  
6. 为多卡推理 / 分布式训练选更合理的 GPU 组合。

---

## 2. 什么是 NUMA

```text
Non-Uniform Memory Access（非统一内存访问）
```

多路 CPU 服务器中，每颗 CPU 通常直连一部分本地内存：

```text
NUMA Node 0
├── CPU Socket 0
├── CPU 0-31
└── Memory 0

NUMA Node 1
├── CPU Socket 1
├── CPU 32-63
└── Memory 1
```

CPU0 访问 Memory0 为本地访问，访问 Memory1 为远端访问。NUMA 内存策略决定进程从哪个节点分配内存；CPU / 内存绑定可提高局部性。

```text
本地内存：离当前 CPU 更近
远端内存：需经 CPU 间互联访问
```

远端内存仍可访问，只是路径、延迟和带宽可能不同。

---

## 3. GPU 服务器的简化拓扑

双路 CPU、四张 GPU 的常见形态：

```text
                    ┌───────────────┐
                    │ CPU Socket 0  │
                    │ NUMA Node 0   │
                    └───────┬───────┘
                            │
                    PCIe Host Bridge
                       ┌────┴────┐
                     GPU0      GPU1

      CPU 间互联
          │
          ▼

                    ┌───────────────┐
                    │ CPU Socket 1  │
                    │ NUMA Node 1   │
                    └───────┬───────┘
                            │
                    PCIe Host Bridge
                       ┌────┴────┐
                     GPU2      GPU3
```

在此结构下：

- GPU0 与 GPU1、GPU2 与 GPU3 通常更近；  
- GPU0 与 GPU2 通信可能经 CPU 间互联；  
- GPU0 读 NUMA 1 的数据可能发生远端内存访问；  
- 网卡所在 NUMA 也会影响 GPU↔RDMA 路径。

---

## 4. PCIe、NVLink 和 NVSwitch

### 4.1 PCIe

GPU 与 CPU、网卡、NVMe 等之间的常见总线。GPU 可能：直连 Root Complex、经一个或多个 PCIe Switch、跨 Socket 与另一张 GPU 通信。

### 4.2 NVLink

NVIDIA 的 GPU 高速互联。有 NVLink 时可减轻部分 GPU 间通信对 PCIe / CPU 的依赖。

### 4.3 NVSwitch

用于连接更多 GPU，形成更高带宽互联。

> 有多张 GPU ≠ 一定有 NVLink。必须用拓扑命令确认。

---

## 5. 查看 CPU 和 NUMA

### 5.1 lscpu

```bash
lscpu
lscpu | grep -i numa
```

关注：`CPU(s)`、`Socket(s)`、`Core(s) per socket`、`Thread(s) per core`、`NUMA node(s)` 及各 node 的 CPU 列表。

### 5.2 numactl

```bash
# yum install -y numactl   或  apt install -y numactl
numactl --hardware
# 简写：numactl -H
```

典型输出含各 node 的 CPU、内存大小/空闲，以及 `node distances`（数值越小通常越近）。

---

## 6. 查看 GPU PCIe 信息

```bash
nvidia-smi -L

nvidia-smi \
  --query-gpu=index,name,uuid,pci.bus_id \
  --format=csv

lspci | grep -i nvidia
lspci -tv
```

用 PCI Bus ID 把 `nvidia-smi` 中的 GPU 与 `lspci` 设备对应起来。

---

## 7. 使用 nvidia-smi 查看拓扑

```bash
nvidia-smi topo -m
```

展示 GPU、网卡连接矩阵及 CPU / 内存亲和。主要标记：

| 标记 | 含义 |
|------|------|
| `X` | 当前设备自身 |
| `PIX` | 经过一个 PCIe Switch |
| `PXB` | 经过多个 PCIe Switch |
| `PHB` | 经过 PCIe Host Bridge（通常涉及 CPU） |
| `NODE` | 同一 NUMA 内跨 PCIe Host Bridge |
| `SYS` | 跨 NUMA / CPU 间互联 |
| `NV#` | 经过若干条绑定的 NVLink |

通常 `NV#`、`PIX` 比跨 NUMA 的 `SYS` 更适合高频 GPU 间通信；最终仍以 NCCL 实测为准。

示例：

```text
        GPU0  GPU1  GPU2  GPU3  CPU Affinity  NUMA Affinity
GPU0      X    NV2   SYS   SYS      0-31            0
GPU1     NV2    X    SYS   SYS      0-31            0
GPU2     SYS   SYS    X    NV2     32-63            1
GPU3     SYS   SYS   NV2    X      32-63            1
```

解读：GPU0/1 在 NUMA 0 且有 NVLink；GPU2/3 在 NUMA 1 且有 NVLink；两组之间通信需跨 NUMA。

---

## 8. 进一步查看亲和关系

```bash
nvidia-smi topo -C -i 0    # 最近的 CPU NUMA
nvidia-smi topo -M -i 0    # 最近的内存 NUMA

nvidia-smi topo -p2p r     # P2P Read
nvidia-smi topo -p2p w     # P2P Write
nvidia-smi topo -p2p n     # NVLink P2P
```

较新版本还可能支持 `-cpu` / `-gpu` / `-nic` / `-nvme` / `-all`。先看帮助：

```bash
nvidia-smi topo -h
```

命令细节也可对照：[nvidia-smi 常用命令与指标说明](./06-nvidia-smi%20常用命令与指标说明.md)。

---

## 9. NUMA 绑定实验

```bash
numastat -p <PID>

numactl --cpunodebind=0 --membind=0 python3 app.py
numactl --preferred=0 python3 app.py

taskset -cp <PID>
taskset -c 0-31 python3 app.py
```

生产环境勿在不了解应用线程模型与 Kubernetes CPU Manager 时随意绑定，先用基准测试对比。

---

## 10. 多卡任务如何选 GPU

若拓扑为 `GPU0-GPU1: NVLink`、`GPU2-GPU3: NVLink`、`GPU0-GPU2: SYS`，两卡 Tensor Parallel 优先：

```bash
CUDA_VISIBLE_DEVICES=0,1 python3 app.py
```

而不是 `0,2`。四卡无法避免跨 NUMA 时，还需关注：NCCL 网卡、CPU 是否跨 NUMA、数据加载用哪个 NUMA 内存、GPU 与 RDMA 距离、是否有 NVLink/NVSwitch、跨卡带宽是否达标。

后续：[InfiniBand、RoCE 与 GPU 集群网络](../../networking/ai-cluster/01-InfiniBand、RoCE%20与%20GPU%20集群网络.md)、[GPU 集群拓扑感知调度](../../../platform/gpu-cluster/scheduling-sharing/12-GPU%20集群拓扑感知调度.md)。

---

## 11. 实验记录模板

```text
服务器型号 / CPU 型号 / Socket 数 / NUMA Node 数 / 内存总量
GPU 型号与数量 / PCI Bus ID / 对应 NUMA
GPU 间连接 / 与网卡关系 / 是否 NVLink
```

保存：

```bash
lscpu
numactl -H
lspci -tv
nvidia-smi -L
nvidia-smi topo -m
nvidia-smi topo -p2p r
```

---

## 12. 常见误区

1. **同机 GPU 性能完全一样**：型号可相同，PCIe / NUMA / 网卡亲和可能不同。  
2. **卡越多一定线性加速**：跨卡通信、PCIe、NVLink、NCCL、CPU、网络都可能成瓶颈。  
3. **只看 GPU 编号判断距离**：GPU0 与 GPU1 不一定物理相邻。  
4. **CPU 绑定与 GPU 无关**：预处理、网络收发、发起 CUDA 都在 CPU；CPU/内存远离 GPU 会增加开销。

---

## 13. 本篇总结

性能还取决于：CPU Socket、NUMA、PCIe、NVLink、NVSwitch、网卡、NVMe。核心检查：

```bash
lscpu
numactl -H
lspci -tv
nvidia-smi topo -m
```

数据路径补充：[CPU 与 GPU 之间的数据搬运](./04-CPU与GPU之间的数据搬运.md) → [NVLink 与 NVSwitch 原理](./05-NVLink与NVSwitch原理.md)；主线下一篇：[nvidia-smi 常用命令与指标说明](./06-nvidia-smi%20常用命令与指标说明.md)。

---

## 参考与致谢

- [NUMA Memory Performance — Linux Kernel](https://docs.kernel.org/admin-guide/mm/numaperf.html)
- [NUMA Memory Policy — Linux Kernel](https://docs.kernel.org/admin-guide/mm/numa_memory_policy.html)
- [NVIDIA System Management Interface（nvidia-smi）](https://docs.nvidia.com/deploy/nvidia-smi/index.html)

本文按内核文档与 nvidia-smi 说明整理，并按本系列做了交叉链接。
