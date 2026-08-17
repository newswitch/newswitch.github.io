---
title: GPU 到 GPU 通信综合实验
sidebar_label: "10. GPU 到 GPU 通信综合实验"
sidebar_position: 10
tags: [Lab, GPU, RDMA, GPUDirect, NCCL]
description: 用两台 GPU 服务器完成 Socket、Host RDMA、GPU RDMA 和 NCCL 的分层验证与故障注入。
---

# GPU 到 GPU 通信综合实验

这个项目验收第一阶段。目标是从一个训练 Collective 出发，证明数据实际经过哪张 GPU、
哪张 NIC、哪条 Rail 和哪种 Transport。

## 1. 环境

最低推荐：

- 2 台 GPU 服务器；
- 每台至少 2 张 GPU；
- 每台至少 1 张 RDMA NIC；
- InfiniBand 或隔离的 RoCE 实验 Fabric；
- CUDA、NCCL、rdma-core、perftest、nccl-tests；
- 统一 NTP；
- 有权限读取交换机端口计数。

没有 GPU RDMA 硬件时，可以完成拓扑、Host RDMA 和单机 NCCL 部分，并明确未验证项。

## 2. 交付拓扑

```text
Rank 0 / GPU0 / PCI BDF / NUMA
→ Preferred NIC / RDMA Device / GID-LID
→ Switch Port / Rail
→ Remote Switch Port
→ Remote NIC
→ Rank 1 / GPU0
```

同时保存：

- `nvidia-smi topo -m`；
- `lspci -tv`；
- `ibv_devinfo`、`show_gids`/`ibstat`；
- IP/路由/MTU；
- 物理线缆与交换端口表。

## 3. 阶段 A：基础和 Host RDMA

验收：

1. 物理 Link Speed/Width 符合设计；
2. IB Port Active 或 RoCE GID/路由正确；
3. 路径 MTU 一致；
4. `rping` 成功；
5. `ib_write_bw` 和 `ib_write_lat` 完成消息矩阵；
6. 测试期间无新增链路错误；
7. 结果与同类健康节点基线一致。

## 4. 阶段 B：GPU Memory RDMA

按平台支持选择 Peer Memory 或 DMA-BUF：

1. 验证驱动和内核模块；
2. 对近端 GPU/NIC 执行 GPU Memory perftest；
3. 对远端 NUMA 组合执行对照；
4. 比较 Host Memory 与 GPU Memory；
5. 记录 PCIe、NIC 和 GPU 状态；
6. 证明数据使用 GPU Buffer。

结果低不能直接归因于网络。先检查 PCIe Link、ACS/IOMMU、拓扑和驱动。

## 5. 阶段 C：NCCL

测试：

```text
单机 AllReduce
双机 AllReduce
AllGather
ReduceScatter
All-to-All
8B～1GiB 消息范围
```

保存 NCCL INFO 日志，证明：

- Rank 和 GPU 映射；
- 网络接口/HCA；
- NET/IB 或 NET/Socket；
- GDR 状态；
- Channel/算法/协议；
- 单 Rail 或 Multi-Rail。

## 6. 三路径对比

| 路径 | 如何构造 | 要证明什么 |
|---|---|---|
| Socket | 实验中禁用 RDMA Transport | TCP 基线与接口选择 |
| Host RDMA | perftest 使用系统内存 | Fabric 与 RDMA 基线 |
| GPU RDMA | perftest/NCCL 使用 GPU Memory | GDR 和 GPU-NIC 路径 |

不要把不同工具的数字直接横向相除。每一层的口径不同，重点是建立因果证据。

## 7. 故障注入

### 故障一：错误网络接口

让 NCCL 选择管理网。观察日志、NIC 流量和性能，修复后验证。

### 故障二：错误 GID/Netdev

在隔离环境选择不匹配条目，记录失败发生在地址解析、建连还是数据面。

### 故障三：GPU/NIC 远端 NUMA

把 Rank 绑定到非首选 NIC，比较性能和 CPU/PCIe 指标。

### 故障四：路径 MTU 不一致

制造小包通、大包失败，证明 MTU 断点。

### 故障五：RDMA 不可用导致 Socket 回退

观察作业是否失败或回退，以及监控能否发现“能运行但性能退化”。

所有配置变更必须限制在实验环境，并在项目结束恢复。

## 8. 报告

```text
01-topology/
02-software-firmware/
03-host-rdma/
04-gpu-rdma/
05-nccl/
06-counters/
07-failure-drills/
08-conclusions.md
```

每个 Run 都保存完整命令、原始输出、时间和 Run ID。

## 9. 验收问题

- 为什么 TCP Bootstrap 存在不代表数据走 Socket？
- 为什么 Host RDMA 正常但 GDR 仍可能失败？
- 为什么同一 NIC 的不同 GPU 结果不同？
- `busbw` 与物理 NIC 线速有什么区别？
- 发生 NCCL Timeout 时先检查哪一层？
- 如何证明修复后没有产生新的 PFC/ECN/错误副作用？

能够用项目证据回答这些问题，才能进入 Fabric 设计与无损网络阶段。
