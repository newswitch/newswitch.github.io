---
title: Kubernetes 分布式训练基础
date: 2026-07-22 17:30:00
categories: 云原生
tags: ["Kubernetes", "分布式训练", "DDP", "TP", "PP", "Volcano", "学习路线"]
---

# Kubernetes 分布式训练基础

单卡训练脚本能跑通后，上集群会立刻碰到：多进程怎么编号、谁当 Master、何时做集合通信、为什么「起了一半 Worker」会占死 GPU。本文给第六阶段搭地图——并行范式、进程角色、Rendezvous、以及在 Kubernetes / Volcano 上的任务生命周期。代码级 DDP 见 [第 30 篇](./02-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)；Gang 见 [第 18 篇](../../../platform/gpu-cluster/scheduling-sharing/06-Gang%20Scheduling%20在分布式训练中的作用.md)。

推荐先读 PyTorch 官方系列：[什么是 DDP](https://docs.pytorch.org/tutorials/beginner/ddp_series_intro.html)、[使用 DDP 进行多 GPU 训练](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html)（中文镜像）。

---

## 1. 为什么「训练」和「推理」在 K8s 上不一样

| 维度 | 推理（如 vLLM） | 分布式训练（DDP） |
|------|-----------------|-------------------|
| Pod 关系 | 多副本可独立服务 | 一组进程必须同时参与 AllReduce |
| 失败语义 | 重启一个副本即可 | 任一 rank 挂，整组常需一起重启 |
| 调度 | 普通 Deployment 即可 | 强依赖 Gang / 整组调度 |
| 网络 | HTTP/gRPC | NCCL + 进程组（对延迟/丢包敏感） |
| 存储 | 读模型权重 | 读数据 + 写 Checkpoint |

心智模型：训练作业是一次 **集体计算**，不是多个独立服务。

---

## 2. 并行范式速览

```text
数据并行族          模型并行族
─────────────      ─────────────────
DP（过时）          TP（张量并行）
DDP（常用）         PP（流水线并行）
FSDP / ZeRO         混合：3D 并行等
```

| 缩写 | 全称 | 一句话 | 典型场景 |
|------|------|--------|----------|
| **DP** | DataParallel | 单进程多卡，主卡汇总，扩展性差 | 几乎不再用于生产 |
| **DDP** | DistributedDataParallel | 每进程一卡，梯度 AllReduce | 单机多卡 / 多机多卡主力 |
| **FSDP / ZeRO** | 分片数据并行 | 参数/梯度/优化器状态切分省显存 | 大模型装不下单卡时 |
| **TP** | Tensor Parallel | 层内矩阵按卡切分 | 单层太大、需 NVLink |
| **PP** | Pipeline Parallel | 层按阶段切到不同卡/机 | 超深模型、跨机流水 |

本阶段以 **DDP** 为主线；显存不够再看 [第 31 篇 ZeRO](./03-DeepSpeed%20ZeRO%20与%20GPU%20显存优化.md)；通信细节见 [第 33 篇 NCCL](./05-NCCL%20通信原理与常见问题.md)。

---

## 3. Rank、World Size、Local Rank

| 概念 | 含义 |
|------|------|
| **world_size** | 参与本次作业的进程总数（常 = 使用的 GPU 总数） |
| **rank** | 全局进程编号，`0 … world_size-1`；**rank 0** 常负责日志、存盘、写 metrics |
| **local_rank** | 本机内的 GPU 编号（0 … nproc_per_node-1） |
| **node_rank** | 机器编号（多机时） |

单机 4 卡：`world_size=4`，`rank=local_rank=0..3`。  
两机各 4 卡：`world_size=8`，机 0 上 `rank=0..3`，机 1 上 `rank=4..7`。

官方单机多卡教程里用 `mp.spawn` 自动分配 rank；上 K8s 后多用 **torchrun** / 环境变量注入同等信息。

---

## 4. 进程组与 Rendezvous

**进程组（Process Group）**：所有可互相通信、同步的进程集合。GPU 训练后端几乎总是 **NCCL**。

初始化前必须约定「在哪碰头」——**Rendezvous**：

| 方式 | 环境变量 / 机制 | 场景 |
|------|-----------------|------|
| TCP Store | `MASTER_ADDR` + `MASTER_PORT` | 经典；rank0 所在地址 |
| 共享文件系统 | file:// | 少见 |
| torchrun / elastic | `c10d` rendezvous | 推荐；支持弹性与容错系列教程 |

单机官方示例：

```python
os.environ["MASTER_ADDR"] = "localhost"
os.environ["MASTER_PORT"] = "12355"
torch.cuda.set_device(rank)  # 先绑卡，再 init，避免全挤到 GPU0
init_process_group(backend="nccl", rank=rank, world_size=world_size)
```

多机时：`MASTER_ADDR` = **rank0 所在 Pod/节点可达地址**（常 rank0 的 Pod IP 或 Headless Service 名），所有 Worker 必须在超时内完成 `init_process_group`，否则表现为 **卡住 / NCCL timeout**。

---

## 5. Master / Worker 在训练里到底指什么

容易和参数服务器（PS）混淆：

| 说法 | 在 DDP 里 |
|------|-----------|
| **Rank 0（常称 master）** | 仍参与完整前向/反向与 AllReduce；额外承担保存 Checkpoint、打日志、有时当 TCP store 宿主 |
| **其它 ranks（workers）** | 同等训练进程，不是「只干活不上报」的从节点 |
| **PS 架构** | 另有参数服务器角色；**标准 DDP 不是 PS** |

K8s 上常见两种编排：

1. **对称 Worker**：`replicas: N`，每个 Pod 一个（或一组）rank，用 torchrun 拼 world  
2. **显式 master + worker**：少数框架仍区分；DDP + torchrun 更常见对称模式  

无论哪种，**调度层**都要把「这一组 Pod」当成一个 Job——这就是 Volcano Gang 的用武之地。

---

## 6. 单机多卡 vs 多机多卡

```text
单机多卡                     多机多卡
─────────                   ─────────
1 Pod / 1 节点              N Pod（常每 Pod 1～多卡）
NVLink / PCIe 为主          跨机走 RoCE / IB / 以太网
MASTER_ADDR=localhost       MASTER_ADDR=rank0 服务发现
shm 要够大                  还要通端口、DNS、防火墙
```

| 检查项 | 单机 | 多机 |
|--------|------|------|
| GPU 申请 | `nvidia.com/gpu: N` | 每 Pod 申请本地卡数之和 = world_size |
| `/dev/shm` | emptyDir Memory，TP/DDP 都敏感 | 每 Pod 都要配 |
| 网络 | 本机 NCCL | 跨节点带宽与 RDMA 常成瓶颈 |
| 调度 | 一 Pod 占满节点卡 | Gang：`minAvailable` = Worker 数 |

拓扑与跨机性能见后续第 34、35 篇规划。

---

## 7. 训练任务在 Kubernetes 上的生命周期

```text
提交 Job / VolcanoJob
    ↓
调度（Queue 配额 + Gang 凑齐）
    ↓
拉镜像 / 挂数据与 Checkpoint 卷
    ↓
各 Pod 启动 → Rendezvous → init_process_group
    ↓
训练循环（AllReduce / 存盘）
    ↓
成功结束 或 任一 rank 失败
    ↓
整组退出 / 按策略重启并从 Checkpoint 恢复
```

关键失败模式：

1. **半组 Running**：无 Gang → GPU 空转（第 18 篇）  
2. **Rendezvous 超时**：地址错、端口未通、有 Pod 未起来  
3. **训练中 Worker 挂掉**：集合通信死等 → 需弹性重启 + Checkpoint（第 32 篇）  
4. **NCCL 超时**：网络 / 拓扑 / 防火墙（第 33、48 篇）  

---

## 8. 和本系列组件怎么拼

```text
GPU Operator / Device Plugin  → 暴露 nvidia.com/gpu
Volcano Queue                 → 训练队列配额
Volcano Gang + minAvailable   → 整组启动
PyTorch DDP + torchrun        → 进程组与数据并行
共享存储 PVC                  → 数据与 Checkpoint
NCCL +（可选）RDMA            → 梯度同步性能
Prometheus / 日志             → 卡住时看 GPU 利用率与 NCCL 日志
```

---

## 9. 小结

| 问题 | 答案要点 |
|------|----------|
| 为什么不用 DP？ | 单进程多卡，扩展差；用 DDP |
| rank 0 特殊在哪？ | 仍训练；额外负责存盘/日志/常作 rendezvous |
| K8s 最容易踩的坑？ | 半组调度、MASTER_ADDR、shm、NCCL 跨机 |
| 下一篇学什么？ | 把官方单机 DDP 改造成 VolcanoJob |

继续：[PyTorch DDP 在 Kubernetes 中的部署](./02-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)。

---

## 参考与致谢

- [使用 DDP 进行多 GPU 训练](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html)  
- [What is Distributed Data Parallel](https://docs.pytorch.org/tutorials/beginner/ddp_series_intro.html)  
- [PyTorch Distributed Overview](https://pytorch.org/tutorials/beginner/dist_overview.html)  
- [Volcano Gang](https://volcano.sh/zh-Hans/docs/Scheduler/Plugins/gang)  

本文串联官方 DDP 概念与本系列 K8s GPU / Volcano 路线，便于后续实操篇引用。
